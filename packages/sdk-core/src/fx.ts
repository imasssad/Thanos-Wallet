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

export const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'BTC'] as const;
export type DisplayCurrency = (typeof FX_CURRENCIES)[number];

const PREF_KEY  = 'thanos.pref.currency';
const CACHE_KEY = 'thanos.fx.rates.v1';
const TTL_MS    = 60 * 60_000;

interface CcyMeta { symbol: string; decimals: number }
const META: Record<DisplayCurrency, CcyMeta> = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  BTC: { symbol: '₿', decimals: 6 },
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

/** Format a USD amount in the active display currency. */
export function formatFiat(nUsd: number): string {
  const meta = META[_code];
  const v = (isFinite(nUsd) ? nUsd : 0) * _rate;
  return meta.symbol + v.toLocaleString('en-US', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
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
