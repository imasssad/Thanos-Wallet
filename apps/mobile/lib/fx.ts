/**
 * Display-currency engine — makes the Settings "Display currency" picker
 * actually convert prices instead of only relabeling itself.
 *
 * All internal values stay USD (the price pipeline is unchanged);
 * conversion happens at FORMAT time via formatUsd(), which reads the
 * module-level state configured here. The root shell holds the selected
 * code in React state, so changing currency re-renders the whole tree and
 * every formatUsd() call picks up the new rate — same pattern as theme.
 *
 * Rates: Coinbase public exchange-rates API (no key) gives USD→fiat and
 * USD→BTC in one call; LAX comes from the app's own ecosystem pricing
 * (1 / LAX-USD). Rates cache in memory + AsyncStorage (1 h TTL) so the
 * picker works offline with last-known rates; with no rate available the
 * app falls back to plain USD formatting rather than showing wrong math.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchEcosystemPrices } from './pricing';

export const PREF_DISPLAY_CCY = 'thanos.pref.currency';
const RATES_CACHE_KEY = 'thanos.fx.rates.v1';
const RATES_TTL_MS = 60 * 60_000;

export const CURRENCY_OPTS = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'LAX'] as const;
export type DisplayCurrency = (typeof CURRENCY_OPTS)[number];

interface CcyMeta { symbol: string; suffix?: string; decimals: number }
const META: Record<DisplayCurrency, CcyMeta> = {
  USD: { symbol: '$',  decimals: 2 },
  EUR: { symbol: '€',  decimals: 2 },
  GBP: { symbol: '£',  decimals: 2 },
  JPY: { symbol: '¥',  decimals: 0 },
  BTC: { symbol: '₿',  decimals: 6 },
  // Ⱡ (U+2C60) — client-specified glyph, prefixed like every other currency:
  // "Ⱡ617,409.88", not "617,409.88 LAX".
  LAX: { symbol: 'Ⱡ',  decimals: 2 },
};

/* Module state read by formatUsd() on every render. */
let _code: DisplayCurrency = 'USD';
let _rate = 1; // display units per USD

export function getDisplayCurrency(): DisplayCurrency { return _code; }

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
  try {
    const cached = await AsyncStorage.getItem(RATES_CACHE_KEY);
    if (cached) {
      const { at, rates } = JSON.parse(cached) as { at: number; rates: Record<string, number> };
      if (Date.now() - at < RATES_TTL_MS) return rates;
    }
  } catch { /* fall through to network */ }
  try {
    const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
    if (!res.ok) return await staleRates();
    const json = (await res.json()) as { data?: { rates?: Record<string, string> } };
    const raw = json.data?.rates ?? {};
    const rates: Record<string, number> = {};
    for (const k of ['EUR', 'GBP', 'JPY', 'BTC']) {
      const v = parseFloat(raw[k] ?? '');
      if (isFinite(v) && v > 0) rates[k] = v;
    }
    // LAX: display units per USD = 1 / (USD per LAX), from our own pricing.
    try {
      const prices = await fetchEcosystemPrices();
      const laxUsd = prices['LAX'];
      if (isFinite(laxUsd) && laxUsd > 0) rates['LAX'] = 1 / laxUsd;
    } catch { /* LAX simply unavailable */ }
    void AsyncStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ at: Date.now(), rates })).catch(() => {});
    return rates;
  } catch {
    return await staleRates();
  }
}

/** Expired cache beats no data when the network is down. */
async function staleRates(): Promise<Record<string, number> | null> {
  try {
    const cached = await AsyncStorage.getItem(RATES_CACHE_KEY);
    if (cached) return (JSON.parse(cached) as { rates: Record<string, number> }).rates;
  } catch { /* nothing usable */ }
  return null;
}

/** Activate a display currency. Resolves its rate (fetching if needed);
 *  falls back to USD when the rate can't be resolved — never fake math. */
export async function applyDisplayCurrency(code: DisplayCurrency): Promise<DisplayCurrency> {
  if (code === 'USD') { _code = 'USD'; _rate = 1; return _code; }
  const rates = await fetchRates();
  const rate = rates?.[code];
  if (isFinite(rate as number) && (rate as number) > 0) {
    _code = code; _rate = rate as number;
  } else {
    _code = 'USD'; _rate = 1;
  }
  return _code;
}

/** Boot: restore the persisted preference and activate it. */
export async function initDisplayCurrency(): Promise<DisplayCurrency> {
  try {
    const saved = (await AsyncStorage.getItem(PREF_DISPLAY_CCY)) as DisplayCurrency | null;
    if (saved && CURRENCY_OPTS.includes(saved)) return await applyDisplayCurrency(saved);
  } catch { /* default */ }
  return 'USD';
}

export async function persistDisplayCurrency(code: DisplayCurrency): Promise<void> {
  try { await AsyncStorage.setItem(PREF_DISPLAY_CCY, code); } catch { /* best-effort */ }
}
