'use client';
/**
 * usePrices() — reactive hook that returns live USD prices keyed by ticker.
 *
 * Calls fetchAllPrices() (which has its own 60s in-memory cache) on mount,
 * then again every 60s. Hard-coded prices (LAX) and client-pinned
 * placeholders (LITHO/JOT/IMAGE) are returned as-is by the pricing layer
 * — only the truly fetched values (LitBTC, FurGPT, COLLE) actually move.
 *
 * Until the first fetch resolves, returns null so consumers can render
 * the static TOKENS[].priceUsd defaults.
 */
import { useEffect, useState } from 'react';
import { fetchAllPrices } from './pricing';

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

/** Helper — returns the live price for a symbol or the supplied fallback. */
export function priceOr(
  prices: Record<string, number> | null,
  sym: string,
  fallback: number,
): number {
  return prices?.[sym] ?? fallback;
}
