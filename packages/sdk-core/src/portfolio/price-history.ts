/**
 * Portfolio value history — shared across all clients (web, desktop,
 * extension, mobile-via-copy). Powers the dashboard portfolio chart.
 *
 * Reality check: only holdings whose symbol is in COINGECKO_IDS have a
 * live price feed. The core Lithosphere ecosystem tokens (LITHO, JOT,
 * IMAGE, LAX) use hard / placeholder prices that don't move, so there is
 * no real history to plot for them. Rather than fabricate a curve we plot
 * the REAL CoinGecko history for tracked coins and hold the placeholder-
 * priced tokens flat at their current price. A portfolio with no tracked
 * coins therefore renders an honest flat line.
 *
 *   value(t) = Σ_holdings qty × price(sym, t)
 *     - tracked sym:  real CoinGecko price at t
 *     - untracked sym: current price (constant baseline)
 *
 * Uses the global `fetch` (Node 18+, Electron, RN, browsers all provide it).
 */
import { COINGECKO_IDS } from '../tokens/pricing';

export type Range = '7d' | '30d';

export interface Holding {
  sym: string;
  /** Token quantity held (not USD). */
  qty: number;
  /** Current USD value of the holding (qty × current price). */
  usd: number;
}

export interface PortfolioHistory {
  /** Evenly-spaced portfolio USD values across the range. */
  points: number[];
  /** (last − first) / first, as a fraction (e.g. 0.05 = +5%). */
  changePct: number;
  /** True when at least one holding had real CoinGecko history. */
  hasRealData: boolean;
}

const POINTS = 40;
const CACHE_TTL_MS = 10 * 60_000;
const rangeDays: Record<Range, number> = { '7d': 7, '30d': 30 };

const seriesCache = new Map<string, { at: number; series: number[] }>();

/** Evenly sample `n` values from an array by index (linear interpolation). */
function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  if (values.length === 1) return new Array(n).fill(values[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    out.push(values[lo] * (1 - frac) + values[hi] * frac);
  }
  return out;
}

