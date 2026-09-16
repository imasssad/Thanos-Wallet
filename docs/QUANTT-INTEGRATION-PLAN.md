# Quantt × Thanos — native integration plan

> Scope per Esha (2026-07-15): **not links** — Quantt's features running
> natively inside Thanos via their SDK/API. This plan is grounded in the
> live API surface: `https://api.quantts.ai/docs` (OpenAPI 0.4.0, snapshot
> committed as [quantt-openapi-0.4.0.json](./quantt-openapi-0.4.0.json)).
> Companion research portal: `https://research.quantt.at/`.

## What the Quantt API already provides (verified 2026-07-15)

The API is visibly **built for this integration**:

- **Wallet-native auth, Thanos-specific:** `GET /v1/auth/wallet/nonce` is
  documented as *"Issue a Thanos-compatible nonce"*. Full flow:
  `nonce → POST /v1/auth/wallet/typed-challenge {address} → wallet signs
  EIP-712 → POST /v1/auth/wallet/typed-verify {address, signature} → bearer
  session (+ refresh)`. A legacy SIWE `challenge`/`verify` pair also exists.
- **A dedicated mobile/BFF surface** (`/v1/mobile/*`): overview, agents
  (list/create/detail/state), alerts (+ack), wallet, billing, marketplace,
  social, enterprise, **`wallet/pay`**, **`copilot`** — shaped for embedding
  in a wallet app rather than for their own web frontend.
- **Full agent lifecycle** (`/v1/agents/*`): CRUD, start/pause/stop,
  trigger analysis, decisions (paginated) and **SSE decision streams**.
- **Market data** (`/v1/market/*`): snapshot, OHLCV, indicators (RSI/MACD/
  EMA), news, sentiment, top-10, watchlist, SSE tick stream.
- **Partner tier** (`/v1/partner/*`, `partnerKey` scheme): public agent
  metadata + recent decisions + market snapshot — usable logged-out.
- Execution: `POST /v1/execution/swap`; `GET /v1/mvp/wallet/address`.

## Auth design (all clients)

1. `GET /v1/auth/wallet/nonce?address=0x…`
2. `POST /v1/auth/wallet/typed-challenge { address }` → EIP-712 typed data
3. Sign with the wallet key — no new UI primitive needed:
   - mobile/desktop/web: internal signer (`signTypedData`)
   - extension: existing `eth_signTypedData_v4` path
4. `POST /v1/auth/wallet/typed-verify { address, signature }` → access +
   refresh tokens
5. Store per client: mobile `expo-secure-store`, extension
   `chrome.storage.session`, desktop keytar, web httpOnly-style storage.
   Refresh via `POST /v1/auth/refresh`; sessions listable/revocable.

Keys never leave the wallet; Quantt only ever sees a signature. This is the
same trust model as the already-live quantts.ai sign-in — inverted to run
inside Thanos.

## Phases

### Phase 1 — Account link + live read-only panel (fastest visible win)
The "Quantt Agents" card (all four clients) becomes a native panel:
- Logged out: teaser from `partner` endpoints (top agents + recent
  decisions) — needs a **partnerKey** from the Quantt team.
- "Connect" → wallet-signature auth (above) → user's real data:
  `GET /v1/mobile/overview`, agents list + status, latest decisions.

### Phase 2 — Agent control + live activity
- Create / start / pause / stop agents (`POST /v1/mobile/agents`,
  `POST /v1/mobile/agents/{id}/state`).
- Alerts inbox with acknowledge (`GET /v1/mobile/alerts`, `POST …/ack`).
- SSE decision stream → live feed in the panel; bridge alerts into the
  existing Thanos push pipeline (server-side subscriber → `/push/notify`)
  so agent events notify even with the app closed.
- Copilot chat surface (`POST /v1/mobile/copilot`).

### Phase 3 — Money flows
- `POST /v1/mobile/wallet/pay` — fund/pay from the Thanos balance with an
  in-wallet confirm sheet (wallet signs; same simulator/guard rails as
  Send).
- `POST /v1/execution/swap` — surface agent-proposed swaps for explicit
  user confirmation in-wallet.
- `GET /v1/mobile/billing` — subscription/billing state, upgade CTA.

### Phase 4 — Market enrichment (shared win)
`/v1/market/*` (snapshot, indicators, news, sentiment) can also upgrade
Thanos's own Market tab + token-detail screens — one integration, two
features.

## Client rollout order
1. **Mobile** (the flagship; `/v1/mobile/*` maps 1:1)
2. **Extension** (popup panel; auth via existing provider signer)
3. **Web + desktop** (shared React patterns from mobile port)

## Open questions for the Quantt team
1. **partnerKey** issuance for Thanos (the `/v1/partner/*` tier).
2. Do `/v1/mobile/*` endpoints require a client credential beyond the user
   bearer token?
3. `wallet/pay` + `execution/swap`: which chain(s) do they settle on
   (Makalu 700777? BSC?) and what asset(s)?
4. Sandbox/staging environment + test accounts.
5. Rate limits per tier; SSE auth (bearer via query param or header?).
6. `research.quantt.at` — is any of the research content meant to surface
   in-app, or is it reference material only?

## Current state in the repo (updated 2026-09-16)

**Phases 1-3 are DONE and shipped on all four clients** (mobile, web,
desktop, extension) — this section was last updated 2026-08-20 when only
Phase 1 was live; Phases 2-3 landed since.

- **Phase 1 (auth + read-only panel):** wallet-signature login end-to-end,
  verified against the LIVE `api.quantts.ai` — challenge → sign (EIP-712,
  per-client signer) → verify → session. "Quantt Agents" card is
  "Connect with Thanos" → live portfolio + agents from `GET /v1/mobile/overview`.
- **Phase 2 (agent control + activity) + Phase 3 (money flows), combined:**
  full agent lifecycle — create (13 strategies × 4 chains × tokens ×
  dexPreference × capitalUsd, plus an Advanced tier), manage (Overview/
  Wallet/Decisions/Trades/Positions tabs), start/pause/stop, manual
  "Analyze" trigger, delete. Deposit (two-step: prefilled Send to the
  agent's own address, then confirm) and withdraw (gated on
  `getWithdrawalAddress` + an EIP-712 binding challenge before
  `withdrawFromAgent`), plus withdrawal history/resume, a kill switch, and
  telemetry. `packages/sdk-core/src/quantt/client.ts` implements the full
  surface; each client has its own thin wrapper kept in sync with it.
- **What "optimize and suggest trades" actually means today** (client
  question, 2026-09-16): Quantt's product is **agent-based, not whole-
  portfolio-based** — there is no endpoint in the spec that reads a user's
  existing wallet holdings and suggests trades against them directly. The
  flow is: create an agent → deposit capital INTO that agent's own address
  → the agent analyzes + decides + trades THAT capital (surfaced via
  Decisions/Trades/Positions). This is a constraint of Quantt's own API
  shape, not a gap in the Thanos integration — asking Quantt whether a
  direct whole-portfolio-analysis endpoint exists (or will) is a question
  for their team, not an engineering task on our side.
- **Still not wired:** the logged-out teaser (needs a `partnerKey` from
  Quantt — open question #1 below, unanswered), `POST /v1/mobile/copilot`
  (chat surface — no documented request/response shape, same "Default
  Response" gap as everything else in this spec; nothing to build against
  yet), Phase 4's market-data enrichment of Thanos's own Market tab.
