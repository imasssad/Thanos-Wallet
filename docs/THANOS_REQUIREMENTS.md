# THANOS WALLET — COMPLETE REQUIREMENTS SPECIFICATION
> Source: Wallet Core Job Post (docx) + Thanos Wallet Technical Paper (pdf)
> Use this file to track, assign, and verify every requirement from both documents.

---

## HOW TO USE THIS FILE

Each requirement has a status field:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked — note the blocker

---

## PART A — JOB POST REQUIREMENTS
*Source: Wallet Core Senior Full-Stack Blockchain Engineer.docx*

---

### A1. SECURITY HARDENING

#### A1.1 Secure Key Storage

| # | Requirement | Status | Notes |
|---|---|---|---|
| A1.1.1 | iOS → Secure Enclave / Keychain | `[x]` | |
| A1.1.2 | Android → Keystore | `[x]` | |
| A1.1.3 | Web → encrypted client-side storage + session isolation | `[x]` | Argon2id-derived AES-256-GCM vault in `localStorage` (apps/web/lib/vault.ts) — chose localStorage over IndexedDB after spec'ing both: same browser security boundary, smaller surface area, atomic single-blob write. Signing isolation lives in a dedicated Web Worker (`workers/signer-worker.ts`) so the unlocked seed never sits in main-thread JS. |
| A1.1.4 | Desktop → OS keychain (keytar or native APIs) | `[x]` | keytar implemented |

#### A1.2 Security Features

| # | Requirement | Status | Notes |
|---|---|---|---|
| A1.2.1 | Transaction signing isolation layer | `[x]` | Web Worker / offscreen / IPC |
| A1.2.2 | Phishing detection — domain analysis | `[x]` | |
| A1.2.3 | Phishing detection — contract analysis | `[x]` | |
| A1.2.4 | Permission manager — token approvals | `[x]` | |
| A1.2.5 | Permission manager — contract access control | `[x]` | |

#### A1.3 Cryptography

| # | Requirement | Status | Notes |
|---|---|---|---|
| A1.3.1 | Seed phrase lifecycle security | `[x]` | |
| A1.3.2 | Encryption — AES-256 | `[x]` | AES-256-GCM |
| A1.3.3 | Key derivation — PBKDF2 or Argon2 | `[x]` | Argon2id (t=3, m=64MB, p=4) |
| A1.3.4 | MPC wallet support | `[ ]` | Optional — Phase 4 |
| A1.3.5 | Social recovery flows | `[ ]` | Optional — Phase 4 |

---

### A2. TRANSACTION ENGINE

#### A2.1 Chain Support

| # | Requirement | Status | Notes |
|---|---|---|---|
| A2.1.1 | Bitcoin — UTXO model, send, receive, fee, broadcast | `[x]` | |
| A2.1.2 | Solana — SOL send/receive | `[x]` | |
| A2.1.3 | Solana — SPL token send/receive | `[x]` | |
| A2.1.4 | EVM — Ethereum send/receive | `[x]` | |
| A2.1.5 | EVM — BNB Chain send/receive | `[x]` | |
| A2.1.6 | EVM — ERC-20 send/receive | `[x]` | |
| A2.1.7 | Cosmos-based chain — send/receive | `[x]` | |
| A2.1.8 | Cosmos-based chain — dual address formats | `[x]` | litho1 ↔ 0x |

#### A2.2 Transaction Features

| # | Requirement | Status | Notes |
|---|---|---|---|
| A2.2.1 | Send/Receive flows across all chains | `[x]` | |
| A2.2.2 | Accurate fee estimation | `[x]` | |
| A2.2.3 | Nonce / sequence handling | `[x]` | |
| A2.2.4 | Transaction lifecycle tracking | `[x]` | |

#### A2.3 Dual Address (Lithosphere / Makalu)

| # | Requirement | Status | Notes |
|---|---|---|---|
| A2.3.1 | 0x... EVM-style address support | `[x]` | |
| A2.3.2 | litho1... bech32 cosmos-native address support | `[x]` | |
| A2.3.3 | Address conversion between formats | `[x]` | litho-address.ts — 18 tests |
| A2.3.4 | Address validation per format | `[x]` | |
| A2.3.5 | Unified transaction abstraction layer | `[x]` | |

