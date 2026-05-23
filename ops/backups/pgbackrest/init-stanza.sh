#!/usr/bin/env bash
#
# pgBackRest first-boot initialisation.
#
# Runs from /docker-entrypoint-initdb.d on a freshly-initialised cluster.
# Postgres has been booted, the schema mounted at 01_schema.sql has been
# loaded, and the `postgres` superuser is available on the local socket.
#
# We:
#   1. Wait for Postgres to accept local connections (it's ready by the
#      time init-d runs, but defensive in slower CI environments).
#   2. Verify the stanza config is mounted — if `/etc/pgbackrest/pgbackrest.conf`
#      doesn't list the `[thanos]` stanza we abort loudly (operator forgot
#      to mount it from the host).
#   3. Run `stanza-create` — idempotent; safe on every restart.
#   4. Take an initial FULL backup so PITR works from minute one.
#
# Idempotent end-to-end: re-running on an already-bootstrapped cluster
# does nothing destructive.

set -euo pipefail

log() { echo "[pgbackrest-init $(date -u +%FT%TZ)] $*"; }

# Wait for the local socket — should already be up, but be safe.
for _ in $(seq 1 30); do
  if pg_isready -q -U postgres -h /var/run/postgresql; then break; fi
  sleep 1
done

if ! grep -q '^\[thanos\]' /etc/pgbackrest/pgbackrest.conf 2>/dev/null; then
  log "ERROR: /etc/pgbackrest/pgbackrest.conf is missing the [thanos] stanza"
  log "Mount the file from ops/backups/pgbackrest/pgbackrest.conf in docker-compose"
  exit 1
fi

log "running stanza-create"
pgbackrest --stanza=thanos --log-level-console=info stanza-create

log "taking initial FULL backup"
pgbackrest --stanza=thanos --type=full --log-level-console=info backup

log "pgbackrest initialised. archive_command is now active."
