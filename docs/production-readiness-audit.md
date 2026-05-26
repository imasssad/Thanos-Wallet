# Production-Readiness Audit

This is the persisted version of the audit checklist. Use it to track
the production-readiness scorecard across releases — paste current
verdicts into a PR description by quoting the section.

> **Scoring:** ✅ = wired e2e in production · ⚠️ = exists but partial or
> credential-gated · ❌ = not built.

---

## 14. Resilience

| # | Item | Status | Notes |
|---|---|---|---|
| 14.1 | Indexer RPC failover (primary + fallback) | ✅ | `services/indexer/src/chain.ts` |
| 14.2 | Worker queue retries (BullMQ) | ✅ | `services/worker/src/queues/definitions.ts` |
| 14.3 | API request-id propagation | ✅ | `services/api/src/middleware/request-id.ts` |
| 14.4 | DB connection pool tuning | ✅ | pg pool in `services/api/src/lib/db.ts` |
| 14.5 | Graceful shutdown on SIGTERM | ✅ | each service registers SIGTERM/SIGINT |

## 15. Observability

| # | Item | Status | Notes |
|---|---|---|---|
| 15.1 | Structured logs (pino) | ✅ | `services/{api,indexer,worker}/src/lib/log.ts` |
| 15.2 | Sentry error tracking — code wired | ✅ | each service inits when `SENTRY_DSN` set |
| 15.3 | Sentry — DSN active in prod env | ⚠️ | secret needs to be added to VPS `.env` (see `docs/sentry-setup.md`) |
| 15.4 | Prometheus + Grafana dashboards | ✅ | `ops/observability/` — 5 dashboards |
| 15.5 | Alerts (RPC down, queue backlog, etc.) | ✅ | `ops/observability/alerts.yml` |

## 16. Deployment

| # | Item | Status | Notes |
|---|---|---|---|
| 16.1 | Docker + CI/CD pipelines | ✅ | `.github/workflows/{ci,release,deploy}.yml` |
| 16.2 | Rollback plan documented | ✅ | `ROLLBACK.md` |
| 16.3 | HTTPS/SSL live (thanos.fi) | ✅ | nginx + certbot, configured on VPS |
| 16.4 | Postgres backups (daily) | ⚠️ | script ready (`ops/backups/pg-backup.sh`); cron registration on VPS pending |
| 16.5 | Off-site backup mirror | ⚠️ | optional `S3_BUCKET` env var; not configured |
| 16.6 | PITR / pgBackRest WAL shipping | ⚠️ | overlay ready (`ops/backups/pgbackrest/`); not yet brought up |
| 16.7 | Cross-region replica | ⚠️ | runbook ready; needs second VPS |

## 17. Distribution

| # | Item | Status | Notes |
|---|---|---|---|
| 17.1 | Chrome Web Store submission | ⚠️ | zip builds; listing/key needs to be added |
| 17.2 | Brave Store submission | ⚠️ | reuses Chrome MV3 build |
| 17.3 | Safari App Store submission | ⚠️ | `safari:convert` + `safari:archive` scripts ready; needs Apple Developer cert + manual submit |
| 17.4 | iOS App Store — privacy strings | ✅ | NSCameraUsageDescription, NSFaceIDUsageDescription, NSLocalNetworkUsageDescription in `app.json` |
| 17.5 | iOS App Store — submission config | ✅ | `eas.json` submit.production.ios populated |
| 17.6 | iOS App Store — actual upload | ⚠️ | requires ASC API key + Apple Developer enrolment (credential-blocked) |
| 17.7 | Android Play Console — submission config | ✅ | `eas.json` submit.production.android populated |
| 17.8 | Android Play Console — actual upload | ⚠️ | requires service-account.json + listing assets |
| 17.9 | Desktop macOS — code-sign + notarize | ⚠️ | CI workflow conditional on `CSC_LINK` + `APPLE_ID*` secrets |
| 17.10 | Desktop Windows — code-sign | ⚠️ | CI workflow conditional on `WIN_CSC_LINK` secret |

## 18. Testing

| # | Item | Status | Notes |
|---|---|---|---|
| 18.1 | Unit tests for SDK core | ✅ | `packages/sdk-core/src/__tests__/` |
| 18.2 | Integration tests for backend | ✅ | `services/api/src/__tests__/` w/ vitest + supertest |
| 18.3 | E2E suite (Playwright) | ✅ | 10 specs covering onboarding, send/receive, swap, WC, lock/unlock, DNNS, permissions |

