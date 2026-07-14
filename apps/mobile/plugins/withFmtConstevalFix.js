// Expo config plugin — fixes the fmt "call to consteval function ... is not a
// constant expression" iOS build error under Xcode 26 (Apple clang 21+).
//
// WHY THE OBVIOUS FIX DOES NOT WORK
// React Native 0.79.6 pulls fmt 11.0.2 (via RCT-Folly) and compiles every pod,
// including fmt, at C++20. In fmt 11.0.2, include/fmt/base.h defines
// FMT_USE_CONSTEVAL through an UNCONDITIONAL #if/#elif cascade with NO
// `#ifndef` guard. Under Xcode 26 / clang 21 at C++20 the
// `#elif defined(__cpp_consteval)` branch fires and sets FMT_USE_CONSTEVAL 1,
// so FMT_CONSTEVAL == consteval and format-inl.h's compile-time checks are
// rejected. Because the macro is a COMPUTED OUTPUT, a `-D FMT_USE_CONSTEVAL=0`
// (whether via GCC_PREPROCESSOR_DEFINITIONS or a header edit at prebuild time)
// is silently overwritten by base.h — that is why the previous approach here
// had zero effect.
//
// THE FIX
// Compile ONLY the fmt pod target as C++17. In fmt's cascade,
// `#elif FMT_CPLUSPLUS < 201709L` then fires (C++17 => 201703L) and sets
// FMT_USE_CONSTEVAL 0, so FMT_CONSTEVAL expands to nothing and every consteval
// site in format-inl.h (lines 59/60/1387/1391/1394) disappears. This drives
// fmt's own detection logic instead of fighting it, and CLANG_CXX_LANGUAGE_STANDARD
// set directly on the target's build_configurations in the pbxproj overrides the
// value the fmt.podspec sets via pod_target_xcconfig. fmt 11.0.2 fully supports
// C++17, and only src/format.cc is built as the fmt translation unit, so scoping
// the downgrade to the fmt target is safe — folly / RN / other pods stay C++20.
//
// ROBUSTNESS
// The block is injected into the generated Podfile's post_install hook
// IMMEDIATELY AFTER the react_native_post_install(...) call, so RN's own
// post-install pass (which re-normalizes C++ language settings) has already run
// and cannot undo it. Idempotent via a marker comment. Managed / CNG workflow:
// this re-runs on every `expo prebuild` on EAS; no committed ios/ needed.
//
// REMOVE this plugin once React Native ships fmt >= 12.x on Xcode 26 (RN >= 0.83.9
// / Expo SDK 56), which builds cleanly without the workaround.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'fmt C++17 consteval fix';

const INJECT = [
  '',
  `    # --- ${MARKER} (Xcode 26 / Apple clang 21) — injected by withFmtConstevalFix ---`,
  '    # Build the fmt pod as C++17 so fmt disables its consteval code path.',
  '    # Runs AFTER react_native_post_install so RN cannot re-normalize it back to C++20.',
  '    installer.pods_project.targets.each do |fmt_fix_target|',
  "      if fmt_fix_target.name == 'fmt' || fmt_fix_target.name.start_with?('fmt')",
  '        fmt_fix_target.build_configurations.each do |fmt_fix_config|',
  "          fmt_fix_config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'",
  '        end',
  '      end',
  '    end',
  `    # --- end ${MARKER} ---`,
].join('\n');

// Matches the (possibly multi-line) react_native_post_install(...) call and
// captures up to its closing ")" on its own line. Non-greedy so it stops at the
// first line that is whitespace followed by ")".
const ANCHOR = /react_native_post_install\([\s\S]*?\n[ \t]*\)/;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return cfg;

      let contents = fs.readFileSync(podfilePath, 'utf8');

      // Idempotent: bail if we've already injected the fix.
      if (contents.includes(MARKER)) return cfg;

      if (ANCHOR.test(contents)) {
        // Preferred: insert immediately AFTER react_native_post_install(...).
        contents = contents.replace(ANCHOR, (m) => `${m}\n${INJECT}`);
      } else {
        // Fallback: no react_native_post_install call found (unexpected on
        // Expo SDK 53). Append at the very end of the post_install block,
        // before its closing "end", so nothing runs after us either.
        const blockStart = contents.indexOf('post_install do |installer|');
        if (blockStart === -1) {
          throw new Error(
            'withFmtConstevalFix: could not find react_native_post_install(...) or ' +
              'a post_install block in the generated Podfile — cannot apply the fmt C++17 fix.',
          );
        }
        // Find the matching "end" for this post_install block by scanning for
        // the last "\n  end" (2-space indent = block-level) after blockStart.
        const tail = contents.slice(blockStart);
        const endMatch = tail.match(/\n[ \t]*end[ \t]*(\r?\n)?[ \t]*$/);
        if (endMatch) {
          const insertAt = blockStart + endMatch.index;
          contents =
            contents.slice(0, insertAt) + `\n${INJECT}` + contents.slice(insertAt);
        } else {
          throw new Error(
            'withFmtConstevalFix: found post_install block but could not locate its ' +
              'closing "end" to inject the fmt C++17 fix.',
          );
        }
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};
