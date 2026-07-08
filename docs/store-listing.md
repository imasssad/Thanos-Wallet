# Thanos Wallet — Store Listing Pack (iOS + Android)

Everything the App Store Connect / Play Console forms ask for, ready to paste.
Build config lives in `apps/mobile/app.json` + `eas.json` (bundle/package
`ai.thanos.wallet`, version **1.0.0**, iOS buildNumber **1**, Android
versionCode **1**).

## Shared

| Field | Value |
|---|---|
| App name | Thanos Wallet |
| Category | Finance |
| Privacy policy URL | https://thanos.fi/privacy |
| Support / marketing URL | https://thanos.fi |
| Support email | devs@thanos.fi |

### Full description (both stores)

Thanos Wallet is the official Web4-native wallet for the Lithosphere network.
Manage Bitcoin, Ethereum, Solana, and Lithosphere assets in one secure app.

Features:
- Multi-chain support: BTC, ETH, SOL, LITHO and all LEP100 tokens
- Hardware wallet support: Ledger and Trezor
- WalletConnect — connect to any dApp
- Biometric unlock with Face ID and fingerprint
- DNNS name resolution (.litho addresses)
- Cross-chain bridge and swap
- Real-time portfolio tracking
- QR scanner for addresses and payments
- Encrypted vault — your keys never leave your device

Thanos Wallet is self-custodial. Your keys, your crypto.

## iOS (App Store Connect)

| Field | Value |
|---|---|
| Subtitle (30 chars max) | Web4 Multi-Chain Wallet |
| Keywords (100 chars max) | wallet,crypto,lithosphere,bitcoin,solana,ethereum,web3,defi,litho,nft |
| Age rating | 17+ (unrestricted web access — the in-app dApp browser) |
| App uses non-exempt encryption | No (`ITSAppUsesNonExemptEncryption=false` already set) |

Permission strings (already in `app.json` → Info.plist):
- **Camera** — "Thanos Wallet uses the camera to scan QR codes for wallet addresses and WalletConnect pairing."
- **Face ID** — "Thanos Wallet uses Face ID to unlock your wallet quickly and securely."
- Notifications need **no** Info.plist string on iOS — the system permission
  prompt is standard and text cannot be customized.

App Privacy (privacy "nutrition label") answers:
- Data collected: **none linked to identity**. The wallet is self-custodial;
  keys/seed never leave the device. The app talks to Thanos' own indexer/API
  (balances, activity for provided addresses) and public RPC endpoints.
- Tracking: **No**.

## Android (Play Console)

| Field | Value |
|---|---|
| Short description (80 chars) | Web4 multi-chain wallet for Lithosphere, Bitcoin, Ethereum and Solana |
| Content rating questionnaire | Finance category; gambling: No; crypto exchange: No (self-custodial wallet); user-generated content: No |
| Data safety | No data collected/shared linked to users; all keys on-device, encrypted |
| Ads | No |
| Target audience | 18+ |

## Assets still needed (cannot be generated from the repo)

- **Screenshots** — from the live app on real devices/simulators:
  - iOS: 6.9" (1320×2868) and 6.5" (1284×2778 or 1242×2688), 3–10 each
  - Android: phone screenshots (min 2), 7"/10" tablet optional
  - Feature graphic (Android, required): 1024×500 PNG/JPG
- **Icon pack from Esha's Dropbox** — current builds use the repo logo
  (`assets/images/logo.png`); swap before building if the pack differs.

## Review notes (paste into "Notes for reviewer")

Thanos Wallet is a self-custodial crypto wallet. No account/login is required —
the reviewer can create a wallet in-app (Create Wallet → set password). Funds
are not needed to review: all screens (portfolio, receive, activity, browser,
settings) are reachable with a fresh empty wallet. WalletConnect can be tested
against https://ignite.trade (Connect Wallet → WalletConnect).
