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

## Open gaps (high-signal only)

1. **Signing isolation on extension/desktop/mobile** — web's worker
   pattern doesn't carry over; the other clients sign in-process. A
   full re-architecture to push signing into a separate context
   (extension offscreen, desktop main process, mobile native module)
   is deferred to v1.1.
2. **VPS-side credential plumbing** — Sentry DSN, App Store + Play
   service account keys, macOS / Windows code-signing certs all need
   the operator to populate. Workflows + configs are ready.
3. **Daily Postgres backup cron registration** — script is ready; the
   `crontab -e` step on the VPS is a one-shot manual action.

Once those land, the wallet is at full production-readiness. None of
them are code-blocked.