---

### A3. WALLETCONNECT + DAPP LAYER

| # | Requirement | Status | Notes |
|---|---|---|---|
| A3.1 | WalletConnect v2 — session lifecycle management | `[x]` | |
| A3.2 | WalletConnect v2 — multi-chain request handling | `[~]` | 2026-06-12 security fix: all 4 clients now ADVERTISE only eip155:700777 — every request handler broadcast via the Makalu provider regardless of the namespace a dApp asked on, so offering 9 chains was a chain-mismatch hazard. Re-expand together with per-chain provider routing. |
| A3.3 | WalletConnect v2 — secure approval flow | `[x]` | |
| A3.4 | Transaction approval screen — human-readable decoding | `[x]` | |
| A3.5 | Transaction approval screen — risk scoring | `[x]` | |
| A3.6 | Transaction approval screen — simulation preview | `[x]` | |

---

### A4. SWAP + BRIDGE INTEGRATION

| # | Requirement | Status | Notes |
|---|---|---|---|
| A4.1 | Cross-chain routing protocol (MultX) integration | `[x]` | Bridge backend is live (the 501 was an upstream TLS-routing bug, fixed 2026-06-10). All 5 clients repointed to the confirmed API: GET /bridge/status/:txHash, /bridge/signatures/:txHash, /bridge/transactions/:address, /chains, /health — verified against the live service. Quoting/routing is NOT a bridge concern (validator-signature design); it belongs to Ignite (A4.2). |
| A4.2 | On-chain DEX integration (Ignite-style) | `[~]` | Frontend wired, Litho team backend pending |
| A4.3 | Unified swap interface | `[x]` | |
| A4.4 | Route optimization — cost + speed | `[~]` | Basic only |
| A4.5 | Bridge tracking — Pending status | `[x]` | Live against GET /bridge/status/:txHash (bridge healthy since 2026-06-10). |
| A4.6 | Bridge tracking — Confirmed status | `[x]` | Live — same endpoint as A4.5. |
| A4.7 | Bridge tracking — Failed status | `[x]` | Live. Raw upstream errors are humanised before display (translateSwapError for swaps, humanizeChainError for sends). |

---

### A5. BACKEND INFRASTRUCTURE

#### A5.1 Core Stack

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.1.1 | Node.js backend services | `[x]` | |
| A5.1.2 | Postgres primary database | `[x]` | 35 tables |
| A5.1.3 | Redis caching + queues | `[x]` | |
| A5.1.4 | Docker deployment | `[x]` | |
| A5.1.5 | Kubernetes (optional) | `[ ]` | Using Docker Compose instead |

#### A5.2 Auth Service

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.2.1 | JWT access tokens | `[x]` | 15min expiry |
| A5.2.2 | Refresh token rotation | `[x]` | Rotates on every use |
| A5.2.3 | Session management | `[x]` | Device-bound sessions |
| A5.2.4 | Rate limiting | `[x]` | 10 attempts / 15 min |
| A5.2.5 | Signature-based login (optional) | `[ ]` | Not implemented |

#### A5.3 Indexer Service

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.3.1 | Track balances — BTC | `[x]` | |
| A5.3.2 | Track balances — SOL | `[x]` | |
| A5.3.3 | Track balances — EVM | `[x]` | |
| A5.3.4 | Track balances — Cosmos/Lithosphere | `[x]` | |
| A5.3.5 | Track transactions — all chains | `[x]` | |
| A5.3.6 | Track token movements — LEP100 | `[x]` | Live indexer on rpc.litho.ai |
| A5.3.7 | RPC polling | `[x]` | |
| A5.3.8 | WebSocket subscriptions | `[x]` | |

#### A5.4 Portfolio Service

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.4.1 | Aggregate balances across chains | `[x]` | |
| A5.4.2 | Token pricing (USD) | `[x]` | CoinGecko |
| A5.4.3 | PnL tracking | `[x]` | |

