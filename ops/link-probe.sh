#!/usr/bin/env bash
#
# Link probe — every URL the wallet depends on, plus the production
# deployment. Run this on the VPS, in CI, or locally to spot breakage
# before users do.
#
# Output:
#   ✓ green  — responding within latency threshold + expected status
#   ⚠ yellow — responding but with unexpected status, or slow (>5s)
#   ✗ red    — unreachable (timeout, DNS, TLS failure, 5xx)
#
# Exits:
#   0 — all green (and CRITICAL endpoints up)
#   1 — at least one critical endpoint is red (any RPC primary AND its
#       fallback both down, or thanos.fi/api/health unreachable)
#   2 — non-critical red items found, but critical paths are healthy
#
# Usage:
#   bash ops/link-probe.sh                # full table
#   bash ops/link-probe.sh --short        # only red rows
#   bash ops/link-probe.sh --json         # machine-readable for monitoring
#   bash ops/link-probe.sh --category prod   # filter to one category
#
# Categories: prod, litho, rpc, svc, cdn, doc

set -uo pipefail

MODE="full"
CAT_FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --short)    MODE="short"; shift ;;
    --json)     MODE="json";  shift ;;
    --category) CAT_FILTER="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -uo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

failed=0
warn=0
ok=0
critical_down=0
declare -a results

# probe <category> <label> <url> [method] [body] [timeout] [expected_status] [critical]
probe() {
  local cat="$1" label="$2" url="$3"
  local method="${4:-GET}" body="${5:-}" timeout="${6:-8}"
  local expected="${7:-200}" critical="${8:-0}"

  if [ -n "$CAT_FILTER" ] && [ "$cat" != "$CAT_FILTER" ]; then return 0; fi

  local start end ms status sym col detail
  start=$(date +%s%N)
  # Pose as a current Chrome — Cloudflare and other WAF layers
  # routinely 403 a bare "curl/8.x" user-agent, which made our probe
  # report false-negative breakage on every CF-fronted site
  # (lithosphere.network, etc.) from datacenter IPs. Real users
  # never hit those URLs as curl, so the probe should match.
  local UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  if [ "$method" = "POST" ]; then
    status=$(curl -sS -m "$timeout" -o /dev/null \
      -A "$UA" \
      -H "content-type: application/json" \
      -w "%{http_code}" \
      -X POST -d "$body" "$url" 2>/dev/null || echo "000")
  else
    status=$(curl -sS -m "$timeout" -o /dev/null \
      -A "$UA" \
      -H "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  fi
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))

  if [ "$status" = "$expected" ] && [ "$ms" -lt 5000 ]; then
    sym='✓'; col='32'; ok=$((ok+1))
  elif [ "$status" = "$expected" ]; then
    sym='⚠'; col='33'; warn=$((warn+1)); detail="slow (${ms}ms)"
  else
    sym='✗'; col='31'; failed=$((failed+1))
    detail="status=$status (expected $expected)"
    [ "$critical" = "1" ] && critical_down=$((critical_down+1))
  fi

  results+=("$status|$ms|$cat|$label|$url|$critical")

  if [ "$MODE" = "full" ] || ([ "$MODE" = "short" ] && [ "$sym" = "✗" ]); then
    printf "\033[1;${col}m  %s\033[0m  %-8s  %-32s  %4dms  %s\n" \
      "$sym" "$cat" "$label" "$ms" "${detail:-}"
  fi
}

section() {
  if [ "$MODE" != "json" ] && [ -z "$CAT_FILTER" ]; then
    printf "\n\033[1m%s\033[0m\n" "$1"
  fi
}

RPC_BODY='{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
SOL_BODY='{"jsonrpc":"2.0","id":1,"method":"getBlockHeight"}'

# ─── Production thanos.fi endpoints ──────────────────────────────────
section "Production — thanos.fi"
probe prod "homepage"           "https://thanos.fi/"                              GET  ""  5 200 1
probe prod "privacy page"       "https://thanos.fi/privacy"                       GET  ""  5 200 0
probe prod "/app (wallet)"      "https://thanos.fi/app"                           GET  ""  5 200 1
probe prod "api /health"        "https://thanos.fi/api/health"                    GET  ""  5 200 1
probe prod "indexer /health"    "https://thanos.fi/indexer/health"                GET  ""  5 200 0
probe prod "security.txt"       "https://thanos.fi/.well-known/security.txt"      GET  ""  5 200 0
probe prod "icon: sol"          "https://thanos.fi/images/tokens/sol.png"         GET  ""  5 200 0
probe prod "icon: agii (dapp)"  "https://thanos.fi/images/dapps/agii.png"         GET  ""  5 200 0
probe prod "icon: furgpt"       "https://thanos.fi/images/tokens/furgpt.png"      GET  ""  5 200 0

# ─── Lithosphere — primary + fallback RPCs (critical pairs) ──────────
section "Lithosphere — Makalu (chain 700777)"
probe litho "makalu primary"   "https://rpc.litho.ai"   POST "$RPC_BODY" 8 200 1
probe litho "makalu fallback"  "https://rpc-2.litho.ai" POST "$RPC_BODY" 8 200 1

