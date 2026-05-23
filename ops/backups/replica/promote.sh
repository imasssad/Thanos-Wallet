#!/usr/bin/env bash
#
# Promote this replica to primary — failover script.
#
# Run on the replica AFTER you've confirmed the primary is dead and DNS
# is about to flip. See ops/backups/replica/RUNBOOK.md "Failover" section.
#
# What it does:
#   1. Sanity-checks that this host IS actually a replica (refuses to run
#      on a primary — that would be a no-op anyway but the error message
#      is cleaner).
#   2. Calls pg_promote(true, 60) — wait up to 60s for promotion to
#      complete.
#   3. Verifies pg_is_in_recovery() flipped to false.
#   4. Removes standby.signal + primary_conninfo so a restart doesn't
#      re-enter recovery mode.
#   5. Prints next steps (bring up the rest of the stack + flip DNS).
#
# This script does NOT:
#   - bring up the wallet services (that's the next step in the runbook)
#   - touch DNS (out of scope — usually done via your registrar's UI or
#     a separate dns/ ops module).

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-thanos-postgres}"

log()  { echo "[promote $(date -u +%FT%TZ)] $*"; }
fail() { log "FAIL: $*" >&2; exit 1; }

# Sanity check.
IN_REC=$(docker exec "$PG_CONTAINER" psql -U postgres -Atc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "?")
case "$IN_REC" in
  t) ;;
  f) fail "this host is already a primary (pg_is_in_recovery=false) — nothing to do" ;;
  *) fail "could not query Postgres on $PG_CONTAINER — is it running?" ;;
esac

log "promoting replica → primary (waiting up to 60s)"
docker exec -u postgres "$PG_CONTAINER" \
  psql -U postgres -c "SELECT pg_promote(true, 60);"

# Verify.
sleep 1
IN_REC=$(docker exec "$PG_CONTAINER" psql -U postgres -Atc "SELECT pg_is_in_recovery()")
[ "$IN_REC" = "f" ] || fail "pg_promote returned but pg_is_in_recovery=$IN_REC — investigate before proceeding"

log "promotion confirmed — clearing standby state from the data dir"
docker exec -u postgres "$PG_CONTAINER" bash -c '
  rm -f /var/lib/postgresql/data/standby.signal
  # Strip the managed primary_conninfo line so a restart does not re-enter
  # recovery. The other postgresql.auto.conf lines stay.
  sed -i.bak \
    -e "/# Managed by ops\/backups\/replica\/setup-replica.sh/,/^$/d" \
    /var/lib/postgresql/data/postgresql.auto.conf || true
'

log "OK — this host is now the primary. Next:"
log "  1. cd /var/www/thanos-wallet && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
log "  2. flip DNS for thanos.fi to this host's IP"
log "  3. run the post-restore verification checklist in ops/backups/RUNBOOK.md"
