# Privacy Policy

**Effective date:** 2026-05-25
**Operator:** Thanos Wallet
**Contact:** devs@thanos.fi

This document explains what data Thanos Wallet handles, where it goes,
and what control you have over it. It applies to every Thanos client:
the browser extension (Chrome / Brave / Firefox / Safari), the desktop
app (macOS / Windows), the mobile app (iOS / Android), and the web
wallet at thanos.fi.

We wrote this to be a real description of what the software actually
does, not a generic template. If anything below is inaccurate, file an
issue at https://github.com/imasssad/Thanos-Wallet/issues — we'll fix
it.

---

## TL;DR

- We don't run a custodial service. We never see your seed phrase.
- We don't sell, share, or build advertising profiles from your data.
- We don't include any third-party analytics SDKs (no Google Analytics,
  no Facebook SDK, no Mixpanel, no Amplitude).
- The only data that leaves your device is what's strictly necessary
  to look at the blockchain: public addresses, transaction hashes,
  contract call data — exactly what's published on-chain anyway.
- An optional cloud-sync feature (address book + DNNS cache) requires
  you to sign in with an email + password. The contents are encrypted
  on your device before they're uploaded.

---

## 1. Data we DO NOT handle

To make the boundary clear:

- **Your seed phrase** — generated on your device, encrypted with a
  key derived from your password (Argon2id), stored in the OS keychain
  (Keychain on iOS, EncryptedSharedPreferences + KeyStore on Android,
  Credential Manager on Windows, Keychain on macOS, IndexedDB on web).
  It never crosses the network in any form.
- **Your password** — only the password's Argon2id-derived encryption
  key ever exists outside your typing. The password itself is never
  stored, transmitted, or logged.
- **Your private keys** — derived on the fly from the seed inside an
  isolated signing context (Worker on web, offscreen document on
  extension, main process on desktop, module-private scope on mobile).
  They never appear in any error report, breadcrumb, or log line.
- **Behavioural analytics** — we don't ship any third-party SDK that
  records clicks, scrolls, time-on-page, or session replays.

## 2. Data sent directly from your device

When you use the wallet, the app talks to several public services on
your behalf. Each request includes your wallet address (this is
public on-chain anyway) and whatever's needed to fulfil it. We don't
proxy these — they go straight from your device to the third party.

| Service | What we send | Purpose |
|---|---|---|
| Lithosphere RPC (rpc.litho.ai, rpc-2.litho.ai) | Your wallet address; signed transactions | Read balances, send transactions on Makalu |
| Bitcoin (mempool.space) | Your BTC address; raw transaction hex | Read BTC balance + UTXOs, broadcast sends |
| Ethereum / EVM RPCs (configurable) | Your EVM address; signed transactions | Read balances, send transactions |
| Solana RPC (api.mainnet-beta.solana.com) | Your SOL address; signed transactions | Read SOL/SPL balances, send transactions |
| Cosmos REST LCD (cosmos-rest.publicnode.com) | Your Cosmos address; signed transactions | Read ATOM balance, send transactions |
| MultX bridge (bridge.litho.ai) | Source token, destination token, amount | Cross-chain swap quotes + execution |
| Ignite DEX (ignite.litho.ai) | Token pair, amount | Same-chain swap quotes + execution |
| WalletConnect relay (relay.walletconnect.com) | Encrypted dApp pairing payloads | dApp connectivity (the wallet's relay is a thin pipe — Reown can't decrypt the payloads) |
| CoinGecko (api.coingecko.com) | Token symbols only | Spot prices for the dashboard |

Each request goes over HTTPS or WSS. You can override the Lithosphere
RPC + Ethereum RPC URLs in Settings; pointing at your own node bypasses
the public services entirely.

## 3. Data sent to the Thanos backend (thanos.fi/api)

The backend is the *optional* cloud-sync layer. None of the wallet's
core functionality (create / unlock / send / receive / sign) requires
it. When you sign in, the following endpoints become available:

