#!/usr/bin/env bash
#
# One-shot Sentry enablement for the VPS.
#
# Drops SENTRY_DSN (+ optional traces sample rate + debug endpoint) into
# /var/www/thanos-wallet/.env, restarts the three services that init
# Sentry (api/indexer/worker), then guides you through a synthetic-
# exception verification.
#
# Usage:
#   sudo SENTRY_DSN='https://<id>@sentry.io/<project>' \
#        ops/install-sentry.sh
#
# Optional env:
#   SENTRY_TRACES_SAMPLE_RATE  default 0.1
#   SENTRY_ENVIRONMENT         default production
#   SENTRY_DEBUG_ENDPOINT      default 0 (enable once for verification)
#
set -euo pipefail

REPO=/var/www/thanos-wallet
ENV_FILE="$REPO/.env"

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (use sudo)"
[ -n "${SENTRY_DSN:-}" ] || die "set SENTRY_DSN=… before running"
[ -d "$REPO" ] || die "$REPO not found"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found — copy .env.example first"

step "1) Patch $ENV_FILE"
# Idempotent: replace any existing SENTRY_* line, append if missing.
set_var() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    echo "${k}=${v}" >> "$ENV_FILE"
  fi
  ok "${k}=${v}"
}
set_var SENTRY_DSN                  "$SENTRY_DSN"
set_var SENTRY_ENVIRONMENT          "${SENTRY_ENVIRONMENT:-production}"
set_var SENTRY_TRACES_SAMPLE_RATE   "${SENTRY_TRACES_SAMPLE_RATE:-0.1}"
set_var SENTRY_DEBUG_ENDPOINT       "${SENTRY_DEBUG_ENDPOINT:-0}"

step "2) Restart api / indexer / worker"
cd "$REPO"
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d api indexer worker
ok "containers restarted"

step "3) Health check"
sleep 4
for svc in api indexer worker; do
  state=$(docker inspect -f '{{.State.Status}}' "thanos-${svc}" 2>/dev/null || echo missing)
  if [ "$state" = "running" ]; then ok "${svc}: $state"
  else printf '\033[1;31m  ✗ %s: %s\033[0m\n' "$svc" "$state"; fi
done

cat <<'EOF'

To verify Sentry is actually receiving events:
  1. Set SENTRY_DEBUG_ENDPOINT=1, re-run this script
  2. curl -X POST https://thanos.fi/api/debug/sentry-test
  3. Check Sentry — the synthetic exception should appear within ~30s
  4. Set SENTRY_DEBUG_ENDPOINT=0, re-run this script to disable

EOF
