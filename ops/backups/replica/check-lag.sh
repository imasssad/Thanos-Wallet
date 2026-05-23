#!/usr/bin/env bash
#
# Postgres replication lag monitor.
#
# Run on the PRIMARY VPS via cron. Emits a single status line to stdout
# every invocation; exits non-zero if lag exceeds the threshold so the
# cron mail / log scraper can alert.
#
# Suggested cron:
#   */5 * * * * /var/www/thanos-wallet/ops/backups/replica/check-lag.sh \
#     >> /var/log/thanos-repl-lag.log 2>&1
#
# Env override:
#   PG_CONTAINER   — default thanos-postgres
#   LAG_MAX_BYTES  — alert threshold in bytes, default 16 MiB
#                    (steady-state lag should be in KB)
#   LAG_MAX_SEC    — secondary threshold in seconds, default 30
#                    (catches a stalled replica even if WAL position
#                    keeps ticking on the primary)

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-thanos-postgres}"
LAG_MAX_BYTES="${LAG_MAX_BYTES:-16777216}"   # 16 MiB
LAG_MAX_SEC="${LAG_MAX_SEC:-30}"

log()  { echo "[lag-check $(date -u +%FT%TZ)] $*"; }
fail() { log "ALERT: $*" >&2; exit 1; }

ROW=$(docker exec -u postgres "$PG_CONTAINER" psql -U postgres -d thanos_wallet -At -F '|' -c "
  SELECT
    coalesce(application_name, '?'),
    coalesce(state, '?'),
    coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::text, '?'),
    coalesce(extract(epoch from (now() - reply_time))::int::text, '?')
  FROM pg_stat_replication
  LIMIT 1;
" 2>/dev/null) || fail "could not query pg_stat_replication on $PG_CONTAINER"

if [ -z "$ROW" ]; then
  fail "NO REPLICA CONNECTED — pg_stat_replication is empty"
fi

IFS='|' read -r APP STATE LAG_BYTES LAG_SEC <<< "$ROW"
log "replica=$APP state=$STATE lag_bytes=$LAG_BYTES lag_sec=$LAG_SEC"

if [ "$STATE" != "streaming" ]; then
  fail "replica state is '$STATE', expected 'streaming'"
fi

# Numeric comparisons — guard against the '?' fallback.
case "$LAG_BYTES" in (*[!0-9]*) fail "lag_bytes is non-numeric: $LAG_BYTES" ;; esac
case "$LAG_SEC"   in (*[!0-9]*) fail "lag_sec is non-numeric: $LAG_SEC"   ;; esac

if [ "$LAG_BYTES" -gt "$LAG_MAX_BYTES" ]; then
  fail "lag_bytes=$LAG_BYTES exceeds threshold $LAG_MAX_BYTES"
fi
if [ "$LAG_SEC" -gt "$LAG_MAX_SEC" ]; then
  fail "lag_sec=$LAG_SEC exceeds threshold $LAG_MAX_SEC"
fi

log "OK"
