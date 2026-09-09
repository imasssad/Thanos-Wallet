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
entirely in-dashboard, pointing at our own backend. **We still don't have a
webhook receiver route built** — needs adding to `services/api` once the
dashboard side is set up, event names to be confirmed against whatever the
dashboard's webhook config UI actually offers.

## 7. Still open

- **Which products are in our contract** (physical / virtual / both) — the
  onboarding guide warned creating a widget for something not covered just
  errors out. Not yet confirmed.
- **A SendGrid/Elastic Email account** for Zypto's transactional emails —
  still don't have one.
- **`product_id` values** — need to actually create a card product in the
  dashboard to get one; not documented as a fixed enum anywhere.
- **The missed call** — reschedule via Robert's Calendly
  (calendly.com/robert-zypto/30min); nobody joined the last one.

---

## What's already built on the Thanos side

- **Server proxy** (`routes/lax.ts`): key stays server-side; routes for
  `POST /account`, `GET /account`, `GET /card`, `POST /card/topup` are
  stubbed. **Auth header now correctly set to `Authorization: Bearer`**
  (was `x-api-key`, a wrong guess — corrected once the real spec confirmed
  it). Still switches from the safe external hand-off to the real API only
  once `LAX_API_KEY` + `LAX_API_BASE` are both set.
- **Client cards** on all four platforms (the current "Create Account"
  cards) — swap the `lax.money` open for the native flow. On web this is a
  straightforward iframe embed of the Super Widget; mobile/desktop/extension
  can reuse each client's existing in-app browser/webview infrastructure to
  host the same widget rather than building a separate native embed path.
- **Env wiring** ready on the VPS (`LAX_API_KEY`, `LAX_API_BASE`,
  `LAX_WIDGET_ID`, `LAX_PRODUCT_ID`).

## Security requirements (non-negotiable on our side)

- The partner key **never** ships in an app binary or a committed file —
  server `.env` only (the wallet apps are public/client-side).
- No pre-approval / private dashboard links ship in the app.
- **No sandbox exists** (confirmed) — test with the smallest possible real
  amount, expect to iterate on errors with Zypto directly rather than
  assume a dry-run environment will catch issues first.
