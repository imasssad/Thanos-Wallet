/**
 * LAX card proxy — Thanos backend ↔ LAX / Zypto partner platform.
 *
 * WHY THIS IS SERVER-SIDE: the LAX API key is a SECRET. The wallet apps (mobile,
 * web, extension, desktop) are public + client-side, so a key embedded there is
 * extractable and abusable. Every LAX call is therefore proxied HERE, with
 * LAX_API_KEY read from the environment and never sent to the client. The apps
 * call these endpoints; this router forwards to LAX with the key attached.
 *
 * ARCHITECTURE (see docs/integrations/LAX-INTEGRATION-REQUEST.md for the full
 * writeup, updated 2026-09-09 from Robert/Zypto + the real OpenAPI spec at
 * dash.zypto.com/docs/openapi.yaml — title "FCFpay", the platform LAX/Zypto is
 * white-labelled from):
 *   - Auth is CONFIRMED: `Authorization: Bearer <key>` (verified from the real
 *     spec — the earlier `x-api-key` guess was wrong).
 *   - LAX_API_BASE is our own dashboard-generated Project URL — the spec's
 *     example server (merchant.fcfpay.com) is a placeholder we replace with
 *     ours ("just replace zypto to yours for endpoints" — Robert, 2026-09-09).
 *   - Path shapes below match the real spec exactly (36 documented endpoints
 *     across /api/physical-cards/* and /api/cards/*), not guesses.
 *   - `POST /api/cards/issue-card-api` requires `iframe_id` (our Super
 *     Widget's dashboard ID, LAX_WIDGET_ID) AND `product_id` (a card product
 *     configured in-dashboard, LAX_PRODUCT_ID) — confirmed straight from the
 *     spec's request schema, not a guess like the earlier scaffold's
 *     x-widget-id header was.
 *   - NO SANDBOX EXISTS (confirmed by Robert). Every call below hits real
 *     production the moment it's configured — there's no dry-run environment
 *     to catch mistakes first.
 *
 * STATUS: SCAFFOLD. Until LAX_API_BASE + LAX_API_KEY are configured the
 * routes degrade safely:
 *   • POST /lax/account → hands back the hosted registration URL (lax.money) so
 *     the app's SafePal-style "Create Account → Next" still opens the web flow —
 *     the pre-integration behaviour, but now through the proper server seam.
 *   • the rest return 503 "LAX not configured yet".
 * Routes that additionally need LAX_WIDGET_ID / LAX_PRODUCT_ID (issuing a new
 * virtual card) stay 503 even once the key/base are set, until those two
 * dashboard-created values exist too — see configuredForIssuance() below.
 *
 * ENV (set on the VPS `.env`, gitignored — NEVER commit the value):
 *   LAX_API_KEY    — partner secret, generated (and rotatable) from the
 *                    dashboard's owner/admin Project-creation page
 *                    (rotate the one shared in chat earlier — that one is
 *                    burned, it was pasted in plaintext)
 *   LAX_API_BASE   — the dashboard-generated Project URL
 *   LAX_WIDGET_ID  — the Super Widget's iframe_id (integer) — required by
 *                    issue-card-api
 *   LAX_PRODUCT_ID — a card product's id (integer), configured in-dashboard
 *                    under Card Fees/Products — also required by
 *                    issue-card-api
 */
import { Router } from 'express';

const LAX_API_KEY    = process.env.LAX_API_KEY    ?? '';
const LAX_API_BASE   = process.env.LAX_API_BASE   ?? '';
const LAX_WIDGET_ID  = process.env.LAX_WIDGET_ID  ?? '';
const LAX_PRODUCT_ID = process.env.LAX_PRODUCT_ID ?? '';
const LAX_PUBLIC_REGISTER = 'https://lax.money';

export const laxRouter = Router();

/** True once the key and base URL are configured — enough for read-only
 *  calls (available currencies, card balance/details, transactions). */
const configured = (): boolean => Boolean(LAX_API_KEY && LAX_API_BASE);
/** True once issuing a NEW card is actually possible — needs the widget +
 *  product id on top of the base key/URL. Neither exists yet (both require
 *  dashboard setup — see the integration doc). */
const configuredForIssuance = (): boolean => configured() && Boolean(LAX_WIDGET_ID && LAX_PRODUCT_ID);

interface FetchOpts { method?: string; body?: string; headers?: Record<string, string> }

/** Proxy helper — attaches the secret key to a LAX/FCFpay API call.
 *  Authorization: Bearer <key> — confirmed from the real OpenAPI spec. */
async function laxFetch(path: string, opts: FetchOpts = {}): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${LAX_API_BASE}${path}`, {
    method:  opts.method ?? 'GET',
    body:    opts.body,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${LAX_API_KEY}`,
      ...(opts.headers ?? {}),
    },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON upstream */ }
  return { status: res.status, json };
}

