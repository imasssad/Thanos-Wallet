# Observability

What we instrument, how to turn it on, and where to look when something
breaks.

## Sentry — error reporting

The web app is already wired (`apps/web/sentry.{client,server,edge}.config.ts`)
with mnemonic/password scrubbing via `beforeSend`. Sentry only initialises
when the DSN env var is present, so local dev and CI builds stay quiet.

### Turn it on in production

Set both vars on the VPS in `/var/www/thanos-wallet/.env` (or whichever env
file `docker-compose.prod.yml` reads from):

```bash
# .env — production
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_AUTH_TOKEN=<sentry auth token with project:write scope>
SENTRY_ORG=thanos
SENTRY_PROJECT=thanos-wallet-web
```

Then rebuild the web image:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.host-db.yml \
  build web && docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.host-db.yml \
  up -d web
```

Verify in the Sentry UI: throw a test error from the wallet (open devtools,
run `throw new Error('sentry test')`) and watch the project's Issues feed.

`SENTRY_AUTH_TOKEN` is **only used at build time** for source-map upload —
it doesn't run in production. Keep it tight in scope (project:write only).

### What gets scrubbed before send

The `beforeSend` hook in `apps/web/sentry.client.config.ts` recursively
walks the event and replaces any field whose key matches:

```
/(mnemonic|password|seed|private[_-]?key|vault|session[_-]?key)/i
```

with `[redacted]`. Defence-in-depth — the vault module never logs these
anyway, but this catches accidental leaks via third-party libraries.

## Structured logs — Pino

All three Node services now emit JSON via Pino:

- `services/api/src/lib/log.ts`
- `services/indexer/src/log.ts`
- `services/worker/src/log.ts`

In production each log line looks like:

```json
{"level":30,"time":1715923200000,"name":"@thanos/api","port":4000,"env":"production","msg":"api listening"}
```

`docker logs <container>` works as-is; the JSON is shippable to Loki,
Datadog, or CloudWatch with no transformation.

Level is controlled by `LOG_LEVEL` (info / debug / warn / error). Pretty
printing for local dev: `LOG_PRETTY=1 pnpm --filter @thanos/api dev`.

Sensitive fields auto-redacted: `password`, `mnemonic`, `seed`,
`private_key`, `token`, `accessToken`, `refreshToken`, `authorization`,
plus nested matches (e.g. `*.password`).

## Prometheus + Grafana — TODO

Metric collection isn't wired yet. The intended stack:

- Each service exposes `/metrics` (prom-client) on the internal Docker
  network only.
- Prometheus container scrapes them every 15s.
- Grafana queries Prometheus + alerts on:
  - **RPC failover triggered** (Makalu primary unreachable)
  - **Indexer sync gap > 5 min** (block cursor stalling)
  - **Queue backlog > 100** (BullMQ workers behind)
  - **API p99 latency > 1s**
  - **5xx rate > 1%** sustained 5 min

Each is a separate alert routed to whatever paging tool we standardise on
(Slack webhook, PagerDuty, email).

This is on the backlog — see todo #17.

## Uptime / external probes

External health-check pings should hit:

- `https://devapp.thanos.fi/` — web UI loads (Next.js returns the HTML)
- `https://devapp.thanos.fi/api/health` — API + DB + Redis up (return 200)

Recommended cadence: every 60s from at least two geographies (e.g. a free
UptimeRobot account hits us from US-East + EU-West).

## RPC failover dashboard

The `apps/web/lib/rpc.ts` and `services/indexer/src/chain.ts` modules now
build an ethers `FallbackProvider` over the comma-separated list in
`NEXT_PUBLIC_LITHO_RPC` / `LITHO_RPC_INDEXER`. Defaults:

- Web: `rpc.litho.ai, rpc-2.litho.ai, rpc-3.litho.ai`
- Indexer: same, with `rpc-2` preferred so its load doesn't compete with UI traffic

When the primary stalls (>1.5s no response), ethers transparently rotates
to the next provider. The user sees nothing. Logs show
`StallTimeoutError` from ethers when this happens — surface as a
warning-level event in Sentry once it's wired.
