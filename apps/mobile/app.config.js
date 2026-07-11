/**
 * Dynamic config layer over the static app.json.
 *
 * 2026-07-12: store-profile ProGuard/resource-shrinking is DISABLED again —
 * this is now a passthrough. The v1.0.1 vc5 Play build crashed on launch;
 * the decisive pattern: every binary users ever ran successfully (all
 * sideload tester APKs, v1.05→v1.13) was UNMINIFIED, while every store
 * .aab (vc1–vc5) was the only variant with R8 + shrinkResources enabled —
 * and none was ever device-tested. Minification was worth ~30% size, not
 * a launch-crash risk on top of the SDK 53 upgrade. 16 KB page-size
 * compliance is unaffected (it comes from RN 0.79's prebuilt libs, not
 * from R8).
 *
 * If store minification is wanted again later: re-enable
 * enableProguardInReleaseBuilds/enableShrinkResourcesInReleaseBuilds for
 * EAS_BUILD_PROFILE === 'production' (keep `-dontwarn java.awt.**` — JNA
 * references desktop-only AWT), and REQUIRE a device smoke test of that
 * exact .aab via bundletool or the Play internal track before rollout.
 */
module.exports = ({ config }) => config;
