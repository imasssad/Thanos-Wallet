# Store-listing checklist

Per-store assets + submission steps. **Credentials** marked here are
required from the operator before submitting; everything else (build
config, screenshots, descriptions) is ready in this repo.

---

## Chrome Web Store

**Path:** `apps/extension/.output/thanosextension-*-chrome.zip`

**Listing assets required:**
- Icon: 128×128 PNG — use `apps/extension/public/icons/icon-128.png`
- Screenshots: 5× 1280×800 PNG (popup screens) — capture from a real
  pop-out window
- Promo tile (optional): 440×280 PNG

**Submission:**
1. Console: https://chrome.google.com/webstore/devconsole
2. Pay one-time $5 developer fee
3. Upload zip → fill description (paste from `apps/extension/public/store-description.md`)
4. Privacy policy URL: `https://thanos.fi/privacy`
5. Permissions justifications:
   - `storage` — encrypted vault + session state
   - `notifications` — tx confirmation alerts
   - `<all_urls>` (host_permissions) — EIP-1193 provider injection on
     any dApp the user visits

**Credentials needed:** Chrome Web Store developer account (one-off $5).

---

## Brave Store

Brave accepts the same MV3 zip as Chrome. The submission portal is
gated and slower; ship to Chrome first and submit to Brave afterwards
referencing the same listing.

**Submission:** https://chromewebstore.google.com/category/extensions
(Brave indexes Chrome listings) — or contact community@brave.com for
direct Brave-store inclusion if needed.

---

## Safari App Store

**Path:** `apps/extension/.output/thanosextension-*-safari.zip`

**Build pipeline:**
```bash
pnpm --filter @thanos/extension build:safari    # WXT → safari-mv2/
pnpm --filter @thanos/extension safari:convert  # → Xcode project at safari/xcode/
APPLE_TEAM_ID=ABC123XYZ \
  pnpm --filter @thanos/extension safari:archive # → .xcarchive + App Store .pkg
xcrun altool --upload-app -f apps/extension/safari/build/export/*.pkg \
  --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_API_KEY_ISSUER"
```

**Credentials needed:**
- Apple Developer Program enrolment ($99/yr)
- Developer ID Application + Mac Installer certs in the system keychain
- App Store Connect API key (`.p8` + ID + Issuer)

---

## Apple App Store (iOS)

EAS Build + EAS Submit handles this end-to-end once the credentials
are in env:

```bash
cd apps/mobile
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

**Required env (CI / shell):**
```bash
EXPO_TOKEN=…                  # eas.dev token, write-scoped
ASC_APPLE_ID=…                # Apple ID email
ASC_APP_ID=…                  # numeric ASC app id
APPLE_TEAM_ID=ABC123XYZ
ASC_API_KEY_ID=…
ASC_API_KEY_ISSUER_ID=…
ASC_API_KEY_PATH=./credentials/asc-api-key.p8
```

**Listing assets required:**
- 1024×1024 app icon (already in `assets/images/`)
- 6.5"/6.7"/iPad screenshots — capture from `eas build --profile preview`
- App preview video (optional)
- Description, keywords, privacy URL — see template at
  `apps/mobile/store-listing/ios.md`

---

## Google Play Console

```bash
cd apps/mobile
eas build --platform android --profile production
eas submit --platform android --profile production
```

**Required env:**
```bash
EXPO_TOKEN=…
# In ./credentials/play-service-account.json:
# Service account with "Release Manager" role on the Play Console.
```

**Listing assets:**
- 512×512 icon (already in `assets/images/`)
- Feature graphic 1024×500
- Phone screenshots (2–8)
- Privacy policy URL: `https://thanos.fi/privacy`

---

## Desktop installers (electron-builder)

The release workflow (`.github/workflows/release.yml`) builds + signs
the macOS `.dmg` and Windows `.exe` when these secrets exist in the
repo:

| Platform | Secret | Source |
|---|---|---|
| macOS sign | `CSC_LINK` | base64-encoded `Developer ID Application.p12` |
| macOS sign | `CSC_KEY_PASSWORD` | password for the .p12 |
| macOS notarize | `APPLE_ID` | Apple ID email |
| macOS notarize | `APPLE_APP_SPECIFIC_PASSWORD` | from appleid.apple.com → App-Specific Passwords |
| macOS notarize | `APPLE_TEAM_ID` | 10-char team id |
| Windows sign | `WIN_CSC_LINK` | base64-encoded `.pfx` from your EV cert vendor (DigiCert / Sectigo) |
| Windows sign | `WIN_CSC_KEY_PASSWORD` | password for the .pfx |

If any of those are unset, the corresponding step still emits the
unsigned artifact + a `.sha256` so users can verify integrity manually.

---

## What this repo ships

- ✅ All build scripts wired (`pnpm` / `eas build` / `electron-builder`)
- ✅ CI workflows conditional on signing secrets
- ✅ Privacy strings populated (iOS Info.plist, Android manifest)
- ✅ Submit config in `eas.json` for both stores
- ✅ Safari Xcode wrapper + archive script
- ✅ Listing copy templates per store

## What still needs operator action

- Sign up for the developer accounts
- Upload base64-encoded certs to GitHub repo secrets
- Capture screenshots from real preview builds
- Click "Submit for review" in each console
