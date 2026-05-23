# Postgres backup & recovery runbook

This is the **on-call playbook** for anything that touches the wallet
database. Pair it with `README.md` (which covers the one-time cron setup).

- **Database**: `thanos_wallet` on Postgres 16, single primary, no replica.
- **Container**: `thanos-postgres` (docker network only — no host port).
- **Backup cadence**: nightly 04:00 UTC `pg_dump` → gzip → rotated daily/weekly/monthly.
- **Off-site**: optional `aws s3 cp` if `S3_BUCKET` is set in `/root/.thanos-backup.env`.
- **RPO** (data we can lose): **24 h** — the last good nightly dump.
- **RTO** (time to recover): **~15 min** for a same-host restore; **~90 min** for a full VPS rebuild.

If those numbers are no longer acceptable, switch to `pgbackrest` with
WAL shipping (PITR, RPO ~5 min). That's a bigger lift — out of scope for
this runbook.

---

## Quick reference — the three commands you'll actually run

```bash
# 1) What backups do we have?
ls -lh /var/backups/thanos-wallet/daily/ /var/backups/thanos-wallet/weekly/ /var/backups/thanos-wallet/monthly/

# 2) Take an ad-hoc backup right now (before doing anything risky).
sudo /var/www/thanos-wallet/ops/backups/pg-backup.sh

# 3) Restore the most recent dump (see "Restore from a dump" below for guardrails).
LATEST=$(ls -1t /var/backups/thanos-wallet/daily/*.sql.gz | head -1)
gunzip -c "$LATEST" | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet
```

---

## Scenario 1 — accidental `DROP TABLE` / bad migration

**Symptom**: API is returning 500s; `docker logs thanos-api` shows
`relation "..." does not exist` or `column "..." does not exist`.