---

## Multi-chain UI — per-client status

| Client | Send | Receive | Live balance |
|---|---|---|---|
| Web | EVM | EVM | EVM |
| Extension | EVM + BTC + SOL + ATOM (chain selector) | EVM + BTC + SOL + ATOM (chain selector + real QR) | EVM via dashboard; BTC/SOL/ATOM shown live on Receive modal |
| Desktop | EVM + BTC + SOL + ATOM (chain selector) | EVM + BTC + SOL + ATOM (chain selector + real QR) | EVM via dashboard; BTC/SOL/ATOM shown live on Receive modal |
| Mobile | EVM + BTC + SOL + ATOM (chain chip strip) | EVM + BTC + SOL + ATOM (chain chip strip + real QR) | EVM via dashboard; BTC/SOL/ATOM shown live on Receive screen |

Out of scope today: showing the non-EVM balances in the main dashboard
portfolio chart. The backend `/portfolio/:address` endpoint can return
multi-chain positions; the dashboard widget that consumes them ships
in 1.1.

## Signing isolation — per-client status

| Client | Mechanism | File |
|---|---|---|
| Web | Web Worker (postMessage) | `apps/web/workers/signer-worker.ts` |
| Extension | Offscreen document (chrome.offscreen) — popup posts `sign.*` over the message bridge, derived keys live only in the offscreen JS heap | `apps/extension/src/entrypoints/offscreen/main.ts` (`handleSignMessage`) + `apps/extension/src/entrypoints/popup/offscreen-sign.ts` |
| Desktop | Electron main-process IPC — seed cached in main, renderer calls `window.thanosDesktop.signer.sendTx(...)` | `apps/desktop/src/main/signer.ts` + IPC handlers in `index.ts` |
| Mobile | Module-private closure (React DevTools / Flipper can't inspect module scope) — seed lives in `lib/signer.ts`, never in component state | `apps/mobile/lib/signer.ts` |

All four clients now route every EVM sign + broadcast through their
isolation boundary. Hardware-wallet flows (Ledger / Trezor) are
already isolated by definition (signature happens on the device).

## Open gaps — all reduced to single paste-able operator steps

Every "open gap" from earlier audit revisions now has a one-shot
installer script. Each requires only the operator credential the script
is gated on; no editing, no manual cron lines, no plist surgery.

| Gap | Script (paste into Termius / shell) | Requires |
|---|---|---|
| Daily Postgres backup cron | `sudo bash ops/backups/install-cron.sh` | nothing — runs on the VPS as root |
| Sentry DSN active | `sudo SENTRY_DSN='https://…' ops/install-sentry.sh` | a Sentry project DSN |
| macOS code-sign + notarize | `pnpm --filter @thanos/desktop dist` | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env / repo secrets |
| Windows code-sign | same `pnpm dist` | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` env / repo secrets |
| Signing verification | `bash apps/desktop/scripts/verify-signing.sh` | nothing — runs after `pnpm dist` to confirm |
| Chrome Web Store upload | manual: drop `apps/extension/.output/thanosextension-*-chrome.zip` into the dev console; listing copy in `apps/extension/store/chrome-listing.md` | Chrome Web Store dev account ($5 one-off) |
| iOS App Store upload | `cd apps/mobile && eas submit --platform ios --profile production` | EAS auth, ASC API key (`.p8`), `APPLE_TEAM_ID` |
| Play Console upload | `eas submit --platform android --profile production` | EAS auth, `credentials/play-service-account.json` |
| Safari extension archive | `pnpm --filter @thanos/extension safari:archive` + `xcrun altool --upload-app …` | Apple Developer cert in keychain |
| Screenshots (web) | `pnpm --filter @thanos/web exec tsx scripts/capture-screenshots.ts` | running web wallet at localhost:3000 |
| Privacy policy | publish `docs/privacy-policy.md` at `https://thanos.fi/privacy` | nothing (already in the repo) |

Everything else from path A + path B is already on `main`. The wallet
is code-complete; the remaining work is exclusively credential
acquisition + the one-paste installs above.
