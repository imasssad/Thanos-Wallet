/**
 * LAX card client (mobile) — talks to the Thanos backend LAX proxy
 * (services/api/src/routes/lax.ts), never to LAX/FCFpay directly. The
 * partner API key is a server-side secret; the app only ever calls our
 * own backend, and every /lax/* route is behind requireAuth, so a Thanos
 * account (apiClient session) is required — screen 3 of the card flow
 * registers one.
 *
 * NOT LIVE: until LAX_API_BASE / LAX_API_KEY (and, for issuance,
 * LAX_WIDGET_ID / LAX_PRODUCT_ID) are set on the VPS, every configured
 * route returns 503 "LAX not configured yet". isConfigured() /
 * isIssuanceConfigured() below let the UI show the right state instead of
 * dead-ending. Response bodies are undocumented upstream ("Default
 * Response" in the OpenAPI, some are stringified-JSON blobs), so the
 * parse helpers here are deliberately loose.
 */
import { apiClient } from './auth-client';

const LAX_PUBLIC_REGISTER = 'https://lax.money';

/* ── status ─────────────────────────────────────────────────────────── */

export interface LaxStatus {
  configured: boolean;
  configuredForIssuance: boolean;
  have: { apiKey: boolean; apiBase: boolean; widgetId: boolean; productId: boolean };
}

/** GET /lax/status — no secrets, just which env vars are present + the two
 *  derived booleans the routes branch on. Drives "coming soon" vs live UI. */
export async function laxStatus(): Promise<LaxStatus> {
  return apiClient.apiRequest<LaxStatus>('GET', '/lax/status');
}

export async function isConfigured(): Promise<boolean> {
  try { return (await laxStatus()).configured; } catch { return false; }
}
export async function isIssuanceConfigured(): Promise<boolean> {
  try { return (await laxStatus()).configuredForIssuance; } catch { return false; }
}

/* ── account ────────────────────────────────────────────────────────── */

export interface LaxAccountResult {
  /** 'external' = open registrationUrl in the browser; 'native'/'kyc' land with the API. */
  mode?: string;
  registrationUrl?: string;
}

/** Register a Thanos cloud account for this wallet — the identity every
 *  /lax/* call authenticates as. The LAX flow already collects an email
 *  (card issuance needs one); this reuses it. Throws ApiError on a taken
 *  email / weak password so screen 3 can surface it. */
export async function laxRegisterThanosAccount(input: {
  email: string; password: string; displayName?: string;
}): Promise<void> {
  await apiClient.register(input);
}

/** True once this device holds a Thanos session token (post-register /
 *  post-login). Screen 3 skips account creation when this is already true. */
export async function hasThanosAccount(): Promise<boolean> {
  return apiClient.isAuthenticated();
}

/** Legacy external hand-off — POST /lax/account still returns the hosted
 *  lax.money registration URL while native issuance isn't wired. Kept as a
 *  fallback for "Learn more" / the pre-KYC path. */
export async function laxCreateAccount(params: { address?: string; referralCode?: string }): Promise<LaxAccountResult> {
  try {
    return await apiClient.apiRequest<LaxAccountResult>('POST', '/lax/account', params);
  } catch {
    const url = new URL(LAX_PUBLIC_REGISTER);
    if (params.referralCode) url.searchParams.set('ref', params.referralCode);
    return { mode: 'external', registrationUrl: url.toString() };
  }
}

/* ── currencies ─────────────────────────────────────────────────────── */

/** GET /lax/currencies — the tokens/chains active for our LAX account,
 *  pollable, shrinks/grows with dashboard prefs. Shape is upstream's
 *  available_currencies; returned raw for the top-up screen to map. */
export async function laxCurrencies(): Promise<unknown> {
  return apiClient.apiRequest<unknown>('GET', '/lax/currencies');
}

/* ── cards ──────────────────────────────────────────────────────────── */

/** One card as best we can pin it from get-my-cards / our own lax_cards
 *  row. Every field optional — the upstream shape isn't documented. */
export interface LaxCard {
  card_number?: string;
  cardNumber?: string;
  status?: string;
  balance?: number | string;
  currency?: string;
  last4?: string;
  [k: string]: unknown;
}

/** GET /lax/cards — POST /api/cards/get-my-cards upstream. Normalises the
 *  common container shapes ({cards:[…]} / {data:[…]} / bare array). */
export async function laxCards(): Promise<LaxCard[]> {
  const raw = await apiClient.apiRequest<unknown>('GET', '/lax/cards');
  return coerceCardList(raw);
}

/** GET /lax/card/:n/balance — POST /api/cards/get-card-balance upstream. */
export async function laxCardBalance(cardNumber: string): Promise<unknown> {
  return apiClient.apiRequest<unknown>('GET', `/lax/card/${encodeURIComponent(cardNumber)}/balance`);
}

/** GET /lax/card/:n/transactions — upstream returns a stringified-JSON
 *  blob; parseTxBlob() unwraps it best-effort. */
export async function laxCardTransactions(cardNumber: string): Promise<LaxTxn[]> {
  const raw = await apiClient.apiRequest<unknown>('GET', `/lax/card/${encodeURIComponent(cardNumber)}/transactions`);
  return parseTxBlob(raw);
}