async function fetchCoinSeries(id: string, days: number): Promise<number[] | null> {
  const key = `${id}:${days}`;
  const hit = seriesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.series;
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
      `/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const prices: [number, number][] = json?.prices ?? [];
    if (prices.length === 0) return null;
    const series = resample(prices.map((p) => p[1]), POINTS);
    seriesCache.set(key, { at: Date.now(), series });
    return series;
  } catch {
    return null;
  }
}

/**
 * Build the portfolio value series for the given holdings and range.
 * Tracked coins contribute their real CoinGecko curve; everything else
 * contributes a flat baseline at its current value.
 */
export async function fetchPortfolioHistory(
  holdings: Holding[],
  range: Range,
): Promise<PortfolioHistory> {
  const days = rangeDays[range];
  const sum = new Array(POINTS).fill(0);
  let hasRealData = false;

  await Promise.all(
    holdings.map(async (h) => {
      if (h.qty <= 0 || h.usd <= 0) return;
      const id = COINGECKO_IDS[h.sym];
      const currentPrice = h.usd / h.qty;
      const series = id ? await fetchCoinSeries(id, days) : null;
      if (series) {
        hasRealData = true;
        for (let i = 0; i < POINTS; i++) sum[i] += series[i] * h.qty;
      } else {
        for (let i = 0; i < POINTS; i++) sum[i] += currentPrice * h.qty;
      }
    }),
  );

  const first = sum[0] || 0;
  const last = sum[POINTS - 1] || 0;
  const changePct = first > 0 ? (last - first) / first : 0;
  return { points: sum, changePct, hasRealData };
}

/** Number of points returned by fetchPortfolioHistory (for chart sizing). */
export const PORTFOLIO_HISTORY_POINTS = POINTS;

/* ─── Single-token history (token detail screen) ─────────────────────── */

/** Token-detail chart ranges. 'all' is capped at 365 days — CoinGecko's
 *  keyless public API rejects `days=max` (401, paid-tier only). */
export type TokenRange = '1d' | '1w' | '1m' | '3m' | '1y' | 'all';

const tokenRangeDays: Record<TokenRange, number> = {
  '1d': 1, '1w': 7, '1m': 30, '3m': 90, '1y': 365, all: 365,
};

export interface TokenHistory {
  /** [timestampMs, usdPrice] pairs, resampled to a fixed point count. */
  prices: Array<[number, number]>;
  /** (last − first) / first, as a fraction. */
  changePct: number;
  /** False for tokens with no CoinGecko feed (Litho ecosystem) — the
   *  caller should render an honest empty/flat state, not a fake curve. */
  hasRealData: boolean;
  /** True when the symbol HAS a feed but the fetch failed (rate limit /
   *  network). Callers should show a "try again" state — NOT the
   *  no-feed copy, which would misdescribe BTC as feedless. */
  failed?: boolean;
}

const tokenSeriesCache = new Map<string, { at: number; hist: TokenHistory }>();

/**
 * Price history for ONE symbol — powers the per-token detail chart.
 * Symbols without a CoinGecko id (Litho ecosystem placeholders) return
 * `hasRealData: false` with an empty series; never a fabricated curve.
 */
export async function fetchTokenHistory(sym: string, range: TokenRange): Promise<TokenHistory> {
  const id = COINGECKO_IDS[sym];
  if (!id) return { prices: [], changePct: 0, hasRealData: false };

  const days = tokenRangeDays[range];
  const key = `tok:${id}:${days}`;
  const hit = tokenSeriesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.hist;

  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
      `/market_chart?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) return { prices: [], changePct: 0, hasRealData: false, failed: true };
    const json = await res.json();
    const raw: [number, number][] = json?.prices ?? [];
    if (raw.length < 2) return { prices: [], changePct: 0, hasRealData: false, failed: true };

    // Resample [ts, price] pairs to POINTS entries so chart paths stay cheap.
    const prices: Array<[number, number]> = [];
    for (let i = 0; i < POINTS; i++) {
      const pos = (i / (POINTS - 1)) * (raw.length - 1);
      const lo = Math.floor(pos), hi = Math.ceil(pos), frac = pos - lo;
      prices.push([
        raw[lo][0] * (1 - frac) + raw[hi][0] * frac,
        raw[lo][1] * (1 - frac) + raw[hi][1] * frac,
      ]);
    }
    const first = prices[0][1], last = prices[prices.length - 1][1];
    const hist: TokenHistory = {
      prices,
      changePct: first > 0 ? (last - first) / first : 0,
      hasRealData: true,
    };
    tokenSeriesCache.set(key, { at: Date.now(), hist });
    return hist;
  } catch {
    return { prices: [], changePct: 0, hasRealData: false, failed: true };
  }
}

/* ─── Market details (token detail screen) ───────────────────────────── */

export interface TokenMarketDetails {
  marketCapUsd:      number | null;
  totalVolumeUsd:    number | null;
  circulatingSupply: number | null;
  athUsd:            number | null;
  atlUsd:            number | null;
}

const marketDetailsCache = new Map<string, { at: number; d: TokenMarketDetails | null }>();

/** Market cap / volume / supply / ATH / ATL for one symbol via CoinGecko
 *  `/coins/{id}`. Returns null for symbols with no feed — callers render
 *  "—" rows rather than invent numbers. Cached 10 min. */
export async function fetchTokenMarketDetails(sym: string): Promise<TokenMarketDetails | null> {
  const id = COINGECKO_IDS[sym];
  if (!id) return null;
  const hit = marketDetailsCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.d;
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}` +
      `?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    const m = j?.market_data;
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    const d: TokenMarketDetails = {
      marketCapUsd:      num(m?.market_cap?.usd),
      totalVolumeUsd:    num(m?.total_volume?.usd),
      circulatingSupply: num(m?.circulating_supply),
      athUsd:            num(m?.ath?.usd),
      atlUsd:            num(m?.atl?.usd),
    };
    marketDetailsCache.set(id, { at: Date.now(), d });
    return d;
  } catch {
    return null;
  }
}

/** Test-only: wipes the per-(id, days) series cache between cases. */
export function _resetSeriesCacheForTests(): void {
  seriesCache.clear();
  tokenSeriesCache.clear();
  marketDetailsCache.clear();
}
