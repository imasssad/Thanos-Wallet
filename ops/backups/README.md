# Postgres backups

Three complementary chains, each for a different failure mode:

1. **`pg-backup.sh`** (this directory) — logical `pg_dump`, gzipped,
   rotated daily/weekly/monthly, optional S3 mirror. Schema-portable.
   Survives a Postgres major-version upgrade.
2. **pgBackRest** ([`./pgbackrest/`](./pgbackrest/)) — physical, continuous
   WAL archiving. Enables point-in-time recovery (RPO ~1 min). Optional
   overlay, brought up with `docker-compose.pitr.yml`.
3. **Cross-region streaming replica** ([`./replica/`](./replica/)) — hot
   standby in a second region. Cuts rebuild RTO from ~90 min to ~5 min
   via DNS-flip failover. Requires a second VPS — see the replica
   [`RUNBOOK.md`](./replica/RUNBOOK.md) for provisioning + failover.

> **Recovering from a real incident?** See [`RUNBOOK.md`](./RUNBOOK.md) for
> the on-call playbook — scenario-by-scenario restore commands (including
> PITR), RPO/RTO targets, and post-restore verification.

## One-time setup on the VPS

1. Copy the env template and fill in real values:

   ```bash
   sudo tee /root/.thanos-backup.env > /dev/null <<'EOF'
   PGUSER=thanos
   PGDATABASE=thanos_wallet
   BACKUP_DIR=/var/backups/thanos-wallet
   # PG_CONTAINER defaults to thanos-postgres — only set if you renamed it.
   # Optional off-site push — uncomment if AWS CLI + creds are configured
   # S3_BUCKET=s3://thanos-backups/postgres
   EOF
   sudo chmod 600 /root/.thanos-backup.env
   ```

2. Make sure the script is executable and the backup directory exists:

   ```bash
   sudo chmod +x /var/www/thanos-wallet/ops/backups/pg-backup.sh
   sudo mkdir -p /var/backups/thanos-wallet
   ```

3. Run it once manually to confirm it works:

   ```bash
   sudo /var/www/thanos-wallet/ops/backups/pg-backup.sh
   ls -la /var/backups/thanos-wallet/daily/
   ```

4. Add the cron entry:

   ```bash
   sudo crontab -e
   # Daily 04:00 UTC — quiet period for the indexer poller.
   0 4 * * * /var/www/thanos-wallet/ops/backups/pg-backup.sh >> /var/log/thanos-pg-backup.log 2>&1
   ```

5. Verify the cron is registered:

   ```bash
   sudo crontab -l | grep pg-backup
   ```

## Restoring a backup

Pick the dump you want and pipe it into `psql`:

```bash
# 1) Stop the services that talk to the DB (so the restore can DROP cleanly)
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api indexer worker

# 2) Restore — the dump was taken with --clean --if-exists, so it drops and
#    recreates each table. Piped into psql inside the Postgres container.
gunzip -c /var/backups/thanos-wallet/daily/thanos-wallet-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet

# 3) Bring services back
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api indexer worker

# 4) Watch logs until the indexer reports "schema ready" + "background poll"
docker logs --tail=20 thanos-indexer
```

## Weekly restore-verification

`pg-backup.sh` proves we can *take* a backup; `restore-verify.sh` proves we
can *use* it. It spins a throwaway Postgres container, pipes the latest
daily dump into it, runs sanity SELECTs, then tears the container down.

```bash
sudo /var/www/thanos-wallet/ops/backups/restore-verify.sh
```

Suggested cron — Sundays at 05:00 UTC, after the nightly rotation:

```bash
sudo crontab -e
# Verify the most recent dump actually restores.
0 5 * * 0 /var/www/thanos-wallet/ops/backups/restore-verify.sh >> /var/log/thanos-restore-verify.log 2>&1
```

If this script exits non-zero two weeks in a row, the backup chain is
broken — see [`RUNBOOK.md`](./RUNBOOK.md) for what to check.

## What's *not* in this script (intentionally)

- **Continuous WAL archiving / PITR.** Daily dumps mean an RPO of 24h. If we
  need tighter RPO, switch to `pgbackrest` with WAL shipping.
- **Encrypted backups.** Add GPG encryption between `gzip` and the optional
  `aws s3 cp` step if backups go to a shared S3 bucket.
- **Monitoring.** Today the cron emits a log line; if it fails the only
  signal is "no new file in /var/backups/thanos-wallet/daily". Add a check
  to the alerting stack once Prometheus is wired (see TODO #17).