export interface LaxCardDetails {
  status?: string;
  expMonth?: string;
  expYear?: string;
  cvc?: string | number;
  pan?: string;
  cardholderName?: string;
  [k: string]: unknown;
}

/** GET /lax/card/:n/details — expiry + CVC (+ maybe PAN). Sensitive:
 *  never persist the result, clear it from state on unmount. */
export async function laxCardDetails(cardNumber: string): Promise<LaxCardDetails> {
  const raw = await apiClient.apiRequest<unknown>('GET', `/lax/card/${encodeURIComponent(cardNumber)}/details`);
  return coerceDetails(raw);
}

/** POST /lax/card/topup — { cardNumber, amount }. Maps to
 *  load-virtual-card. NO SANDBOX: a real fund movement from day one. */
export async function laxTopUp(input: { cardNumber: string; amount: number }): Promise<unknown> {
  return apiClient.apiRequest<unknown>('POST', '/lax/card/topup', input);
}

/** POST /lax/card/issue — { amount, currency, email }. iframe_id +
 *  product_id are injected server-side. 503s until issuance is configured
 *  (isIssuanceConfigured()). */
export async function laxIssueCard(input: { amount: number; currency: string; email: string }): Promise<unknown> {
  return apiClient.apiRequest<unknown>('POST', '/lax/card/issue', input);
}

/** POST /lax/card/:n/status — freeze / unfreeze. `status` shape is
 *  unconfirmed upstream; send what the backend forwards. */
export async function laxSetCardStatus(cardNumber: string, status: 'active' | 'frozen' | string): Promise<unknown> {
  return apiClient.apiRequest<unknown>('POST', `/lax/card/${encodeURIComponent(cardNumber)}/status`, { status });
}

/* ── loose parse helpers ────────────────────────────────────────────── */

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function coerceCardList(raw: unknown): LaxCard[] {
  if (Array.isArray(raw)) return raw as LaxCard[];
  const o = asObj(raw);
  if (!o) return [];
  for (const k of ['cards', 'data', 'result', 'items']) {
    if (Array.isArray(o[k])) return o[k] as LaxCard[];
  }
  // { success, cards: {…single…} }
  const single = asObj(o.cards) ?? asObj(o.data);
  return single ? [single as LaxCard] : [];
}

function coerceDetails(raw: unknown): LaxCardDetails {
  const o = asObj(raw);
  const src = asObj(o?.cards) ?? asObj(o?.data) ?? o ?? {};
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = src[k];
      if (v != null && v !== '') return String(v);
    }
    return undefined;
  };
  return {
    status:         pick('status', 'Status'),
    expMonth:       pick('ExpMonth', 'expMonth', 'exp_month'),
    expYear:        pick('ExpYear', 'expYear', 'exp_year'),
    cvc:            pick('cvc', 'cvv', 'CVC', 'CVV'),
    pan:            pick('pan', 'PAN', 'card_number', 'cardNumber', 'number'),
    cardholderName: pick('cardholder_name', 'cardholderName', 'name'),
  };
}

export interface LaxTxn {
  id?: string;
  merchant?: string;
  amount?: number;
  currency?: string;
  date?: string;
  type?: string;
  raw?: unknown;
}

/** get-card-transactions comes back as text/plain containing (often
 *  double-escaped) JSON. Peel it apart without throwing — return [] on any
 *  shape we don't recognise. */
function parseTxBlob(raw: unknown): LaxTxn[] {
  let val: unknown = raw;
  for (let i = 0; i < 3 && typeof val === 'string'; i++) {
    try { val = JSON.parse(val); } catch { break; }
  }
  const o = asObj(val);
  const data = asObj(o?.data) ?? o;
  const txns = data?.transactions ?? data?.txns ?? data?.items;
  const list: unknown[] = Array.isArray(txns)
    ? txns
    : asObj(txns)
      ? Object.values(txns as Record<string, unknown>)
      : [];
  return list.map((t) => {
    let e: unknown = t;
    if (typeof e === 'string') { try { e = JSON.parse(e); } catch { /* keep string */ } }
    const r = asObj(e);
    if (!r) return { raw: t };
    const num = (k: string) => {
      const n = Number(r[k]);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      id:       (r['Transaction ID'] ?? r['transaction_id'] ?? r['id']) as string | undefined,
      merchant: (r['Merchant Name'] ?? r['Merchant Name who Charged card'] ?? r['merchant'] ?? r['description']) as string | undefined,
      amount:   num('Transaction Amount') ?? num('Amount') ?? num('amount'),
      currency: (r['Merchant Currency'] ?? r['currency']) as string | undefined,
      date:     (r['Transaction Date'] ?? r['Trans DateTime'] ?? r['date']) as string | undefined,
      type:     (r['Trans Type'] ?? r['Transaction Type'] ?? r['type']) as string | undefined,
      raw:      e,
    };
  });
}

/** card_number of a card object regardless of key spelling. */
export function cardNumberOf(c: LaxCard): string | undefined {
  return (c.card_number ?? c.cardNumber ?? c.number ?? (typeof c.last4 === 'string' ? undefined : undefined)) as string | undefined;
}