/* POST /lax/account — create account / start registration.
   Body: { address?: string, referralCode?: string }.
   Pre-API: returns the hosted registration URL (with ref/address prefill) so the
   SafePal-style "Next" opens the LAX web flow. Post-API: this maps to the
   physical-card holder-creation flow (POST /api/physical-cards/create-card-holder)
   once we actually collect the KYC fields that endpoint requires (name, DOB,
   address, phone, etc.) — that's a bigger form than a single "create account"
   call, so this route stays on the external hand-off until the client UI for
   that form exists. */
laxRouter.post('/account', async (req, res) => {
  const { address, referralCode } = (req.body ?? {}) as { address?: string; referralCode?: string };
  const url = new URL(LAX_PUBLIC_REGISTER);
  if (referralCode) url.searchParams.set('ref', referralCode);
  if (address)      url.searchParams.set('address', address);
  return res.json({ mode: 'external', registrationUrl: url.toString() });
});

/** GET /lax/currencies — the "which tokens/chains are active for your
 *  account" read Robert described: pollable, shrinks/grows based on our
 *  dashboard preferences. Safe, read-only, no widget/product id needed. */
laxRouter.get('/currencies', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  try {
    const { status, json } = await laxFetch('/api/general/available_currencies');
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/cards — POST /api/cards/get-my-cards under the hood (their spec
 *  has this as a POST despite being a read — kept as-is rather than
 *  "fixing" their API shape). `cards_type` is required by their schema;
 *  defaults to 'virtual' since that's the only flow this scaffold covers so
 *  far (see issue-card-api below) — physical-card holders need the fuller
 *  KYC flow noted on /account above first. */
laxRouter.get('/cards', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  try {
    const { status, json } = await laxFetch('/api/cards/get-my-cards', {
      method: 'POST', body: JSON.stringify({ cards_type: 'virtual' }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/card/:cardNumber/balance — POST /api/cards/get-card-balance. */
laxRouter.get('/card/:cardNumber/balance', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  try {
    const { status, json } = await laxFetch('/api/cards/get-card-balance', {
      method: 'POST', body: JSON.stringify({ card_number: req.params.cardNumber }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** POST /lax/card/topup — body { cardNumber, amount }. Maps to
 *  load-virtual-card. Unload (withdraw) isn't wired yet — no client UI
 *  needs it until the load flow itself is proven, and NO SANDBOX means
 *  every one of these calls is a real fund movement from day one. */
laxRouter.post('/card/topup', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const { cardNumber, amount } = (req.body ?? {}) as { cardNumber?: string; amount?: number };
  if (!cardNumber || !amount) return res.status(400).json({ error: 'cardNumber and amount are required' });
  try {
    const { status, json } = await laxFetch('/api/cards/load-virtual-card', {
      method: 'POST', body: JSON.stringify({ card_number: cardNumber, amount }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** POST /lax/card/issue — body { amount, currency, email }. Maps to
 *  issue-card-api. iframe_id + product_id are OUR configured values, never
 *  taken from the client request — a user has no business choosing which
 *  widget/product a card gets issued against. 503s until both env vars
 *  exist (they don't yet — need the dashboard Widget + Card Product setup
 *  from the integration doc). */
laxRouter.post('/card/issue', async (req, res) => {
  if (!configuredForIssuance()) return res.status(503).json({ error: 'LAX card issuance not configured yet (missing widget/product setup)' });
  const { amount, currency, email } = (req.body ?? {}) as { amount?: number; currency?: string; email?: string };
  if (!amount || !currency || !email) return res.status(400).json({ error: 'amount, currency and email are required' });
  try {
    const { status, json } = await laxFetch('/api/cards/issue-card-api', {
      method: 'POST',
      body: JSON.stringify({
        iframe_id:  Number(LAX_WIDGET_ID),
        product_id: Number(LAX_PRODUCT_ID),
        amount, currency, email,
      }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

// Kept for back-compat with any existing client calls to the old /account,
// /card status shape — now honest 501s instead of silently proxying to a
// path that doesn't exist in the real API (the earlier scaffold's GET
// /account and GET /card never matched anything real; /currencies, /cards,
// and /card/:cardNumber/balance above are the real equivalents).
laxRouter.get('/account', async (_req, res) => {
  return res.status(501).json({ error: 'use /lax/cards (get-my-cards) — /account has no card-holder-status equivalent yet' });
});
laxRouter.get('/card', async (_req, res) => {
  return res.status(501).json({ error: 'use /lax/card/:cardNumber/balance or /lax/cards' });
});
