#!/usr/bin/env bash
#
# link-probe-alert.sh — cron-ready wrapper around link-probe.sh.
#
# Runs the full link-probe sweep. If any CRITICAL endpoint is red,
# posts a single Slack message and exits non-zero. Otherwise exits 0
# silently. Designed to drop straight into a 5-minute cron.
#
# Configuration:
#   SLACK_WEBHOOK_URL    — incoming-webhook URL. Required.
#                          Either set as an env var in the cron line,
#                          OR drop the URL into /etc/thanos/slack-webhook
#                          (chmod 600, root-readable only) and this
#                          script will read it from there.
#
# Usage:
#   bash ops/link-probe-alert.sh
#
# Cron example (paste into `crontab -e`):
#   */5 * * * * cd /var/www/thanos-wallet && bash ops/link-probe-alert.sh >> /var/log/link-probe.log 2>&1
#
# Exit codes (matches link-probe.sh + Slack-post outcome):
#   0 — all clean, no alert sent
#   1 — CRITICAL down; alert sent (or skipped because URL not set)
#   2 — non-critical reds; no alert
#   3 — link-probe missing / unreadable

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_SCRIPT="${REPO_DIR}/ops/link-probe.sh"
SECRET_FILE="${LINK_PROBE_SECRET_FILE:-/etc/thanos/slack-webhook}"
ALERT_HOST="$(hostname -s 2>/dev/null || echo unknown)"
OUT_FILE="$(mktemp -t link-probe.XXXXXX)"
trap 'rm -f "$OUT_FILE"' EXIT

if [ ! -x "$PROBE_SCRIPT" ] && [ ! -r "$PROBE_SCRIPT" ]; then
  echo "link-probe-alert: ${PROBE_SCRIPT} not found or unreadable" >&2
  exit 3
fi

# Resolve the Slack webhook. Prefer env var; fall back to the secret
# file so the cron line stays free of secret material.
if [ -z "${SLACK_WEBHOOK_URL:-}" ] && [ -r "$SECRET_FILE" ]; then
  SLACK_WEBHOOK_URL="$(< "$SECRET_FILE" tr -d '[:space:]')"
fi

# Run the probe. Capture its output AND exit code; --short keeps the
# Slack payload small (only failures + summary).
bash "$PROBE_SCRIPT" --short > "$OUT_FILE" 2>&1
probe_exit=$?

# Probe exit conventions (set in link-probe.sh):
#   0 — clean
#   1 — CRITICAL endpoint down
#   2 — non-critical reds
case "$probe_exit" in
  0) exit 0 ;;
  2) exit 2 ;;  # non-critical, no alert
  1) : ;;       # CRITICAL — fall through to Slack
  *) echo "link-probe-alert: unexpected probe exit ${probe_exit}" >&2; exit 3 ;;
esac

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "link-probe-alert: CRITICAL endpoint down but no SLACK_WEBHOOK_URL configured" >&2
  cat "$OUT_FILE" >&2
  exit 1
fi

# Build the Slack message. Heredoc keeps the JSON readable; jq-style
# escaping for the probe output preserves backticks + quotes inside
# the code-fenced block.
escaped="$(sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/$/\\n/' "$OUT_FILE" | tr -d '\n')"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# POST to Slack with a heredoc body — readable, no nested-quote pain.
http_code=$(curl -fsS -o /dev/null -w "%{http_code}" \
  -X POST -H "Content-Type: application/json" \
  --data @- "$SLACK_WEBHOOK_URL" <<EOF
{
  "text": "🚨 Thanos link-probe CRITICAL on ${ALERT_HOST}",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*🚨 Thanos link-probe CRITICAL*\n*Host:* \`${ALERT_HOST}\`\n*When:* ${timestamp}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "\`\`\`${escaped}\`\`\`"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Source: \`ops/link-probe-alert.sh\` · auto-paged on critical endpoint down · run \`bash ops/link-probe.sh\` on the host to drill in." }
      ]
    }
  ]
}
EOF
)

if [ "$http_code" != "200" ]; then
  echo "link-probe-alert: Slack POST returned ${http_code}" >&2
  cat "$OUT_FILE" >&2
  exit 1
fi

echo "link-probe-alert: CRITICAL alert posted to Slack at ${timestamp}"
exit 1
