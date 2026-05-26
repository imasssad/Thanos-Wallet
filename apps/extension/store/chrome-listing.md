# Chrome Web Store — listing copy

**Path:** Chrome Web Store Developer Dashboard → New item → fill the
fields below verbatim. Brave Store and Opera Add-ons accept the same
zip + identical metadata.

## Item title

Thanos Wallet — Lithosphere & Multi-Chain

## Summary (132 chars max)

Non-custodial wallet for Lithosphere, Bitcoin, Ethereum, Solana, Cosmos. WalletConnect, hardware-wallet, MultX bridge built in.

## Description (16,000 chars max)

```
Thanos Wallet is a self-custodial, multi-chain wallet built around the
Lithosphere ecosystem. Hold and send LITHO and every LEP-100 token
alongside native Bitcoin, Ethereum, Solana, and Cosmos — from a single
seed, in a single window.

WHAT'S IN THE BOX

• Lithosphere (Makalu) — native LITHO + LEP-100 token transfers, DNNS
  name resolution (.litho names), Ignite DEX swaps, MultX bridge.
• Bitcoin — BIP-84 P2WPKH addresses, RBF-signaled sends, mempool.space
  fee estimates.
• Ethereum / EVM L2s — standard EIP-1559 transactions, ERC-20 transfers
  and approvals.
• Solana — SOL + SPL token transfers, Phantom-compatible derivation.
• Cosmos Hub — ATOM transfers with memo support.

SAFETY

• Argon2id + AES-256-GCM encrypted vault — your seed never leaves the
  device unencrypted, never touches a remote server.
• Pre-send transaction simulation — flags contract recipients,
  insufficient balances, and unusual approval amounts before you sign.
• Phishing-domain detection — blocks dApps with drainer / scam
  signatures before connection.
• Hardware-wallet support — Ledger and Trezor for both signing and
  receive-address verification.
• Permission manager — audit and one-click revoke every token
  allowance you've granted, plus every connected dApp.
• Signing isolation — every cryptographic operation happens in an
  isolated offscreen document; your keys never live in the popup's
  JavaScript context.

DAPP CONNECTIVITY

• Full EIP-1193 provider injected into every page.
• WalletConnect v2 with a persistent relay (survives popup close).
• Multi-chain request routing — eth_sendTransaction / personal_sign /
  eth_signTypedData_v4 / wallet_switchEthereumChain all supported.

CROSS-DEVICE

Sign in once and your address book and DNNS records sync across the
Thanos Wallet browser extension, desktop app, mobile app, and the
web wallet at thanos.fi.

OPEN SOURCE

The full source for every client is at github.com/imasssad/Thanos-Wallet.
```

## Category

Productivity → Other (Chrome doesn't have a "wallet" category — most
crypto wallets use Productivity)

## Language

English (United States) — primary. Translations in a follow-up release.

## Permissions justifications

| Permission | Why we need it |
|---|---|
| `storage` | Persist the encrypted vault, address book cache, and active-account index across browser restarts. |
| `notifications` | Surface incoming-transaction alerts when the popup is closed. |
| `<all_urls>` (host_permissions) | Inject the EIP-1193 provider on every dApp the user visits. Without this, dApps can't see the wallet. |
| `offscreen` | Run the WalletConnect relay + the signing helpers in a separate document so they survive popup close and don't share JS state with the UI. |

## Privacy policy URL

https://thanos.fi/privacy

## Single purpose

Provide a non-custodial cryptocurrency wallet with support for the
Lithosphere blockchain plus Bitcoin, Ethereum, Solana, and Cosmos.

## Remote code declaration

Thanos Wallet does **not** execute remote code. All JavaScript ships
with the extension bundle. The WalletConnect relay is a WebSocket;
RPC calls are JSON; neither involves eval or remote-script evaluation.

## Data collection disclosure

| Data | Used? | Sent to remote server? | Sold? |
|---|---|---|---|
| Personally identifiable information | No | — | — |
| Financial / payment info | Yes (wallet addresses, tx history) | No (the wallet talks directly to public RPCs) | No |
| Authentication info (passwords, seeds) | Yes | Never. Encrypted locally; key derivation in-browser. | No |
| Personal communications | No | — | — |
| Location | No | — | — |
| Web history | No | — | — |
| User activity | No | — | — |
| Website content | No | — | — |

## Compliance certifications

- Discloses use of remote services: ✓ (RPC endpoints, MultX bridge,
  Ignite DEX, Sentry error reporting when enabled, listed in privacy
  policy)
- Limited use of user data: ✓
- Secure transmission: ✓ (HTTPS for every endpoint; WebSocket over wss)
