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
 *
 * HARDENING (2026-09-09), added once this got read closely for exactly
 * that purpose:
 *   - requireAuth on the whole router — every route below previously had
 *     NO authentication check at all, unlike every other per-user router
 *     in this service (contactsRouter, wcSessionsRouter both do
 *     `router.use(requireAuth)`). With no sandbox and real fund movement,
 *     an unauthenticated /lax/card/topup was a real risk the moment keys
 *     got configured, not a theoretical one.
 *   - Card ownership scoping via the new lax_cards table (services/db/
 *     schema.sql + migrations/002_lax_cards.sql). LAX's API itself is
 *     scoped to our one shared merchant key, not per end-user — "my
 *     cards" from LAX's point of view means "all of Thanos's cards," not
 *     "this caller's cards." Without a local mapping, any logged-in user
 *     could query the balance of, or load funds onto, ANY card number
 *     under our account just by guessing/enumerating it. Recorded at
 *     issuance, checked before balance/topup calls; a card the caller
 *     doesn't own 404s rather than 403s, so ownership can't be probed.
 *   - laxOpLimiter (10/hour, its own dedicated instance in rate-limit.ts)
 *     on the two fund-moving routes, on top of the app-wide general
 *     limiter. Deliberately NOT auth.ts's sensitiveOpLimiter — that's a
 *     shared singleton, and express-rate-limit counts by IP across every
 *     route a given instance is attached to, so reusing it here would
 *     couple a user's card actions to their unrelated session-revocation
 *     budget (and to each other).
 *   - zod validation on every body instead of loose `as {...}` casts —
 *     rejects negative/zero/non-finite amounts and malformed email/ids
 *     before they reach production with no sandbox to catch a typo.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { laxOpLimiter } from '../middleware/rate-limit.js';

const LAX_API_KEY    = process.env.LAX_API_KEY    ?? '';
const LAX_API_BASE   = process.env.LAX_API_BASE   ?? '';
const LAX_WIDGET_ID  = process.env.LAX_WIDGET_ID  ?? '';
const LAX_PRODUCT_ID = process.env.LAX_PRODUCT_ID ?? '';
const LAX_PUBLIC_REGISTER = 'https://lax.money';

export const laxRouter = Router();
laxRouter.use(requireAuth);

/** True once the key and base URL are configured — enough for read-only
 *  calls (available currencies, card balance/details, transactions). */
const configured = (): boolean => Boolean(LAX_API_KEY && LAX_API_BASE);
/** True once issuing a NEW card is actually possible — needs the widget +
 *  product id on top of the base key/URL. Neither exists yet (both require
 *  dashboard setup — see the integration doc). */
const configuredForIssuance = (): boolean => configured() && Boolean(LAX_WIDGET_ID && LAX_PRODUCT_ID);

interface FetchOpts { method?: string; body?: string; headers?: Record<string, string> }

interface LaxCardRow { id: string; user_id: string; card_number: string }

/** True iff `cardNumber` is recorded as this user's in lax_cards. Every
 *  card-scoped route below gates on this — LAX's own API has no per-end-user
 *  scoping, so the mapping we record at issue time is the only thing that
 *  stops one Thanos user reading/topping-up another's card. */
async function ownsCard(userId: string, cardNumber: string): Promise<boolean> {
  const row = await queryOne<LaxCardRow>(
    `select id from lax_cards where user_id = $1 and card_number = $2`,
    [userId, cardNumber],
  );
  return Boolean(row);
}

const AccountSchema = z.object({
  address:      z.string().min(1).max(200).optional(),
  referralCode: z.string().min(1).max(64).optional(),
});
const TopupSchema = z.object({
  cardNumber: z.string().min(1).max(64),
  amount:     z.number().positive().finite(),
});
const IssueSchema = z.object({
  amount:   z.number().positive().finite(),
  currency: z.string().min(1).max(16),
  email:    z.string().email(),
});

/** Best-effort card-number extraction from issue-card-api's response — its
 *  shape is documented as a bare "Default Response" in the spec, never
 *  confirmed against a live call (no sandbox exists to check against).
 *  Tries the field names likely to hold it; if none match, the card was
 *  still issued for real (this never blocks the response), it's just not
 *  recorded in lax_cards yet — logged so it can be reconciled manually. */
