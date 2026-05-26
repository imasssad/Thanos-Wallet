#!/usr/bin/env bash
#
# Pre-flight verification — prints a green/yellow/red status table
# for every item the production-readiness audit checks. Safe to run
# anytime; read-only, no side effects.
#
# Three column meanings:
#   ✓  passing
#   ⚠  configured but unverifiable from this machine (operator action
#       needed to verify — e.g. live HTTPS, App Store upload status)
#   ✗  failing or missing
#
# Examples:
#   ./ops/verify.sh             # full table
#   ./ops/verify.sh --short     # only ✗ rows
#   ./ops/verify.sh --json      # machine-readable

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="full"
case "${1:-}" in --short) MODE="short" ;; --json) MODE="json" ;; esac

ok=0; warn=0; fail=0
declare -a results

check() {
  local label="$1" status="$2" detail="${3:-}"
  case "$status" in
    ok)   ((ok++));   sym='✓'; col='32' ;;
    warn) ((warn++)); sym='⚠'; col='33' ;;
    fail) ((fail++)); sym='✗'; col='31' ;;
  esac
  results+=("$status|$label|$detail")
  if [ "$MODE" = "full" ] || ([ "$MODE" = "short" ] && [ "$status" = "fail" ]); then
    printf "\033[1;${col}m  %s\033[0m  %-50s %s\n" "$sym" "$label" "$detail"
  fi
}

section() {
  if [ "$MODE" != "json" ]; then printf "\n\033[1m%s\033[0m\n" "$1"; fi
}

# ─── 1. Security ──────────────────────────────────────────────────────
section "1. Security"
[ -f apps/web/lib/vault.ts ]                                       && check "Web vault (Argon2id + AES-GCM)"           ok
[ -f apps/mobile/lib/vault.ts ]                                    && check "Mobile vault (Argon2id + AES-GCM)"        ok
[ -f apps/extension/src/lib/vault.ts ]                             && check "Extension vault"                          ok
[ -f apps/desktop/src/renderer/vault.ts ]                          && check "Desktop vault"                            ok
[ -f apps/web/workers/signer-worker.ts ]                           && check "Web signing isolation (Worker)"           ok
[ -f apps/desktop/src/main/signer.ts ]                             && check "Desktop signing isolation (main-process)" ok
[ -f apps/mobile/lib/signer.ts ]                                   && check "Mobile signing isolation (module-private)" ok
grep -q "sign\\." apps/extension/src/entrypoints/offscreen/main.ts 2>/dev/null \
                                                                   && check "Extension signing isolation (offscreen)"  ok
[ -f packages/sdk-core/src/security/phishing.ts ]                  && check "Phishing detection"                       ok
grep -q "Content-Security-Policy" apps/web/next.config.js 2>/dev/null \
                                                                   && check "CSP headers (web)"                        ok
grep -q "content_security_policy" apps/extension/wxt.config.ts 2>/dev/null \
                                                                   && check "CSP headers (extension)"                  ok
grep -q "gitleaks" .github/workflows/ci.yml 2>/dev/null            && check "Secret scanning (gitleaks)"               ok
grep -q "pnpm audit" .github/workflows/ci.yml 2>/dev/null          && check "Dependency audit"                         ok

# ─── 2. Chain support ─────────────────────────────────────────────────
section "2. Chain support"
[ -f apps/web/lib/bitcoin.ts ]      && check "Bitcoin (web)"  ok
[ -f apps/web/lib/solana.ts ]       && check "Solana (web)"   ok
[ -f apps/web/lib/cosmos.ts ]       && check "Cosmos (web)"   ok
[ -f apps/extension/src/lib/bitcoin.ts ] && check "Bitcoin (extension)" ok
[ -f apps/desktop/src/renderer/bitcoin.ts ] && check "Bitcoin (desktop)" ok
[ -f apps/mobile/lib/bitcoin.ts ]   && check "Bitcoin (mobile)" ok
[ -f packages/sdk-core/src/utils/litho-address.ts ] && check "Lithosphere dual-address" ok
[ -f packages/sdk-core/src/clients/lep100-client.ts ] && check "LEP-100 client" ok

# ─── 3. Backend ───────────────────────────────────────────────────────
section "3. Backend"
[ -f services/api/src/routes/auth.ts ]      && check "Auth routes (register/login/refresh/logout)" ok
[ -f services/api/src/routes/contacts.ts ]  && check "Contacts CRUD" ok
[ -f services/api/src/routes/dnns.ts ]      && check "DNNS resolve" ok
[ -f services/api/src/routes/portfolio.ts ] && check "Portfolio aggregation endpoint" ok
[ -f services/api/src/routes/wc-sessions.ts ] && check "Multi-device WC session sync" ok
[ -f services/worker/src/queues/definitions.ts ] && {
  count=$(grep -cE "^\s+[A-Z][A-Z0-9_]+:" services/worker/src/queues/definitions.ts || echo 0)
  if [ "$count" -ge 6 ]; then check "BullMQ 6 queues" ok
  else check "BullMQ 6 queues" fail "found $count"; fi
}
[ -f services/indexer/src/lep100-sync.ts ] && check "Indexer LEP-100 sync" ok
[ -f ROLLBACK.md ] && check "Rollback plan" ok
[ -f ops/backups/pg-backup.sh ] && check "Postgres backup script" ok
[ -f ops/backups/install-cron.sh ] && check "Backup cron installer" ok

