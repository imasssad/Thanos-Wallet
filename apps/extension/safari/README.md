# Thanos Wallet — Safari extension

Safari can't side-load a raw extension folder the way Chrome / Brave do.
A Safari Web Extension ships as a **native macOS + iOS app** that embeds
the web-extension bundle. The pipeline is: WXT build → Apple converter →
Xcode build → notarize / App Store.

Everything up to the Xcode step is automated; the Xcode + signing steps
need macOS and your Apple Developer account.

## 1. Build the Safari bundle (any OS)

```bash
pnpm --filter @thanos/extension build:safari
```

WXT emits a Safari-flavoured Manifest V2 bundle to
`apps/extension/.output/safari-mv2/`. (Safari's MV3 support is still
patchy; WXT targets MV2 for Safari on purpose.)

## 2. Convert to an Xcode project (macOS + Xcode)

```bash
pnpm --filter @thanos/extension safari:convert
```

This runs `xcrun safari-web-extension-converter` (see `convert.sh`) and
writes an Xcode project to `apps/extension/safari/xcode/` with:

- App name: **Thanos Wallet**
- Bundle identifier: `ai.thanos.wallet.safari` (the host app)
  - The extension target gets `ai.thanos.wallet.safari.Extension`
- Swift app shell, both macOS and iOS targets

## 3. Configure in Xcode

Open `safari/xcode/Thanos Wallet/Thanos Wallet.xcodeproj`, then for
**each** target (host app + extension, macOS + iOS):

1. **Signing & Capabilities** → set your **Team**.
2. Confirm bundle identifiers match your App Store Connect records.
3. If the wallet ever shares a vault between the app and the extension,
   add an **App Group** (`group.ai.thanos.wallet`) to both targets —
   not required today (extension storage is self-contained) but reserve
   the identifier now.
4. Keychain / iCloud entitlements: none needed today; leave off.
5. Bump the **version + build number** to match `package.json`.

## 4. Build, run, test

- macOS: select the **Thanos Wallet (macOS)** scheme → Run. Then in
  Safari → Settings → Extensions, enable "Thanos Wallet". Safari →
  Develop menu → "Allow Unsigned Extensions" for local testing.
- iOS: select the iOS scheme → Run on a simulator/device → enable in
  Settings → Safari → Extensions.

Smoke test: open the popup, unlock, hit a dApp's connect button, confirm
the EIP-1193 provider injects (`window.thanos` present in the page).

## 5. Distribute

**App Store (recommended for Safari):**
1. Xcode → Product → Archive (macOS and iOS archives separately).
2. Distribute App → App Store Connect → upload.
3. In App Store Connect complete the listing for both the macOS and iOS
   apps, attach screenshots, submit for review.

**Direct macOS distribution (notarized .app):**
1. Archive → Distribute App → Developer ID.
2. Xcode notarizes via `notarytool` automatically when a Developer ID
   cert is selected; staple the ticket.

## Notes

- The converter overwrites `safari/xcode/` (`convert.sh` passes
  `--force`). Don't hand-edit files there — re-run the converter and
  re-apply Team settings, or keep Team config in a checked-in
  `.xcconfig`.
- `host_permissions: ['https://*/*', 'http://*/*']` from `wxt.config.ts`
  becomes a broad website-access prompt in Safari — expected for a
  wallet that injects a provider on every dApp.
- Re-run steps 1–2 after every extension code change; the Xcode project
  references the built bundle, it doesn't rebuild the web code itself.
