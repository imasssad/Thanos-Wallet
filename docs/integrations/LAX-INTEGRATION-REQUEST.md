# LAX × Thanos — what we need to finish the native integration

**Status today:** all four Thanos clients (mobile, web, desktop, extension) ship
a LAX card that does **"Create Account → opens lax.money"** (an external
hand-off). The server-side seam is already built — [`services/api/src/routes/lax.ts`](../../services/api/src/routes/lax.ts)
proxies every LAX call so the partner key stays server-only.

**Architecture correction (2026-08-27, from Zypto's "Tenant Onboarding Guide"):**
LAX is **Zypto's white-label reseller platform**, not a plain REST API. It's
**widget/iframe-driven** — Zypto's own doc says outright: *"Widgets are
necessary even if you're using the API — some API calls require a widget
(iframe) ID."* This changes the plan below from "build a fully custom native
UI against documented endpoints" to "embed Zypto's branded widget for the
flows that require one, and use the API for read-only/status data around it."
Everything in §1–2 of the old version of this doc assumed a pure-API model;
corrected here.

---

## 1. Dashboard setup (self-service — no longer something to wait on Zypto for)

Per the guide, **we generate our own credentials** once we have owner/admin
dashboard access (`https://dashboard.lax.money/`):

1. **Projects → New Project → type "Custom" → Save.** This generates the
   **API key**, and — important — **the dashboard URL itself becomes the API
   endpoint** (`LAX_API_BASE`). There's no separate "give us your base URL"
   step from Zypto; it's self-service once the project exists.
2. **Widgets → create one widget per product we're actually authorized to
   resell per our contract**, then combine them into one **Super Widget**
   (branding — colors/text/logo — is set on the Super Widget, not the child
   widgets; "child widgets are not fully supported... use the Super Widget
   moving forward"). Some API calls need this widget's iframe ID as a
   parameter.
3. **Settings → Tenant Settings → Webhook Configuration** — we configure the
   webhook URL *ourselves* pointing at our own backend; Zypto doesn't hand us
   a signature scheme separately, it's a dashboard setting. **We don't have a
   webhook receiver built yet** — needs a new route in `services/api` once
   the dashboard side is set up.
4. **Settings → Integration Settings** — requires a **SendGrid or Elastic
   Email** API key + sender info for Zypto's automated transactional emails
   (KYC confirmations etc.) to send under our branding. **New external
   dependency — we don't have a SendGrid/Elastic Email account yet.**
5. **Settings → Crypto & Reseller Fees / Card Fees** — markup and currency
   selection is a **business decision**, not a technical one; currencies
   must be explicitly selected (the guide warns "do not leave this blank").
6. ⚠️ Guide's own warning: **only the owner/admin account should create API
   keys or widgets** — decide who on the team holds that login before
   starting (dashboard access was shared as `admin@lax.money`, password not
   yet confirmed).

## 2. Open question for Zypto — which products are actually in our contract?

The guide repeatedly says to skip anything not covered ("Create widgets only
for the products you're authorized to resell... widgets not covered in your
contract will cause errors"). **We don't know which products (physical card /
premium virtual card / other) our contract actually includes** — this needs
confirming with Robert/Zypto before creating widgets, or we'll hit avoidable
errors.

## 3. Endpoint contracts we still need (now scoped to whichever products apply)

Once §1–2 are resolved, the original question list still stands for the API
side of whatever isn't covered by an embedded widget:

1. **Onboarding / KYC status** — likely widget-driven (Card Dashboards →
   Physical/Premium Virtual Card Dashboard shows "user KYC status" — may be
   an admin-only view, or the "My Cards" surface may itself be a
   user-facing widget; **need to confirm with Zypto which of these the end
   user sees directly vs. which we read via API**).
2. **Card details** — status, **last-4 / balance / currency** (never full
   PAN unless Zypto confirms a PCI-safe tokenization story).
3. **Fund / top-up** — which **chains + assets** are accepted, and whether
   it's a **deposit-address** model or a **quote → execute** swap-to-fiat
   model.
4. **Transactions / statement** (optional v2).
5. **Card controls** (optional v2) — freeze/unfreeze, limits.

## 4. Product / compliance decisions we still need from you

- **Custodial model:** does LAX/Zypto custody the fiat balance?
- **Funding rails:** exact chains + tokens accepted, min/max, fees.
- **PCI scope:** do our clients ever render the PAN/CVV, or only tokenized
  last-4?
- **Regions / eligibility:** which countries are supported; any licensing
  gates.

---

## What's already built on the Thanos side

- **Server proxy** (`routes/lax.ts`): key stays server-side; routes for
  `POST /account`, `GET /account`, `GET /card`, `POST /card/topup` are
  stubbed and switch from the safe hand-off to the real API the moment
  `LAX_API_BASE` + `LAX_API_KEY` are set. **Needs updating** once the
  widget-based model is confirmed — some calls will need a widget ID, and a
  webhook *receiver* route doesn't exist yet.
- **Client cards** on all four platforms (the current "Create Account"
  cards) — swap the `lax.money` open for the native flow. On web this is a
  straightforward iframe embed of the Super Widget; mobile/desktop/extension
  can reuse each client's existing in-app browser/webview infrastructure to
  host the same widget rather than building a separate native embed path.
- **Env wiring** ready on the VPS (`LAX_API_KEY`, `LAX_API_BASE`).

## Security requirements (non-negotiable on our side)

- The partner key **never** ships in an app binary or a committed file —
  server `.env` only (the wallet apps are public/client-side).
- No pre-approval / private dashboard links ship in the app.
- Sandbox-first: nothing touches real cards until a sandbox flow (if Zypto's
  platform offers one — not yet confirmed) is verified. If there's no
  sandbox, we test with the smallest possible real amount and cap exposure
  until the flow is proven.
