# iOS App Store — listing copy

Paste into App Store Connect → App Information / Version Information.
Limits per Apple's current spec; truncate if needed but match the tone.

## App name (30 chars max)

Thanos Wallet

## Subtitle (30 chars max)

Lithosphere & multi-chain

## Promotional text (170 chars max, can change without resubmission)

Self-custodial wallet for Lithosphere, Bitcoin, Ethereum, Solana, and Cosmos. WalletConnect-ready, hardware-wallet-friendly, biometric-secured.

## Description (4,000 chars max)

```
Thanos Wallet is a self-custodial, multi-chain wallet built around the
Lithosphere ecosystem. One seed, every chain you care about.

WHAT YOU CAN DO

• Send and receive on Lithosphere (LITHO + LEP-100 tokens), Bitcoin,
  Ethereum and every major EVM L2, Solana with SPL tokens, and Cosmos
  Hub with memo support.
• Pair with dApps via WalletConnect v2, in-app browser, or QR scan.
• Resolve human-readable .litho names instead of pasting 0x addresses.
• Run Quantts AI trading agents from your wallet.

SECURITY

• Face ID / Touch ID unlock backed by the Secure Enclave.
• Argon2id key derivation + AES-256-GCM authenticated encryption.
• Seed phrase shown once, then masked behind a password challenge.
• Pre-send transaction simulation flags contract recipients, sketchy
  approval amounts, and insufficient-balance conditions before you
  sign.
• Phishing-domain detection on WalletConnect pairings.
• Signing isolation — your keys never live in a screen-rendering JS
  context.

OPEN SOURCE

The full source for every Thanos client is at
github.com/imasssad/Thanos-Wallet. No phone-home. No analytics. No
custodial vault. Your seed lives in the iOS Keychain, on this device,
under your password.
```

## Keywords (100 chars max, comma-separated)

wallet,crypto,bitcoin,ethereum,solana,cosmos,lithosphere,defi,web3,walletconnect

## Support URL

https://thanos.fi/support

## Marketing URL

https://thanos.fi

## Privacy policy URL

https://thanos.fi/privacy

## App Privacy — Data collection disclosure

(App Store Connect → App Privacy → Edit responses)

**Do you or your third-party partners collect data from this app?** No

Justification: Thanos Wallet talks directly to public blockchain RPCs
and the Thanos backend (which stores only the encrypted address book +
DNNS cache for signed-in users). No personally identifying information,
no behavioural tracking, no advertising identifiers.

## Age rating

17+ — "Unrestricted Web Access" applies because of the in-app dApp
browser; "Frequent/Intense Simulated Gambling" is "None" but the
"Cryptocurrency" disclosure must be set to "Yes" per Apple's 2025
guidance.

## Build review — required notes for Apple

(App Store Connect → App Review Information → Notes)

```
Thanos Wallet is a non-custodial cryptocurrency wallet. Reviewing it
end-to-end requires creating a wallet inside the app:

  1. Tap "Create new wallet"
  2. Choose 12 words
  3. Tap "I understand" on the risk warning
  4. Tap "I've saved it" on the seed-display screen
  5. Re-enter the prompted words on the verify screen
  6. Set a password (any 8+ chars), confirm
  7. Dashboard appears — Send and Receive are live but Send
     requires a token balance to broadcast a real tx. The Receive
     screen + QR display work without any balance.

There is no test account credential; every wallet is local-only.
Apple's reviewer can safely create one, explore, and then reset the
device (Settings → Reset wallet) without leaving state behind.

The app does not collect any user data. The privacy policy at
https://thanos.fi/privacy is the canonical document.
```

## What's New in this version (release notes, 4,000 chars max)

```
• Thanos MultiSig: create a shared wallet on Lithosphere with co-signers,
  then propose, approve and send from it together. Approvals can be
  gas-free.
• Security hardening from an independent audit: your recovery phrase
  stays in secure storage and is no longer passed around for each
  signature, the vault uses stronger key derivation, and biometric
  unlock no longer falls back to the device passcode.
• Native LAX on the Makalu testnet shows as a view-only balance when
  Makalu is added as a custom network.
• Keep several wallets in Thanos: create a new one or import another
  recovery phrase or private key, without removing the one you have.
  “Wallets & accounts” lists each wallet with its accounts, grouped as
  created or imported, with “Add account” under every wallet.
• Wallets and accounts get their own icons.
• Every token you hold now shows up. Lesser-known ones sit behind
  “Show hidden assets”, and you can hide or show any of them.
• LAX on Ethereum, BNB Chain and Base: see it, receive it and send it.
  Quantt agents on Base and BNB Chain can be funded with LAX.
• Lithosphere addresses show as litho1… everywhere, and transactions
  show their Lithosphere hash first, as on LithoScan.
• Send tells you what to fix when it can’t go ahead yet, and clear
  messages replace technical errors.
• Scan a QR code from a photo or screenshot: “Upload QR image” in the
  scanner. The scanner also says when the camera can’t start.
• Activity now shows every past transaction — including ones made
  before Thanos or from another wallet — on Lithosphere, Ethereum, Base,
  Arbitrum, Polygon, Optimism, Avalanche, Bitcoin, Solana and Cosmos.
• Lithosphere Mainnet history: LITHO you send and receive shows in
  Activity again, now that Mainnet is live.
• Received funds now show up: you get a notification ("You received
  2.5 USDT on BNB Chain") and the deposit stays in Activity, on every
  network — Lithosphere, Ethereum, BNB Chain, Base, Bitcoin, Solana and
  more.
• Send shows your available balance under the amount, for every coin.
• Activity keeps your whole history, on every network. Tap a
  transaction to see where it went, the network fee, block and hash.
• Lithosphere Mainnet is your home network; every send goes out on the
  network of the balance you pick.
• New look: floating glass navigation, with your assets scrolling
  beneath it.
• Face ID unlock is more reliable after the app has been in the
  background.
• Quantts agents work with wallets imported by private key, stay signed
  in between app launches, and a stalled withdrawal can be resumed.
• Full-screen views such as token details now sit correctly below the
  status bar.
• You can delete an account even if it still holds funds, after a
  reminder to keep your recovery phrase safe.
• Settings → Advanced → Show hex data, for sending data with a
  transaction.
```

## Screenshots (required sizes)

Capture from a real `eas build --profile preview` running on these
exact devices:

| Display | Pixel size | Source device |
|---|---|---|
| 6.7"   iPhone | 1290 × 2796 | iPhone 16 Pro Max simulator |
| 6.5"   iPhone | 1242 × 2688 | iPhone 11 Pro Max simulator |
| 5.5"   iPhone | 1242 × 2208 | iPhone 8 Plus simulator |
| 12.9"  iPad   | 2048 × 2732 | iPad Pro 12.9" simulator (optional but better tablet ranking) |

Per-screen content (in this order):
1. Dashboard with non-zero balances + portfolio chart
2. Send modal with a typed recipient (.litho name or 0x)
3. Receive screen with the address QR code
4. Quantts agents list
5. WalletConnect approval sheet with a dApp's metadata
6. Settings → Recovery phrase reveal warning sheet

See `scripts/capture-screenshots.ts` for the automation.
