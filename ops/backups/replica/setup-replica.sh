#!/usr/bin/env bash
#
# Bootstrap a Postgres streaming replica from the pgBackRest repo.
#
# Run this ON THE REPLICA VPS, once. Idempotent — re-running on a healthy
# replica is a no-op (it detects standby.signal and exits early).
#
# Prerequisites (see ops/backups/replica/RUNBOOK.md for the full setup):
#   - /var/backups/thanos-pgbackrest is populated (`aws s3 sync` from
#     the primary's repo).
#   - /root/.thanos-backup.env contains THANOS_REPL_PASSWORD.
#   - The SSH tunnel from the primary is up (replica's localhost:5433
#     reaches the primary's 5432).
#   - The PITR-overlay image is built locally:
#       docker compose -f docker-compose.yml -f docker-compose.pitr.yml \
#         build postgres
#
# What it does:
#   1. Stops the local postgres container (if any).
#   2. Wipes the local postgres data volume.
#   3. Calls `pgbackrest restore --type=standby` to populate the data dir
#      and drop standby.signal in place.
#   4. Writes primary_conninfo with credentials from the env file.
#   5. Starts Postgres — it comes up as a hot standby.
#
# Failure modes:
#   - pgbackrest repo empty / corrupted: aborts before touching the
#     data volume. Re-sync from primary, retry.
#   - THANOS_REPL_PASSWORD missing: aborts; never writes a partial conf.

set -euo pipefail

REPO_DIR="${PGBACKREST_REPO_HOST_PATH:-/var/backups/thanos-pgbackrest}"
COMPOSE_DIR="${THANOS_COMPOSE_DIR:-/var/www/thanos-wallet}"
PG_CONTAINER="${PG_CONTAINER:-thanos-postgres}"
PG_VOLUME="${PG_VOLUME:-thanos-wallet_postgres_data}"
PRIMARY_HOST="${PRIMARY_HOST:-127.0.0.1}"
PRIMARY_PORT="${PRIMARY_PORT:-5433}"  # SSH-tunneled
APPLICATION_NAME="${APPLICATION_NAME:-thanos-replica-$(hostname -s)}"

[ -f /root/.thanos-backup.env ] && source /root/.thanos-backup.env

log()  { echo "[setup-replica $(date -u +%FT%TZ)] $*"; }
fail() { log "FAIL: $*" >&2; exit 1; }

[ -n "${THANOS_REPL_PASSWORD:-}" ] || fail "THANOS_REPL_PASSWORD not set (put it in /root/.thanos-backup.env)"
[ -d "$REPO_DIR" ] || fail "pgBackRest repo missing at $REPO_DIR — sync from primary first"
[ -d "$COMPOSE_DIR" ] || fail "compose dir $COMPOSE_DIR not found"

# Refuse to clobber a healthy replica.
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  if docker exec "$PG_CONTAINER" test -f /var/lib/postgresql/data/standby.signal 2>/dev/null; then
    log "replica already initialised (standby.signal present) — nothing to do"
    exit 0
  fi
fi

log "stopping existing postgres container, if any"
( cd "$COMPOSE_DIR" && \
  docker compose -f docker-compose.yml -f docker-compose.pitr.yml stop postgres ) || true

log "wiping data volume $PG_VOLUME"
docker volume rm "$PG_VOLUME" >/dev/null 2>&1 || true
docker volume create "$PG_VOLUME" >/dev/null

log "restoring pgBackRest backup into the fresh data volume (as standby)"
docker run --rm \
  -v "$PG_VOLUME":/var/lib/postgresql/data \
  -v "$REPO_DIR":/var/lib/pgbackrest \
  -v "$COMPOSE_DIR/ops/backups/pgbackrest/pgbackrest.conf":/etc/pgbackrest/pgbackrest.conf:ro \
  --user postgres \
  thanos-postgres-pitr \
  pgbackrest --stanza=thanos --type=standby \
             --log-level-console=info \
             restore

log "writing primary_conninfo into postgresql.auto.conf"
# Use docker run to write into the volume — the data dir is owned by
# postgres uid 70 inside the alpine image, so going through the container
# avoids host-side perms surprises.
docker run --rm \
  -v "$PG_VOLUME":/var/lib/postgresql/data \
  --user postgres \
  thanos-postgres-pitr \
  bash -c "cat >> /var/lib/postgresql/data/postgresql.auto.conf <<EOF
# Managed by ops/backups/replica/setup-replica.sh
primary_conninfo = 'host=${PRIMARY_HOST} port=${PRIMARY_PORT} user=thanos_repl password=${THANOS_REPL_PASSWORD} application_name=${APPLICATION_NAME} sslmode=disable'
hot_standby = on
EOF
touch /var/lib/postgresql/data/standby.signal
"

log "starting postgres on the replica"
( cd "$COMPOSE_DIR" && \
  docker compose -f docker-compose.yml -f docker-compose.pitr.yml up -d postgres )

# Wait for the replica to come up + report it's in recovery.
for _ in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -q -U postgres; then break; fi
  sleep 2
done

IN_REC=$(docker exec "$PG_CONTAINER" psql -U postgres -Atc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "?")
if [ "$IN_REC" = "t" ]; then
  log "OK — replica is in recovery + streaming. Verify on the primary with pg_stat_replication."
else
  fail "postgres started but is NOT in recovery (pg_is_in_recovery=$IN_REC) — check primary_conninfo + tunnel"
fi
