# LAX × Thanos — what we need to finish the native integration

**Status today:** all four Thanos clients (mobile, web, desktop, extension) ship
a LAX card that does **"Create Account → opens lax.money"** (an external
hand-off). The server-side seam is already built — [`services/api/src/routes/lax.ts`](../../services/api/src/routes/lax.ts)
proxies every LAX call so the partner key stays server-only.

**Update 2026-09-09 (from Robert/Zypto directly + the real OpenAPI spec at
`dash.zypto.com/docs/openapi.yaml`):** this is now a fully scoped, real
integration — not a "wait for docs" situation anymore. Key facts below,
correcting/extending the 2026-08-27 widget/iframe architecture note.

---

## 1. It's real, live, and self-service — here's the actual shape

- **The API is "FCFpay"** underneath the LAX/Zypto branding (per the
  OpenAPI spec's `info.title`). The spec's example server is
  `https://merchant.fcfpay.com` — **per Robert: "just replace zypto to
  yours for endpoints"**, i.e. swap that example host for our own
  dashboard-generated Project URL (`LAX_API_BASE`).
- **Auth is confirmed**: `Authorization: Bearer <key>` header (verified
  directly from the spec — NOT the `x-api-key` placeholder this repo had
  guessed at). One key, no separate widget-scoped credential for API calls.
- **Keys are self-serve, including rotation** — created from the owner/admin
  dashboard account (same page as the onboarding guide's Project-creation
  steps); rotation lives in that same creation area, no ticket to Zypto
  needed.
- **No sandbox environment exists.** Robert, verbatim: *"Prod, there is no
  provided sandbox, please use real data, errors we can correct together if
  any happen."* Plan accordingly — smallest real amounts first, not a
  simulated dry run.

## 2. Real endpoint list (36 total, from the OpenAPI spec)

Two namespaces — **physical cards** and **virtual cards** — both live and
documented with full request-body validation rules (regexes, min/max
lengths) even though response shapes aren't documented (same gap as
Quantt's spec — expect to observe real responses once we're calling it).

**Physical cards** (`/api/physical-cards/*`): create/update card holder, list
card holders, send KYC, submit to issuer, assign bulk card, set/get PIN,
holder KYC (proof of address + ID document upload), load/unload balance, get
balance, get transactions (current/previous month), create account, set
password, create wallet, get holder details, view/activate card, change card
status, enable multi-card assign.

**Virtual cards** (`/api/cards/*`): create card order (+ deposit variant),
create refill order (+ deposit variant), **issue card** (this is the one
that needs `iframe_id` — see below), get card transactions, get card
balance, get allowance, load/unload virtual card, get my cards, get card
details.

**General**: `GET /api/general/available_currencies` — **this is the "which
tokens/chains are active for your account" poll Robert mentioned** ("several
tokens and chains... can be polled to get active for your account... this
list can shrink or expand based on your selections to preference"). Call
this rather than hardcoding a chain/token list — it reflects our actual
dashboard configuration.

## 3. The widget ID, confirmed exactly where it's used

`POST /api/cards/issue-card-api` (virtual card issuance) requires:

```json
{
  "iframe_id":  14,          // integer — our Super Widget's dashboard ID
  "amount":     82,          // number, min 20
  "currency":   "usdc",      // string, min 3 chars
  "product_id": 7,           // integer — a card product configured in-dashboard
  "email":      "user@example.com"
}
```

So **two dashboard-configured values gate virtual card issuance**:
`iframe_id` (the widget) and `product_id` (a card product — variant/currency/
fee-tier, configured separately, not yet created on our side). Neither
exists until we've done the dashboard setup in §1 of the original plan
(Projects → Widgets → Card Fees/Products).

## 4. KYC — confirmed both options, and the real vendor

Robert: *"kyc hosted redirect or use in modal."* Both are available. The
spec links out to **Sumsub** (`docs.sumsub.com`) for the actual KYC
verification step — so the underlying vendor is Sumsub, accessed either via
a hosted redirect (small lift — same shape as our current external
hand-off) or embedded in a modal (bigger lift, matches the "Super Widget"
iframe embed approach). `POST /api/physical-cards/send-kyc` takes a
`card_holder_id` and kicks the flow off.

## 5. Custodial model — confirmed