| Endpoint | What we receive | Why |
|---|---|---|
| `POST /auth/register` | Email, password (Argon2id-hashed on the server too), display name | Create an account so address book + DNNS records sync across your devices |
| `POST /auth/login` | Email, password | Issue an access + refresh token pair |
| `GET  /contacts`  | (auth required) | Return your encrypted contacts |
| `POST /contacts`  | Ciphertext blob for `name` + `notes`, plaintext wallet address | Store a contact you saved |
| `GET  /dnns/resolve?name=…` | A DNNS name | Cache the on-chain owner of a name |
| `GET  /portfolio/:address` | A wallet address | Aggregate balances across chains |
| `POST /push/register` | Expo / FCM push token, wallet address | Send you a notification when funds arrive (mobile only) |

The contact `name` and `notes` fields are encrypted on your device
(AES-256-GCM, key derived from your seed via HKDF-SHA256) before the
bytes leave. The server only sees opaque ciphertext for those two
fields — a DBA dump won't reveal who's in your address book. The
wallet address itself is stored plaintext (the server deduplicates on
it; it's public on-chain regardless).

## 4. Error reports (when enabled)

If the operator running this Thanos instance has set `SENTRY_DSN`,
the backend services (api, indexer, worker) and optionally the web
client will send crash reports to Sentry. Before any event is sent,
we recursively strip any key matching the regex
`/mnemonic|password|seed|private[_-]?key|vault|session[_-]?key|authorization|token/i`
from the event body, breadcrumbs, and tags. Stack traces, request
URLs, and timing data still travel.

For the public thanos.fi instance, Sentry is enabled. To opt out
entirely, run the wallet against your own deployment or block the
relevant Sentry ingestion domain in your browser/firewall.

## 5. Cookies + local storage

| Storage | What we put there |
|---|---|
| `localStorage` (web + extension + desktop renderer) | Encrypted vault, theme preference, active-account index, address-book cache, token-logo cache, custom RPC URL |
| `sessionStorage` (web only) | Argon2id-derived AES key while a tab is open — wiped on tab close |
| `AsyncStorage` (mobile) | Same as localStorage for mobile-specific equivalents |
| iOS Keychain / Android KeyStore | The encrypted vault, biometric-unlock token |
| `IndexedDB` | Token-logo blob cache (optional) |
| HTTP cookies | None. We use bearer tokens in `Authorization` headers, not cookies. |

## 6. Children

The wallet is not directed at users under 13. If you become aware
that a child under 13 has provided us with personal information,
contact us at devs@thanos.fi and we will delete the account.

## 7. Your rights

If you have an account on the cloud-sync layer:

- **Access.** `GET /auth/me` returns everything we have associated
  with you. The mobile app surfaces this in Settings → Account.
- **Deletion.** `DELETE /auth/account` wipes your account, every
  contact, and every cached DNNS record. The token at the moment of
  deletion is also revoked. This is irreversible.
- **Export.** `GET /contacts` returns your contacts in JSON. Decrypt
  the `name` + `notes` fields client-side with your seed-derived key.

You don't need an account to use the wallet. Skipping sign-in skips
this entire section.

## 8. Security incidents

If we discover that user data has been disclosed without authorisation,
we will publish an incident report at https://thanos.fi/security
within seven days of confirming the scope, including:
- What data was disclosed
- How many users were affected
- What we've changed to prevent recurrence

Material incidents are pushed via the wallet's in-app notification.

## 9. Changes to this policy

We'll update the **Effective date** at the top of this document when
we change anything material. The git history at
github.com/imasssad/Thanos-Wallet/commits/main/docs/privacy-policy.md
is the canonical changelog.

## 10. Contact

- **General questions:** devs@thanos.fi
- **Security disclosures:** security@thanos.fi (PGP key at thanos.fi/.well-known/security.txt)
- **Mailing address:** [TODO: physical address required by California / EU rules]
