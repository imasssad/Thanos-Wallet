# Postgres backup & recovery runbook

This is the **on-call playbook** for anything that touches the wallet
database. Pair it with `README.md` (which covers the one-time cron setup).

- **Database**: `thanos_wallet` on Postgres 16, single primary, no replica.
- **Container**: `thanos-postgres` (docker network only — no host port).
- **Backup cadence**: nightly 04:00 UTC `pg_dump` → gzip → rotated daily/weekly/monthly.
- **Off-site**: optional `aws s3 cp` if `S3_BUCKET` is set in `/root/.thanos-backup.env`.
- **RPO** (data we can lose): **24 h** with dumps alone; **~1 min** with the optional PITR overlay (see Scenario 4).
- **RTO** (time to recover): **~15 min** for a same-host restore; **~90 min** for a full VPS rebuild.

Two complementary backup chains run side-by-side:

1. **`pg_dump`** — logical, gzipped, schema-portable. Survives a Postgres
   major-version upgrade and is human-readable. Daily / weekly / monthly
   rotation. *This is what most restores use.*
2. **pgBackRest (optional overlay)** — physical, with continuous WAL
   shipping. Enables point-in-time recovery and a cross-region replica.
   Bring up with `docker-compose.pitr.yml`. *Use for PITR or PR-grade
   incidents where 24h RPO is too much.*

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

## Scenario 4 — point-in-time recovery (PITR)

**Symptom**: You need to roll the database back to a specific moment —
the minute before a bad migration ran, the hour before someone TRUNCATE'd
a table. Nightly dumps can't help; you need every WAL segment since the
last full backup.

**Prerequisite**: the PITR overlay is up. There are two paths depending on
whether the cluster already has data or is being initialised fresh.

### Activating on a fresh cluster

```bash
cd /var/www/thanos-wallet
sudo mkdir -p /var/backups/thanos-pgbackrest
sudo chown -R 70:70 /var/backups/thanos-pgbackrest
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.pitr.yml up -d --build postgres
```

The `init-stanza.sh` script baked into the image fires on first boot,
creates the stanza, and takes the initial full backup automatically.
Skip straight to "Restore to a target time" below.

### Activating on an existing cluster

`init-stanza.sh` only runs on a fresh `initdb`, so for a cluster that
already has data you do the equivalent steps via a one-shot bootstrap
script:

```bash
cd /var/www/thanos-wallet
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.pitr.yml up -d --build postgres
sudo /var/www/thanos-wallet/ops/backups/pgbackrest/bootstrap-existing.sh
```

The script is idempotent — it:
- creates the `postgres` superuser role if missing (the stock image
  initdb's with `POSTGRES_USER=thanos`, so the `postgres` role that
  `pgbackrest.conf` expects doesn't exist by default),
- chowns the host bind mount to uid 70 (Alpine's postgres container
  user) so pgBackRest can write the repo,
- runs `stanza-create`,
- takes the initial full backup if one doesn't exist yet.

Safe to re-run on a healthy stanza — it skips each step that's already
done.

Once it's running, pgBackRest streams every WAL segment to the local
repo as Postgres rotates it (RPO ~1 min once WAL pressure flushes it).
The host cron (see `ops/backups/pgbackrest/backup.sh`) takes nightly
incrementals + weekly fulls on top.

### Restore to a target time

1. **Identify the target time** in UTC. Be precise — pgBackRest replays
   WAL up to (not including) this timestamp.

   ```bash
   TARGET="2026-05-23 14:32:00+00"
   ```

2. **Stop the dependent services** so they don't keep writing while you
   restore:

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api indexer worker
   ```

3. **Check what backups + WAL the repo has**. If the target time falls
   before the oldest backup, you're out of luck — bail and use the
   nightly dump instead.

   ```bash
   docker exec -u postgres thanos-postgres \
     pgbackrest --stanza=thanos info
   ```

4. **Stop Postgres, wipe the data directory, restore**. pgBackRest will
   not restore over a non-empty data dir without `--delta`. Use `--delta`
   for an in-place restore (faster, only changed files copied) and
   `--type=time` with the target.

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml stop postgres

   # Restore as the postgres OS user. The data dir is on a Docker volume;
   # easiest path is to run a one-shot exec inside a fresh container.
   docker run --rm \
     -v thanos-wallet_postgres_data:/var/lib/postgresql/data \
     -v /var/backups/thanos-pgbackrest:/var/lib/pgbackrest \
     -v /var/www/thanos-wallet/ops/backups/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
     --user postgres \
     thanos-postgres-pitr \
     pgbackrest --stanza=thanos \
                --type=time "--target=$TARGET" \
                --target-action=promote \
                --delta restore
   ```

5. **Bring Postgres back** and verify it's caught up to the target time:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                   -f docker-compose.pitr.yml up -d postgres
   sleep 5
   docker exec thanos-postgres psql -U thanos -d thanos_wallet -c \
     "SELECT now() AS db_now, pg_last_wal_replay_lsn();"
   ```

6. **Bring services back** and run the post-restore verification
   checklist above:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api indexer worker
   ```

> **PITR caveat**: WAL between the target and the moment you noticed
> the problem is *lost on purpose* — that's the entire point of PITR.
> If the bad event was at T+0 and you restore to T-5min, anything
> users did between T-5min and T+0 is gone. Communicate this clearly
> before pulling the trigger.

---

## What's intentionally not in this runbook

- **Cross-region replica failover.** Handled in its own runbook:
  [`ops/backups/replica/RUNBOOK.md`](./replica/RUNBOOK.md). Streaming
  standby + DNS-flip failover, RTO ~5 min. Provisioning + failover
  scripts ready; execute once the second VPS is provisioned.
- **Cross-region replica.** A read replica in a second region would cut
  the rebuild RTO from ~90 min to ~5 min, at the cost of a second VPS.
- **Encrypted-at-rest backups.** If the S3 bucket is shared, pipe through
  `gpg --symmetric --cipher-algo AES256 --batch --passphrase-file ...`
  between `gzip` and `aws s3 cp`. Bucket-level SSE-KMS is the simpler option.
- **Snapshot of the `redis_data` volume.** Redis is rebuilt cold —
  pending jobs are lost, but BullMQ jobs are idempotent (the indexer
  re-emits anything missed via the cursor catch-up loop).