Robert: *"if using your own liquidity balance, this is deposited in a
separate issuer account and totals are maintained by you."* So there are
(at least) two funding models: (a) let Zypto/the issuer custody per-user
balances directly, or (b) fund a separate issuer account ourselves and track
per-user totals on our own side. This is a real product decision — (b) means
we own more of the ledger/compliance surface, (a) means less engineering but
less control. Needs a decision before building the funding flow, not just an
engineering call.

## 6. Webhooks — confirmed dashboard-configured

`dash.zypto.com/webhooks` — Robert: *"following the same naming convention
as your product or the general term, such as 'user deposit'."* Configured
entirely in-dashboard, pointing at our own backend.

**Thanos side (built):** `POST /lax-webhook` in `services/api/src/routes/lax.ts`
(`laxWebhookRouter`) logs payloads to `lax_webhook_events` and authenticates
with `LAX_WEBHOOK_SECRET` (`x-lax-webhook-secret` or `Authorization: Bearer`).
Configure the dashboard webhook URL as `https://<api-host>/lax-webhook` and
set the same shared secret in the VPS `.env`. Event names still follow
whatever the dashboard UI offers (e.g. `user deposit`).

## 7. Still open / corrected 2026-09-18

- **Product namespace:** Project **612** (LAX Card) has **no Virtual Cards
  API section** on the dashboard. Live ops use `/api/physical-cards/*`.
  There is no separate `product_id` to fetch — only the project id (612).
  Native `POST /lax/card/issue` therefore returns 501 until physical
  create-card-holder + KYC is wired; UI stays on external / coming-soon
  for new cards.
- **Active currencies:** must call `GET /api/general/available_currencies`
  (docs: dash.zypto.com/docs/cards) and re-check at least once per 24h —
  server + all clients cache with a 24h TTL.
- **A SendGrid/Elastic Email account** for Zypto's transactional emails —
  still don't have one.
- **The missed call** — reschedule via Robert's Calendly
  (calendly.com/robert-zypto/30min).

## 8. UPDATE 2026-09-13 — all 4 values now locatable; Robert answered the rest

Our dashboard account exists and is populated (Project "LAX Card", user
LaxCash, `admin@lax.money`, status active). Where each `.env` value comes
from, confirmed via screenshots + Robert:

- **`LAX_API_KEY`** — Project List row → **"Get api key"** / **"Refresh Key"**.
- **`LAX_API_BASE`** — Robert: *"base url is your dashboard."* →
  `https://dashboard.lax.money` (not the vestigial Project "Domain" field).
- **`LAX_PROJECT_ID`** — **`612`** (Project "LAX Card"). Confirmed: there is
  **no Virtual Cards API option** on this dashboard and therefore **no
  product_id**. Do not wait on widget/product IDs for this project.
- **Physical cards** — balance / load / transactions / view / status map to
  `/api/physical-cards/*`. New-card KYC remains hosted redirect (or future
  native create-card-holder flow).

**Net:** set `LAX_API_KEY` + `LAX_API_BASE` + `LAX_PROJECT_ID=612` (+ webhook
secret) on the VPS. Currencies + physical card ops go live; native instant
issue stays off until physical onboarding is built.

---

## What's already built on the Thanos side

- **Server proxy** (`routes/lax.ts`): key stays server-side. Live routes once
  configured: `GET /lax/status`, `GET /lax/currencies`, `GET /lax/cards`
  (ownership-scoped to the caller's `lax_cards`), balance / transactions /
  details, `POST /lax/card/topup`, `POST /lax/card/issue`, freeze/unfreeze,
  plus `POST /lax-webhook`. Auth header is `Authorization: Bearer`. Until
  `LAX_API_KEY` + `LAX_API_BASE` are set, non-account routes return 503 and
  account creation still hands back the hosted `lax.money` URL.
- **Native client flows** on all four platforms (`LaxCard` / `LaxCardFlow`) —
  intro → create/issue → dashboard → top-up, talking only to Thanos `/lax/*`.
- **Env wiring** in compose + VPS template: `LAX_API_KEY`, `LAX_API_BASE`,
  `LAX_PROJECT_ID` (612), `LAX_WEBHOOK_SECRET`.

## Security requirements (non-negotiable on our side)

- The partner key **never** ships in an app binary or a committed file —
  server `.env` only (the wallet apps are public/client-side).
- No pre-approval / private dashboard links ship in the app.
- **No sandbox exists** (confirmed) — test with the smallest possible real
  amount, expect to iterate on errors with Zypto directly rather than
  assume a dry-run environment will catch issues first.
