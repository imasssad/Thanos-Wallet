# Google Play Console — listing copy

Paste into Play Console → Main store listing for each language.

## App name (30 chars max)

Thanos Wallet

## Short description (80 chars max)

Self-custodial wallet for Lithosphere, BTC, ETH, SOL, Cosmos. WalletConnect.

## Full description (4,000 chars max)

```
Thanos Wallet is a self-custodial, multi-chain wallet built around the
Lithosphere ecosystem. One seed phrase, every chain you care about.

WHAT YOU CAN DO

• Send and receive on Lithosphere (LITHO + LEP-100 tokens), Bitcoin,
  Ethereum and every major EVM L2, Solana with SPL tokens, and Cosmos
  Hub with memo support.
• Swap Lithosphere ecosystem tokens via the Ignite DEX, with bridge
  transfers tracked end-to-end through MultX.
• Manage your token approvals — see every smart contract authorised
  to spend your funds and revoke any of them with one tap.
• Pair with dApps via WalletConnect v2, the in-app browser, or QR
  code.
• Use a Ledger or Trezor over USB for hardware-wallet signing.
• Resolve human-readable .litho names instead of pasting 0x
  addresses.

SECURITY

• Biometric unlock backed by Android KeyStore + EncryptedSharedPrefs.
• Argon2id key derivation + AES-256-GCM authenticated encryption.
• Seed phrase shown once, then locked behind a password challenge.
• Pre-send transaction simulation flags contract recipients,
  suspicious approval amounts, and insufficient balances before you
  sign.
• Phishing-domain detection on WalletConnect pairings.
• Signing isolation — your keys never live in a screen-rendering JS
  context.

OPEN SOURCE

Every Thanos client (iOS, Android, browser extension, desktop, web)
is open source at github.com/imasssad/Thanos-Wallet. No phone-home.
No advertising IDs. No custodial vault. Your seed phrase lives on
this device, encrypted with your password, in Android's hardware-
backed KeyStore.
```

## Tags / Category

- Primary category: **Finance**
- Tags: Crypto, Wallet, Self-custody, DeFi, Web3

## Contact email

devs@thanos.fi

## Privacy policy URL

https://thanos.fi/privacy

## Content rating questionnaire

Use IARC's questionnaire (Play Console → Content rating). Expected
ratings:

- ESRB (US):       Everyone 10+ ("Mild gambling-style references" — the
                   swap UI shows price impact but isn't a gambling product)
- PEGI (EU):       PEGI 12
- IARC global:     12+ — primary trigger: handles real-world currency

## Data safety form

(Play Console → Data safety)

Data collected: **None.**

Data shared with third parties: **Wallet addresses** (with the public
blockchain RPCs — Lithosphere RPC, Ethereum RPC, mempool.space,
Solana RPC, Cosmos REST LCD). Necessary for the app to function;
required by the user; not used for any other purpose; cannot be
disabled without making the app useless.

Encryption in transit: **Yes** — all RPC calls + bridge requests are
HTTPS or WSS.

Data deletion: **Yes** — Settings → Reset wallet wipes every byte the
app stores on the device, including the encrypted vault, address-book
cache, and any cached prices.

## Target audience and content

- Age groups: 18+
- Appeals to children: No
- Designed for Family: No

## Release notes (500 chars max)

```
First public release. Multi-chain support (Lithosphere, BTC, ETH+L2s,
SOL+SPL, Cosmos). Biometric unlock backed by Android KeyStore.
WalletConnect v2 with persistent relay. MultX bridge + Ignite DEX
swap with route optimization. Ledger + Trezor hardware-wallet
support. .litho name resolution and on-chain registration.
Open-source at github.com/imasssad/Thanos-Wallet.
```

## Screenshots required

Per Play Console (Aug 2025 spec):

| Form factor | Required count | Pixel size |
|---|---|---|
| Phone   | 4 (max 8)  | 1080 × 2400 (16:9 to 18:9 portrait) |
| 7" tablet | 1 (max 8) | 1920 × 1200 |
| 10" tablet | 1 (max 8) | 2560 × 1600 |

Plus:
- Feature graphic: 1024 × 500 (no transparency, no text on the right side
  for Play Store carousels)
- Icon: 512 × 512 (already exported from build/icons/icon.png at 512px)

## Content per screenshot (in carousel order)

1. Dashboard with non-zero balances + portfolio chart
2. Send screen with .litho name auto-resolved
3. Swap screen mid-quote, showing route picker + MultX + Ignite labels
4. Permissions screen with two example approvals + Revoke button
5. WalletConnect approval sheet
6. Recovery-phrase warning sheet

See `scripts/capture-screenshots.ts` for the automation.