1. **Stop write traffic immediately** so the dump-in-progress and
   current state don't diverge any further:

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api indexer worker
   ```

2. **Take an emergency dump of the broken state** — keeps forensics
   possible if something else went wrong:

   ```bash
   sudo /var/www/thanos-wallet/ops/backups/pg-backup.sh
   mv /var/backups/thanos-wallet/daily/thanos-wallet-*.sql.gz \
      /var/backups/thanos-wallet/broken-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   ```

3. **Restore the most recent *pre-incident* dump** — usually last night's
   04:00 UTC daily:

   ```bash
   LATEST=$(ls -1t /var/backups/thanos-wallet/daily/*.sql.gz | head -1)
   echo "Restoring: $LATEST"
   gunzip -c "$LATEST" | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet
   ```

   The dump was taken with `--clean --if-exists`, so it drops each table
   before recreating it. No need to drop the DB by hand.

4. **Re-apply any migrations that ran *after* the dump but *before* the
   incident** (look in `services/db/migrations/`). Almost always there's
   nothing — migrations only run on deploy.

5. **Bring services back**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api indexer worker
   docker logs --tail=30 thanos-api thanos-indexer thanos-worker
   ```

6. **Verify** — see "Post-restore verification" below.

---

## Scenario 2 — Postgres data volume is corrupted

**Symptom**: `thanos-postgres` keeps restarting. `docker logs
thanos-postgres` shows `PANIC: could not locate ...` or
`invalid page in block ...`.

1. Stop everything:

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml down
   ```

2. **Move** (don't delete) the bad volume so forensics is still possible:

   ```bash
   docker volume inspect thanos-wallet_postgres_data \
     --format '{{.Mountpoint}}'
   # Then, as root, mv that directory to <path>.broken-<timestamp>
   ```

3. Bring Postgres back with a fresh empty volume:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
   docker logs --tail=30 thanos-postgres   # should show "ready to accept connections"
   ```

4. Restore from the latest dump (same as Scenario 1 step 3).

5. Start the rest of the stack.

---

## Scenario 3 — full VPS lost / rebuild from zero

**Symptom**: The host is gone (provider incident, accidental rm -rf,
ransomware). You have only the off-site S3 backup.

1. **Provision the new VPS** — Ubuntu 22.04+, Docker + Compose v2, AWS
   CLI, ufw open on 80/443/22 only.

2. **Pull the latest off-site dump**:

   ```bash
   sudo mkdir -p /var/backups/thanos-wallet/daily
   aws s3 ls s3://thanos-backups/postgres/ | sort | tail -5
   aws s3 cp s3://thanos-backups/postgres/thanos-wallet-<TS>.sql.gz \
     /var/backups/thanos-wallet/daily/
   ```

3. **Clone the repo** to `/var/www/thanos-wallet` and copy the
   production `.env` (from your password manager — it is not in git).

4. **Bring up Postgres only** and let it initialise on the empty volume:

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
   sleep 10   # let initdb finish
   ```

5. **Create the database** (the dump assumes it already exists):

   ```bash
   docker exec thanos-postgres createdb -U thanos thanos_wallet || true
   ```

6. **Restore the dump**:

   ```bash
   LATEST=$(ls -1t /var/backups/thanos-wallet/daily/*.sql.gz | head -1)
   gunzip -c "$LATEST" | docker exec -i thanos-postgres psql -U thanos -d thanos_wallet
   ```

7. **Bring up the rest of the stack**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

8. Run "Post-restore verification" below. The indexer will catch back up
   from chain on its own (cursor is in Postgres; it will resume from
   wherever the dump left off and re-index the gap).

9. **Repoint DNS** to the new VPS IP once `/api/health` returns 200.

---

## Post-restore verification

After **any** restore, run these checks before declaring the wallet healthy.

```bash
# 1) DB is up and the schema is intact.
docker exec thanos-postgres psql -U thanos -d thanos_wallet -c "\dt" | head -40

# 2) Row counts are sane — none should be zero on a populated system.
docker exec thanos-postgres psql -U thanos -d thanos_wallet -c "
  SELECT 'users'        AS table, COUNT(*) FROM users
  UNION ALL SELECT 'accounts',     COUNT(*) FROM accounts
  UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
  UNION ALL SELECT 'tokens',       COUNT(*) FROM tokens;"

# 3) API health check passes.
curl -fsS http://localhost:4000/health

# 4) Indexer is making forward progress (head and cursor both advancing).
curl -fsS http://localhost:4010/metrics | grep '^thanos_indexer_'

# 5) Worker is processing the queues — none should be stuck > 100 deep.
curl -fsS http://localhost:4020/metrics | grep 'thanos_worker_queue_depth'

# 6) From the outside: the marketing flow loads.
curl -fsSI https://thanos.fi/ | head -3
```

If all six return cleanly, the restore is complete.

---

## Proving the backups *actually restore* — `restore-verify.sh`

Schroedinger's backup: an untested backup is in superposition between
"works" and "doesn't" until you restore it. We exercise it in production
every week to collapse the wave function.

```bash
# Restores the most recent daily dump into a throwaway Postgres
# container, runs sanity selects, then tears down. Exits non-zero if
# anything failed. Send the exit code into Prometheus blackbox / cron-
# health if you want it alerted.
sudo /var/www/thanos-wallet/ops/backups/restore-verify.sh
```

Suggested cron (Sundays 05:00 UTC, after the nightly dump rotation has
settled):

```cron
0 5 * * 0 /var/www/thanos-wallet/ops/backups/restore-verify.sh >> /var/log/thanos-restore-verify.log 2>&1
```

If this fails two Sundays in a row, **page** — your DR plan is broken.

---

## What's intentionally not in this runbook

- **Continuous WAL archiving / point-in-time recovery.** Daily dumps give
  RPO 24h. If that's no longer acceptable, install `pgbackrest` and ship
  WAL to S3; the restore workflow then includes a `--target-time` flag.
- **Cross-region replica.** A read replica in a second region would cut
  the rebuild RTO from ~90 min to ~5 min, at the cost of a second VPS.
- **Encrypted-at-rest backups.** If the S3 bucket is shared, pipe through
  `gpg --symmetric --cipher-algo AES256 --batch --passphrase-file ...`
  between `gzip` and `aws s3 cp`. Bucket-level SSE-KMS is the simpler option.
- **Snapshot of the `redis_data` volume.** Redis is rebuilt cold —
  pending jobs are lost, but BullMQ jobs are idempotent (the indexer
  re-emits anything missed via the cursor catch-up loop).
