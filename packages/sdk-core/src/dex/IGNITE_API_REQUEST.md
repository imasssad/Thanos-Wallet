# Ignite DEX — API Contract Request

**To**: Ignite engineering team
**From**: Thanos Wallet
**Status**: ⏳ Awaiting confirmation
**Last revised**: 2026-05-23

We've built the Thanos Wallet swap UI to route through Ignite alongside
MultX, picking whichever route returns the better output. The wallet's
client adapter — `packages/sdk-core/src/dex/ignite.ts` —
is already wired end-to-end against a best-guess REST shape derived
from conventional same-chain DEX APIs (1inch, 0x, OpenOcean,
Uniswap auto-router).

We need a brief confirmation from your team that **the shape below
matches what `ignite.litho.ai` actually serves** (or, if it differs,
the deltas). With sign-off on this single page, the wallet ships
against the real Ignite endpoint in one config flip — no further
back-and-forth needed.

---

## What the wallet expects

Base URL: `https://ignite.litho.ai` (overridable via env for staging)

### 1. `POST /api/v1/quote`

Quote a same-chain swap.

#### Request body

```jsonc
{
  "tokenIn":       "LITHO",            // symbol OR 0x address (your call — please specify)
  "tokenOut":      "USDL",
  "amountIn":      "100",              // human-readable decimal, NOT wei (please confirm)
  "slippageBps":   50,                 // optional, default 50 (0.5%)
  "walletAddress": "0xa11ce…",         // sender, for personalised routes / accounts
  "chainId":       700777               // Makalu
}
```

#### Response body (200)

```jsonc
{
  "quoteId":          "ign-7f3a…",     // opaque, passed back to /swap
  "amountOut":        "121.45",        // human-readable, includes slippage allowance
  "route":            ["LITHO", "USDL"],   // hops; minimum two entries
  "priceImpactBps":   12,              // 0.12 % impact
  "expiresAtMs":      1747843200000,   // when this quote stops being valid (~30 s typical)
  "feeUsd":           "0.42",          // optional, USD-denominated fee for display
  "estimatedSeconds": 6                 // optional, time-to-confirm hint
}
```

#### Error responses

- `400` for invalid pair / insufficient liquidity / amount below floor — please
  include a human-readable `error` field in the body.
- `429` if we hit a rate limit — the wallet backs off automatically.
- `5xx` — the wallet falls back to MultX route or indicative price.

### 2. `POST /api/v1/swap`

Execute a previously-issued quote. The wallet's user has already
approved the source token allowance + clicked "Swap" by the time this
fires.

#### Request body

```jsonc
{
  "quoteId":       "ign-7f3a…",
  "walletAddress": "0xa11ce…"
  // signedTx field omitted — please tell us whether you expect the
  // client to sign and submit, OR whether you broadcast on our behalf
  // using a relayer keyed off walletAddress. Either is fine; we just
  // need to know which.
}
```

#### Response body (200)

```jsonc
{
  "executionId": "exec-7f3a…",         // opaque, polled via /status/{id}
  "status":      "submitted",          // or "pending" | "completed"
  "txHash":      "0xdead…"             // optional, present once broadcast
}
```

### 3. `GET /api/v1/status/{executionId}`

Poll execution state. The wallet polls with exponential backoff
(4s → 8s → 16s → 30s cap), so a single execution might be hit ~10
times over the lifecycle of a swap.

#### Response body (200)

```jsonc
{
  "status":  "completed",              // or "pending" | "signing" | "failed"
  "txHash":  "0xdead…",                // populated once broadcast
  "error":   null                       // human-readable on status="failed"
}
```

#### 404 semantics

Please **return 404** when the executionId is not yet known to your
backend (race between /swap returning and /status being polled). The
wallet treats 404 as "still in-flight, keep polling" — same convention
MultX uses.

### 4. `GET /api/v1/health`

Liveness — any 2xx body is fine. The wallet uses this to decide whether
to even include Ignite in the quote race; a 5xx here means "route around
me" rather than "fail the swap".

---

## What we need from your team

A confirmation of the shapes above. If anything differs, mark up this
document inline and send back — we'll port the changes verbatim into
`packages/sdk-core/src/dex/ignite.ts:LiveIgniteClient` (the relevant
methods are all in one place; the change is mechanical).

### Specific unknowns we need answers to

1. **Token format**: do you expect `tokenIn`/`tokenOut` as ticker
   symbols (`"LITHO"`) or 0x token addresses
   (`"0xc47E49259b8dDa2C9D57941E1a52747E4c721Cb9"`)? Symbols are nicer
   for our UI; addresses are more robust for new listings. We can adapt
   either way.

2. **Amount format**: human-readable decimal (`"100"` for 100 LITHO) or
   wei (`"100000000000000000000"`)? Decimal is conventional for REST
   DEX APIs; wei is conventional for on-chain.

3. **Execution path**: does `/swap` build + broadcast the tx server-side
   (we send no signed tx), or does it return an unsigned tx for the
   wallet to sign and broadcast? If the latter, please add a
   `signedTx` request field + return an unsigned tx in the response.

4. **Quote expiry**: is `expiresAtMs` Unix ms (our assumption) or
   seconds? If your quotes don't have a hard expiry, please return a
   far-future timestamp + we treat it as evergreen.

5. **Rate limits**: any per-IP or per-wallet limits we should respect?
   The wallet's swap UI debounces at 400ms so quote spam shouldn't be a
   problem, but we'd like to know the ceiling.

6. **CORS**: the wallet calls these endpoints directly from the browser
   (no proxy). Please confirm `Access-Control-Allow-Origin: *` (or at
   least `https://thanos.fi`) is set.

---

## What's already shipped on our side

- `MockIgniteClient` — deterministic canned quotes. Used by tests + UI
  dev. Currently the default in `createIgniteClient()`.
- `LiveIgniteClient` — implemented against the shape above, throws
  `IgniteUnavailable` on any malformed response so the wallet
  gracefully falls back to MultX.
- Swap UI quotes Ignite + MultX in parallel and picks the better
  output. The "real" Ignite path runs the moment we flip
  `createIgniteClient({ kind: 'live' })`.

When you're ready, the only change on our side is one assignment in
`packages/sdk-core/src/wallet-engine.ts`:

```ts
// from:
readonly ignite: IgniteClient = createIgniteClient();
// to:
readonly ignite: IgniteClient = createIgniteClient({ kind: 'live' });
```

Reply with confirmations / corrections and we ship.

— Thanos Wallet
