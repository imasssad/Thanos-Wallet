#!/usr/bin/env bash
#
# Activate pgBackRest on an EXISTING Postgres cluster.
#
# The init-stanza.sh script in /docker-entrypoint-initdb.d only fires on
# a fresh `initdb` — so when you flip the PITR overlay onto a cluster
# that already has data, you have to do the equivalent steps by hand.
#
# This script captures those steps. Idempotent end-to-end: re-running on
# a healthy stanza is a no-op (it detects `status: ok` from `info` and
# skips straight to a status report).
#
# Run on the PRIMARY VPS after bringing the PITR overlay up:
#
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#                  -f docker-compose.pitr.yml up -d --build postgres
#   sudo /var/www/thanos-wallet/ops/backups/pgbackrest/bootstrap-existing.sh
#
# What it does:
#   1. CREATE ROLE postgres SUPERUSER LOGIN  — needed when the cluster
#      was initdb'd with POSTGRES_USER=<something other than postgres>,
#      because pgbackrest.conf uses `pg1-user = postgres`.
#   2. chown -R 70:70 of the host bind mount — Alpine's postgres runs as
#      uid 70 inside the container; a root-owned host dir blocks writes.
#   3. stanza-create on the existing cluster.
#   4. Initial FULL backup so WAL archiving has a baseline to attach to.
#
# Env overrides:
#   PG_CONTAINER          (default: thanos-postgres)
#   POSTGRES_ADMIN_USER   (default: thanos — must match docker-compose.yml)
#   POSTGRES_DB           (default: thanos_wallet)
#   PGBACKREST_REPO_HOST  (default: /var/backups/thanos-pgbackrest)

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-thanos-postgres}"
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-${POSTGRES_USER:-thanos}}"
POSTGRES_DB="${POSTGRES_DB:-thanos_wallet}"
PGBACKREST_REPO_HOST="${PGBACKREST_REPO_HOST:-/var/backups/thanos-pgbackrest}"

log()  { echo "[bootstrap-existing $(date -u +%FT%TZ)] $*"; }
fail() { log "FAIL: $*" >&2; exit 1; }

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 \
  || fail "$PG_CONTAINER is not running — bring up the PITR overlay first"

# 1) postgres role.
log "ensuring 'postgres' superuser role exists (needed by pgbackrest.conf)"
ROLE_EXISTS=$(docker exec -u postgres "$PG_CONTAINER" \
  psql -U "$POSTGRES_ADMIN_USER" -d "$POSTGRES_DB" -At -c \
    "SELECT 1 FROM pg_roles WHERE rolname='postgres'" 2>/dev/null || echo "")
if [ "$ROLE_EXISTS" = "1" ]; then
  log "  'postgres' role already exists"
else
  docker exec -u postgres "$PG_CONTAINER" \
    psql -U "$POSTGRES_ADMIN_USER" -d "$POSTGRES_DB" -c \
      "CREATE ROLE postgres SUPERUSER LOGIN;"
  log "  created 'postgres' role"
fi

# 2) Repo perms.
if [ ! -d "$PGBACKREST_REPO_HOST" ]; then
  log "creating repo dir at $PGBACKREST_REPO_HOST"
  mkdir -p "$PGBACKREST_REPO_HOST"
fi
CURRENT_OWNER=$(stat -c '%u:%g' "$PGBACKREST_REPO_HOST")
if [ "$CURRENT_OWNER" = "70:70" ]; then
  log "repo dir already owned by uid 70 (container postgres user)"
else
  log "chowning $PGBACKREST_REPO_HOST → 70:70 (was $CURRENT_OWNER)"
  chown -R 70:70 "$PGBACKREST_REPO_HOST"
fi

# 3) stanza-create — pgbackrest's own check is idempotent: if the stanza
#    is already valid, it logs "stanza-create was successful" and exits 0.
log "running stanza-create (idempotent)"
docker exec -u postgres "$PG_CONTAINER" \
  pgbackrest --stanza=thanos --log-level-console=info stanza-create

# 4) Initial full backup — skip if one already exists.
EXISTING_FULL=$(docker exec -u postgres "$PG_CONTAINER" \
  pgbackrest --stanza=thanos info --output=json 2>/dev/null \
    | grep -o '"type":"full"' | head -1 || true)
if [ -n "$EXISTING_FULL" ]; then
  log "full backup already present — skipping initial backup"
else
  log "taking initial FULL backup (may take a few minutes on a large DB)"
  docker exec -u postgres "$PG_CONTAINER" \
    pgbackrest --stanza=thanos --type=full --log-level-console=info backup
fi

# Report.
log "final status:"
docker exec -u postgres "$PG_CONTAINER" \
  pgbackrest --stanza=thanos info
