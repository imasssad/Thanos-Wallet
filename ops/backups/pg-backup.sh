#!/usr/bin/env bash
#
# Thanos Wallet — Postgres backup script.
#
# Runs pg_dump inside the Postgres container (via docker exec), gzips,
# rotates daily/weekly/monthly, and optionally pushes the latest dump
# off-site. The DB has no host port — it's Docker-network-only — so the
# dump runs from within the container.
#
# Wiring (cron, on the VPS):
#   crontab -e
#   0 4 * * * /var/www/thanos-wallet/ops/backups/pg-backup.sh >> /var/log/thanos-pg-backup.log 2>&1
#
# Required env (set in /etc/default/thanos-pg-backup or /root/.thanos-backup.env):
#   PGUSER       — typically 'thanos'
#   PGDATABASE   — 'thanos_wallet'
#   BACKUP_DIR   — '/var/backups/thanos-wallet'
# Optional:
#   PG_CONTAINER — Postgres container name (default 'thanos-postgres')
# Optional:
#   S3_BUCKET    — 's3://bucket/path' for off-site upload via aws cli
#   RETAIN_DAILY   — default 7
#   RETAIN_WEEKLY  — default 4
#   RETAIN_MONTHLY — default 12

set -euo pipefail

# Load env (optional — overrides shell env)
[ -f /root/.thanos-backup.env ] && source /root/.thanos-backup.env
[ -f /etc/default/thanos-pg-backup ] && source /etc/default/thanos-pg-backup

: "${PGUSER:?PGUSER must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"
: "${PG_CONTAINER:=thanos-postgres}"
: "${BACKUP_DIR:=/var/backups/thanos-wallet}"
: "${RETAIN_DAILY:=7}"
: "${RETAIN_WEEKLY:=4}"
: "${RETAIN_MONTHLY:=12}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
DOW=$(date -u +%u)   # 1..7 (Mon..Sun)
DOM=$(date -u +%d)   # 01..31

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"

OUT="$BACKUP_DIR/daily/thanos-wallet-${TS}.sql.gz"

echo "[$(date -u +%FT%TZ)] starting backup → $OUT"

# pg_dump with custom format would be more flexible, but plain SQL is more
# portable across Postgres versions and easier to inspect. The dump runs
# inside the container — local socket auth, so no password is needed.
docker exec "$PG_CONTAINER" pg_dump \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip -9 > "$OUT"

# Verify the gzip and that the dump isn't empty.
gzip -t "$OUT"
SIZE=$(stat -c '%s' "$OUT")
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: backup file is suspiciously small ($SIZE bytes)" >&2
  exit 1
fi

# Promote to weekly on Mondays, monthly on the 1st of the month.
if [ "$DOW" = "1" ]; then
  cp "$OUT" "$BACKUP_DIR/weekly/thanos-wallet-${TS}.sql.gz"
fi
if [ "$DOM" = "01" ]; then
  cp "$OUT" "$BACKUP_DIR/monthly/thanos-wallet-${TS}.sql.gz"
fi

# Rotation — keep only N newest in each bucket.
find "$BACKUP_DIR/daily"   -name "*.sql.gz" -type f -mtime "+$RETAIN_DAILY"   -delete
find "$BACKUP_DIR/weekly"  -name "*.sql.gz" -type f -mtime "+$((RETAIN_WEEKLY * 7))" -delete
find "$BACKUP_DIR/monthly" -name "*.sql.gz" -type f -mtime "+$((RETAIN_MONTHLY * 31))" -delete

# Off-site copy (optional).
if [ -n "${S3_BUCKET:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$OUT" "$S3_BUCKET/$(basename "$OUT")"
  else
    echo "WARN: S3_BUCKET set but aws CLI not installed" >&2
  fi
fi

echo "[$(date -u +%FT%TZ)] backup OK ($(numfmt --to=iec --suffix=B "$SIZE"))"