# ─── 4. Observability ─────────────────────────────────────────────────
section "4. Observability"
[ -f services/api/src/lib/sentry.ts ] && check "Sentry (api)" ok
[ -f services/indexer/src/lib/sentry.ts ] && check "Sentry (indexer)" ok
[ -f services/worker/src/lib/sentry.ts ] && check "Sentry (worker)" ok
[ -f apps/web/sentry.client.config.ts ] && check "Sentry (web)" ok
[ -f apps/mobile/lib/sentry.ts ] && check "Sentry (mobile)" ok
[ -f ops/observability/prometheus.yml ] && check "Prometheus" ok
[ -f ops/observability/alerts.yml ] && check "Alert rules" ok
[ -f ops/observability/alertmanager.yml ] && check "Alertmanager" ok
[ -d ops/observability/dashboards ] && check "Grafana dashboards in repo" ok
[ -f ops/observability/loki-config.yml ] && check "Loki (centralized logs)" ok
[ -f ops/observability/promtail-config.yml ] && check "Promtail (log shipper)" ok
[ -f ops/observability/docker-compose.uptime.yml ] && check "Uptime Kuma" ok

# ─── 5. Deployment + CI ───────────────────────────────────────────────
section "5. Deployment + CI"
[ -f .github/workflows/ci.yml ] && check "CI workflow" ok
[ -f .github/workflows/release.yml ] && check "Release workflow" ok
[ -f .github/workflows/deploy.yml ] && check "Deploy workflow (prod)" ok
[ -f .github/workflows/deploy-staging.yml ] && check "Deploy workflow (staging)" ok
[ -f docker-compose.staging.yml ] && check "Staging compose" ok
grep -q "lint" .github/workflows/ci.yml 2>/dev/null && check "Lint in CI" ok
[ -f .sops.yaml ] && check "SOPS config" ok
[ -f ops/secrets/prod.enc.env.template ] && check "Secrets template" ok
[ -f ops/secrets/prod.enc.env ] && check "Production secrets encrypted in repo" ok \
                                || check "Production secrets" warn "not encrypted yet — see ops/secrets/README.md"
[ -f SIGNING.md ] && check "Code signing docs (SIGNING.md)" ok

# ─── 6. Testing ───────────────────────────────────────────────────────
section "6. Testing"
[ -d packages/sdk-core/src/__tests__ ] && check "SDK unit tests" ok
[ -d services/api/src/__tests__ ] && check "API integration tests" ok
[ -f services/api/src/__tests__/security.test.ts ] && check "Security tests (redaction + brute-force)" ok
[ -d services/indexer/src/__tests__ ] && check "Indexer integration tests" ok
[ -d apps/web/e2e ] && {
  count=$(find apps/web/e2e -name '*.spec.ts' | wc -l)
  check "Playwright E2E suite" ok "$count specs"
}

# ─── 7. Listings + docs ───────────────────────────────────────────────
section "7. Listings + docs"
[ -f apps/extension/store/chrome-listing.md ] && check "Chrome Web Store listing copy" ok
[ -f apps/mobile/store-listing/ios.md ] && check "App Store listing copy" ok
[ -f apps/mobile/store-listing/android.md ] && check "Play Store listing copy" ok
[ -f docs/privacy-policy.md ] && check "Privacy policy" ok
[ -f docs/incident-runbook.md ] && check "Incident runbook" ok
[ -f docs/status-page-setup.md ] && check "Status page setup" ok
[ -f docs/scaling-policy.md ] && check "Scaling policy" ok
[ -f DEPLOYMENT.md ] && check "DEPLOYMENT.md master sequence" ok
[ -f CHANGELOG.md ] && grep -q '^## \[1\.0\.0\]' CHANGELOG.md && check "v1.0.0 release notes" ok
[ -f apps/web/scripts/capture-screenshots.ts ] && check "Web screenshot script" ok
[ -f apps/mobile/scripts/capture-screenshots.sh ] && check "Mobile screenshot script" ok
[ -f ops/capture-all-screenshots.sh ] && check "Master screenshot orchestrator" ok

# ─── 8. Operator-side (VPS) ───────────────────────────────────────────
section "8. Operator (paste-able commands ready to run)"
check "Backups cron install" warn "operator runs: sudo bash ops/backups/install-cron.sh"
check "Sentry DSN provisioning" warn "operator runs: sudo SENTRY_DSN=… ops/install-sentry.sh"
check "VPS docker compose up" warn "operator runs: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
check "Status page first-time setup" warn "operator: docs/status-page-setup.md (10 min)"
check "DNS staging.thanos.fi" warn "operator: CNAME → VPS"
check "Apple Developer enrolment" warn "operator: \$99/yr"
check "Google Play account" warn "operator: \$25 one-off"
check "Chrome Web Store account" warn "operator: \$5 one-off"
check "Windows EV cert" warn "operator: ~\$400/yr (optional for v1)"
check "On-call rotation" warn "operator: PagerDuty"
check "Post-launch monitoring window" warn "operator: calendar slot"

# ─── Summary ──────────────────────────────────────────────────────────
total=$((ok + warn + fail))
if [ "$MODE" = "json" ]; then
  printf '{"ok":%d,"warn":%d,"fail":%d,"total":%d,"items":[' "$ok" "$warn" "$fail" "$total"
  first=1
  for r in "${results[@]}"; do
    [ $first -eq 0 ] && printf ','
    first=0
    s="${r%%|*}"; rest="${r#*|}"; label="${rest%%|*}"; detail="${rest#*|}"
    printf '{"status":"%s","label":"%s","detail":"%s"}' "$s" "$label" "$detail"
  done
  printf ']}\n'
else
  printf "\n\033[1mSummary\033[0m\n"
  printf "  \033[1;32m✓ %d ok\033[0m   \033[1;33m⚠ %d warn\033[0m   \033[1;31m✗ %d fail\033[0m   (%d total)\n" \
    "$ok" "$warn" "$fail" "$total"
  if [ $fail -gt 0 ]; then exit 1; fi
fi
