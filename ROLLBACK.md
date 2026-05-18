# Rollback runbook

A deploy went bad. The goal of this doc is to get the wallet back to a
known-good state in under 5 minutes.

## TL;DR — fastest possible rollback

```bash
# On the VPS, as root or with sudo
cd /var/www/thanos-wallet
git log --oneline -10                       # pick the last good commit hash
git checkout <good-commit-hash>             # detached HEAD, fine
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  build web api indexer
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d web api indexer
curl -fsS https://devapp.thanos.fi/ -o /dev/null && echo "✓ site is up"
```

When the dust settles, get back onto a branch:

```bash
git checkout -b hotfix/rollback-$(date -u +%F)
git push -u origin hotfix/rollback-$(date -u +%F)
```

Then open a PR to merge the revert (or cherry-pick the good commits forward
onto a new main).

## Decide what kind of rollback you need

| Symptom | Rollback to |
|---|---|
| Web UI broken (build succeeded but UX regressed) | previous web image only |
| API returning 500s on every request | previous api image only |
| Indexer balances frozen / wrong | previous indexer image + skip below |
| Database schema migration broke a column | DB restore from `/var/backups/thanos-wallet/` |
| Everything broken simultaneously | full stack rollback (TL;DR above) |

## Per-service rollback

Each service is its own Docker image, so you can roll back just one.
Replace `<service>` with `web`, `api`, or `indexer`.

```bash
# 1) Show recent tags / shas of the local image — Docker keeps the last few
docker images thanos-wallet-<service>

# 2) Pick the previous image id
docker tag <image-id> thanos-wallet-<service>:rollback

# 3) Force-restart the container using that image
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps --no-build <service>
```

If the previous image was already pruned (`docker system prune` ran
recently), fall back to the git-checkout-and-rebuild flow above.

## Database rollback (last resort)

Schema migrations on this stack are still `CREATE TABLE IF NOT EXISTS`, so
forward-only — there's no `down()` migration. If a deploy corrupts data:

1. Identify the most recent good dump:

   ```bash
   ls -lh /var/backups/thanos-wallet/daily/
   ```

2. Stop the services that write to the DB:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     stop api indexer worker
   ```

3. Restore (the dumps were taken with `--clean --if-exists`):

   ```bash
   gunzip -c /var/backups/thanos-wallet/daily/<dump>.sql.gz \
     | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet
   ```

4. Bring services back, watch logs:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     up -d api indexer worker
   docker logs --tail=20 thanos-indexer
   ```

Restoring loses up to 24h of indexer state. The background sync loop will
re-fetch transfer events from the last persisted cursor on boot, so most
of that gap closes within ~15 minutes.

## After any rollback

- Comment on the GitHub commit/PR that caused the regression with a brief
  postmortem and the exact rollback steps used.
- Open an issue tagged `regression` describing what to test before the same
  fix can land again.
- If the bad commit reached users, add a banner to the web app letting
  them know about the issue and any action they need to take (e.g. re-import).

## Things that do **not** roll back automatically

- **Pushed images on the user's machine** — Desktop / Extension / Mobile
  binaries that already shipped to users aren't reverted by a server
  rollback. If a client-side regression went out, see the per-platform
  release notes for a hotfix release.
- **Chrome Web Store / App Store listings** — pulling a published listing
  is a separate process; contact the store reviewer if the regression is
  a security issue.
- **Sentry breadcrumbs** — old crashes stay in the dashboard. Triage them
  separately to confirm the rollback actually fixed the issue.
