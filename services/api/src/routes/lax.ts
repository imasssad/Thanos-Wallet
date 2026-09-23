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
 *   - Project 612 (LAX Card) has NO Virtual Cards dashboard section — ops
 *     confirmed 2026-09-18. Live card ops therefore use
 *     `/api/physical-cards/*` (balance/load/transactions/view/status), not
 *     `/api/cards/*` virtual issue/load. Instant virtual `issue-card-api`
 *     (iframe_id + product_id) is not available for this project.
 *   - Active tokens/chains: `GET /api/general/available_currencies` from
 *     dash.zypto.com/docs/cards — must be re-checked at least once per 24h
 *     (list shrinks/grows with dashboard prefs). Cached server-side 24h.
 *   - NO SANDBOX EXISTS (confirmed by Robert). Every call below hits real
 *     production the moment it's configured — there's no dry-run environment
 *     to catch mistakes first.
 *
 * STATUS: Until LAX_API_BASE + LAX_API_KEY are configured the routes degrade
 * safely:
 *   • POST /lax/account → hosted registration URL (lax.money).
 *   • the rest return 503 "LAX not configured yet".
 * Native one-shot card issuance stays off (`configuredForIssuance: false`)
 * until the physical create-card-holder + KYC flow is wired — Project 612
 * has no virtual-card product picker.
 *
 * WEBHOOKS: laxWebhookRouter (mounted at /lax-webhook) requires
 * LAX_WEBHOOK_SECRET. Configure dash.zypto.com/webhooks →
 * https://<api-host>/lax-webhook.
 *
 * ENV (set on the VPS `.env`, gitignored — NEVER commit the value):
 *   LAX_API_KEY     — partner secret from Project List → "Get api key"
 *   LAX_API_BASE    — dashboard root / project API base (https)
 *   LAX_PROJECT_ID  — dashboard Project id (612 for LAX Card) — informational
 *                     / status flag; the Bearer key already scopes the merchant
 *   LAX_WEBHOOK_SECRET — shared secret for /lax-webhook
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
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { laxOpLimiter } from '../middleware/rate-limit.js';

const LAX_API_KEY    = process.env.LAX_API_KEY    ?? '';
const LAX_API_BASE   = process.env.LAX_API_BASE   ?? '';
/** Dashboard Project id for LAX Card — confirmed 612. Not sent on every
 *  upstream call (Bearer key scopes the merchant); exposed via /lax/status. */
const LAX_PROJECT_ID = process.env.LAX_PROJECT_ID ?? '';
const LAX_WEBHOOK_SECRET = process.env.LAX_WEBHOOK_SECRET ?? '';
const LAX_PUBLIC_REGISTER = 'https://lax.money';
const LAX_REQUEST_TIMEOUT_MS = 15_000;
const CURRENCIES_TTL_MS = 24 * 60 * 60 * 1000;

export const laxRouter = Router();
laxRouter.use(requireAuth);

/** True once the key and base URL are configured — enough for currencies,
 *  balance, top-up, transactions (physical-cards namespace). */
function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

const configured = (): boolean => Boolean(LAX_API_KEY && validBaseUrl(LAX_API_BASE));
const projectConfigured = (): boolean => /^\d+$/.test(LAX_PROJECT_ID) && Number(LAX_PROJECT_ID) > 0;
/** Instant native issuance is OFF for Project 612 — no Virtual Cards
 *  dashboard / product_id. Physical issuance needs create-card-holder + KYC
 *  (not wired yet). Keep false so clients show the external / coming-soon
 *  path instead of calling POST /lax/card/issue. */
const configuredForIssuance = (): boolean => false;

interface CurrenciesCache { at: number; status: number; json: unknown }
let currenciesCache: CurrenciesCache | null = null;

/** Prefer entries marked enabled_on_account when the upstream shape includes it. */
function filterEnabledCurrencies(json: unknown): unknown {
  const pickList = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['data', 'currencies', 'items', 'result', 'message']) {
        if (Array.isArray(o[k])) return o[k] as unknown[];
      }
    }
    return null;
  };
  const list = pickList(json);
  if (!list) return json;
  const hasFlag = list.some(
    (row) => row && typeof row === 'object' && 'enabled_on_account' in (row as object),
  );
  if (!hasFlag) return json;
  const enabled = list.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    return Boolean((row as Record<string, unknown>).enabled_on_account);
  });
  if (Array.isArray(json)) return enabled;
  const o = { ...(json as Record<string, unknown>) };
  for (const k of ['data', 'currencies', 'items', 'result', 'message']) {
    if (Array.isArray(o[k])) {
      o[k] = enabled;
      return o;
    }
  }
  return enabled;
}