section "Lithosphere — Kamet (chain 900523)"
probe litho "kamet primary"    "https://rpc.kamet.litho.ai" POST "$RPC_BODY" 8 200 1
probe litho "kamet fallback"   "https://rpc-3.litho.ai"     POST "$RPC_BODY" 8 200 1

# ─── Lithosphere services ────────────────────────────────────────────
section "Lithosphere services"
probe litho "bridge.litho.ai" "https://bridge.litho.ai/health"                    GET  "" 8 501 0
probe litho "ignite.litho.ai (SPA)" "https://ignite.litho.ai/"                    GET  "" 8 200 0
probe litho "ecosystem.litho.ai" "https://ecosystem.litho.ai/"                    GET  "" 8 200 0
probe litho "lithosphere.network" "https://lithosphere.network/"                  GET  "" 8 200 0

# ─── External chain RPCs ─────────────────────────────────────────────
section "External chain RPCs"
probe rpc "bitcoin mempool"        "https://mempool.space/api/blocks/tip/height"  GET  "" 5 200 1
probe rpc "bitcoin fees"           "https://mempool.space/api/v1/fees/recommended" GET "" 5 200 0
probe rpc "solana mainnet-beta"    "https://api.mainnet-beta.solana.com"          POST "$SOL_BODY" 8 200 1
probe rpc "cosmos rest"            "https://cosmos-rest.publicnode.com/cosmos/bank/v1beta1/params" GET "" 8 200 0
probe rpc "ethereum publicnode"    "https://ethereum.publicnode.com"              POST "$RPC_BODY" 8 200 1
probe rpc "ethereum merkle (fb)"   "https://eth.merkle.io"                        POST "$RPC_BODY" 8 200 0
probe rpc "bsc dataseed"           "https://bsc-dataseed.binance.org"             POST "$RPC_BODY" 8 200 0

# ─── Third-party services ────────────────────────────────────────────
section "Third-party services"
probe svc "coingecko ping" "https://api.coingecko.com/api/v3/ping" GET "" 5 200 0
probe svc "wc relay"       "https://relay.walletconnect.com"       GET "" 5 400 0  # WSS endpoint — 400 on HTTP GET = healthy

# ─── Bundled-icon CDN URLs ───────────────────────────────────────────
section "CoinGecko CDN icons (in REMOTE_ICONS / chain badges)"
probe cdn "btc"     "https://assets.coingecko.com/coins/images/1/large/bitcoin.png"          GET "" 5 200 0
probe cdn "usdt"    "https://assets.coingecko.com/coins/images/325/large/Tether.png"         GET "" 5 200 0
probe cdn "usdc"    "https://assets.coingecko.com/coins/images/6319/large/usdc.png"          GET "" 5 200 0
probe cdn "bnb"     "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png"   GET "" 5 200 0
probe cdn "xrp"     "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png" GET "" 5 200 0
probe cdn "polygon" "https://assets.coingecko.com/coins/images/4713/large/polygon.png"       GET "" 5 200 0
probe cdn "avax"    "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png" GET "" 5 200 0
probe cdn "eth"     "https://assets.coingecko.com/coins/images/279/large/ethereum.png"       GET "" 5 200 0

# ─── Brand asset sources ─────────────────────────────────────────────
section "Brand asset sources"
probe doc "solana brand page" "https://solana.com/branding" GET "" 8 200 0
probe doc "x.com handle"      "https://x.com/lithospherenet" GET "" 8 200 0

# ─── Summary / exit ──────────────────────────────────────────────────
if [ "$MODE" = "json" ]; then
  printf '{"ok":%d,"warn":%d,"fail":%d,"critical_down":%d,"checks":[' \
    "$ok" "$warn" "$failed" "$critical_down"
  first=1
  for r in "${results[@]}"; do
    [ $first -eq 0 ] && printf ','
    first=0
    s="${r%%|*}"; rest="${r#*|}"
    ms="${rest%%|*}"; rest2="${rest#*|}"
    cat="${rest2%%|*}"; rest3="${rest2#*|}"
    label="${rest3%%|*}"; rest4="${rest3#*|}"
    url="${rest4%%|*}"; critical="${rest4#*|}"
    printf '{"status":"%s","ms":%s,"category":"%s","label":"%s","url":"%s","critical":%s}' \
      "$s" "$ms" "$cat" "$label" "$url" "$critical"
  done
  printf ']}\n'
else
  printf "\n\033[1mSummary\033[0m  "
  printf "\033[1;32m✓ %d\033[0m  " "$ok"
  printf "\033[1;33m⚠ %d\033[0m  " "$warn"
  printf "\033[1;31m✗ %d\033[0m" "$failed"
  if [ "$critical_down" -gt 0 ]; then
    printf "  \033[1;31m(%d CRITICAL)\033[0m" "$critical_down"
  fi
  printf "\n"
fi

# Critical-down exits 1 — the gate for cron / CI alerting.
# Non-critical red exits 2 so monitoring can distinguish.
if [ "$critical_down" -gt 0 ]; then exit 1; fi
if [ "$failed" -gt 0 ]; then exit 2; fi
exit 0
