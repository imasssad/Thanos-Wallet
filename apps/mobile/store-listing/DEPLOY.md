# Mobile deployment — App Store + Play Store

Everything needed to ship `@thanos/mobile` to both stores. Builds run on
**EAS** (Expo's cloud), so you do **not** need a Mac to ship iOS.

The build + submit config already lives in the repo:
- `app.json` — bundle id `ai.thanos.wallet` (iOS) / package `ai.thanos.wallet` (Android), version, permissions, icons.
- `eas.json` — `build.production` (iOS store + Android app-bundle, auto-increment) and `submit.production` (App Store + Play).
- `credentials/` — where the two submit keys go (gitignored). See `credentials/README.md`.

---

## 0. One-time accounts + tools

| Need | Where |
|---|---|
| Apple Developer Program ($99/yr) | developer.apple.com |
| App created in App Store Connect | App Store Connect → My Apps → **+** (bundle `ai.thanos.wallet`) |
| Google Play Developer ($25 once) | play.google.com/console |
| App created in Play Console | Play Console → Create app (package `ai.thanos.wallet`) |
| Expo account (free) | expo.dev — project id is already wired in app.json (`edaba20e-…`) |
| `eas-cli` | `npm install -g eas-cli` then `eas login` |

Gather the submit credentials per **`credentials/README.md`**:
- `credentials/asc-api-key.p8` + the ASC_* env values (iOS)
- `credentials/play-service-account.json` (Android)

---

## 1. Bump the version (each release)

Edit `app.json`:
- `expo.version` — marketing version, e.g. `1.0.0` → `1.0.1` (both platforms).

You do **not** need to touch `ios.buildNumber` / `android.versionCode` —
`eas.json`'s production profile has `autoIncrement: true`, so EAS bumps the
build number / version code automatically on every build.

---

## 2A. Ship — the easy path (one command, local)

From `apps/mobile`, with `eas login` done and the two credential files in
`credentials/`:

```bash
# build BOTH platforms on EAS, then auto-submit each to its store
npm run deploy:all
```

Or split:
```bash
npm run release:ios     && npm run submit:ios       # build then submit iOS
npm run release:android && npm run submit:android   # build then submit Android
```

- iOS lands in App Store Connect → TestFlight, ready to add to a store
  review submission.
- Android lands in the Play Console **production** track as a **draft**
  (`releaseStatus: draft` in eas.json) — review and click *Send for review*.

## 2B. Ship — the CI path (tag a release)

Set these GitHub repo secrets once (Settings → Secrets and variables →
Actions):

| Secret | Value |
|---|---|
| `EXPO_TOKEN` | expo.dev → Account → Access tokens |
| `ASC_API_KEY_BASE64` | `base64 -i credentials/asc-api-key.p8` |
| `ASC_APPLE_ID` | Apple ID email |
| `ASC_APP_ID` | numeric App Store app id |
| `APPLE_TEAM_ID` | 10-char team id |
| `ASC_API_KEY_ID` | ASC API key id |
| `ASC_API_KEY_ISSUER_ID` | ASC API issuer id |
| `PLAY_SERVICE_ACCOUNT_BASE64` | `base64 -i credentials/play-service-account.json` |

Then:
```bash
git tag mobile-v1.0.0 && git push origin mobile-v1.0.0
```

`.github/workflows/mobile-release.yml` builds both platforms on EAS and
auto-submits. You can also run it manually (Actions → mobile-release →
Run workflow) and pick the platform / whether to submit.

> macOS signing certs + the Android keystore are managed by **EAS**, not
> this repo. First `eas build` generates and stores them; run
> `eas credentials` to inspect or replace them.

## 2C. Ship a shareable test APK (sideload, no store)

When you just need to hand someone an installable Android build (testing,
client review) — **not** a Play Store submission — build an **APK** instead
of the store `.aab`. This is a managed Expo app (no committed `android/`
project), so the APK is built on **EAS**, same as the store builds:

```bash
cd apps/mobile
eas login           # once
npm run apk         # builds the production-apk profile on EAS
```

When the build finishes, EAS prints a **download URL** for the `.apk` (also
visible at expo.dev → project → Builds). Send that link or the downloaded
`.apk` file. The recipient enables "Install unknown apps" on their phone and
taps the APK — no Play Store, no Apple account, no signing setup needed.

- `npm run apk` is interactive (lets EAS create the keystore on first run).
- `npm run apk:ci` is the non-interactive variant for CI.
- The APK uses the `production-apk` profile (release build, internal
  distribution) — see `eas.json`.

---

## 3. First-submission gotchas

- **iOS:** the app must exist in App Store Connect before `eas submit`
  works, and the first build must be attached to a version + sent through
  *App Review* manually in ASC (TestFlight is automatic, store release is
  not).
- **Android:** the **first** AAB must be uploaded **manually** to the Play
  Console (any track) to register the app's signing before the service
  account can push to `production`. After that, automated submits work.
- **Encryption declaration:** `ITSAppUsesNonExemptEncryption: false` is set
  in app.json — correct for a wallet that only uses standard
  crypto/HTTPS, so Apple won't block on export compliance.

---

## 4. Store listing copy

Marketing text, screenshots spec and review notes live in:
- `store-listing/ios.md`
- `store-listing/android.md`
