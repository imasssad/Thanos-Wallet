# Cross-region Postgres replica — provisioning + failover runbook

A streaming read-replica in a second region cuts the rebuild RTO from
~90 min (restore from off-site dump on a fresh VPS) to **~5 min**
(promote the warm standby + repoint DNS). The same replica also serves
as a hot off-site backup for the pgBackRest repo.

This runbook assumes the primary stack is already running the PITR
overlay (`docker-compose.pitr.yml`). The replica chains off the
pgBackRest repo for the initial bootstrap, then catches up via
streaming replication over an SSH tunnel.

- **Primary**: existing VPS at `thanos.fi` (PITR overlay enabled).
- **Replica**: a fresh VPS in a different region, same OS, same Docker.
- **Replication mode**: asynchronous streaming. Lag typically <100 ms
  with both hosts in the same continent; <1 s for trans-continental.
- **RPO** under normal operation: data committed on the primary in the
  last ~1 s may not be on the replica when the primary dies. Acceptable
  for a wallet workload — exchange-grade synchronous replication is a
  separate, larger lift.

## 1. Provision the replica VPS

Same baseline as the primary: Ubuntu 22.04+, Docker + Compose v2, AWS
CLI, ufw open on 22/443 (no 80/443 needed — the replica isn't serving
traffic yet).

```bash
# On the new VPS, as root:
mkdir -p /var/www
git clone https://github.com/<org>/Thanos-Wallet.git /var/www/thanos-wallet
cd /var/www/thanos-wallet

# Copy the production .env from the primary (use a secure channel —
# password manager / age-encrypted file / sealed-box). The replica needs
# the same POSTGRES_USER / POSTGRES_PASSWORD as the primary so the apps'
# connection strings still work after failover.
```

## 2. Open a tunnel between the two VPS

Postgres replication is **not** exposed to the public internet. Use an
SSH reverse tunnel from the primary so the replica reaches the primary's
5432 on `localhost:5433` of the replica host:

```bash
# On the primary, as root — make this a systemd service so it survives reboots.
cat > /etc/systemd/system/thanos-repl-tunnel.service <<'EOF'
[Unit]
Description=SSH reverse tunnel: primary 5432 -> replica:5433
After=network.target docker.service

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
  -i /root/.ssh/thanos-repl \
  -R 5433:127.0.0.1:5432 \
  thanos-repl@<REPLICA_IP>
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now thanos-repl-tunnel
```

Wireguard is a cleaner alternative if you already run it; the same
`primary_conninfo` setup below works against a private IP.

## 3. Set up the replication user on the primary

```bash
# On the primary VPS:
docker exec -u postgres thanos-postgres psql -d thanos_wallet <<'SQL'
  CREATE ROLE thanos_repl WITH REPLICATION LOGIN PASSWORD '<PICK-A-STRONG-ONE>';
SQL
```

