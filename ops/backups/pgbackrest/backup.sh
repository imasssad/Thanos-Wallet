#!/usr/bin/env bash
#
# Thanos Wallet — pgBackRest backup driver.
#
# Drives pgBackRest from the host crontab via `docker exec`. Runs an
# incremental nightly + full weekly + WAL is shipped continuously by
# Postgres's archive_command (no manual step here for WAL).
#
# Suggested cron on the VPS:
#   # Incremental every day at 03:30 UTC
#   30 3 * * * /var/www/thanos-wallet/ops/backups/pgbackrest/backup.sh incr >> /var/log/thanos-pgbackrest.log 2>&1
#   # Full every Sunday at 03:00 UTC (replaces the day's incremental)
#   0  3 * * 0 /var/www/thanos-wallet/ops/backups/pgbackrest/backup.sh full >> /var/log/thanos-pgbackrest.log 2>&1
#
# Optional off-site mirror (env-driven, set in /root/.thanos-backup.env):
#   PGBACKREST_S3_BUCKET=s3://thanos-pgbackrest
# If set, the script rsyncs the repo to S3 after each backup.
#
# Env override:
#   PG_CONTAINER  — container name, default thanos-postgres

set -euo pipefail

[ -f /root/.thanos-backup.env ] && source /root/.thanos-backup.env

: "${PG_CONTAINER:=thanos-postgres}"
: "${PGBACKREST_REPO_HOST_PATH:=/var/backups/thanos-pgbackrest}"

TYPE="${1:-incr}"
case "$TYPE" in
  full|diff|incr) ;;
  *) echo "Usage: $0 [full|diff|incr]" >&2; exit 2 ;;
esac

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "starting pgBackRest --type=$TYPE backup against $PG_CONTAINER"

docker exec -u postgres "$PG_CONTAINER" \
  pgbackrest --stanza=thanos --type="$TYPE" --log-level-console=info backup

# Report stanza info — running this after every backup makes the cron log
# self-diagnostic; you can `grep info` to see backup history at a glance.
docker exec -u postgres "$PG_CONTAINER" \
  pgbackrest --stanza=thanos info

# Off-site mirror.
if [ -n "${PGBACKREST_S3_BUCKET:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    log "WARN: PGBACKREST_S3_BUCKET set but aws CLI not installed"
  else
    log "syncing repo to $PGBACKREST_S3_BUCKET"
    aws s3 sync "$PGBACKREST_REPO_HOST_PATH" "$PGBACKREST_S3_BUCKET" \
      --delete \
      --only-show-errors
  fi
fi

log "OK"
