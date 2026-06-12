# THANOS WALLET — COMPLETE PROJECT DOCUMENTATION
> Compiled: June 2026 (updated 12 Jun) | Commit: 587ed06+ | Production: https://thanos.fi

---

## TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Job Scope — Original Brief](#2-job-scope--original-brief)
3. [Production Launch Spec — Key Requirements](#3-production-launch-spec--key-requirements)
4. [Technical Paper Summary](#4-technical-paper-summary)
5. [Contract Addresses — Makalu LEP100 Tokens](#5-contract-addresses--makalu-lep100-tokens)
6. [Chain Configuration](#6-chain-configuration)
7. [What Was In Scope vs Out of Scope](#7-what-was-in-scope-vs-out-of-scope)
8. [Final Audit Results](#8-final-audit-results)
9. [Production Launch Checklist](#9-production-launch-checklist)
10. [Remaining Work](#10-remaining-work)
11. [Developer Auth Integration](#11-developer-auth-integration)
12. [Privacy Policy](#12-privacy-policy)
13. [Rollback Runbook](#13-rollback-runbook)
14. [Known Issues & Bug Log](#14-known-issues--bug-log)

---

## 1. Project Overview

**Thanos Wallet** is a Web4-native, self-custodial, multi-chain cryptocurrency wallet built for the Lithosphere network. It supports BTC, SOL, EVM, Cosmos, Lithosphere (Makalu + Kamet), and LEP100 tokens across web, mobile, browser extension, and desktop platforms.

| Property | Value |
|---|---|
| Production URL | https://thanos.fi |
| Dev URL | https://devapp.thanos.fi |
| Staging URL | https://staging.thanos.fi |
| GitHub | github.com/imasssad/Thanos-Wallet |
| Version | v0.2.0 |
| Latest commit | 587ed06+ (12 Jun 2026) |
| API health | `{"ok":true,"db":true,"redis":true}` |
| Client | Esha / ThanosWallet.ai / KaJ Labs |

---

## 2. Job Scope — Original Brief

### Mission
Lead and deliver the production launch of a multi-chain, Web4-native wallet ensuring:
- End-to-end security across all platforms
- Fully functional multi-chain support (BTC, SOL, SPL, EVM, LITHO, LEP100)
- Scalable backend infrastructure (Postgres, indexers, job queues)
- Reliable cross-chain swaps and bridge integrations
- WalletConnect + hardware wallet support
- Store-ready apps across web, mobile, extension, and desktop

### Original Critical Gaps (all resolved)
1. **Security hole** — mnemonic encryption used a hardcoded key. Fixed with Argon2id + per-user AES-256-GCM vault.
2. **No bech32/litho1 dual-address layer** — built with 18 passing round-trip tests.
3. **Backend was a mock** — Postgres, Redis, auth service, and real indexer all live in production.
4. **All 4 client UIs were empty shells** — all platforms now complete.

### Agreed Timeline & Budget
- **Duration:** 6.5 weeks
- **Budget:** $800 (agreed)
- **Payment terms:** On app store publication

---

## 3. Production Launch Spec — Key Requirements

### Architecture Scope

**Client Applications**
- Web App — onboarding, dashboard, send/receive, QR, WalletConnect, swaps, portfolio, DNNS, address book
- Browser Extensions — Chrome, Brave, Safari — injected provider, popup, approval screens
- Mobile Apps — iOS + Android — full UX, biometric, QR, WalletConnect, push notifications
- Desktop Apps — macOS + Windows — full UX, OS vault, hardware wallet USB, auto-update

**Backend Services**
- API Gateway — auth, sessions, contacts, portfolio, bridge state, DNNS cache
- Indexer Service — balance sync, transaction sync, LEP100 events, block cursors
- Worker Service — BullMQ queues, bridge polling, price refresh, tx confirmation
- WalletConnect Relay — session persistence, request fanout
- DNNS Service — resolve names, reverse resolution, cache

**Data Layer**
- Primary: Postgres (35 tables)
- Cache/Queue: Redis + BullMQ
- Object Storage: S3-compatible (logs, exports, backups)

### Security Requirements
- Keys never transmitted to backend
- Per-user Argon2id password hashing
- AES-256-GCM vault encryption with unique salt/IV
- Platform-specific secure storage (Keychain, Keystore, OS vault)
- Transaction signing isolation
- Phishing detection on all approvals
- Rate limiting: 10 attempts / 15 min on auth endpoints
- Refresh token rotation on every use

---

## 4. Technical Paper Summary

**Thanos Wallet** is composed of five primary layers:

| Layer | Status |
|---|---|
| Wallet Core Layer | ✅ Delivered (Phase 1) |
| Lithosphere Integration Layer | ✅ Delivered (Phase 1/2) |
| Intelligence & Agent Layer (Quantts) | ❌ Phase 3 — out of scope |
| Identity Layer (DNNS + zk) | ⚠️ DNNS delivered, zk = Phase 4 |
| Cross-Chain & Execution Layer | ✅ Delivered |

### Roadmap Phases

| Phase | Scope | Our Engagement |
|---|---|---|
| Phase 1 | Wallet core, Makalu integration | ✅ Delivered |
| Phase 2 | Lithic execution engine, DNNS | ✅ Delivered |
| Phase 3 | AI agents (Quantts), cross-chain swaps | ❌ Future engagement |
| Phase 4 | zk Identity, enterprise treasury, MPC | ❌ Future engagement |

---

## 5. Contract Addresses — Makalu LEP100 Tokens

**Chain:** Makalu Testnet | **Chain ID:** 700777 | **Explorer:** https://makalu.litho.ai
*(All 10 addresses re-verified directly on-chain via name()/symbol() eth_calls, 12 Jun 2026. A separate 12-token Kamet registry — incl. QTT and DOGE — lives in `packages/sdk-core/src/tokens/kamet-lep100-source.ts`.)*

| # | Token | Standard | Supply | Contract Address |
|---|---|---|---|---|
| 1 | LITHO | Native | 21,490 | Native |
| 2 | wLITHO — Wrapped Lithosphere | LEP100 | 1,000,000,000 | `0x599a7E135f1790ae117b4EdDc0422D24Bc766161` |
| 3 | LAX — Lithosphere Algo | LEP100 | 10,000,000,000 | `0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d` |
| 4 | JOT — Jot Art | LEP100 | 1,000,000,000 | `0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e` |
| 5 | COLLE — Colle AI | LEP100 | 5,000,000,000 | `0x10D4BB600c96e9243E2f50baFED8b2478F25af61` |
| 6 | IMAGE — Imagen Network | LEP100 | 10,000,000,000 | `0xAcD98E323968647936887aD4934e64B01060727e` |
| 7 | AGII | LEP100 | 1,000,000,000 | `0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c` |
| 8 | BLDR — Built AI | LEP100 | 1,000,000,000 | `0x798eD6bFc5bfCFc60938d5098825b354427A0786` |
| 9 | FGPT — FurGPT | LEP100 | 1,000,000,000 | `0x151ef362eA96853702Cc5e7728107e3961fbD22e` |
| 10 | MUSA — Mansa AI | LEP100 | 1,000,000,000 | `0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D` |

### DNNS Contract Addresses — Kamet Chain

**Chain:** Kamet | **Chain ID:** 900523 | **Explorer:** https://kamet.litho.ai

| Contract | Address |
|---|---|
| NameWrapper | `0xc47E49259b8dDa2C9D57941E1a52747E4c721Cb9` |
| Registry | `0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab` |
| BaseRegistrar | `0xB3D1a8e92FFAD73Ab8a07BF37A8E1374df8B3722` |
| MetadataService | `0x9138E4CD9c5EBAc6964Fd28516BD5B0E83E5AA51` |
| Metadata URI | `https://names.litho.ai/metadata/{id}` |

---

## 6. Chain Configuration

| Chain | Chain ID | Primary RPC | Fallback RPC | Notes |
|---|---|---|---|---|
| Makalu (Lithosphere) | 700777 | rpc.litho.ai | rpc-2.litho.ai | Main Lithosphere testnet |
| Kamet | 900523 | rpc-3.litho.ai | rpc.kamet.litho.ai | DNNS lives here. Use rpc-3 first — old hostname TLS-fails behind Cloudflare |
| Ethereum | 1 | eth.llamarpc.com | — | |
| BNB Chain | 56 | bsc-dataseed.binance.org | — | |
| Bitcoin | — | blockstream.info/api | — | |
| Solana | — | api.mainnet-beta.solana.com | — | |

### Bridge
- **URL:** https://bridge.litho.ai
- **API Key:** None required (internal service)
- **Status:** LIVE (the 501 was an upstream TLS-routing bug, fixed 10 Jun 2026). Confirmed routes: GET /bridge/status/:txHash, /bridge/signatures/:txHash, /bridge/transactions/:address, /chains, /health. Quotes/routing belong to Ignite, not the bridge.

### LEP100 Token Standard
- Standard ERC-20 + `burn(amount)`, `burnFrom(address, amount)`, `owner()`, `transferOwnership()`, `renounceOwnership()`
- Full ABI: `contracts/artifacts/contracts/LEP100Token.sol/LEP100Token.json`

---

## 7. What Was In Scope vs Out of Scope

### ✅ In Scope (Agreed in Proposal)

**Security**
- Argon2id encryption, bech32 dual-address, secure storage per platform
- Signing isolation, phishing detection, permission manager, seed phrase lifecycle

**Chains**
- BTC, SOL + SPL, EVM, Cosmos-native, Lithosphere dual-address, LEP100

**Web App**
- Onboarding, dashboard, send/receive, QR, WalletConnect, swap/bridge, portfolio, DNNS, address book

**Browser Extensions**
- Chrome, Brave, Safari — EIP-1193 injection, all approval screens

**Mobile**
- iOS + Android — biometric, QR camera, WalletConnect, full UX

**Desktop**
- macOS + Windows — OS vault, Ledger + Trezor, USB, auto-update

**Backend**
- Auth, Postgres, Redis, BullMQ (6 queues), indexer, worker, DNNS, contacts, portfolio

**WalletConnect v2**
- Full session lifecycle, multi-chain, human-readable approvals, risk scoring

**Hardware Wallets**
- Ledger (EVM/BTC/SOL), Trezor (EVM/BTC), WebHID/WebUSB, desktop native USB

**Swap + Bridge**
- bridge.litho.ai integration, status tracking, exponential backoff polling

**Observability**
- Sentry (all surfaces), Prometheus, Alertmanager (9 rules), Grafana (5 dashboards)

**DevOps**
- Docker, CI/CD, HTTPS, VPS, SOPS secrets, staging, ROLLBACK.md

**Testing**
- Unit, integration, E2E tests

### ❌ Out of Scope (Extra work done for free)

- `@thanos/connect` SDK for 9 ecosystem apps
- Privacy Policy (MD + Word doc)
- `INTEGRATE-THANOS-AUTH.md` developer documentation
- In-app dApp browser with Lithosphere ecosystem
- dApp discovery screen (AI & Agents, DeFi & Yield)
- Market page with token listings
- `STORE-ASSETS.md` spec sheet
- `docs/LAUNCH.md` launch checklist
- Multiple audit reports and status documents

### ❌ Never In Scope (Esha's new requests)

- NFT features (display, transfer, mint)
- Quantts AI agents (Phase 3)
- zk Identity, MPC wallets (Phase 4)
- Gasless transactions
- Security audit (external pen test)
- Ignite DEX backend (Litho team's responsibility)
- Real-time Lithosphere price oracle

---

## 8. Final Audit Results

**Commit:** a8e3dde | **Date:** 28 May 2026

| Section | ✅ | ⚠️ | ❌ | Score |
|---|---|---|---|---|
| Security | 19 | 0 | 0 | 100% |
| Chain Support | 9 | 0 | 0 | 100% |
| Web App | 21 | 0 | 0 | 100% |
| Browser Extensions | 15 | 0 | 0 | 100% |
| Mobile iOS + Android | 17 | 0 | 0 | 100% |
| Desktop macOS + Windows | 21 | 0 | 0 | 100% |
| Backend Services | 29 | 0 | 0 | 100% |
| WalletConnect v2 | 11 | 0 | 0 | 100% |
| Hardware Wallets | 13 | 0 | 0 | 100% |
| Swap + Bridge | 10 | 1 | 0 | 91% |
| Observability | 19 | 0 | 0 | 100% |
| Deployment + Infra | 26 | 0 | 0 | 100% |
| Testing | 16 | 0 | 0 | 100% |
| Launch Checklist | 45 | 7 | 0 | 87% |
| **OVERALL** | **271** | **8** | **0** | **97%** |

### Remaining 8 Items (all externally blocked)

| Item | Blocked On |
|---|---|
| Ignite DEX live execute | Litho team — no JSON backend yet. MultX fallback active. |
| Signed artifacts execution | Apple Developer ID cert |
| App store metadata | Icons, screenshots, privacy policy |
| Extension store metadata | Chrome Web Store account |
| Desktop signing execution | Apple Dev ID + MS Authenticode cert |
| Status page | Provider selection |
| On-call owner | Operational decision |
| Post-launch monitoring | Calendar + escalation plan |

---

## 9. Production Launch Checklist

### 16.1 Core Functionality

| Item | Status |
|---|---|
| Create wallet | ✅ |
| Import via seed phrase | ✅ |
| Import via private key | ✅ |
| Lock/unlock all clients | ✅ |
| Biometric unlock mobile | ✅ |
| Send/receive BTC | ✅ |
| Send/receive SOL + SPL | ✅ |
| Send/receive EVM native + ERC-20 | ✅ |
| Send/receive Cosmos-native | ✅ |
| Dual 0x / litho1 flow | ✅ |
| LEP100 balances sync | ✅ |
| LEP100 transfer, approve, revoke | ✅ |
| WalletConnect session proposal + approval | ✅ |
| QR scan addresses + WalletConnect URIs | ✅ |
| Hardware wallet signing (Ledger + Trezor) | ✅ |
| Bridge status updates | ✅ |
| Swap quotes refresh | ⚠️ MultX fallback active, Ignite pending |
| Address book CRUD | ✅ |
| Contacts sync | ✅ |
| DNNS forward + reverse resolve | ✅ |

### 16.2 Backend + Infrastructure

| Item | Status |
|---|---|
| Postgres backups (daily, 7-day retention) | ✅ |
| Redis persistence (AOF) | ✅ |
| Migrations tested on staging | ✅ |
| Rollback plan documented | ✅ ROLLBACK.md |
| Health checks on all services | ✅ |
| RPC fallback configured | ✅ |
| Rate limits configured | ✅ |
| Logs centralized (Pino JSON) | ✅ |
| Alerts configured (9 rules) | ✅ |
| Grafana dashboards (5 JSONs) | ✅ |
| Secrets in manager (SOPS + age) | ✅ |
| Staging mirrors production | ✅ |

### 16.3 Security

| Item | Status |
|---|---|
| No private keys to backend | ✅ |
| Seed phrase never logged | ✅ |
| CSP enabled | ✅ |
| Extension permissions minimized | ✅ |
| Token storage secure per platform | ✅ |
| Refresh token rotation | ✅ |
| Brute force protection | ✅ |
| Auth audit trail | ✅ |
| Tx simulation before risky approvals | ✅ |
| Phishing checks | ✅ |
| Dependency audit clean | ✅ |
| Secrets scan clean | ✅ |
| Incident runbook (ROLLBACK.md) | ✅ |

### 16.4 Release

| Item | Status |
|---|---|
| Versioning locked (v0.2.0) | ✅ |
| Release notes written | ✅ |
| Signing config committed | ✅ |
| Signed artifact execution | 🔒 Needs Apple Dev ID + MS cert |
| App store metadata | 🔒 Needs client assets |
| Extension store metadata | 🔒 Needs Chrome Web Store account |
| Support docs | ⚠️ Internal only, no public page yet |
| Status page | 🔒 Provider decision needed |
| On-call owner | 🔒 Client decision |
| Post-launch monitoring | 🔒 Client decision |

---

## 10. Remaining Work

### From us (engineering)

| Item | Effort |
|---|---|
| Ignite DEX live wiring (after Litho team ships spec — confirmed WIP on their side 12 Jun) | ~1 day |
| Per-chain WalletConnect signing (re-expand beyond Makalu) | ~1 day |
| Kamet indexer sync loop (12 tokens registered, not yet indexed) | ~1 day |
| Lithosphere price oracle (if Esha wants real % for LITHO) | ~2 days |

### From Esha (client)

| Deliverable | Used For |
|---|---|
| Apple Developer ID cert (.p12) + App Store Connect API key (.p8) | iOS App Store + Safari + macOS notarization |
| Microsoft Authenticode cert (.pfx) | Windows .exe signing |
| Google Play upload key (.jks) | Android Play Store |
| Chrome Web Store account | Chrome + Brave extension publishing |
| App icons (done) + screenshots + privacy policy + age rating | All store listings |
| On-call rotation decision | Operational |
| Launch window date | Operational |

### From Litho team

| Item | Status |
|---|---|
| Alex's branch `kmp/kamet-network-config` | Not on our remote — needs PR against `imasssad/Thanos-Wallet:main` |
| Ignite DEX JSON backend (`/api/quote`, `/api/execute`) | Frontend exists at ignite.litho.ai, no API yet |
| bridge.litho.ai 501 fix | MultX team bug — returns 501 on all endpoints |
| 3 missing LEP100 token addresses | Need verified addresses from Alex |
| Kamet bridge contract address | Need from Alex |
| Canonical Makalu explorer URL | Confirm: `makalu.litho.ai` or `explorer.litho.ai` |

---

## 11. Developer Auth Integration

### @thanos/connect SDK

```bash
npm install thanos-connect
# or
pnpm add thanos-connect
```

```tsx
import { ThanosConnectButton } from '@thanos/connect/react';

<ThanosConnectButton
  config={{ appName: 'Ignite DEX', chainId: 700777 }}
  onSignIn={(s) => myAuthStore.setSession(s)}
/>
```

Handles EIP-6963 discovery, SIWE message, personal_sign, backend nonce/verify round-trip, and install-CTA fallback when extension isn't present.

### Supported Apps + Chain IDs

| App | Chain ID |
|---|---|
| Ignite DEX | 700777 |
| EGO Exchange | 700777 |
| COLLE AI | 700777 |
| AGII | 700777 |
| ATUA AI | 700777 |
| Imagen Network | 700777 |
| Mansa AI | 700777 |
| Makalu Explorer | 700777 |
| Kamet Explorer | 900523 |

### REST API Endpoints

**Base URL:** `https://thanos.fi/api`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Create account. Body: `{email, password, displayName}` |
| POST | `/auth/login` | Authenticate. Body: `{email, password}` |
| POST | `/auth/refresh` | Rotate refresh token. Body: `{refreshToken}` |
| POST | `/auth/logout` | Revoke session. Requires Bearer token. |
| GET | `/auth/me` | Get current user. Requires Bearer token. |
| GET | `/auth/sessions` | List active sessions. |
| DELETE | `/auth/sessions/:id` | Kill a session remotely. |
| GET | `/health` | `{"ok":true,"db":true,"redis":true}` |

**Authentication header:**
```
Authorization: Bearer <accessToken>
```

**Token notes:**
- Access tokens expire in 15 minutes
- Refresh tokens rotate on every use — always store the new one
- Rate limited: 10 failed attempts per 15-minute window
- Passwords hashed with Argon2id — never stored or logged in plaintext

Full reference guide: `docs/INTEGRATE-THANOS-AUTH.md`

---

## 12. Privacy Policy

**Effective date:** June 2026 | **ThanosWallet.ai** | Maintained by KaJ Labs

Thanos Wallet is a self-custodial, multi-chain cryptocurrency wallet. Your private keys and seed phrase never leave your device. We do not sell your data.

### What We Collect

**You provide:**
- Email and password (hashed with Argon2id, never readable)
- Address book contacts and DNNS names

**Collected automatically:**
- On-chain data (public by nature): addresses, tx hashes, balances
- Device session data: platform, session tokens
- Crash reports via Sentry (no keys or balances)
- Aggregate usage metrics (not tied to identity)

**Never collected:**
- Seed phrase or private keys
- Unbroadcast transaction contents
- Location
- Data from websites outside the wallet

### How We Use It
- Run and secure the wallet
- Index balances and transaction history
- Fix bugs via crash reports
- Improve the wallet via aggregate metrics
- Security update notifications

We do not advertise, sell data, or use it to train AI models.

### Key Storage
Your seed phrase is encrypted on-device with Argon2id-derived key + AES-256-GCM. We cannot recover it if you lose your password.

### Third-Party Services
- Blockchain RPC nodes (receive wallet address + tx data)
- CoinGecko (price data, no wallet identity)
- bridge.litho.ai (tx data when you initiate a bridge)
- Sentry (crash reports)
- WalletConnect / Reown relay (session metadata)

### Data Retention
- Account data: retained while account is active
- Blockchain index data: retained for portfolio
- Crash reports: 90 days
- Usage metrics: 12 months aggregate

### Contact
**Support:** support@thanos.fi | **Website:** ThanosWallet.ai

---

## 13. Rollback Runbook

### Fastest rollback (under 5 minutes)

```bash
cd /var/www/thanos-wallet
git log --oneline -10                         # pick last good commit
git checkout <good-commit-hash>
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  build web api indexer
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d web api indexer
curl -fsS https://thanos.fi/ -o /dev/null && echo "✓ site is up"
```

### Per-service rollback

```bash
docker images thanos-wallet-<service>
docker tag <image-id> thanos-wallet-<service>:rollback
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps --no-build <service>
```

### Database restore

```bash
ls -lh /var/backups/thanos-wallet/daily/
docker compose stop api indexer worker
gunzip -c /var/backups/thanos-wallet/daily/<dump>.sql.gz \
  | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet
docker compose up -d api indexer worker
```

> Restoring loses up to 24h of indexer state. The sync loop re-fetches from the last cursor on boot — most of the gap closes within ~15 minutes.

---

## 14. Known Issues & Bug Log

| # | Issue | Root Cause | Status |
|---|---|---|---|
| 1 | Transaction failed / "can't send but can receive" | ROOT CAUSE: Lithosphere RPC nodes answer CORS preflights with no ACAO header — every browser-side broadcast was blocked client-side | ✅ Fixed 12 Jun: same-origin proxy on web (1b24756) + Electron header shim (6b3bcec) |
| 2 | Bridge showing "Bridge offline" | bridge.litho.ai returning 501 on all endpoints | ✅ Fixed upstream 10 Jun (TLS-routing bug); clients repointed to confirmed routes (fafe285) |
| 3 | Kamet RPC TLS failure | Old hostname `rpc.kamet.litho.ai` fails behind Cloudflare | Fixed — use `rpc-3.litho.ai` as primary |
| 4 | Alex's branch not on remote | Branch `kmp/kamet-network-config` pushed to fork, not main repo | ✅ Applied 10 Jun as a patch series (7ad6dad…2c4ed6d), verified by live smoke test 12/12 |
| 5 | LITHO price % shows "—" | No CoinGecko price feed for LITHO token | Decision pending: build oracle or keep "—" |
| 6 | EGO Exchange in dApp list | Was in original dApp discovery | ✅ Removed in commit 03d4333 |
| 7 | Non-Lithosphere tokens on market page | FIGR_HELOC and others in token list | ✅ Cleaned in commit 03d4333 |
| 8 | ATUA logo incorrect | Wrong asset in codebase | ✅ Fixed from atua.ai in commit 03d4333 |
| 9 | Price charts showing static data | Hardcoded values | ✅ Fixed in commit dd4981a |
| 10 | 3 LEP100 token addresses missing | The "~12" was the KAMET set (incl. QTT + DOGE) | ✅ Closed: 10 verified Makalu + 12 verified Kamet tokens registered |

---

*Thanos Wallet is self-custodial. Your keys, your crypto.*

---
*Document compiled from project scope, technical specs, audit results, and live codebase state.*

---

## 15. Job Post — Full Text (Wallet Core Senior Full-Stack Blockchain Engineer)

# Wallet Core
**Senior Full-Stack Blockchain Engineer (Wallet + Infrastructure)**
*(Web4 / Multi-chain / Production Systems)*

### 🎯 Mission
Lead and deliver the **production launch of a multi-chain, Web4-native wallet platform**, ensuring:
- 🔐 End-to-end security across all platforms
- ⚙️ Fully functional multi-chain support (BTC, SOL, SPL, EVM, LITHO, LEP100)
- 🌐 Scalable backend infrastructure (Postgres, indexers, job queues)
- 🔁 Reliable cross-chain swaps and bridge integrations
- 🔗 WalletConnect + hardware wallet support
- 📱 Store-ready apps across web, mobile, extension, and desktop

### 🧩 Core Responsibilities

#### 1. 🔐 Security Hardening (CRITICAL PATH)

**Wallet Security**
- iOS → Secure Enclave / Keychain
- Android → Keystore
- Web → encrypted IndexedDB + session isolation
- Desktop → OS keychain (keytar or native APIs)
- Transaction signing isolation layer
- Phishing detection (domain + contract analysis)
- Permission manager (token approvals, contract access)

**Cryptography**
- Seed phrase lifecycle security
- Encryption (AES-256 + PBKDF2 or Argon2)
- Optional: MPC wallet support, social recovery flows

#### 2. 💸 Transaction Engine Completion

**Chains:** Bitcoin (UTXO), Solana (SOL + SPL), EVM (Ethereum, BNB), Cosmos-based with dual address

**Special Requirement:** Dual address compatibility (0x... EVM-style + litho1... bech32)
- Address conversion + validation
- Unified transaction abstraction layer

#### 3. 🔗 WalletConnect + dApp Layer
- WalletConnect v2: session lifecycle, multi-chain request handling, secure approval flow
- Transaction approval screens: human-readable decoding, risk scoring, simulation preview

#### 4. 🔁 Swap + Bridge Integration
- Cross-chain routing protocol (MultX)
- On-chain DEX integration (Ignite-style DEX)
- Unified swap interface, route optimization, bridge tracking (pending/confirmed/failed)

#### 5. 🤖 Backend Infrastructure

**Core Stack:** Node.js, Postgres, Redis, Docker + Kubernetes

**Services:**
1. Auth Service — JWT + refresh tokens, session management, rate limiting
2. Indexer Service — BTC, SOL, EVM, Cosmos balances + transactions
3. Portfolio Service — balances, pricing, PnL
4. Job Queue System — Redis + BullMQ
5. WalletConnect Relay Backend
6. Naming/Identity Service (DNNS)
7. Contact Sync Service

**Database Tables:** users, wallets, accounts, transactions, tokens, contacts, sessions, wc_sessions, bridge_jobs

#### 6. 📷 QR + Camera System
- iOS (AVFoundation), Android (CameraX), Web (getUserMedia)
- Scan: wallet addresses, WalletConnect URIs, payment requests

#### 7. 🔌 Hardware Wallet Integration
- Devices: Ledger, Trezor
- Transports: WebHID/WebUSB, Native USB (desktop), Mobile bridge/BLE
- Signing: BTC, EVM, SOL — with device confirmation prompts

#### 8. 📊 Observability + DevOps
- Structured JSON logs, Sentry, Prometheus + Grafana
- Alerts: transaction failures, RPC downtime, sync issues

#### 9. 🚀 Deployment & Release
- Dockerized microservices, CI/CD pipelines
- Web → CDN/Vercel | Mobile → App Store + Google Play | Extensions → Chrome, Brave, Safari
- Desktop: code signing (macOS + Windows), auto-update system

### 🧪 Testing Requirements
- Unit tests (SDK + core logic)
- Integration tests (RPC + backend services)
- End-to-end tests (user flows)
- Security testing: static analysis, dependency audits, external audit (recommended)

### 📦 Deliverables
- Production-ready monorepo
- Backend services (Dockerized)
- Stable SDK
- Fully functional apps: Web, Mobile, Browser extensions, Desktop
- Database schema + migrations
- Deployment scripts

### 📅 Execution Phases

| Phase | Scope |
|---|---|
| Phase 1 | Backend + auth + DB, Indexers + job system |
| Phase 2 | Transaction engine completion, WalletConnect + swaps |
| Phase 3 | Hardware wallet integration, QR scanning + security |
| Phase 4 | QA + audits, Store submissions, Launch |

### 🧠 Ideal Candidate
- 5+ years full-stack/backend experience
- Strong blockchain experience: EVM, Solana, Bitcoin, Cosmos (important)
- Experience with wallets, DeFi, or infrastructure systems
- Strong focus on security and production readiness

### 📌 Summary
Delivering a **secure, multi-chain, production-grade wallet platform with full backend infrastructure and Web4 capabilities**

---

## 16. Technical Paper — Full Text (Thanos Wallet ThanosWallet.ai)

### Abstract
Thanos Wallet is a next-generation Web4-native wallet designed to operate as a unified financial operating system, identity layer, and intelligent agent execution environment on the Lithosphere network. Unlike traditional wallets that primarily serve as key managers and transaction signers, Thanos Wallet integrates multi-chain asset management, Lithic smart contract execution, decentralized identity (DNNS), AI-driven financial agents (Quantts), and cross-chain interoperability into a single cohesive architecture.

### 1. Introduction

**1.1 Background**
Existing wallets (MetaMask, Trust Wallet, SafePal) are designed for Web3: key custody, transaction signing, basic DeFi. Lithosphere introduces multi-VM execution environments, AI-driven agents, persistent decentralized identities (DNNS), and autonomous financial coordination — requiring a fundamentally new wallet architecture.

**1.2 Objective**
- Unified interface for Web4 interactions
- Native support for Lithic contracts
- Autonomous financial agents
- Cross-chain complexity abstraction
- Integrate identity, assets, and intelligence

### 2. System Overview — Five Primary Layers
1. Wallet Core Layer
2. Lithosphere Integration Layer
3. Intelligence & Agent Layer
4. Identity Layer (DNNS + zk)
5. Cross-Chain & Execution Layer

### 3. Wallet Core Layer

**Key Management**
- HD Wallet (BIP32/BIP39/BIP44)
- MPC-based wallets
- Hardware wallet integration (Ledger, Trezor)
- Social recovery wallets
- Optional HSM-backed key storage
- Encrypted local keystore (AES-256)
- Biometric authentication (mobile)

**Transaction Engine**
- EVM-compatible signing
- Lithic transaction signing
- Batched transactions
- Parallel execution queues

### 4. Lithosphere Integration Layer

**Network Support:** Makalu Testnet (default), Kamet Testnet (auto-switch), Mainnet-ready abstraction

**RPC Infrastructure:** Primary: rpc.litho.ai, Fallback RPC cluster, Latency-aware routing

**Chain Abstraction:** Automatic chain detection, Unified interface for EVM + Lithic

### 5. Lithic Execution Engine

**Supported Contract Types:** LEP100 tokens, DNNS registry contracts, Agent contracts, Treasury & vesting contracts

**Features:** Contract deployment, ABI → UI auto-generation, Contract simulation, Gas estimation

**Execution Flow:**
1. User intent defined
2. Contract selected/generated
3. Simulation executed
4. Transaction signed
5. State updated on Lithosphere

### 6. Intelligence & Agent Layer (Phase 3 — Out of Current Scope)

**Quantts Integration** — Autonomous AI agents:
- Yield optimization
- Arbitrage execution
- Portfolio rebalancing
- Intent-based execution
- Policy-driven constraints
- Risk scoring before execution

**Syndicates AI:**
- Multi-agent collaboration
- Shared treasury contracts
- On-chain negotiation protocols

### 7. Identity Layer — DNNS + zk Identity (Phase 2/4)

**DNNS Integration:**
- Human-readable addresses (.litho)
- Agent identity mapping

**zk Identity (Phase 4 — Out of Current Scope):**
- Privacy-preserving identity proofs
- Selective disclosure

**Reputation System (Phase 4):**
- On-chain reputation scoring
- Agent trust metrics

### 8. Cross-Chain & Interoperability Layer

**Supported Chains:** Lithosphere, Ethereum, BNB Chain, (Optional) Solana

**Bridge Architecture:** Canonical bridge gateway, Liquidity routing

**Cross-Chain Abstraction:** Unified balance view, One-click cross-chain swaps

### 9. Token & Asset Management

**Preloaded Tokens:** LITHO, COLLE, AGII, ATUA, IMAGEN

**Portfolio Engine:** Real-time valuation, PnL tracking, Asset allocation analytics

### 10. Security Architecture
- Pre-execution simulation
- Contract risk analysis
- Phishing detection
- Malicious contract detection
- Contract approval dashboard
- One-click revoke

### 11. UX & Interaction Model
- Intent-Based Transactions: *"Allocate 1,000 USDT to highest yield strategy"*
- Gas Abstraction: Gasless transactions via relayers (Phase 4)
- Human-Readable Transactions: Natural language summaries

### 12. System Architecture

**Frontend:** Next.js (web + extension), React Native (mobile)

**Backend Services:** Relayer service, Indexer service, Risk engine, Agent orchestration engine

**Modules:** Wallet Core, Lithic Engine, DNNS Resolver, Agent Manager, Cross-chain Router

### 13. SDK & API

**Wallet SDK:** Connect wallet, Sign transactions, Execute Lithic contracts

**DNNS SDK:** Name resolution, Identity registration

**Agent SDK (Phase 3):** Deploy Quantts, Execute strategies

### 14. Deployment Architecture
- Browser extension, Mobile apps (iOS/Android), Desktop app
- Multi-region deployment, AWS + bare metal hybrid
- Horizontal scaling, Event-driven architecture

### 15. Roadmap

| Phase | Deliverables | Our Scope |
|---|---|---|
| Phase 1 | Wallet core, Makalu integration | ✅ Delivered |
| Phase 2 | Lithic execution engine, DNNS integration | ✅ Delivered |
| Phase 3 | AI agents, Cross-chain swaps | ❌ Future |
| Phase 4 | zk identity, Enterprise treasury features | ❌ Future |

### 16. Conclusion
Thanos Wallet represents a paradigm shift from passive key management tools to active, intelligent financial operating systems. It is not merely a wallet — it is the command layer for decentralized intelligence.

**Author:** ThanosWallet.ai | **Maintained by:** KaJ Labs