Then add an `hba` rule so the replication user can connect from the
loopback (the SSH tunnel terminates on the primary's `localhost`):

```bash
docker exec -u postgres thanos-postgres bash -c \
  "echo 'host replication thanos_repl 127.0.0.1/32 scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec -u postgres thanos-postgres pg_ctl reload
```

Store the password in `/root/.thanos-backup.env` on the replica:

```bash
# On the replica:
sudo tee -a /root/.thanos-backup.env > /dev/null <<'EOF'
THANOS_REPL_PASSWORD=<the-password-you-just-set>
EOF
sudo chmod 600 /root/.thanos-backup.env
```

## 4. Bootstrap the replica from pgBackRest

The replica's initial data-directory is built from the most recent
pgBackRest full + WAL — much faster than re-streaming the whole
cluster from scratch, especially across regions.

```bash
# On the replica VPS, repo first synced from S3 (or the primary):
sudo mkdir -p /var/backups/thanos-pgbackrest
aws s3 sync s3://thanos-pgbackrest /var/backups/thanos-pgbackrest

# Then run the setup script (idempotent — re-running on a healthy
# replica is a no-op):
sudo /var/www/thanos-wallet/ops/backups/replica/setup-replica.sh
```

`setup-replica.sh` will:
- restore the latest pgBackRest backup into the replica's data volume,
- write a `standby.signal` so Postgres starts in standby mode,
- set `primary_conninfo` pointing at the tunnel's `localhost:5433`,
- bring up Postgres on the replica.

## 5. Verify replication is healthy

On the **primary**:

```bash
docker exec -u postgres thanos-postgres psql -d thanos_wallet -c \
  "SELECT client_addr, state, sync_state,
          pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
     FROM pg_stat_replication;"
```

`state` should be `streaming` and `lag_bytes` should converge to a low
number (single-digit MB initially, kilobytes at steady state).

On the **replica**:

```bash
docker exec -u postgres thanos-postgres psql -d thanos_wallet -c \
  "SELECT pg_is_in_recovery() AS in_recovery,
          now() - pg_last_xact_replay_timestamp() AS replay_lag;"
```

`in_recovery` should be `t`. `replay_lag` should be sub-second.

Wire `check-lag.sh` into cron for ongoing monitoring:

```bash
# On the primary:
sudo crontab -e
# Every 5 min — emits a non-zero exit if lag > 30s, suitable for piping
# into Prometheus blackbox or a Sentry breadcrumb.
*/5 * * * * /var/www/thanos-wallet/ops/backups/replica/check-lag.sh >> /var/log/thanos-repl-lag.log 2>&1
```

---

## Failover — primary lost, promote replica

This is the path you'll actually run under pressure. Read all six steps
before doing any of them.

1. **Confirm the primary is really down**, not just slow. A network blip
   that triggers a false failover doubles the incident — you end up
   with both hosts thinking they're primary.

   ```bash
   # On the replica, try to reach the primary one more time.
   curl -fsS --max-time 5 https://thanos.fi/api/health
   ```

   If this returns 200, do **not** failover. Investigate the latency
   alert instead.

2. **Stop write traffic** by failing the primary's DNS or by stopping
   nginx on the primary if it's reachable:

   ```bash
   # If the primary is reachable but unhealthy:
   ssh root@<PRIMARY> 'cd /var/www/thanos-wallet && \
     docker compose -f docker-compose.yml -f docker-compose.prod.yml stop nginx api indexer worker'
   ```

3. **Promote the replica**:

   ```bash
   # On the replica:
   sudo /var/www/thanos-wallet/ops/backups/replica/promote.sh
   ```

   `promote.sh` calls `pg_promote()` inside the container and removes
   the `standby.signal`. Postgres exits recovery; it is now a primary.

4. **Bring up the rest of the wallet stack on the replica** (it has the
   same `.env` and the same repo, so the services start cleanly):

   ```bash
   cd /var/www/thanos-wallet
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

5. **Repoint DNS** — `thanos.fi` A/AAAA records to the replica IP. TTL
   is 60s in our zone (set this *before* you ever need to failover); the
   change should be visible in well under five minutes.

6. **Run the post-restore verification checklist** from
   `ops/backups/RUNBOOK.md` ("Post-restore verification"). The same
   commands apply.

The old primary, when it comes back, **must be rebuilt as the new
replica** — never just brought up. Two primaries diverge, and the
second one's last-five-minutes-of-data wins because of step 5.
`setup-replica.sh` does this correctly: it wipes the data dir and
re-bootstraps from pgBackRest.

---

## Fail-back — return to the original primary

Optional. If the original primary is geographically preferable, swap
the roles back during a quiet window. Repeat the failover procedure
with the hosts reversed.

In practice, most teams **don't** fail back — the replica is now the
primary, and a new replica is built in the original region. Saves a
second outage window.

---

## What this runbook intentionally doesn't cover

- **Synchronous replication.** We use async. Synchronous would give RPO
  zero but means a write to the primary blocks if the replica is
  unreachable — wrong tradeoff for a wallet (better to lose 1s of data
  than to halt the whole wallet during a network partition).
- **Multi-master.** Out of scope for Postgres. If we ever need it,
  switch to a CRDT-based ledger backend.
- **Connection pooling at the failover boundary.** pgbouncer in front
  of the wallet services would shave another minute off the failover
  RTO, since app-side connection objects could survive the IP flip.
  Open issue when you spin up the replica.
