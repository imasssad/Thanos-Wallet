#!/usr/bin/env bash
#
# Thanos Wallet — backup restore verification.
#
# Spins up a throwaway Postgres container, pipes the most recent daily
# dump into it, runs sanity SELECTs, then tears the container down. The
# point is to detect a broken dump *before* you need it for real.
#
# Exit 0 = backup verified. Anything else = the backup chain is broken
# (see /var/log/thanos-restore-verify.log for the failure reason).
#
# Suggested cron (Sundays 05:00 UTC, after nightly rotation has settled):
#   0 5 * * 0 /var/www/thanos-wallet/ops/backups/restore-verify.sh >> /var/log/thanos-restore-verify.log 2>&1
#
# Optional env:
#   BACKUP_DIR        — where dumps live (default /var/backups/thanos-wallet)
#   PG_IMAGE          — Postgres image to spin up (default postgres:16-alpine)
#   VERIFY_CONTAINER  — throwaway container name (default thanos-restore-verify)
#   VERIFY_TABLES     — comma-separated list to row-count check
#                       (default users,accounts,transactions,tokens)

set -euo pipefail

: "${BACKUP_DIR:=/var/backups/thanos-wallet}"
: "${PG_IMAGE:=postgres:16-alpine}"
: "${VERIFY_CONTAINER:=thanos-restore-verify}"
: "${VERIFY_TABLES:=users,accounts,transactions,tokens}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { log "FAIL: $*" >&2; cleanup; exit 1; }

cleanup() {
  docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

LATEST=$(ls -1t "$BACKUP_DIR/daily/"*.sql.gz 2>/dev/null | head -1 || true)
[ -n "$LATEST" ] || fail "no dumps found in $BACKUP_DIR/daily"

# A dump that didn't even reach the rotation threshold is almost certainly
# a half-finished run from a previous failure. Bail loudly.
SIZE=$(stat -c '%s' "$LATEST")
[ "$SIZE" -ge 1024 ] || fail "$LATEST is suspiciously small ($SIZE bytes)"

# Refuse to verify a dump older than 36h — backups are stale and oncall
# would be debugging the *cron* anyway, not this script.
AGE_HOURS=$(( ( $(date +%s) - $(stat -c '%Y' "$LATEST") ) / 3600 ))
[ "$AGE_HOURS" -le 36 ] || fail "$LATEST is $AGE_HOURS h old — backup cron may be broken"

log "verifying $LATEST (size $(numfmt --to=iec --suffix=B "$SIZE"), age ${AGE_HOURS}h)"

# Boot a throwaway Postgres, wait for it to accept connections.
cleanup
docker run -d --rm \
  --name "$VERIFY_CONTAINER" \
  -e POSTGRES_USER=thanos \
  -e POSTGRES_PASSWORD=verify-only \
  -e POSTGRES_DB=thanos_wallet \
  "$PG_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$VERIFY_CONTAINER" pg_isready -U thanos -d thanos_wallet -q; then break; fi
  sleep 1
done
docker exec "$VERIFY_CONTAINER" pg_isready -U thanos -d thanos_wallet -q \
  || fail "throwaway Postgres did not come up in 30s"

# Pipe the dump in. The dump was taken with --clean --if-exists so it
# drops tables before recreating; on a fresh DB the DROPs are no-ops.
if ! gunzip -c "$LATEST" | docker exec -i "$VERIFY_CONTAINER" \
      psql -v ON_ERROR_STOP=1 -U thanos -d thanos_wallet >/dev/null; then
  fail "psql exited non-zero — restore did not complete cleanly"
fi

# Sanity SELECTs — every named table must exist and be queryable.
# We don't require any to be non-empty (a brand-new install legitimately
# has zero rows in some), but every named table must at least exist.
IFS=',' read -r -a TABLES <<< "$VERIFY_TABLES"
for t in "${TABLES[@]}"; do
  if ! docker exec "$VERIFY_CONTAINER" psql -v ON_ERROR_STOP=1 -U thanos \
        -d thanos_wallet -c "SELECT COUNT(*) FROM \"$t\";" >/dev/null 2>&1; then
    fail "table '$t' missing or unqueryable after restore"
  fi
done

# Bonus: count the user-defined tables so a half-restored dump (e.g. dump
# truncated mid-stream so only the first few tables exist) shows up.
TABLE_COUNT=$(docker exec "$VERIFY_CONTAINER" psql -U thanos -d thanos_wallet -At -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
[ "$TABLE_COUNT" -ge "${#TABLES[@]}" ] \
  || fail "only $TABLE_COUNT tables restored, expected at least ${#TABLES[@]}"

log "OK — $TABLE_COUNT tables restored, all sanity SELECTs passed"
