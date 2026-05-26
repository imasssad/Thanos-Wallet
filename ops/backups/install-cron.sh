#!/usr/bin/env bash
#
# One-shot installer for the daily Postgres backup cron + the weekly
# restore-verify cron. Designed to be paste-able into Termius.
#
# What it does (idempotent):
#   1. Verifies the repo checkout is at /var/www/thanos-wallet.
#   2. Writes /root/.thanos-backup.env if it doesn't exist (with safe
#      defaults pointing at the prod container names + paths).
#   3. Creates the backup directories with the right ownership.
#   4. Runs pg-backup.sh once to confirm it actually works.
#   5. Adds the cron lines to root's crontab if they're not already there.
#
# Usage on the VPS:
#   sudo bash /var/www/thanos-wallet/ops/backups/install-cron.sh
#
# To customise:
#   - Edit /root/.thanos-backup.env afterwards (S3_BUCKET, retention,
#     etc.) and the cron picks it up on the next run.
#
set -euo pipefail

REPO=/var/www/thanos-wallet
ENV_FILE=/root/.thanos-backup.env
BACKUP_DIR=/var/backups/thanos-wallet
LOG_DIR=/var/log

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (use sudo)"

step "1) Verify repo checkout"
[ -d "$REPO" ] || die "expected $REPO to exist — clone the repo there first"
[ -x "$REPO/ops/backups/pg-backup.sh" ] || die "pg-backup.sh missing or not executable"
ok "found $REPO and pg-backup.sh"

step "2) Write /root/.thanos-backup.env (if missing)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENV'
PGUSER=thanos
PGDATABASE=thanos_wallet
BACKUP_DIR=/var/backups/thanos-wallet
PG_CONTAINER=thanos-postgres
RETAIN_DAILY=7
RETAIN_WEEKLY=4
RETAIN_MONTHLY=12
# Optional off-site mirror — uncomment + configure AWS CLI to enable:
# S3_BUCKET=s3://thanos-backups/postgres
ENV
  chmod 600 "$ENV_FILE"
  ok "wrote $ENV_FILE"
else
  ok "$ENV_FILE already exists — leaving untouched"
fi

step "3) Create backup directories"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly} "$LOG_DIR"
chmod 700 "$BACKUP_DIR"
ok "directories ready under $BACKUP_DIR"

step "4) Run pg-backup.sh once — proves the chain works"
if "$REPO/ops/backups/pg-backup.sh" >> "$LOG_DIR/thanos-pg-backup.log" 2>&1; then
  recent=$(ls -1t "$BACKUP_DIR/daily" | head -1 || true)
  [ -n "$recent" ] && ok "first backup taken: $recent"
else
  warn "pg-backup.sh exited non-zero — see $LOG_DIR/thanos-pg-backup.log"
  warn "common cause: Postgres container '$PG_CONTAINER' (in $ENV_FILE) not running"
  die "fix the failure above before installing the cron"
fi

step "5) Install cron entries (root crontab)"
CRON_DAILY="0 4 * * * $REPO/ops/backups/pg-backup.sh >> $LOG_DIR/thanos-pg-backup.log 2>&1"
CRON_VERIFY="0 5 * * 0 $REPO/ops/backups/restore-verify.sh >> $LOG_DIR/thanos-restore-verify.log 2>&1"

# Pull existing crontab (or empty), append missing lines, install in one call.
existing=$(crontab -l 2>/dev/null || true)
new="$existing"
for line in "$CRON_DAILY" "$CRON_VERIFY"; do
  if ! grep -Fxq "$line" <<<"$existing"; then
    new="${new}
${line}"
    ok "adding: $line"
  else
    ok "already present: $line"
  fi
done
printf '%s\n' "$new" | crontab -

step "Verify"
crontab -l | grep -E 'pg-backup|restore-verify' && ok "cron entries registered"

cat <<EOF

Daily Postgres backup is now active.
  - Backup file:    $BACKUP_DIR/daily/*.sql.gz
  - Log:            $LOG_DIR/thanos-pg-backup.log
  - Restore-verify: weekly on Sunday 05:00 UTC → $LOG_DIR/thanos-restore-verify.log
  - Config:         $ENV_FILE

To enable S3 off-site backups, uncomment S3_BUCKET in $ENV_FILE and
configure ~/.aws/credentials (aws configure).

EOF
