# Publishing Thanos Wallet to the App Store & Play Store — step by step

A do-this-in-order guide for whoever is publishing the app under their own
Apple + Google accounts. No Mac required — the builds run in Expo's cloud
(**EAS**), which produces the signed iOS `.ipa` and Android `.aab` for you.

> The app is already configured: bundle id / package **`ai.thanos.wallet`**,
> marketing version **1.0.0**. You don't edit code — you create the store
> accounts, plug in credentials, and run one command.

---

## Step 0 — What you need

| Thing | Cost | Where |
|---|---|---|
| Apple Developer Program | $99 / year | [developer.apple.com](https://developer.apple.com) |
| Google Play Developer | $25 once | [play.google.com/console](https://play.google.com/console) |
| Expo account | free | [expo.dev](https://expo.dev) |
| A computer with **Node 20+** | free | [nodejs.org](https://nodejs.org) |

You do **not** need a Mac, Xcode, or Android Studio.

---

## Step 1 — Install the tools

```bash
node -v          # must be 20 or higher
npm install -g eas-cli
eas --version    # confirms it installed
```

---

## Step 2 — Get the code & open the mobile folder

If you got a **zip**: unzip it, then open a terminal in that folder.
If you got **repo access**: clone it, then `cd apps/mobile`.

Either way, you should be in the folder that contains `app.json` and
`eas.json`. Install dependencies:

```bash
npm ci
```

---

## Step 3 — Log in to Expo

```bash
eas login
```

> Note: the project is currently owned by the Expo account `imasssad`
> (`owner` in `app.json`). Easiest path: log in with that account, or ask
> for it to be transferred / shared. If you want it under **your** Expo org
> instead, edit `owner` in `app.json` and run `eas init` to create a fresh
> project id.

---

## Step 4 — Create the two store listings (one-time)

These must exist **before** you can submit.

**Apple — App Store Connect**
1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps → ➕ → New App**
2. Platform iOS, bundle id **`ai.thanos.wallet`**, pick a name, primary language.
3. Note the **numeric App ID** shown on the app's *App Information* page.

**Google — Play Console**
1. [play.google.com/console](https://play.google.com/console) → **Create app**
2. Package name **`ai.thanos.wallet`**, app name, default language, app type.

---

## Step 5 — Gather the submit credentials

Put both files inside the `credentials/` folder (it's already there and is
git-ignored, so they never get committed).

**iOS — App Store Connect API key**
1. App Store Connect → **Users and Access → Integrations → App Store Connect API**
2. Create a key with the **App Manager** role. Download the `.p8` **once**
   (Apple only lets you download it a single time).
3. Save it as `credentials/asc-api-key.p8`.
4. Write down: **Key ID**, **Issuer ID** (both on that page), your **Team ID**
   (Membership page), your **Apple ID email**, and the numeric **App ID** from Step 4.

Set these in your terminal so `eas submit` can read them:

```bash
# macOS / Linux
export ASC_APPLE_ID="you@example.com"
export ASC_APP_ID="1234567890"
export APPLE_TEAM_ID="XXXXXXXXXX"
export ASC_API_KEY_ID="XXXXXXXXXX"
export ASC_API_KEY_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
```powershell
# Windows PowerShell
$env:ASC_APPLE_ID="you@example.com"
$env:ASC_APP_ID="1234567890"
$env:APPLE_TEAM_ID="XXXXXXXXXX"
$env:ASC_API_KEY_ID="XXXXXXXXXX"
$env:ASC_API_KEY_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Android — Play service account**
1. Play Console → **Setup → API access** → create a **service account**,
   grant it **Release Manager**.
2. Create a **JSON key** for it and download it.
3. Save it as `credentials/play-service-account.json`.

---

## Step 6 — Build & submit (the main command)

From `apps/mobile`:

```bash
npm run deploy:all
```

This builds **both** platforms on EAS and auto-submits each to its store.
First time, EAS will ask to generate the iOS signing certificate and the
Android keystore for you — answer **yes**; it stores and reuses them.

Prefer to do one platform at a time, or build first and submit later:

```bash
npm run release:ios      && npm run submit:ios
npm run release:android  && npm run submit:android
```

Want the files in hand instead of auto-submitting (e.g. to upload manually)?
Drop `--auto-submit` by using the `release:*` scripts above — when each build
finishes, EAS prints a URL where you can **download the `.ipa` / `.aab`**.

---

## Step 7 — Finish in the consoles (first release only)

- **iOS:** the build shows up in **TestFlight** automatically. To put it on
  the public store you must, **once**, open the app in App Store Connect, add
  it to the version, fill the store listing (screenshots, description,
  privacy), and click **Submit for Review**.
- **Android:** the very **first** `.aab` must be uploaded **manually** in the
  Play Console once (any track) to register the app's signing. After that,
  `npm run submit:android` works automatically. Your build lands in the
  **production** track as a **draft** — review it and click **Send for review**.

Store text + screenshot specs are in
[store-listing/ios.md](ios.md) and [store-listing/android.md](android.md).

---

## Step 8 — Future updates

1. Bump the marketing version in `app.json` → `expo.version` (e.g. `1.0.0` → `1.0.1`).
   You do **not** touch `buildNumber` / `versionCode` — EAS auto-increments those.
2. Run `npm run deploy:all` again.

---

## Quick troubleshooting

| Problem | Fix |
|---|---|
| `eas: command not found` | `npm install -g eas-cli` |
| Submit fails: app not found | Create the listing in Step 4 first; check the bundle/package is exactly `ai.thanos.wallet`. |
| iOS upload rejected: signing | The build must be under the **same Apple account** that owns the listing — make sure you logged into EAS / provided the ASC key for *that* account. |
| "duplicate version" on re-upload | Bump `expo.version` in `app.json` (Step 8). |
| Android first submit fails | Upload the first `.aab` manually in Play Console once (Step 7), then retry. |

Full technical reference: [store-listing/DEPLOY.md](DEPLOY.md).
