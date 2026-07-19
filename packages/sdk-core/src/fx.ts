/**
 * Display-currency engine — shared by web / desktop / extension so the
 * Settings "Currency" picker actually converts prices instead of only
 * relabeling itself. (Mobile carries a detached copy in apps/mobile/lib/fx.ts
 * — EAS builds can't resolve workspace deps; keep the logic in sync.)
 *
 * All internal values stay USD; conversion happens at FORMAT time via
 * formatFiat(). Clients subscribe to changes and re-render their tree so
 * every price picks up the new rate.
 *
 * Rates: Coinbase public exchange-rates API (keyless) — USD→EUR/GBP/JPY/BTC
 * in one call. Cached in memory + localStorage (1 h TTL; stale beats nothing
 * offline). If a rate can't be resolved the engine falls back to USD rather
 * than showing wrong math.
 */

export const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'LAX'] as const;
export type DisplayCurrency = (typeof FX_CURRENCIES)[number];

/** LAX is a FIXED-PEG display unit, not an FX-market currency: 1 LAX = $1.001
 *  (confirmed by the client, 2026-07-19). It is resolved locally — never
 *  fetched — so it works offline and can never silently fall back to USD. */
const LAX_USD = 1.001;

const PREF_KEY  = 'thanos.pref.currency';
const CACHE_KEY = 'thanos.fx.rates.v1';
const TTL_MS    = 60 * 60_000;

/** `suffix` renders AFTER the number ("99.90 LAX"); `symbol` renders before
 *  ("$99.90"). Mirrors apps/mobile/lib/fx.ts so every client reads the same. */
interface CcyMeta { symbol: string; suffix?: string; decimals: number }
const META: Record<DisplayCurrency, CcyMeta> = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  BTC: { symbol: '₿', decimals: 6 },
  // Ⱡ (U+2C60) — client-specified glyph, prefixed like every other currency:
  // "Ⱡ617,409.88", not "617,409.88 LAX".
  LAX: { symbol: 'Ⱡ', decimals: 2 },
};

let _code: DisplayCurrency = 'USD';
let _rate = 1; // display units per USD
const _subs = new Set<() => void>();

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function getDisplayCurrency(): DisplayCurrency { return _code; }

/** Subscribe to currency changes (returns unsubscribe). Clients bump a
 *  render tick here so every formatFiat() call re-runs with the new rate. */
export function subscribeFx(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}

/** Convert a USD amount into the active display currency as a RAW number.
 *  For callers that need their own precision rules — e.g. sub-dollar token
 *  prices, which formatFiat's fixed 2-dp would flatten to "0.00". */
export function convertFromUsd(nUsd: number): number {
  return (isFinite(nUsd) ? nUsd : 0) * _rate;
}

/** Currency symbol for the active display currency (pairs with convertFromUsd).
 *  Prefer withCurrencyAffix() — this returns '' for suffix currencies (LAX). */
export function currencySymbol(): string {
  return META[_code].symbol;
}

/** Wrap an already-formatted number with the active currency's affix, on the
 *  correct side — "$1,234.00" but "1,234.00 LAX". Use this wherever the caller
 *  needs its own precision (sub-dollar prices, compact 1.2B forms) and so can't
 *  go through formatFiat(). */
export function withCurrencyAffix(formatted: string): string {
  const meta = META[_code];
  return meta.suffix ? `${formatted}${meta.suffix}` : `${meta.symbol}${formatted}`;
}

/** Format a USD amount in the active display currency. */
export function formatFiat(nUsd: number): string {
  const meta = META[_code];
  const v = (isFinite(nUsd) ? nUsd : 0) * _rate;
  const s = v.toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return meta.suffix ? `${s}${meta.suffix}` : `${meta.symbol}${s}`;
}

async function fetchRates(): Promise<Record<string, number> | null> {
  const store = storage();
  try {
    const cached = store?.getItem(CACHE_KEY);
    if (cached) {
      const { at, rates } = JSON.parse(cached) as { at: number; rates: Record<string, number> };
      if (Date.now() - at < TTL_MS) return rates;
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
    if (!res.ok) return staleRates();
    const json = (await res.json()) as { data?: { rates?: Record<string, string> } };
    const raw = json.data?.rates ?? {};
    const rates: Record<string, number> = {};
    for (const k of ['EUR', 'GBP', 'JPY', 'BTC']) {
      const v = parseFloat(raw[k] ?? '');
      if (isFinite(v) && v > 0) rates[k] = v;
    }
    try { store?.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rates })); } catch { /* quota */ }
    return rates;
  } catch {
    return staleRates();
  }
}

/** Expired cache beats no data when the network is down. */
function staleRates(): Record<string, number> | null {
  try {
    const cached = storage()?.getItem(CACHE_KEY);
    if (cached) return (JSON.parse(cached) as { rates: Record<string, number> }).rates;
  } catch { /* nothing usable */ }
  return null;
}

/** Activate a display currency; resolves to what actually took effect
 *  (falls back to USD when the rate can't be resolved — never fake math). */
export async function applyDisplayCurrency(code: DisplayCurrency): Promise<DisplayCurrency> {
  if (code === 'USD') { _code = 'USD'; _rate = 1; }
  // Fixed peg — resolved locally, before the network path.
  else if (code === 'LAX') { _code = 'LAX'; _rate = 1 / LAX_USD; }
  else {
    const rate = (await fetchRates())?.[code];
    if (isFinite(rate as number) && (rate as number) > 0) { _code = code; _rate = rate as number; }
    else { _code = 'USD'; _rate = 1; }
  }
  try { storage()?.setItem(PREF_KEY, _code); } catch { /* best-effort */ }
  for (const fn of _subs) { try { fn(); } catch { /* subscriber's problem */ } }
  return _code;
}

/** Boot: restore the persisted preference and activate it. */
export async function initDisplayCurrency(): Promise<DisplayCurrency> {
  try {
    const saved = storage()?.getItem(PREF_KEY) as DisplayCurrency | null;
    if (saved && (FX_CURRENCIES as readonly string[]).includes(saved) && saved !== 'USD') {
      return await applyDisplayCurrency(saved);
    }
  } catch { /* default */ }
  return 'USD';
}
