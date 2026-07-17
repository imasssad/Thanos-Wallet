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

Both are gated by a compile-time `MAS_BUILD=1` flag (wire in `main.tsx`:
`if (!process.env.MAS_BUILD) initAutoUpdater()`, and hide HW-wallet UI when the
renderer sees the flag via a build-time define).

## Bundle-ID decision (client to confirm)

The "Thanos Wallet" ASC record already has a **macOS platform slot** (bundle id
`litho.thanos.wallet`, team `JEYAFQ92YG`). Two options:

- **A — fill that slot** (one unified listing, iOS + macOS): build the Electron
  app with appId `litho.thanos.wallet`. Requires flipping `electron-builder.yml`
  `appId` from `ai.thanos.wallet` → `litho.thanos.wallet` for the MAS build, and
  the entitlements already assume this.
- **B — separate record** for the desktop app (its own bundle id, e.g.
  `ai.thanos.wallet`): cleaner separation, but a second listing/metadata set.

Recommendation: **A** — it uses the slot the client already created.

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
- [ ] Us: `MAS_BUILD` flag — disable auto-updater + HW-wallet UI
- [ ] Us: run the MAS workflow → get the `.pkg`
- [ ] Client (on a Mac): Transporter upload → ASC macOS slot
- [ ] Iterate on review feedback until approved
