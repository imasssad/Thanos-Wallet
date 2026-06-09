'use client';
/**
 * usePrices() — reactive hook that returns live USD prices keyed by ticker.
 * useQuotes() — same shape but also includes real 24h + 7d % change for the
 *               coins CoinGecko lists (Litho ecosystem tokens return
 *               chg24h/chg7d as null, NOT 0 — never fake a movement).
 *
 * Both call into @thanos/sdk-core's pricing layer (60s in-memory cache)
 * on mount and again every 60s. Until the first fetch resolves they
 * return null so consumers can render the static TOKENS[].priceUsd
 * defaults.
 */
import { useEffect, useState } from 'react';
import { fetchAllPrices } from './pricing';
import { fetchPriceQuotes, type PriceQuote } from '@thanos/sdk-core';

const REFRESH_MS = 60_000;

export function usePrices(): Record<string, number> | null {
  const [prices, setPrices] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const p = await fetchAllPrices();
        if (!cancel) setPrices(p);
      } catch {
        /* swallow — UI keeps showing previous prices or defaults */
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  return prices;
}

/** Reactive quotes hook — current price + signed 24h % + signed 7d %. For
 *  symbols without a public price feed (Litho ecosystem) the chg fields
 *  stay null; renderers must show "—" rather than coerce to 0%. */
export function useQuotes(): Record<string, PriceQuote> | null {
  const [quotes, setQuotes] = useState<Record<string, PriceQuote> | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const q = await fetchPriceQuotes();
        if (!cancel) setQuotes(q);
      } catch { /* swallow — keep previous */ }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  return quotes;
}

/** Helper — returns the live price for a symbol or the supplied fallback. */
export function priceOr(
  prices: Record<string, number> | null,
  sym: string,
  fallback: number,
): number {
  return prices?.[sym] ?? fallback;
}
