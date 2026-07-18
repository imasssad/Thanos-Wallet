# Thanos Desktop → Mac App Store (Path 2)

Publishing the **Electron desktop app** to the Mac App Store. This is a real
project, not an EAS build — EAS only builds iOS/Android. The Mac build runs on
GitHub's macOS runners; the hard part is **App Sandbox compliance**, which the
Store requires.

## The two product decisions the Store forces

The direct-download build (`entitlements.mac.plist`, Developer ID) keeps the
sandbox OFF. The Store requires it ON, and that removes two capabilities from
the **MAS build only** (the direct-download `.dmg` keeps them):

1. **Hardware wallets (Ledger / Trezor) — dropped in the MAS build.** Sandboxed
   MAS apps can't get the raw USB/HID access those transports need. The MAS
   build must hide the "Connect a device" flow (software keys only). Ledger/
   Trezor stay in the direct-download build.
2. **Auto-update — dropped in the MAS build.** `electron-updater` is an
   automatic MAS rejection; the App Store delivers updates. The MAS build must
   not initialize the updater.

Both are gated and WIRED (2026-07-18):
- **Auto-updater** — `startAutoUpdater()` (`src/main/updater.ts`) early-returns
  when `process.mas` is true. `process.mas` is Electron's runtime flag, set only
  in a Mac App Store build — so this needs no build env var and leaves the
  direct-download `.dmg`/`.exe` build untouched.
- **Hardware-wallet UI** — a Vite `define` (`vite.config.ts`) exposes
  `__MAS_BUILD__` (from `MAS_BUILD=1`) to the renderer; `globals.d.ts` types it.
  The Settings "Hardware wallet" row, the Send "Sign with" Ledger/Trezor
  selector, and the `HardwareModal` mount are all gated `{!__MAS_BUILD__ && …}`,
  so `MAS_BUILD=1 pnpm build` dead-code-eliminates them and tree-shakes the
  eager `@ledgerhq/hw-transport-webhid` import out of the bundle. (The lazy
  `vendor-hardware` chunk still exists but is never loaded under MAS — its only
  entry points are the hidden selector buttons.)

Verified: `MAS_BUILD=1 pnpm build` produces a bundle with no HW-wallet UI
strings and no eager WebHID import; a normal build keeps them.

## Bundle-ID decision — DECIDED: `ai.thanos.wallet` (separate desktop record)

The desktop app ships under its **own** ASC record, bundle id
`ai.thanos.wallet` (team `JEYAFQ92YG`) — matching `electron-builder.yml` appId.
The MAS provisioning profile (below) must be created for `ai.thanos.wallet`.
(The empty macOS slot on the iOS "Thanos Wallet" record is unrelated and can be
removed — that was for the abandoned Catalyst path.)

## What the client must obtain from Apple (only they can)

From the Apple Developer account (team JEYAFQ92YG), create and export:

1. **Apple Distribution** (a.k.a. Mac App Distribution) certificate → `.p12`
2. **Mac Installer Distribution** certificate → `.p12`
   (bundle BOTH into one `.p12` for `MAS_CSC_LINK`)
3. **App ID** for the chosen bundle id with the **Keychain Sharing** +
   **App Sandbox** capabilities enabled
4. **Mac App Store provisioning profile** for that App ID → `.provisionprofile`
5. **App-specific password** (or an ASC API key) for the upload step

Add as GitHub repo secrets (Settings → Secrets → Actions):
`MAS_CSC_LINK`, `MAS_CSC_KEY_PASSWORD`, `MAS_PROVISION_PROFILE`, `APPLE_TEAM_ID`.
(`base64 -i cert.p12 | pbcopy` to produce the secret values.)

## The build

Once the secrets are in:

- **Actions → "Desktop Mac App Store build" → Run workflow** → produces a
  signed, sandboxed **`.pkg`** artifact (arm64 + x64).
- Download it, then on a Mac upload to App Store Connect with **Transporter**
  (or `xcrun altool --upload-app`). It lands in the macOS App slot → complete
  the metadata → submit for review.

The build config is staged and committed:
- `apps/desktop/build/entitlements.mas.plist` + `.inherit.plist` (sandboxed)
- `apps/desktop/electron-builder.yml` → `mas:` target
- `.github/workflows/desktop-macos-appstore.yml`

## Honest risk + timeline

The sandbox entitlement set and Electron-MAS specifics (JIT, helper signing,
keytar under the keychain access group) are a **validated starting point** —
they get finalized against real App Store review iteration on a Mac. Expect
**1–3 review rounds** over ~1–2 weeks: the first rejections are usually a
missing entitlement justification or a sandbox violation the crash logs point
at. This is normal for Electron-in-MAS; budget for it rather than expecting a
one-shot approval.

## Phase checklist

- [ ] Client: confirm bundle-ID option (A vs B)
- [ ] Client: create + export the 2 certs, App ID, provisioning profile
- [ ] Client: add the 4 repo secrets
- [x] Us: `MAS_BUILD` flag — disable auto-updater + HW-wallet UI (done 2026-07-18)
- [ ] Us: run the MAS workflow → get the `.pkg`
- [ ] Client (on a Mac): Transporter upload → ASC macOS slot
- [ ] Iterate on review feedback until approved
