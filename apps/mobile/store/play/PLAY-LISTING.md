# Google Play — first-publish kit (Thanos Wallet)

**Authoritative Play doc.** Supersedes the version numbers in
[`docs/store-listing.md`](../../../../docs/store-listing.md) (that file predates
1.1.x). Everything below is ready to paste into Play Console.

| | |
|---|---|
| Package name | `ai.thanos.wallet` |
| App version | **1.1.2** (versionCode **15**) |
| Binary | `.aab` from EAS `production` profile — build `286f8dde` |
| Signing | Google Play App Signing + local upload key `android-upload.jks` (same key as the direct-download APK, so installs upgrade in place) |
| Category | Finance |
| App or game | App |
| Free or paid | Free |
| Contains ads | No |

Assets are in this folder:
- `icon-512.png` — 512×512 store icon (matches the launcher icon)
- `feature-graphic.png` — 1024×500 feature graphic (required)
- **Screenshots** — the only asset still needed (see §7)

---

## 1. Store listing (Main store listing)

- **App name (30):** `Thanos Wallet`
- **Short description (80):**
  `Web4 multi-chain wallet for Lithosphere, Bitcoin, Ethereum and Solana`
- **Full description (paste as-is):**

```
Thanos Wallet is the official Web4-native wallet for the Lithosphere network. Manage Bitcoin, Ethereum, Solana, and Lithosphere assets in one secure, self-custodial app.

Features:
- Multi-chain: BTC, ETH, SOL, LITHO and all LEP100 tokens
- Lithosphere Mainnet + Makalu, plus 8 EVM networks (Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche, Linea)
- WalletConnect — connect to any dApp
- Built-in multi-chain dApp browser
- Biometric unlock (fingerprint / face)
- Encrypted on-device vault — your keys never leave your device
- Real-time portfolio tracking and transaction history
- QR scanner for addresses and payments
- DNNS name resolution (.litho addresses)

Thanos Wallet is self-custodial. Your keys, your crypto.
```

- **App icon:** `icon-512.png`
- **Feature graphic:** `feature-graphic.png`
- **Category:** Finance · **Tags:** Crypto, Finance
- **Contact email:** `support@thanos.fi` (dev contact `devs@thanos.fi`)
- **Website:** `https://thanos.fi`
- **Privacy policy:** `https://thanos.fi/privacy`  ← already live

---

## 2. App access

Select **"All functionality is available without any special access"** — the
wallet needs no login/account. Paste into the notes:

```
Thanos Wallet is a self-custodial crypto wallet. No account or login is required.
The reviewer creates a wallet in-app (Create Wallet -> set a password); all screens
(portfolio, receive, activity, dApp browser, settings) are reachable with a fresh,
empty wallet — no funds needed. WalletConnect can be tested at https://ignite.trade
(Connect Wallet -> WalletConnect).
```

## 3. Ads
**No**, the app contains no ads.

## 4. Content rating (IARC questionnaire)
Category: **Utility, Productivity, Communication, or Other**. Answers:
- Violence / scary / sexual / crude-humor / language: **None**
- Controlled substances: **None**
- Does the app share the user's current location: **No**
- Gambling (simulated or real): **No** — a crypto wallet is not gambling
- User-generated content / user-to-user communication: **No**
- Is it a finance app dealing in crypto: **Yes** (informational)
- Digital purchases: **No** (no IAP/paid digital goods)

→ Expected rating: **Everyone / PEGI 3**. (This is separate from Target
audience in §5, which is 18+.)

## 5. Target audience and content
- **Target age:** **18 and over** only. Do **not** tick any under-18 band.
- **Appeals to children:** **No.**
- Store presence for under-18: N/A.

## 6. Data safety
The production build collects **no** analytics/crash data — Sentry is compiled in
but is a **no-op** unless `EXPO_PUBLIC_SENTRY_DSN` is set, and it is not set for
the `production` profile (confirmed in the build env). Keys/seed are generated
and stored **on-device only** and are never transmitted. Wallet addresses are
sent to Thanos' own indexer/API purely to fetch balances/activity (user-provided
public identifiers, transient, not linked to identity).

Answers:
- **Does your app collect or share any of the required user data types?** → **No.**
- Data encrypted in transit: **Yes** (HTTPS/TLS).
- Users can request data deletion: N/A (no account); "Delete wallet" wipes all
  local data on-device.