#### A5.5 Job Queue System (Redis + BullMQ)

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.5.1 | Transaction sync queue | `[x]` | wallet-sync |
| A5.5.2 | Bridge tracking queue | `[x]` | bridge-poll |
| A5.5.3 | Portfolio update queue | `[x]` | portfolio-refresh |
| A5.5.4 | Price refresh queue | `[x]` | price-refresh — every 60s |
| A5.5.5 | LEP100 sync queue | `[x]` | lep100-sync |
| A5.5.6 | TX confirmation queue | `[x]` | tx-confirm |

#### A5.6 WalletConnect Relay Backend

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.6.1 | Store pending WC requests | `[x]` | |
| A5.6.2 | Sync approvals across devices | `[x]` | Reown hosted relay |

#### A5.7 Naming / Identity Service (DNNS)

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.7.1 | Resolve human-readable .litho names | `[x]` | Forward resolution |
| A5.7.2 | Register identities | `[ ]` | Not in current scope |
| A5.7.3 | Cache lookups | `[x]` | |
| A5.7.4 | Reverse resolution (address → name) | `[x]` | Commit 4f58e3b |

#### A5.8 Contact Sync Service

| # | Requirement | Status | Notes |
|---|---|---|---|
| A5.8.1 | Multi-device sync | `[x]` | |
| A5.8.2 | Encrypted storage | `[x]` | |

#### A5.9 Database Tables

| # | Table | Status |
|---|---|---|
| A5.9.1 | users | `[x]` |
| A5.9.2 | wallets | `[x]` |
| A5.9.3 | accounts | `[x]` |
| A5.9.4 | transactions | `[x]` |
| A5.9.5 | tokens | `[x]` |
| A5.9.6 | contacts | `[x]` |
| A5.9.7 | sessions | `[x]` |
| A5.9.8 | wc_sessions | `[x]` |
| A5.9.9 | bridge_jobs | `[x]` |

---

### A6. QR + CAMERA SYSTEM

| # | Requirement | Status | Notes |
|---|---|---|---|
| A6.1 | Native camera — iOS (AVFoundation / expo-camera) | `[x]` | |
| A6.2 | Native camera — Android (CameraX / expo-camera) | `[x]` | |
| A6.3 | Native camera — Web (getUserMedia) | `[x]` | |
| A6.4 | Scan wallet addresses | `[x]` | |
| A6.5 | Scan WalletConnect URIs | `[x]` | wc: prefix at QrScannerModal.tsx:50 |
| A6.6 | Scan payment requests | `[x]` | |

---

### A7. HARDWARE WALLET INTEGRATION

