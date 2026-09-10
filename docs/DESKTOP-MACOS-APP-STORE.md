# Thanos Desktop → Mac App Store (Path 2)

Publishing the **Electron desktop app** to the Mac App Store. This is a real
project, not an EAS build — EAS only builds iOS/Android. The build runs on
GitHub's macOS runners *or* locally on a Mac
(`bash apps/desktop/scripts/build-macos.sh --mas`); the hard part is **App
Sandbox compliance**, which the Store requires.

**Status (2026-09):** submission in progress. The separate macOS record exists
in App Store Connect (bundle id `ai.thanos.wallet`). Remaining work is the
Apple-account setup in the runbook below. Everything in the repo is ready.

**Release hold:** the client wants macOS/Windows to go *live* only after the
other open issues clear. Uploading the `.pkg` and going through review is fine —
just do not click *"Release this version"* in ASC after approval until the hold
is lifted.

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

## Runbook — Apple-account setup (only the client can do this)

From the Apple Developer account (team `JEYAFQ92YG`):

1. **App Store Connect → macOS app record** — DONE. Separate record, bundle id
   `ai.thanos.wallet` (not a slot on the iOS "Thanos Wallet" record — bundle ids
   differ). If the iOS record shows an empty macOS slot, remove it.
2. **Identifiers → App ID `ai.thanos.wallet`** — enable **App Sandbox** +
   **Keychain Sharing** capabilities.
3. **Certificates** — create **Apple Distribution** (signs the `.app`) *and*
   **Mac Installer Distribution** (signs the `.pkg`). Export **both into one
   `.p12`**.
4. **Profiles → Mac App Store provisioning profile** for `ai.thanos.wallet`,
   tied to the Apple Distribution cert → download the `.provisionprofile`.
5. **Upload credential** — reuse the **App Store Connect API key** already set up
   for EAS iOS submit (Issuer ID + Key ID + `.p8`), or an app-specific password.

Then, to build in CI, add as GitHub repo secrets (Settings → Secrets → Actions):
`MAS_CSC_LINK` (`base64 -i certs.p12`), `MAS_CSC_KEY_PASSWORD`,
`MAS_PROVISION_PROFILE` (`base64 -i profile.provisionprofile`),
`APPLE_TEAM_ID` = `JEYAFQ92YG`.

To build locally on a Mac instead: double-click the `.p12` to import both certs
into the login keychain, put the profile at
`apps/desktop/build/thanos-mas.provisionprofile`, then
`bash apps/desktop/scripts/build-macos.sh --mas`.

## The build

Once the certs/profile exist:

- **CI:** add the `MAS_*` repo secrets, then **Actions → "Desktop Mac App Store
  build" → Run workflow** → produces a signed, sandboxed **`.pkg`** artifact
  (`thanos-desktop-mas-pkg`). Download it.
- **Local (Mac):** `bash apps/desktop/scripts/build-macos.sh --mas` →
  `apps/desktop/release/mas/Thanos Wallet-<version>.pkg`.

Then on a Mac, upload to the macOS ASC record with **Transporter** (drag the
`.pkg` in) or:

```bash
xcrun altool --upload-app -f "apps/desktop/release/mas/Thanos Wallet-<version>.pkg" \
  -t macos --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

The build shows up under the macOS record → complete metadata + macOS
screenshots (1280×800 or 2560×1600) + the 3.1.5(b) crypto answers → submit for
review. **Do not "Release this version" after approval until the release hold
clears.**

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

- [x] Bundle id decided: `ai.thanos.wallet`, separate desktop record
- [x] Client: create the macOS app record in App Store Connect (done 2026-09)
- [x] Us: `MAS_BUILD` flag — disable auto-updater + HW-wallet UI (done 2026-07-18)
- [x] Us: `mas:` target, entitlements, CI workflow, `build-macos.sh --mas` (staged)
- [ ] Client: App ID `ai.thanos.wallet` — enable App Sandbox + Keychain Sharing
- [ ] Client: create + export the 2 certs (one `.p12`) + MAS provisioning profile
- [ ] Client: add the 4 repo secrets *(CI path)* — or install cert+profile on the Mac *(local path)*
- [ ] Build the `.pkg` (CI workflow or `build-macos.sh --mas`)
- [ ] Client (on a Mac): Transporter / `altool` upload → macOS ASC record
- [ ] Complete metadata + macOS screenshots + 3.1.5(b) answers → submit for review
- [ ] Iterate on review feedback until approved
- [ ] **Hold:** do not "Release this version" until the macOS/Windows release hold clears
