# Store-submission asset checklist

What's committed in the repo today, and what we still need from Esha
before each submission can ship.

Updated 2026-05-28 at commit `a8e3dde` (with the icon-resize fixes from
the next commit).

## Summary

| Asset class | Status |
|-------------|--------|
| **All runtime icons** (favicon, app icons, taskbar, dock) | ✅ in repo |
| **Store-listing app icons** (1024×1024, 512×512) | ✅ fixed in this commit |
| **Marketing promo graphics** (Chrome Web Store tiles, Play feature graphic) | ⏳ Esha |
| **Device screenshots** (App Store, Play Store, Chrome Web Store) | ⏳ Esha |

## In the repo today

### Web app — `apps/web/public/`
| File | Size | Used by |
|------|------|---------|
| `favicon.ico` | multi | Browser tab |
| `favicon-16x16.png` | 16×16 | Browser tab |
| `favicon-32x32.png` | 32×32 | Browser tab |
| `apple-touch-icon.png` | 180×180 | iOS home-screen PWA |
| `android-chrome-192x192.png` | 192×192 | Android home-screen PWA |
| `android-chrome-512x512.png` | 512×512 | Android home-screen PWA |

### Browser extension — `apps/extension/public/icons/`
| File | Size | Used by |
|------|------|---------|
| `icon16.png` | 16×16 | Toolbar |
| `icon32.png` | 32×32 | Toolbar (HiDPI) |
| `icon128.png` | 128×128 | Chrome Web Store listing **AND** `chrome://extensions` |
| `icon512.png` | 512×512 | Source for store assets |

### Desktop (Electron) — `apps/desktop/build/icons/`
| File | Size | Used by |
|------|------|---------|
| `icon.png` | **1024×1024** ✓ | electron-builder source for `.icns` (macOS) + dock icon |
| `icon@2x.png` | 512×512 | HiDPI window icon |
| `icon.ico` | 16, 32, 48, 64, 128, **256** ✓ | Windows taskbar + installer |

`.icns` (macOS) is generated automatically by electron-builder from
`icon.png` at build time — see [electron-builder.yml](../apps/desktop/electron-builder.yml) `icon: build/icons/icon.png`.

### Mobile (Expo) — `apps/mobile/assets/images/`
| File | Size | Used by |
|------|------|---------|
| `icon.png` | **1024×1024** ✓ | Expo's iOS App Icon |
| `logo.png` | **1024×1024** ✓ | Expo `app.json` icon source (App Store + Play Store) |
| `Thanos_Logo_Transparent.png` | 1563×1563 | Adaptive icon foreground (Android) |
| `apple-touch-icon.png` | 180×180 | iOS home-screen PWA (web view) |

## Still required from Esha

### Chrome Web Store — marketing tiles
Esha must produce these as branded marketing graphics (not auto-derivable from the logo):
| Asset | Size | Required / optional | Where it shows up |
|-------|------|---------------------|-------------------|
| Small promo tile | 440×280 | **required** | Search results + extension card |
| Large promo tile | 920×680 | optional | Detail page hero |
| Marquee | 1400×560 | optional | Featured-extension shelf |
| Screenshots | 1280×800 (×3-5) | **required** | Detail page carousel |

### iOS App Store — Connect screenshots
| Device class | Size (per orientation) | Min |
|--------------|------------------------|-----|
| iPhone 6.7" (15/16 Pro Max) | 1290×2796 | 3 |
| iPhone 6.5" (XS Max, 11 Pro Max) | 1242×2688 | 3 |
| iPhone 5.5" (8 Plus) | 1242×2208 | 3 |
| iPad 12.9" | 2048×2732 | 1 (optional) |
| iPad 11" | 1668×2388 | 1 (optional) |

### Google Play — feature graphic + screenshots
| Asset | Size | Required |
|-------|------|---------|
| Feature graphic | 1024×500 | **required** for store listing |
| Phone screenshots | 1080×1920 minimum | **2-8 required** |
| Tablet screenshots | 7" + 10" | optional |

### Brave / Firefox / Safari
Brave + Firefox use the Chrome Web Store assets unchanged. Safari needs
a 12.9" iPad screenshot in the Mac App Store flow (`.app` wrap) —
Esha's Mac screenshots in the iOS pack cover this if `.app` packaging
targets macOS Catalyst.

## How to capture screenshots

If Esha wants engineering help:
- iOS: `pnpm --filter @thanos/mobile ios` → Cmd+S in simulator
- Android: `pnpm --filter @thanos/mobile android` → run `adb shell screencap -p /sdcard/screenshot.png && adb pull /sdcard/screenshot.png`
- Web (for Chrome store): https://thanos.fi in a 1280×800 browser window → browser's built-in screenshot tool
- Extension: open in popup → Chrome dev-tools → Capture node screenshot

Or pipe the operator-side ops/screenshot-capture script (already in repo) once dev-mode reproductions are wired.

## Submission-readiness gate

Each store submission is gated on:
- Cert in `secrets` ✓ (delivered by Esha)
- App icon at correct size ✓ (already in repo as of this commit)
- Marketing graphic ⏳ (Esha)
- Screenshots ⏳ (Esha)
- Store-listing copy ✓ (skeleton at `apps/{mobile,extension}/store-listing/`, may need Esha-side polish)
- Privacy policy URL ✓ ([docs/privacy-policy.md](privacy-policy.md))
- Support URL ✓ (https://thanos.fi/support — once deployed; the route exists)

Once Esha hands over the marketing graphics + screenshots, the release
pipelines in [.github/workflows/release.yml](../.github/workflows/release.yml) + EAS + electron-builder can produce signed, store-ready artifacts on `git tag v1.0.0`.
