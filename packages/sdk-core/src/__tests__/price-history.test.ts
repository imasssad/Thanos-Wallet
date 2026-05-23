/**
 * Portfolio price-history tests.
 *
 * The math here drives the dashboard chart on every client. Mocks fetch
 * so the suite runs offline + deterministically — we exercise the
 * holdings × series math, not CoinGecko's uptime.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchPortfolioHistory,
  PORTFOLIO_HISTORY_POINTS,
  _resetSeriesCacheForTests,
} from '../portfolio/price-history.js';

// One mock fetch reused across cases; flips its behaviour per-test.
const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  _resetSeriesCacheForTests();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

/** Build a CoinGecko-shaped market_chart response with `n` evenly-spaced
 *  prices ramping from `start` to `end`. Mirrors the real API shape. */
function rampPrices(start: number, end: number, n = 30): { ok: true; json: () => Promise<unknown> } {
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    points.push([i, start + (end - start) * t]);
  }
  return {
    ok: true,
    json: async () => ({ prices: points }),
  };
}

describe('fetchPortfolioHistory', () => {
  it('returns POINTS evenly-spaced samples', async () => {
    fetchSpy.mockResolvedValueOnce(rampPrices(100, 110));
    const out = await fetchPortfolioHistory([{ sym: 'BTC', qty: 1, usd: 110 }], '7d');
    expect(out.points.length).toBe(PORTFOLIO_HISTORY_POINTS);
    expect(out.hasRealData).toBe(true);
  });

  it('marks hasRealData false when no holding has a CoinGecko id', async () => {
    // LITHO has no CG id → flat baseline only, no fetch is made.
    const out = await fetchPortfolioHistory([{ sym: 'LITHO', qty: 100, usd: 30 }], '7d');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.hasRealData).toBe(false);
    // A flat baseline => every point equals the current USD value.
    expect(out.points.every((p) => Math.abs(p - 30) < 1e-6)).toBe(true);
    expect(out.changePct).toBe(0);
  });

  it('changePct reflects (last − first) / first for tracked coins', async () => {
    // Price doubles across the window: $100 → $200, qty 1 → portfolio $100 → $200.
    fetchSpy.mockResolvedValueOnce(rampPrices(100, 200));
    const out = await fetchPortfolioHistory([{ sym: 'BTC', qty: 1, usd: 200 }], '7d');
    expect(out.points[0]).toBeCloseTo(100, 5);
    expect(out.points[out.points.length - 1]).toBeCloseTo(200, 5);
    expect(out.changePct).toBeCloseTo(1, 5);
  });

  it('skips holdings with non-positive qty or usd', async () => {
    const out = await fetchPortfolioHistory(
      [{ sym: 'BTC', qty: 0, usd: 0 }, { sym: 'ETH', qty: -1, usd: 5 }],
      '7d',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.points.every((p) => p === 0)).toBe(true);
  });

  it('treats a 404 / non-ok response as no history (flat baseline, no throw)', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const out = await fetchPortfolioHistory([{ sym: 'BTC', qty: 2, usd: 100 }], '7d');
    expect(out.hasRealData).toBe(false);
    expect(out.points.every((p) => Math.abs(p - 100) < 1e-6)).toBe(true);
  });

  it('swallows fetch rejections (CoinGecko outage must not break the dashboard)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const out = await fetchPortfolioHistory([{ sym: 'BTC', qty: 1, usd: 50 }], '7d');
    expect(out.hasRealData).toBe(false);
    expect(out.points.length).toBe(PORTFOLIO_HISTORY_POINTS);
  });

  it('sums tracked + untracked holdings into the same series', async () => {
    fetchSpy.mockResolvedValueOnce(rampPrices(10, 20)); // BTC 10→20 with qty 1 → 10→20 contribution
    const out = await fetchPortfolioHistory(
      [
        { sym: 'BTC',   qty: 1,   usd: 20 },   // tracked, contributes 10→20
        { sym: 'LITHO', qty: 100, usd: 30 },   // flat 30 baseline
      ],
      '7d',
    );
    // First ≈ 10 + 30 = 40, last ≈ 20 + 30 = 50.
    expect(out.points[0]).toBeCloseTo(40, 3);
    expect(out.points[out.points.length - 1]).toBeCloseTo(50, 3);
  });
});
