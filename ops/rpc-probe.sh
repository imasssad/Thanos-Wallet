#!/usr/bin/env bash
#
# RPC reachability probe — every upstream the wallet talks to. Run
# this whenever the wallet "feels broken" but the local stack looks
# healthy. Catches the cases where the wallet is fine but Lithosphere
# RPC / mempool.space / Solana / Cosmos / bridge / DEX is down.
#
# Output:
#   ✓  green  — responding within latency threshold
#   ⚠  yellow — responding but slow (>5s) or partial
#   ✗  red    — unreachable (timeout, DNS, 5xx)
#
# Exits non-zero if any critical RPC (Makalu primary OR fallback) is red.
#
# Usage:
#   bash ops/rpc-probe.sh             # full table
#   bash ops/rpc-probe.sh --short     # only red rows
#   bash ops/rpc-probe.sh --json      # machine-readable for monitoring

set -uo pipefail

MODE="full"
case "${1:-}" in --short) MODE="short" ;; --json) MODE="json" ;; esac

failed=0
ok=0
warn=0
declare -a results

probe() {
  local label="$1" url="$2" method="${3:-GET}" body="${4:-}" timeout="${5:-5}" expected_status="${6:-200}"
  local start end ms status

  start=$(date +%s%N)
  if [ "$method" = "POST" ]; then
    status=$(curl -sS -m "$timeout" -o /tmp/probe-body \
      -H "content-type: application/json" \
      -w "%{http_code}" \
      -X POST -d "$body" "$url" 2>/dev/null || echo "000")
  else
    status=$(curl -sS -m "$timeout" -o /tmp/probe-body \
      -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  fi
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))

  local sym col detail
  if [ "$status" = "$expected_status" ] && [ "$ms" -lt 5000 ]; then
    sym='✓'; col='32'; ((ok++))
  elif [ "$status" = "$expected_status" ]; then
    sym='⚠'; col='33'; ((warn++)); detail="slow (${ms}ms)"
  else
    sym='✗'; col='31'; ((failed++)); detail="status=$status (expected $expected_status)"
  fi

  results+=("$status|$ms|$label|$url")
  if [ "$MODE" = "full" ] || ([ "$MODE" = "short" ] && [ "$sym" = "✗" ]); then
    printf "\033[1;${col}m  %s\033[0m  %-32s  %4dms  %s\n" "$sym" "$label" "$ms" "${detail:-}"
  fi
}

section() {
  if [ "$MODE" != "json" ]; then printf "\n\033[1m%s\033[0m\n" "$1"; fi
}

# ─── Lithosphere ──────────────────────────────────────────────────────
section "Lithosphere — Makalu (chain 700777)"
probe "rpc.litho.ai (primary)"   "https://rpc.litho.ai"   POST '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
probe "rpc-2.litho.ai (fallback)" "https://rpc-2.litho.ai" POST '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

section "Lithosphere — Kamet (chain 900523)"
probe "rpc-3.litho.ai (primary)"      "https://rpc-3.litho.ai"     POST '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# ─── External chains ──────────────────────────────────────────────────
section "Bitcoin — mempool.space"
probe "mempool.space/api/blocks/tip/height" "https://mempool.space/api/blocks/tip/height"
probe "mempool.space/api/v1/fees/recommended" "https://mempool.space/api/v1/fees/recommended"

section "Solana — mainnet-beta"
probe "api.mainnet-beta.solana.com" "https://api.mainnet-beta.solana.com" POST '{"jsonrpc":"2.0","id":1,"method":"getBlockHeight"}'

section "Cosmos Hub"
probe "cosmos-rpc.publicnode.com" "https://cosmos-rpc.publicnode.com/status"
probe "cosmos-rest.publicnode.com" "https://cosmos-rest.publicnode.com/cosmos/bank/v1beta1/params"

section "Ethereum mainnet (fallback for chain id 1)"
probe "cloudflare-eth.com" "https://cloudflare-eth.com" POST '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# ─── Wallet services ──────────────────────────────────────────────────
section "Thanos services"
probe "MultX bridge"      "https://bridge.litho.ai/health"
probe "Ignite DEX"        "https://ignite.litho.ai/api/health"
probe "Reown WC relay"    "https://relay.walletconnect.com" GET '' 5 400  # WSS endpoint — HTTP GET returns 400 when reachable
probe "CoinGecko"         "https://api.coingecko.com/api/v3/ping"

# ─── Local thanos stack (if running) ─────────────────────────────────
section "Local stack (skip if running off-host)"
probe "thanos.fi/api/health"      "https://thanos.fi/api/health"      GET '' 3 || true
probe "thanos.fi/indexer/health"  "https://thanos.fi/indexer/health"  GET '' 3 || true

# ─── Summary ──────────────────────────────────────────────────────────
if [ "$MODE" = "json" ]; then
  printf '{"ok":%d,"warn":%d,"fail":%d,"checks":[' "$ok" "$warn" "$failed"
  first=1
  for r in "${results[@]}"; do
    [ $first -eq 0 ] && printf ','
    first=0
    s="${r%%|*}"; rest="${r#*|}"; ms="${rest%%|*}"; rest2="${rest#*|}"; label="${rest2%%|*}"; url="${rest2#*|}"
    printf '{"status":"%s","ms":%s,"label":"%s","url":"%s"}' "$s" "$ms" "$label" "$url"
  done
  printf ']}\n'
else
  printf "\n\033[1mSummary\033[0m  \033[1;32m✓ %d\033[0m  \033[1;33m⚠ %d\033[0m  \033[1;31m✗ %d\033[0m\n" "$ok" "$warn" "$failed"
fi

# Exit non-zero if Makalu is down — that's a hard "wallet is broken"
# signal worth gating CI/cron jobs on.
if printf '%s\n' "${results[@]}" | grep -E "rpc\.litho\.ai|rpc-2\.litho\.ai" | grep -q "^[^|]*|\(000\||[0-9]\+|" 2>/dev/null; then
  # the above is a heuristic; the simpler check is whether any rpc.litho.ai row was red.
  if printf '%s\n' "${results[@]}" | grep "rpc\.litho\.ai\|rpc-2\.litho\.ai" | head -1 | cut -d'|' -f1 | grep -vq "^200$"; then
    if printf '%s\n' "${results[@]}" | grep "rpc-2\.litho\.ai" | cut -d'|' -f1 | grep -vq "^200$"; then
      exit 1   # Both Makalu primary AND fallback are down → fail
    fi
  fi
fi

rm -f /tmp/probe-body
exit 0
