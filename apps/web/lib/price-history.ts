/**
 * Portfolio value history for the dashboard chart.
 *
 * Reality check: only a handful of holdings have a live price feed
 * (the symbols in COINGECKO_IDS — BTC/LitBTC, ETH, BNB, etc.). The core
 * Lithosphere ecosystem tokens (LITHO, JOT, IMAGE, LAX) use hard /
 * placeholder prices that don't move, so there is no real history to
 * plot for them. Rather than fabricate a curve, we plot the REAL
 * CoinGecko history for tracked coins and hold the placeholder-priced
 * tokens flat at their current price. A portfolio with no tracked coins
 * therefore shows an honest flat line.
 *
 * Portfolio value at time t = Σ_holdings qty × price(sym, t)
 *   - tracked sym:  real CoinGecko price at t
 *   - untracked sym: current price (constant baseline)
 */
import { COINGECKO_IDS } from '@thanos/sdk-core';

export type Range = '7d' | '30d';

export interface Holding {
  sym:   string;
  /** Token quantity held (not USD). */
  qty:   number;
  /** Current USD value of the holding (qty × current price). */
  usd:   number;
}

export interface PortfolioHistory {
  /** Evenly-spaced portfolio USD values across the range. */
  points:    number[];
  /** (last − first) / first, as a fraction (e.g. 0.05 = +5%). */
  changePct: number;
  /** True when at least one holding had real CoinGecko history. */
  hasRealData: boolean;
}

const POINTS = 40;
const CACHE_TTL_MS = 10 * 60_000;

const rangeDays: Record<Range, number> = { '7d': 7, '30d': 30 };

/** id → resampled price series, cached per (id, days). */
const seriesCache = new Map<string, { at: number; series: number[] }>();

/** Evenly sample `n` values from an array by index (linear). */
function resample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  if (values.length === 1) return new Array(n).fill(values[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo  = Math.floor(pos);
    const hi  = Math.ceil(pos);
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
    const series = resample(prices.map(p => p[1]), POINTS);
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
  const sum  = new Array(POINTS).fill(0);
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
        // No live history — hold flat at the current value.
        for (let i = 0; i < POINTS; i++) sum[i] += currentPrice * h.qty;
      }
    }),
  );

  const first = sum[0] || 0;
  const last  = sum[POINTS - 1] || 0;
  const changePct = first > 0 ? (last - first) / first : 0;

  return { points: sum, changePct, hasRealData };
}
