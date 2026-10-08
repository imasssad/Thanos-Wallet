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
• Lithosphere Mainnet is now your home network; every send goes out
  on the network of the balance you pick.
• New look: floating glass navigation, with your assets scrolling
  beneath it.
• Face ID unlock is more reliable after the app has been in the
  background.
• Quantts agents: stay signed in between app launches.
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
