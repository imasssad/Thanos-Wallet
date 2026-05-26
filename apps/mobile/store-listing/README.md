# Mobile store-listing assets

This folder holds everything you upload to App Store Connect and the
Play Console. Per-store description, keywords, screenshots, feature
graphic.

## File layout

```
store-listing/
├── ios.md                 — App Store Connect listing copy
├── android.md             — Play Console listing copy
├── screenshots/
│   ├── ios-6.7/           — iPhone 6.7" (1290×2796) — required for current models
│   ├── ios-6.5/           — iPhone 6.5" (1242×2688) — required if no 6.7"
│   ├── ios-5.5/           — iPhone 5.5" (1242×2208) — required if supporting older
│   ├── ios-12.9/          — iPad 12.9" (2048×2732) — optional
│   ├── android-phone/     — 1080×2400 — required
│   ├── android-tablet-7/  — 1920×1200 — recommended
│   └── android-tablet-10/ — 2560×1600 — recommended
└── feature-graphic/
    └── 1024x500.png       — Play Console feature graphic
```

## Capturing screenshots

Use the Detox-based capture script:

```bash
cd apps/mobile

# 1) Build a preview that runs against staging or against a local
#    backend with seeded fixture data.
eas build --platform ios --profile preview --local
eas build --platform android --profile preview --local

# 2) Run the capture script. Defaults to the device simulators listed in
#    eas.json `submit.production.ios.device` etc.
pnpm capture-screenshots
```

The script:
- Creates a fresh wallet inside the simulator
- Funds the address with a fixture set (LITHO, BTC, ETH) via the
  staging backend's `/dev/fund` endpoint (gated on `NODE_ENV=staging`)
- Navigates through the screens listed in `ios.md` / `android.md`
- Saves PNGs into the matching `screenshots/<form-factor>/` folder

## Localising

Both stores accept localized listings. To add a translation:

1. Copy `ios.md` to `ios-fr.md` (or whatever locale), translate.
2. Add the locale in App Store Connect → Localizations.
3. Capture screenshots with the simulator language set to that locale.

Same flow for Play Console — Main store listing → Add translations.

## Feature graphic

The 1024×500 Play Console feature graphic is the one image users see
in the Play carousel. The current draft lives at
`feature-graphic/1024x500.png` and was rendered from
`feature-graphic/template.svg`. Re-render:

```bash
inkscape -w 1024 -h 500 feature-graphic/template.svg \
  -o feature-graphic/1024x500.png
```

Or in Figma using the matching frame.