interface FetchOpts { method?: string; body?: string; headers?: Record<string, string> }

interface LaxCardRow { id: string; user_id: string; card_number: string }
interface LaxHolderRow { id?: string; user_id?: string; holder_id: string; status?: string | null; created_at?: string; updated_at?: string }

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
// LAX's own spec (docs/integrations/reference/zypto-fcfpay-openapi.yaml):
// amount "must match /^\d+(\.\d{1,2})?$/, must be at least 20" on both
// load-virtual-card and issue-card-api. Without this floor specifically, a
// sub-$20 request still round-trips to real production (no sandbox) before
// LAX rejects it, surfacing a raw upstream error instead of an immediate
// client-side message. (The spec ALSO claims card_number "must not be
// greater than 20 characters" right next to an example value that is
// itself 43 characters — a self-contradiction in LAX's own doc, so that
// one constraint is deliberately NOT tightened here; the existing 64-char
// cap stays as the safer, more permissive bound.)
const hasAtMost2Decimals = (v: number) => Number(v.toFixed(2)) === v;
const laxAmount = z.number().positive().finite().min(20, 'Minimum amount is 20').max(100_000)
  .refine(hasAtMost2Decimals, 'Amount may have at most 2 decimal places');
const TopupSchema = z.object({
  cardNumber: z.string().trim().regex(/^[A-Za-z0-9_-]{3,64}$/),
  amount:     laxAmount,
  currency:   z.string().trim().regex(/^[A-Za-z0-9_.-]{1,32}$/).transform(v => v.toUpperCase()).optional(),
});
const IssueSchema = z.object({
  amount:   laxAmount,
  currency: z.string().trim().regex(/^[A-Za-z0-9_-]{1,16}$/).transform(v => v.toUpperCase()),
  email:    z.string().trim().email().max(254),
});
const CardNumberSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,64}$/);
const CardStatusSchema = z.object({ status: z.enum(['active', 'frozen']) });
const HolderSchema = z.object({
  name: z.string().trim().min(3).max(22),
  NFT_holder: z.number().int().min(0).max(1).default(0),
  Card_color: z.enum(['Mirror black', 'Brushed black', 'Brushed red', 'Brushed green', 'Matte black (stainless)', 'Matte black (gold)', 'Matte white', '24karat mirror gold']).default('Matte black (stainless)'),
  firstName: z.string().trim().min(1).max(22), lastName: z.string().trim().min(1).max(22),
  address_line1: z.string().trim().min(3).max(200), city: z.string().trim().min(3).max(100),
  state: z.string().trim().min(2).max(2), country: z.string().trim().min(2).max(3),
  zip: z.string().trim().min(3).max(20), phone: z.string().trim().regex(/^\+?[0-9]{9,15}$/),
  email: z.string().trim().email().max(254), cellPhoneNumber: z.string().trim().regex(/^\+?[0-9]{9,15}$/),
  callingCode: z.string().trim().regex(/^[0-9]{3}$/), countryCallingCode: z.string().trim().min(2).max(2),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), genderId: z.number().int().min(0).max(1),
});
const HolderIdSchema = z.object({ holderId: z.string().trim().min(1).max(128) });
const PinSchema = z.object({ PIN: z.string().regex(/^\d{4,6}$/) });

/** Proxy helper — attaches the secret key to a LAX/FCFpay API call.
 *  Authorization: Bearer <key> — confirmed from the real OpenAPI spec. */
async function laxFetch(path: string, opts: FetchOpts = {}): Promise<{ status: number; json: unknown }> {
  if (!configured() || !path.startsWith('/api/') || path.includes('://') || path.includes('..')) {
    throw new Error('Invalid LAX upstream configuration or path');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAX_REQUEST_TIMEOUT_MS);
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${LAX_API_BASE.replace(/\/$/, '')}${path}`, {
    method:  opts.method ?? 'GET',
    body:    opts.body,
    signal:  controller.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${LAX_API_KEY}`,
      ...(opts.headers ?? {}),
    },
    });
  } finally { clearTimeout(timer); }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON upstream */ }
  return { status: res.status, json };
}

