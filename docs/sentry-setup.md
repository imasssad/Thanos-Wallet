# Sentry setup on the VPS

The wallet's three backend services (`api`, `indexer`, `worker`) initialize
Sentry only when `SENTRY_DSN` is set; otherwise they no-op cleanly. To
turn error tracking on in production:

1. **Create the Sentry project** (one-time)
   - Org → Projects → Create → "Node.js"
   - Name: `thanos-wallet-backend` (or three separate projects if you
     want per-service quotas)
   - Copy the DSN — looks like `https://<id>@sentry.io/<project>`

2. **Add the DSN to the VPS env** at `/var/www/thanos-wallet/.env`:

   ```env
   SENTRY_DSN=https://<id>@sentry.io/<project>
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0.1
   ```

3. **Reload the services** so they pick up the new env:

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     up -d api indexer worker
   ```

4. **Verify** with a forced exception:

   ```bash
   curl -X POST https://thanos.fi/api/debug/sentry-test
   # Sentry should record the synthetic exception within ~30s
   ```

   (Endpoint is only enabled when `SENTRY_DEBUG_ENDPOINT=1` is set.)

## Client-side (web bundle)

Set `NEXT_PUBLIC_SENTRY_DSN` at build time — the release workflow already
forwards it from the GitHub secret of the same name. Source-map upload
needs three additional secrets (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`), all forwarded by `.github/workflows/release.yml`.

## What to alert on

The alert rules in `ops/observability/alerts.yml` cover Prometheus
metrics. Sentry handles the orthogonal axis of errors with stack traces.
Suggested Sentry alert rules:

| Trigger | Notify |
|---|---|
| New issue in last 1h | Slack #ops |
| Issue rate × 10 in 5m | Slack #ops + PagerDuty |
| `level:error` for `route:/auth/login` more than 50× in 10m | PagerDuty |

Don't page on every error — the wallet is a long-tail of user-induced
exceptions (wrong password, network blips). Page only on regression
signals.
