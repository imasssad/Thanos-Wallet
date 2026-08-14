# LAX × Thanos — what we need to finish the native integration

**Status today:** all four Thanos clients (mobile, web, desktop, extension) ship
a LAX card that does **"Create Account → opens lax.money"** (an external
hand-off). The server-side seam is already built — [`services/api/src/routes/lax.ts`](../../services/api/src/routes/lax.ts)
proxies every LAX call so the partner key stays server-only. To make the card
**native** (onboard, view balance, top up, spend — all in-wallet) we need the
items below from the LAX / Zypto team.

---

## 1. API access (hard blockers)

| Need | Why |
|---|---|
| **Base URL** (prod + **sandbox/staging**) | `LAX_API_BASE` — we can't call anything without it, and we must test against sandbox before touching real cards. |
| **Auth scheme** — exact header name + format | Currently a placeholder (`x-api-key`). Is it `x-api-key: <key>`, `Authorization: Bearer <key>`, or an HMAC-signed request? |
| **A partner API key** (prod + sandbox) | The one shared earlier must be **rotated** (it was pasted in chat) and delivered over a secure channel, not chat. Lives only in the VPS `.env`. |
| **OpenAPI / API docs** (or a Postman collection) | The endpoint list + request/response shapes for the flows in §2. |

## 2. Endpoint contracts we need (request + response shapes)

The card lifecycle the UI already assumes:

1. **Onboarding / create account** — `POST /account` (or equiv). What does it
   return? A hosted KYC URL, a KYC-SDK token, or a created-account object? Is a
   wallet address / email the identifier?
2. **KYC status** — how we poll/verify a user is approved (`GET /account`).
3. **Card details** — issued card status, **last-4 / balance / currency**
   (never full PAN unless you tell us the PCI story — see §3).
4. **Fund / top-up** — `POST /card/topup`: which **chains + assets** are
   accepted, and is it a **deposit-address** model (we send crypto to an address
   you give) or a **quote → execute** swap-to-fiat model?
5. **Transactions / statement** (optional v2) — recent card spend for the panel.
6. **Card controls** (optional v2) — freeze/unfreeze, limits.
7. **Webhooks** — endpoint + **signature scheme** for async events (KYC
   approved, card issued, top-up settled) so the app updates without polling.

## 3. Product / compliance decisions we need from you

- **Custodial model:** does LAX/Zypto custody the fiat balance? (drives the
  top-up rails and the compliance story)
- **KYC method:** hosted redirect (what the hand-off already does — small lift)
  vs. an embedded KYC SDK (large, per-platform lift). Which one?
- **Funding rails:** exact chains + tokens accepted, min/max, fees.
- **PCI scope:** do our clients ever render the PAN/CVV, or only tokenized
  last-4? (If PAN, we need the tokenization/iframe approach — big scope change.)
- **Regions / eligibility:** which countries are supported; any licensing gates
  (same class of question as the crypto-card regulatory rules).

---

## What's already built on the Thanos side (so this is a small lift once §1–2 land)

- **Server proxy** (`routes/lax.ts`): key stays server-side; routes for
  `POST /account`, `GET /account`, `GET /card`, `POST /card/topup` are stubbed
  and switch from the safe hand-off to the real API the moment
  `LAX_API_BASE` + `LAX_API_KEY` are set. Only the per-route bodies + auth header
  need filling in from your docs.
- **Client cards** on all four platforms (the current "Create Account" cards) —
  we swap the `lax.money` open for the native onboard → card → top-up flow.
- **Env wiring** ready on the VPS (`LAX_API_KEY`, `LAX_API_BASE`).

## Security requirements (non-negotiable on our side)

- The partner key **never** ships in an app binary or a committed file — server
  `.env` only (the wallet apps are public/client-side).
- No pre-approval / private dashboard links ship in the app.
- Sandbox-first: nothing touches real cards until the sandbox flow is verified.