| # | Requirement | Status | Notes |
|---|---|---|---|
| A7.1 | Ledger device support | `[x]` | |
| A7.2 | Trezor device support | `[x]` | Commit ac9520c |
| A7.3 | WebHID transport | `[x]` | |
| A7.4 | WebUSB transport | `[x]` | |
| A7.5 | Native USB transport — desktop | `[x]` | hw-transport-node-hid via IPC |
| A7.6 | Mobile bridge / BLE transport | `[ ]` | Not implemented |
| A7.7 | BTC signing flow | `[x]` | Ledger + Trezor |
| A7.8 | EVM signing flow | `[x]` | Ledger + Trezor |
| A7.9 | SOL signing flow | `[x]` | Ledger only (Trezor doesn't support SOL) |
| A7.10 | Device confirmation prompts UI | `[x]` | |
| A7.11 | Error handling + disconnect recovery | `[x]` | |

---

### A8. OBSERVABILITY + DEVOPS

| # | Requirement | Status | Notes |
|---|---|---|---|
| A8.1 | Structured JSON logs | `[x]` | Pino on all services |
| A8.2 | Error tracking — Sentry | `[x]` | All 5 surfaces |
| A8.3 | Monitoring — Prometheus | `[x]` | |
| A8.4 | Monitoring — Grafana | `[x]` | 5 dashboards committed |
| A8.5 | Alerts — transaction failures | `[x]` | |
| A8.6 | Alerts — RPC downtime | `[x]` | |
| A8.7 | Alerts — sync issues | `[x]` | |

---

### A9. DEPLOYMENT + RELEASE

| # | Requirement | Status | Notes |
|---|---|---|---|
| A9.1 | Dockerized microservices | `[x]` | |
| A9.2 | CI/CD pipelines | `[x]` | GitHub Actions |
| A9.3 | Environment configuration | `[x]` | SOPS + age secrets |
| A9.4 | Web → CDN/Vercel (or VPS) | `[x]` | VPS + Nginx |
| A9.5 | Mobile → App Store (iOS) | `[!]` | Blocked: Apple Dev cert needed |
| A9.6 | Mobile → Google Play (Android) | `[!]` | Blocked: Play upload key needed |
| A9.7 | Extension → Chrome Store | `[!]` | Blocked: Chrome Dev account needed |
| A9.8 | Extension → Brave Store | `[!]` | Blocked: Same as Chrome |
| A9.9 | Extension → Safari Store | `[!]` | Blocked: Apple Dev cert needed |
| A9.10 | Desktop — code signing macOS | `[!]` | Config ready, cert needed |
| A9.11 | Desktop — code signing Windows | `[!]` | Config ready, cert needed |
| A9.12 | Desktop — auto-update system | `[x]` | electron-updater |

---

### A10. TESTING

| # | Requirement | Status | Notes |
|---|---|---|---|
| A10.1 | Unit tests — SDK + core logic | `[x]` | vault, key derivation, address conversion, LEP100 |
| A10.2 | Integration tests — RPC + backend services | `[x]` | 36 tests: auth, contacts, DNNS |
| A10.3 | End-to-end tests — user flows | `[x]` | Playwright: wallet creation, send, swap |
| A10.4 | Security testing — static analysis | `[x]` | CI dependency audit |
| A10.5 | Security testing — dependency audits | `[x]` | npm audit in CI |
| A10.6 | External security audit | `[ ]` | Recommended, not yet engaged |

---

### A11. DELIVERABLES

| # | Deliverable | Status | Notes |
|---|---|---|---|
| A11.1 | Production-ready monorepo | `[x]` | github.com/imasssad/Thanos-Wallet |
| A11.2 | Backend services — Dockerized | `[x]` | All 5 containers healthy on VPS |
| A11.3 | Stable SDK | `[x]` | packages/sdk-core |
| A11.4 | Web app — fully functional | `[x]` | devapp.thanos.fi |
| A11.5 | Mobile apps — fully functional | `[x]` | iOS + Android |
| A11.6 | Browser extensions — fully functional | `[x]` | Chrome, Brave, Safari |
| A11.7 | Desktop apps — fully functional | `[x]` | macOS + Windows |
| A11.8 | Database schema + migrations | `[x]` | 35 tables, services/db/schema.sql |
| A11.9 | Deployment scripts | `[x]` | Docker Compose, CI/CD |

---

## PART B — TECHNICAL PAPER REQUIREMENTS
*Source: Thanos Wallet Technical Paper (document_pdf.pdf)*

---

### B1. WALLET CORE LAYER

#### B1.1 Key Management

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B1.1.1 | HD Wallet — BIP32/BIP39/BIP44 | 1 | `[x]` | |
| B1.1.2 | MPC-based wallets | 4 | `[ ]` | Future phase |
| B1.1.3 | Hardware wallet integration — Ledger | 1 | `[x]` | |
| B1.1.4 | Hardware wallet integration — Trezor | 1 | `[x]` | |
| B1.1.5 | Social recovery wallets | 4 | `[ ]` | Future phase |
| B1.1.6 | HSM-backed key storage (optional) | 4 | `[ ]` | Future phase |
| B1.1.7 | Encrypted local keystore (AES-256) | 1 | `[x]` | AES-256-GCM + Argon2id |
| B1.1.8 | Biometric authentication — mobile | 1 | `[x]` | Face ID + fingerprint |

#### B1.2 Transaction Engine

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B1.2.1 | EVM-compatible signing | 1 | `[x]` | |
| B1.2.2 | Lithic transaction signing | 1 | `[x]` | |
| B1.2.3 | Batched transactions | 2 | `[ ]` | Not implemented |
| B1.2.4 | Parallel execution queues | 2 | `[ ]` | Not implemented |

---

### B2. LITHOSPHERE INTEGRATION LAYER

#### B2.1 Network Support

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B2.1.1 | Makalu Testnet (default) | 1 | `[x]` | Chain ID 700777 |
| B2.1.2 | Kamet Testnet (auto-switch) | 1 | `[x]` | Chain ID 900523 |
| B2.1.3 | Mainnet-ready abstraction | 1 | `[x]` | Config in networks.ts |

#### B2.2 RPC Infrastructure

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B2.2.1 | Primary RPC — rpc.litho.ai | 1 | `[x]` | |
| B2.2.2 | Fallback RPC cluster | 1 | `[x]` | rpc-2.litho.ai + rpc-3.litho.ai |
| B2.2.3 | Latency-aware routing | 1 | `[x]` | FallbackProvider |

#### B2.3 Chain Abstraction

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B2.3.1 | Automatic chain detection | 1 | `[x]` | |
| B2.3.2 | Unified interface for EVM + Lithic | 1 | `[x]` | |

---

### B3. LITHIC EXECUTION ENGINE

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B3.1 | LEP100 token contract support | 1 | `[x]` | All 9 Makalu tokens |
| B3.2 | DNNS registry contract support | 2 | `[x]` | Kamet contracts wired |
| B3.3 | Agent contracts | 3 | `[ ]` | Future phase |
| B3.4 | Treasury & vesting contracts | 4 | `[ ]` | Future phase |
| B3.5 | Contract deployment | 2 | `[ ]` | Not implemented |
| B3.6 | ABI → UI auto-generation | 2 | `[ ]` | Not implemented |
| B3.7 | Contract simulation | 1 | `[x]` | Pre-execution simulation |
| B3.8 | Gas estimation | 1 | `[x]` | |

---

### B4. INTELLIGENCE & AGENT LAYER
*Phase 3 — Out of current scope*

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B4.1 | Quantts AI agents | 3 | `[ ]` | Future engagement |
| B4.2 | Yield optimization agent | 3 | `[ ]` | Future engagement |
| B4.3 | Arbitrage execution agent | 3 | `[ ]` | Future engagement |
| B4.4 | Portfolio rebalancing agent | 3 | `[ ]` | Future engagement |
| B4.5 | Intent-based execution | 3 | `[ ]` | Future engagement |
| B4.6 | Policy-driven constraints | 3 | `[ ]` | Future engagement |
| B4.7 | Risk scoring before agent execution | 3 | `[ ]` | Future engagement |
| B4.8 | Syndicates AI — multi-agent collaboration | 3 | `[ ]` | Future engagement |
| B4.9 | Shared treasury contracts | 3 | `[ ]` | Future engagement |
| B4.10 | On-chain negotiation protocols | 3 | `[ ]` | Future engagement |

---

### B5. IDENTITY LAYER — DNNS + ZK IDENTITY

#### B5.1 DNNS (Phase 2 — Delivered)

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B5.1.1 | Human-readable .litho addresses | 2 | `[x]` | |
| B5.1.2 | Agent identity mapping | 3 | `[ ]` | Future |
| B5.1.3 | Forward name resolution | 2 | `[x]` | |
| B5.1.4 | Reverse name resolution | 2 | `[x]` | Commit 4f58e3b |

#### B5.2 zk Identity (Phase 4 — Future)

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B5.2.1 | Privacy-preserving identity proofs | 4 | `[ ]` | Future engagement |
| B5.2.2 | Selective disclosure | 4 | `[ ]` | Future engagement |

#### B5.3 Reputation System (Phase 4 — Future)

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B5.3.1 | On-chain reputation scoring | 4 | `[ ]` | Future engagement |
| B5.3.2 | Agent trust metrics | 4 | `[ ]` | Future engagement |

---

### B6. CROSS-CHAIN & INTEROPERABILITY LAYER

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B6.1 | Lithosphere chain support | 1 | `[x]` | Makalu + Kamet |
| B6.2 | Ethereum chain support | 1 | `[x]` | |
| B6.3 | BNB Chain support | 1 | `[x]` | |
| B6.4 | Solana chain support (optional) | 1 | `[x]` | |
| B6.5 | Canonical bridge gateway | 1 | `[x]` | bridge.litho.ai |
| B6.6 | Liquidity routing | 1 | `[~]` | Basic — Ignite pending |
| B6.7 | Unified balance view | 1 | `[x]` | |
| B6.8 | One-click cross-chain swaps | 2 | `[~]` | bridge.litho.ai active, Ignite DEX pending |

---

### B7. TOKEN & ASSET MANAGEMENT

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B7.1 | Preloaded LITHO token | 1 | `[x]` | Native token (chain 700777) |
| B7.2 | Preloaded COLLE token | 1 | `[x]` | Makalu address `0xE7eBf52b...60DF49` in `makalu-lep100-source.ts`. The multi-chain `registry.ts` row uses placeholder addresses for non-Makalu chains — COLLE isn't deployed on Ethereum/BSC, those are aspirational entries. |
| B7.3 | Preloaded AGII token | 1 | `[x]` | Makalu address `0x9984ad7a...6Fe020` |
| B7.4 | Preloaded ATUA token | 1 | `[~]` | Listed in `packages/sdk-core/src/tokens/registry.ts` and surfaces as a dApp tile in Discover with the proper icon, BUT no real contract address is wired anywhere — registry has the all-zeros placeholder `0x…0003`. Treat as a Discover-app entry, not a transferable token. Promotes to `[x]` once Esha / Alex provides the real Makalu contract address. |
| B7.5 | Preloaded IMAGE / Imagen Network token | 1 | `[x]` | Verified Makalu address `0xAcD98E32...060727e`; ticker `IMAGE` confirmed by the Ignite team (the duplicate `IMAGEN` registry row was removed with the placeholder purge). LIVE-PRICED since 2026-06-12 via CoinGecko id `imagen-ai` (~$0.0000115 — the old $0.025 placeholder was ~2000x off market). |
| B7.6 | wLITHO, LAX, JOT, BLDR, FGPT, MUSA tokens | 1 | `[x]` | All verified on-chain via name()/symbol() eth_calls (2026-06-12): FGPT (name "FurGPT") = `0x151ef362...fbD22e`, MUSA (name "Mansa AI") = `0xDB829be...EA1c5D`, wLITHO = `0x599a7E13...766161`, BLDR = `0x798eD6bF...7A0786`. The old `0xa25c2a49` contract is dead and referenced by no team. Kamet counterparts also registered (12 tokens incl. QTT + DOGE). |
| B7.7 | Real-time valuation | 1 | `[x]` | CoinGecko |
| B7.8 | PnL tracking | 1 | `[x]` | |
| B7.9 | Asset allocation analytics | 1 | `[x]` | |

---

### B8. SECURITY ARCHITECTURE

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B8.1 | Pre-execution simulation | 1 | `[x]` | |
| B8.2 | Contract risk analysis | 1 | `[x]` | |
| B8.3 | Phishing detection | 1 | `[x]` | |
| B8.4 | Malicious contract detection | 1 | `[x]` | |
| B8.5 | Contract approval dashboard | 1 | `[x]` | |
| B8.6 | One-click revoke | 1 | `[x]` | |

---

### B9. UX & INTERACTION MODEL

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B9.1 | Intent-based transactions ("Allocate 1,000 USDT...") | 3 | `[ ]` | Phase 3 — Quantts AI |
| B9.2 | Gasless transactions via relayers | 4 | `[ ]` | Phase 4 |
| B9.3 | Human-readable transaction display | 1 | `[x]` | Natural language decode |

---

### B10. SYSTEM ARCHITECTURE

#### B10.1 Frontend

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B10.1.1 | Next.js — web app | 1 | `[x]` | |
| B10.1.2 | Next.js — browser extension | 1 | `[x]` | WXT framework |
| B10.1.3 | React Native — mobile apps | 1 | `[x]` | Expo |

#### B10.2 Backend Services

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B10.2.1 | Relayer service | 1 | `[x]` | WalletConnect relay |
| B10.2.2 | Indexer service | 1 | `[x]` | Live on rpc.litho.ai |
| B10.2.3 | Risk engine | 1 | `[x]` | Phishing + contract risk |
| B10.2.4 | Agent orchestration engine | 3 | `[ ]` | Phase 3 — Quantts |

#### B10.3 Modules

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B10.3.1 | Wallet Core module | 1 | `[x]` | packages/sdk-core |
| B10.3.2 | Lithic Engine module | 2 | `[x]` | LithicClient |
| B10.3.3 | DNNS Resolver module | 2 | `[x]` | DnnsService |
| B10.3.4 | Agent Manager module | 3 | `[ ]` | Phase 3 |
| B10.3.5 | Cross-chain Router module | 1 | `[x]` | bridge.litho.ai |

---

### B11. SDK & API

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B11.1 | Wallet SDK — connect wallet | 1 | `[x]` | @thanos/connect published |
| B11.2 | Wallet SDK — sign transactions | 1 | `[x]` | |
| B11.3 | Wallet SDK — execute Lithic contracts | 2 | `[x]` | |
| B11.4 | DNNS SDK — name resolution | 2 | `[x]` | |
| B11.5 | DNNS SDK — identity registration | 2 | `[ ]` | Not implemented |
| B11.6 | Agent SDK — deploy Quantts | 3 | `[ ]` | Phase 3 |
| B11.7 | Agent SDK — execute strategies | 3 | `[ ]` | Phase 3 |

---

### B12. DEPLOYMENT ARCHITECTURE

| # | Requirement | Phase | Status | Notes |
|---|---|---|---|---|
| B12.1 | Browser extension deployment | 1 | `[!]` | Blocked: store accounts needed |
| B12.2 | Mobile apps — iOS/Android | 1 | `[!]` | Blocked: Apple + Play certs needed |
| B12.3 | Desktop app | 1 | `[!]` | Blocked: signing certs needed |
| B12.4 | Multi-region deployment | 4 | `[ ]` | Currently single VPS |
| B12.5 | AWS + bare metal hybrid | 4 | `[ ]` | Phase 4 infrastructure |
| B12.6 | Horizontal scaling for services | 4 | `[ ]` | Currently single instances |
| B12.7 | Event-driven architecture | 1 | `[x]` | BullMQ + Redis |

---

## REQUIREMENTS SUMMARY

### Status Count

| Status | Count | Meaning |
|---|---|---|
| `[x]` Complete | ~125 | Implemented and working |
| `[~]` Partial | ~9 | In progress or partial |
| `[!]` Blocked | ~14 | Waiting on external party |
| `[ ]` Not started | ~35 | Not yet implemented |

### Not Started — Breakdown

| Category | Items | Reason |
|---|---|---|
| Phase 3 (AI Agents / Quantts) | 10 | Future engagement, separate scope |
| Phase 4 (zk Identity, MPC, gasless) | 8 | Future engagement, separate scope |
| Store submissions | 5 | Blocked on Esha (certs + accounts) |
| Advanced Lithic features | 4 | Contract deploy, ABI-to-UI, batched txs |
| Other optional | 8 | Mobile BLE, sig-based login, Kubernetes, multi-region, etc. |

### Blockers Summary

| Blocker | Items Blocked | Owner |
|---|---|---|
| Apple Developer ID cert + ASC key | iOS, Safari, macOS notarization | Esha |
| Microsoft Authenticode cert | Windows signing | Esha |
| Google Play upload key | Android submission | Esha |
| Chrome Web Store account | Chrome + Brave | Esha |
| Store listing assets | All stores | Esha |
| Ignite DEX JSON backend | Swap live mode | Litho team |
| Alex's PR (kamet-network-config) | Kamet chain fixes | Alex / Litho team |
| Real ATUA contract address on Makalu | B7.4 (ATUA token) — currently a Discover-app entry only, no transferable token | Esha / Alex |

---

*This file is the single source of truth for all project requirements.*
*Update status fields as items are completed or unblocked.*