function extractCardNumber(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const candidates = [o.card_number, o.cardNumber, o.id, o.card_id];
  const nested = o.card && typeof o.card === 'object' ? (o.card as Record<string, unknown>) : null;
  if (nested) candidates.push(nested.card_number, nested.number, nested.id);
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

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

/** GET /lax/status — readiness check for whoever is standing up the
 *  dashboard config (ops, or a future settings screen), without exposing
 *  anything secret. Reveals only which of the four env vars are SET
 *  (never their values) and the two derived booleans every route below
 *  actually branches on — not "is LAX_API_KEY correct," just "is it
 *  present." No auth-gate bypass: still behind requireAuth like the rest
 *  of this router, so this doesn't leak configuration state to anyone
 *  who isn't already a logged-in Thanos user. */
laxRouter.get('/status', async (_req, res: Response) => {
  return res.json({
    configured:           configured(),
    configuredForIssuance: configuredForIssuance(),
    have: {
      apiKey:    Boolean(LAX_API_KEY),
      apiBase:   Boolean(LAX_API_BASE),
      widgetId:  Boolean(LAX_WIDGET_ID),
      productId: Boolean(LAX_PRODUCT_ID),
    },
  });
});

/* POST /lax/account — create account / start registration.
   Body: { address?: string, referralCode?: string }.
   Pre-API: returns the hosted registration URL (with ref/address prefill) so the
   SafePal-style "Next" opens the LAX web flow. Post-API: this maps to the
   physical-card holder-creation flow (POST /api/physical-cards/create-card-holder)
   once we actually collect the KYC fields that endpoint requires (name, DOB,
   address, phone, etc.) — that's a bigger form than a single "create account"
   call, so this route stays on the external hand-off until the client UI for
   that form exists. */
laxRouter.post('/account', async (req, res: Response) => {
  const parse = AccountSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
  const { address, referralCode } = parse.data;
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

/** GET /lax/card/:cardNumber/balance — POST /api/cards/get-card-balance.
 *  404s (not 403 — don't confirm/deny a card number's existence to a
 *  caller who doesn't own it) for any card not recorded as this user's in
 *  lax_cards. LAX's own API has no per-end-user scoping to fall back on. */
laxRouter.get('/card/:cardNumber/balance', async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const owned = await queryOne<LaxCardRow>(
    `select id, user_id, card_number from lax_cards where user_id = $1 and card_number = $2`,
    [userId, req.params.cardNumber],
  );
  if (!owned) return res.status(404).json({ error: 'Card not found' });
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
 *  every one of these calls is a real fund movement from day one.
 *  laxOpLimiter + ownership check on top of the usual validation — this
 *  moves real money with nothing to rehearse it against first. */
laxRouter.post('/card/topup', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const parse = TopupSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
  const { cardNumber, amount } = parse.data;
  const userId = (req as unknown as AuthRequest).userId;
  const owned = await queryOne<LaxCardRow>(
    `select id, user_id, card_number from lax_cards where user_id = $1 and card_number = $2`,
    [userId, cardNumber],
  );
  if (!owned) return res.status(404).json({ error: 'Card not found' });
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
 *  from the integration doc). laxOpLimiter — issuing a card is a real,
 *  no-sandbox fund-adjacent action same as topup. On success, records
 *  (userId, cardNumber) in lax_cards so /balance and /topup above can
 *  enforce ownership on this card going forward. */
laxRouter.post('/card/issue', laxOpLimiter, async (req, res: Response) => {
  if (!configuredForIssuance()) return res.status(503).json({ error: 'LAX card issuance not configured yet (missing widget/product setup)' });
  const parse = IssueSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
  const { amount, currency, email } = parse.data;
  const userId = (req as unknown as AuthRequest).userId;
  try {
    const { status, json } = await laxFetch('/api/cards/issue-card-api', {
      method: 'POST',
      body: JSON.stringify({
        iframe_id:  Number(LAX_WIDGET_ID),
        product_id: Number(LAX_PRODUCT_ID),
        amount, currency, email,
      }),
    });
    if (status >= 200 && status < 300) {
      const cardNumber = extractCardNumber(json);
      if (cardNumber) {
        await query(
          `insert into lax_cards (user_id, card_number, currency, issued_amount) values ($1, $2, $3, $4)
           on conflict (card_number) do nothing`,
          [userId, cardNumber, currency, amount],
        );
      } else {
        // eslint-disable-next-line no-console
        console.error('[lax] issue-card-api succeeded but no recognizable card number field was found in the response — ownership not recorded, reconcile lax_cards manually', { userId, responseKeys: json && typeof json === 'object' ? Object.keys(json) : null });
      }
    }
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/card/:cardNumber/transactions — POST /api/cards/get-card-transactions.
 *  Upstream returns a stringified-JSON blob (text/plain), forwarded as-is;
 *  the client parses. Ownership-gated like the rest. */
laxRouter.get('/card/:cardNumber/transactions', async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const cardNumber = String(req.params.cardNumber);
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/cards/get-card-transactions', {
      method: 'POST', body: JSON.stringify({ card_number: cardNumber }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/card/:cardNumber/details — POST /api/cards/get-card-details.
 *  Sensitive: the spec's response carries expiry + CVC. Ownership-gated AND
 *  laxOpLimiter'd so a compromised session can't scrape card secrets in a
 *  loop. Never logged here. */
laxRouter.get('/card/:cardNumber/details', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const cardNumber = String(req.params.cardNumber);
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/cards/get-card-details', {
      method: 'POST', body: JSON.stringify({ card_number: cardNumber }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** POST /lax/card/:cardNumber/status — freeze / unfreeze. Maps to
 *  POST /api/physical-cards/change-card-status. The spec documents only
 *  `card_number` in the body (no explicit state field), so this forwards
 *  an optional `status` too if the client sends one — to be confirmed
 *  against the live API ("errors we can correct together" — Robert). */
laxRouter.post('/card/:cardNumber/status', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const cardNumber = String(req.params.cardNumber);
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  const { status: desired } = (req.body ?? {}) as { status?: string };
  const body: Record<string, unknown> = { card_number: cardNumber };
  if (typeof desired === 'string' && desired) body.status = desired;
  try {
    const { status, json } = await laxFetch('/api/physical-cards/change-card-status', {
      method: 'POST', body: JSON.stringify(body),
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