> ⚠️ If you ever set `EXPO_PUBLIC_SENTRY_DSN` for a production build, this answer
> must change to declare **App info & performance → Crash logs, Diagnostics** and
> **Device or other IDs** (collected, not shared, encrypted in transit).

## 6b. Financial features declaration  ← crypto-specific, do not skip
Play now asks crypto apps to declare this (App content → Financial features).
- "Does your app provide financial features?" → **Yes**
- Select **Crypto assets** → **"Non-custodial / software wallet"**
  (Thanos never holds user funds or keys).
- If asked whether the app is a **crypto exchange**: the in-app Swap/Bridge route
  through **third-party non-custodial DEXs**; Thanos does not custody funds or
  operate an exchange. Declare accordingly.
- Have the legal entity ready (**KaJ Labs LLC**) — Google may ask who operates the
  app and, for some countries, request registration/licensing evidence. See §9.

## Other declarations
- News app: **No** · Government app: **No** · Health: **No** · COVID-19: **No**

---

## 7. Screenshots — the one asset still needed
Play requires **2–8 phone screenshots**: 24-bit PNG/JPG (**no alpha**), each side
**320–3840px**, aspect ratio **≤ 2:1**. Recommended **1080×2160** portrait.

⚠️ The iOS App Store screenshots (1290×2796 = 2.17:1) are **too tall** for Play and
will be rejected as-is. Two options:
- **Send me the iOS screenshots** and I'll reframe them to Play-legal 1080×2160
  (≤2:1) — no new captures needed.
- Or capture fresh on an Android device/emulator: `adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png`.

Suggested set: Portfolio · Receive (QR) · Activity/tx detail · dApp browser · Swap.

---

## 8. Release
- Track: **Production** (or **Internal testing** first for a fast smoke test).
- Upload `.aab` (versionCode 15). Play will link it to Play App Signing.
- **Release name:** `1.1.2 (15)`
- **Release notes (paste):**

```
<en-US>
- Lithosphere Mainnet support (LITHO, EVM chain 9005)
- Tap any past transaction for full on-chain details (fee, nonce, status)
- Accurate activity amounts and network-aware Send/Receive
- New app icon and many stability fixes
</en-US>
```

- **Countries:** select your launch markets (exclude any where you can't meet
  crypto licensing — see §9).

---

## 9. Crypto policy note (read before submitting)
Google Play's Financial Services policy covers "Crypto Exchanges and Software
Wallets." A **non-custodial software wallet** like Thanos is permitted **without**
an exchange license in most regions (this is how MetaMask and Trust Wallet ship on
Play). Keys to a smooth review:
- Declare it honestly as **non-custodial** (§6b) — do not describe it as an exchange.
- The full description already says "self-custodial … your keys never leave your
  device," which matches the declaration.
- A few countries still restrict crypto apps; if Google flags a market, deselect
  it in §8 rather than fight it.
- This is the Android analogue of the iOS 3.1.5 issue — but Play is materially more
  lenient, and unlike iOS the Swap/Bridge/TGE features are **not** gated on Android.

---

## 10. Ordered Console steps
1. **All apps → Create app** → name `Thanos Wallet`, language en-US, App, Free, accept declarations.
2. **Set up your app** panel → work top-to-bottom: App access (§2), Ads (§3),
   Content rating (§4), Target audience (§5), Data safety (§6), **Financial features (§6b)**,
   News/Government/Health = No.
3. **Store listing** → paste §1, upload `icon-512.png` + `feature-graphic.png` + screenshots (§7).
4. **Production → Create new release** → upload the `.aab`, paste §8 release notes,
   pick countries → **Save → Review release → Roll out to production**.
5. First-app review typically takes **a few days to ~2 weeks** (crypto apps get extra scrutiny).

## 11. Future: one-command submits (optional)
To let `eas submit --platform android` push future builds automatically:
- Play Console → **Setup → API access** → create/link a **service account**, grant it
  **Release** permission.
- Download its JSON to `apps/mobile/credentials/play-service-account.json` (gitignored).
- `eas.json` submit config already points there (`track: production`, `releaseStatus: draft`).
- Note: the **first** release must be created **manually** in the Console anyway — the
  service account can only push updates once the listing exists and is approved.
