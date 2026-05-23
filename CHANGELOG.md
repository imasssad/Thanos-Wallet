# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release entry is grouped by capability area rather than commit-by-commit
so the wallet team can see at a glance which surface a change affected.

---

## [0.2.0] — 2026-05-23

First production-grade tag. All four clients (web, desktop, extension, mobile)
ship the same vault, address layer, and signing primitives via the shared
sdk-core; the backend (api + indexer + worker) runs on a single VPS with full
observability and continuous WAL-archived Postgres backups.

### Core wallet

- BIP39 / BIP32 onboarding with 12 or 24-word phrase, paste-import, and
  raw-private-key import.
- AES-256-GCM vault keyed off the user's password via Argon2id
  (`t=3, m=64MB, p=4`), per-vault salt + IV. Same primitives in every client.
- Biometric unlock on mobile (`expo-local-authentication` + `expo-secure-store`).
- Bech32 ↔ EVM dual-address layer for the Lithosphere chains (Makalu 700777,
  Kamet 900523) — full conversion + canonical display + 18 unit tests.

### Sending + receiving

- Native sends on Lithosphere EVM, Ethereum, BNB, Polygon, Avalanche, Linea,
  Base, Arbitrum, plus Bitcoin (BIP84 segwit + RBF Bump Fee), Solana
  (SOL + SPL tokens), and Cosmos (ATOM via CosmJS).
- LEP100 (`ERC-20 + burn`) transfer / approve / revoke. Allowances surface in
  the Permissions page across web, desktop, extension.
- Hardware-wallet signing — Ledger (WebHID) on desktop + extension, Trezor
  (`@trezor/connect-web`) on desktop. Both cover EVM, BTC, and SOL flows.
- QR scanner reads recipient addresses and `wc:` WalletConnect URIs in the
  same camera surface.
- DNNS name resolution — type `name.litho` in the recipient field, it
  resolves on-chain via the NameWrapper + Registry contracts on Kamet.

### Cross-chain + DEX

- MultX bridge (`bridge.litho.ai`) integration with status polling, no API
  key. Bridge-poll BullMQ queue keeps execution state alive across worker
  restarts.
- Ignite DEX integration layer (`packages/sdk-core/src/dex/ignite.ts`):
  `IgniteClient` interface + `MockIgniteClient` + `LiveIgniteClient` skeleton.
  Live `quote()` / `execute()` / `getStatus()` are stubbed pending the
  Ignite team's API spec; `isHealthy()` works against the real endpoint
  today.
- Swap modal quotes MultX + Ignite in parallel, picks the better output,
  degrades to indicative pricing when both providers are offline.

### WalletConnect v2

- `@reown/walletkit` integration on all four clients. Persistent offscreen
  document on the extension keeps the relay socket alive across popup close.
- `session_request` signing approval sheet on web, desktop, extension,
  mobile — each platform shares the `executeWcRequest` signer flow from
  its own platform-specific signer module.
- EIP-1193 injected provider on the extension covers
  `eth_requestAccounts`, `eth_accounts`, `eth_chainId`,
  `wallet_switchEthereumChain`, `eth_sendTransaction`, `personal_sign`,
  `eth_signTypedData_v4`, `eth_sign`.

### Backend services

- API (Express + pg + zod + JWT HS256 + Argon2id) with auth, sessions,
  refresh-token rotation, push-token registration, contacts CRUD, DNNS
  resolve/lookup, rate-limited (auth: 10/15min, sensitive: 5/h, general:
  100/min).
- Indexer with cursor-persisted real `eth_getLogs` polling against
  `rpc.litho.ai` + `rpc-2.litho.ai` + `rpc-3.litho.ai` via ethers
  `FallbackProvider`. LEP100 token, event, and balance tables.
- Worker with BullMQ queues (`bridge-poll`, `push-fanout`,
  `portfolio-refresh`, `price-refresh`, `tx-confirm`, `wallet-sync`,
  `lep100-sync`), Redis-backed with AOF persistence.
- Postgres 16 with daily `pg_dump` rotation, optional pgBackRest PITR
  overlay (`docker-compose.pitr.yml`), and a documented cross-region
  replica playbook in `ops/backups/replica/RUNBOOK.md`.

### Security

- Transaction simulator surfaces `RECIPIENT_IS_CONTRACT` warnings and
  `INSUFFICIENT_BALANCE` critical issues before sign on the Send modal
  and the extension popup approval sheet.
- Phishing recipient classifier blocks Send when verdict is `critical`.
- Strict CSP without `unsafe-eval` (WASM-only). gitleaks + `pnpm audit`
  run on every PR.
- Sentry + Pino redact `mnemonic|password|seed|private[_-]?key|token|
  authorization` patterns recursively at the sink.
- WebHID device-permission allowlist restricts USB access to Ledger
  (`0x2c97`) and Trezor (`0x534c` / `0x1209`) vendor IDs on desktop + extension.

### Observability

- Pino structured JSON logs across api / indexer / worker with secret
  redaction.
- Prometheus + Alertmanager + Grafana stack
  (`ops/observability/docker-compose.observability.yml`).
- 9 alert rules (service-down, 5xx rate, API p99 latency, worker queue
  backlog, failed jobs, bridge poll failures, indexer sync gap, indexer
  stalled).
- 5 auto-provisioned Grafana dashboards (overview, api, worker, indexer,
  bridge).
- Alertmanager v0.27.0 routes critical → Slack + PagerDuty; warning →
  Slack only. Falls back to a `null-receiver` config when no real
  creds are configured, so the daemon stays healthy in dev/staging.
- Sentry on every client + every service; activates only when `SENTRY_DSN`
  is set.

### Testing

- 104 vitest cases in `@thanos/sdk-core` (litho-address, mnemonic, multx,
  ignite, bridge, ecosystem, phishing, networks, price-history,
  simulator).
- 23 Playwright E2E tests across 8 specs in `apps/web/e2e/` covering
  onboarding, send/receive, import, lock/unlock, navigation, settings,
  swap, and DNNS resolution.

### Tooling + ops

- Monorepo via pnpm workspaces + Turbo.
- GitHub Actions runs lint + build + vitest per package on every PR.
- Docker Compose deploy on a single VPS at `/var/www/thanos-wallet`,
  reverse-proxied by nginx with HTTPS via Let's Encrypt. PITR overlay
  optional for tightened RPO.
- Restore-verify cron (`ops/backups/restore-verify.sh`) exercises the
  latest backup weekly into a throw-away Postgres + sanity SELECTs.
- Disaster-recovery runbooks for `pg_dump` restore, PITR target-time
  restore, and cross-region replica failover all under `ops/backups/`.

---

## [0.1.0] — initial scaffold

Monorepo scaffold, baseline UI, dependencies wired. Not a production
release; tracked here for historical completeness.

[0.2.0]: https://github.com/imasssad/Thanos-Wallet/releases/tag/v0.2.0
[0.1.0]: https://github.com/imasssad/Thanos-Wallet/releases/tag/v0.1.0