/** GET /lax/status — readiness check without exposing secrets. */
laxRouter.get('/status', async (_req, res: Response) => {
  return res.json({
    configured:            configured(),
    configuredForIssuance: configuredForIssuance(),
    projectId:             projectConfigured() ? Number(LAX_PROJECT_ID) : null,
    have: {
      apiKey:    Boolean(LAX_API_KEY),
      apiBase:   validBaseUrl(LAX_API_BASE),
      projectId: projectConfigured(),
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

function findProviderId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  for (const key of ['cardHolderID', 'card_holder_id', 'holder_id', 'holderId', 'id']) {
    if (typeof o[key] === 'string' || typeof o[key] === 'number') return String(o[key]);
  }
  for (const key of ['data', 'result', 'message']) {
    const found = findProviderId(o[key]);
    if (found) return found;
  }
  return undefined;
}

async function ownedHolder(userId: string, holderId: string): Promise<boolean> {
  return Boolean(await queryOne<LaxHolderRow>(
    `select id from lax_card_holders where user_id = $1 and holder_id = $2`, [userId, holderId],
  ));
}

/** Create the provider card-holder identity used by the physical-card KYC flow. */
laxRouter.post('/physical/holder', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const parsed = HolderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const userId = (req as unknown as AuthRequest).userId;
  const existing = await queryOne<LaxHolderRow>(`select id, user_id, holder_id, status from lax_card_holders where user_id = $1`, [userId]);
  if (existing) return res.status(200).json({ holderId: existing.holder_id, status: existing.status ?? 'created', existing: true });
  try {
    const upstream = await laxFetch('/api/physical-cards/create-card-holder', { method: 'POST', body: JSON.stringify(parsed.data) });
    if (upstream.status < 200 || upstream.status >= 300) return res.status(upstream.status).json(upstream.json);
    const holderId = findProviderId(upstream.json);
    if (!holderId) return res.status(502).json({ error: 'LAX did not return a card-holder id' });
    await query(`insert into lax_card_holders (user_id, holder_id, status) values ($1, $2, $3) on conflict (user_id) do update set holder_id = excluded.holder_id, status = excluded.status`, [userId, holderId, 'created']);
    return res.status(201).json({ holderId, status: 'created' });
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
});

laxRouter.get('/physical/holder', async (req, res: Response) => {
  const userId = (req as unknown as AuthRequest).userId;
  const holder = await queryOne<LaxHolderRow>(`select holder_id, status, created_at, updated_at from lax_card_holders where user_id = $1`, [userId]);
  return res.json(holder ? { holderId: holder.holder_id, status: holder.status, createdAt: holder.created_at, updatedAt: holder.updated_at } : null);
});

/** Forward a holder's hosted KYC start and issuer submission, ownership-scoped. */
laxRouter.post('/physical/kyc/start', laxOpLimiter, async (req, res: Response) => {
  const parsed = HolderIdSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'holderId is required' });
  const userId = (req as unknown as AuthRequest).userId;
  if (!(await ownedHolder(userId, parsed.data.holderId))) return res.status(404).json({ error: 'Card holder not found' });
  try {
    const upstream = await laxFetch('/api/physical-cards/send-kyc', { method: 'POST', body: JSON.stringify({ card_holder_id: parsed.data.holderId }) });
    return res.status(upstream.status).json(upstream.json);
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
});

laxRouter.post('/physical/submit', laxOpLimiter, async (req, res: Response) => {
  const parsed = HolderIdSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'holderId is required' });
  const userId = (req as unknown as AuthRequest).userId;
  if (!(await ownedHolder(userId, parsed.data.holderId))) return res.status(404).json({ error: 'Card holder not found' });
  try {
    const upstream = await laxFetch('/api/physical-cards/submit_to_issuer', { method: 'POST', body: JSON.stringify({ card_holder_id: parsed.data.holderId }) });
    if (upstream.status >= 200 && upstream.status < 300) await query(`update lax_card_holders set status = $1 where user_id = $2 and holder_id = $3`, ['submitted', userId, parsed.data.holderId]);
    return res.status(upstream.status).json(upstream.json);
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
});

/** GET /lax/currencies — dash.zypto.com/docs/cards → available_currencies.
 *  Must be re-checked at least once per 24h (partner requirement). Server
 *  caches successful responses for 24h; serves stale cache on upstream failure. */
laxRouter.get('/currencies', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  if (currenciesCache && Date.now() - currenciesCache.at < CURRENCIES_TTL_MS) {
    return res.status(currenciesCache.status).json(currenciesCache.json);
  }
  try {
    const { status, json } = await laxFetch('/api/general/available_currencies');
    if (status >= 200 && status < 300) {
      const filtered = filterEnabledCurrencies(json);
      currenciesCache = { at: Date.now(), status, json: filtered };
      return res.status(status).json(filtered);
    }
    if (currenciesCache) return res.status(currenciesCache.status).json(currenciesCache.json);
    return res.status(status).json(json);
  } catch {
    if (currenciesCache) return res.status(currenciesCache.status).json(currenciesCache.json);
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/cards — Project 612 has no virtual get-my-cards surface.
 *  Source of truth is this caller's `lax_cards` rows only (never the full
 *  merchant cardholder list). Physical enrich (view-card) is per-card on
 *  demand via /lax/card/:n/details. */
laxRouter.get('/cards', async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  try {
    const ownedRows = await query<{ card_number: string; currency: string | null }>(
      `select card_number, currency from lax_cards where user_id = $1 order by created_at desc`,
      [userId],
    );
    return res.status(200).json({
      cards: ownedRows.map((r) => ({
        card_number: r.card_number,
        currency: r.currency ?? undefined,
      })),
    });
  } catch {
    return res.status(502).json({ error: 'LAX card lookup failed' });
  }
});

/** GET /lax/card/:cardNumber/balance — physical get-balance. */
laxRouter.get('/card/:cardNumber/balance', async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const cardParse = CardNumberSchema.safeParse(req.params.cardNumber);
  if (!cardParse.success) return res.status(404).json({ error: 'Card not found' });
  const userId = (req as unknown as AuthRequest).userId;
  const owned = await queryOne<LaxCardRow>(
    `select id, user_id, card_number from lax_cards where user_id = $1 and card_number = $2`,
    [userId, cardParse.data],
  );
  if (!owned) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/physical-cards/get-balance', {
      method: 'POST', body: JSON.stringify({ card_number: cardParse.data }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** POST /lax/card/topup — physical load. NO SANDBOX — real funds. */
laxRouter.post('/card/topup', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const parse = TopupSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    const { cardNumber, amount, currency } = parse.data;
  const userId = (req as unknown as AuthRequest).userId;
  const owned = await queryOne<LaxCardRow>(
    `select id, user_id, card_number from lax_cards where user_id = $1 and card_number = $2`,
    [userId, cardNumber],
  );
  if (!owned) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/physical-cards/load', {
      method: 'POST', body: JSON.stringify({ card_number: cardNumber, amount, ...(currency ? { currency } : {}) }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** POST /lax/card/issue — not available for Project 612 (no Virtual Cards
 *  product). Physical issuance is create-card-holder + KYC + assign/activate,
 *  which is a separate flow still using the external hand-off. */
laxRouter.post('/card/issue', laxOpLimiter, async (req, res: Response) => {
  const parse = IssueSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
  return res.status(501).json({
    error: 'Native card issuance is not available for this LAX project',
    detail: 'Project 612 has no Virtual Cards API / product_id. Use physical card-holder KYC (hosted redirect) or wait for the native physical onboarding flow.',
    projectId: projectConfigured() ? Number(LAX_PROJECT_ID) : null,
  });
});

/** GET /lax/card/:cardNumber/transactions — POST /api/cards/get-card-transactions.
 *  Upstream returns a stringified-JSON blob (text/plain), forwarded as-is;
 *  the client parses. Ownership-gated like the rest. */
laxRouter.get('/card/:cardNumber/transactions', async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const cardNumber = String(req.params.cardNumber);
  if (!CardNumberSchema.safeParse(cardNumber).success) return res.status(404).json({ error: 'Card not found' });
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/physical-cards/get-transactions-current-month', {
      method: 'POST', body: JSON.stringify({ card_number: cardNumber }),
    });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/** GET /lax/card/:cardNumber/details — physical view-card. Ownership-gated
 *  + laxOpLimiter'd. Never logged here. */
laxRouter.get('/card/:cardNumber/details', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const userId = (req as unknown as AuthRequest).userId;
  const cardNumber = String(req.params.cardNumber);
  if (!CardNumberSchema.safeParse(cardNumber).success) return res.status(404).json({ error: 'Card not found' });
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const { status, json } = await laxFetch('/api/physical-cards/view-card', {
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
  if (!CardNumberSchema.safeParse(cardNumber).success) return res.status(404).json({ error: 'Card not found' });
  if (!(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  const parsed = CardStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'status must be active or frozen' });
  const desired = parsed.data.status;
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

/** Physical-card PIN operations are provider-backed and never persisted by Thanos. */
laxRouter.get('/card/:cardNumber/pin', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const cardNumber = String(req.params.cardNumber);
  const userId = (req as unknown as AuthRequest).userId;
  if (!CardNumberSchema.safeParse(cardNumber).success || !(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const upstream = await laxFetch('/api/physical-cards/get-pin', { method: 'POST', body: JSON.stringify({ card_number: cardNumber }) });
    return res.status(upstream.status).json(upstream.json);
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
});

laxRouter.post('/card/:cardNumber/pin', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const cardNumber = String(req.params.cardNumber);
  const userId = (req as unknown as AuthRequest).userId;
  const parsed = PinSchema.safeParse(req.body ?? {});
  if (!CardNumberSchema.safeParse(cardNumber).success || !(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  if (!parsed.success) return res.status(400).json({ error: 'PIN must contain 4 to 6 digits' });
  try {
    const upstream = await laxFetch('/api/physical-cards/set-pin', { method: 'POST', body: JSON.stringify({ card_number: cardNumber, PIN: parsed.data.PIN }) });
    return res.status(upstream.status).json(upstream.json);
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
});

laxRouter.post('/card/:cardNumber/activate', laxOpLimiter, async (req, res: Response) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  const cardNumber = String(req.params.cardNumber);
  const userId = (req as unknown as AuthRequest).userId;
  if (!CardNumberSchema.safeParse(cardNumber).success || !(await ownsCard(userId, cardNumber))) return res.status(404).json({ error: 'Card not found' });
  try {
    const upstream = await laxFetch('/api/physical-cards/activate-card', { method: 'POST', body: JSON.stringify({ card_number: cardNumber }) });
    return res.status(upstream.status).json(upstream.json);
  } catch { return res.status(502).json({ error: 'LAX upstream unreachable' }); }
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

/* ── webhook receiver ─────────────────────────────────────────────────
 * Separate router — Zypto's servers calling in have no Thanos session, so
 * this can't sit behind laxRouter's requireAuth (or under the /lax mount
 * at all). Mounted at /lax-webhook in app.ts.
 *
 * Auth: shared secret via `x-lax-webhook-secret` or `Authorization: Bearer`
 * (LAX_WEBHOOK_SECRET). Unset secret → 503; wrong secret → 401 with a
 * timing-safe compare. Zypto has not documented an HMAC scheme yet; swap
 * this for their real signature check when they publish one.
 *
 * Event names/payload shapes are dashboard-configured
 * (dash.zypto.com/webhooks) and not in the OpenAPI spec — unrecognized
 * payloads are still accepted and logged to lax_webhook_events (migration
 * 003) for reconciliation, with a fast 200 so senders don't retry-storm.
 */
export const laxWebhookRouter = Router();

laxWebhookRouter.post('/', async (req, res: Response) => {
  if (!LAX_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook authentication is not configured' });
  const supplied = String(req.headers['x-lax-webhook-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(LAX_WEBHOOK_SECRET);
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Best-effort field extraction — webhook payload shapes are unconfirmed.
  const eventType =
    (typeof body.event === 'string' && body.event) ||
    (typeof body.event_type === 'string' && body.event_type) ||
    (typeof body.type === 'string' && body.type) ||
    null;
  const cardNumber =
    (typeof body.card_number === 'string' && body.card_number) ||
    (typeof body.cardNumber === 'string' && body.cardNumber) ||
    null;
  try {
    await query(
      `insert into lax_webhook_events (event_type, card_number, payload) values ($1, $2, $3)`,
      [eventType, cardNumber, JSON.stringify(body)],
    );
  } catch (e) {
    // Never fail the webhook response over our own logging — log server-side
    // and still ack, so Zypto doesn't retry-storm us over a DB hiccup.
    // eslint-disable-next-line no-console
    console.error('[lax] failed to persist webhook event', e);
  }
  return res.status(200).json({ received: true });
});
