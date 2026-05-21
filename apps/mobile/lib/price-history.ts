/**
 * Portfolio value history — mobile (detached copy of
 * @thanos/sdk-core's portfolio/price-history; EAS Cloud can't resolve
 * workspace deps). Keep in sync with the sdk-core version.
 *
 * Only holdings whose symbol is in COINGECKO_IDS have real history; the
 * placeholder-priced ecosystem tokens are held flat at their current
 * price, so a portfolio with no tracked coins renders an honest flat line.
 */
import { COINGECKO_IDS } from './pricing';

export type Range = '7d' | '30d';

export interface Holding {
  sym: string;
  qty: number;
  usd: number;
}

export interface PortfolioHistory {
  points: number[];
  changePct: number;
  hasRealData: boolean;
}

const POINTS = 40;
const CACHE_TTL_MS = 10 * 60_000;
const rangeDays: Record<Range, number> = { '7d': 7, '30d': 30 };
const seriesCache = new Map<string, { at: number; series: number[] }>();

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

export const PORTFOLIO_HISTORY_POINTS = POINTS;
