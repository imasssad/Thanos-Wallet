/**
 * Pricing layer for the Lithosphere ecosystem tokens.
 *
 * Three categories:
 *  1. HARD_PRICES — fixed values that should NEVER be fetched
 *     (e.g. LAX = $1.0001 by client spec).
 *  2. PLACEHOLDER_PRICES — used until a real oracle is wired (LITHO, JOT,
 *     IMAGE). When CoinGecko returns a value for these symbols we still
 *     ignore it because the client wants the placeholder.
 *  3. Everything else — fetched from CoinGecko's public simple/price API
 *     by symbol. BTC is the only one guaranteed to resolve; FGPT, COLLE
 *     usually won't be listed and will fall back to their token-table
 *     default `priceUsd`.
 *
 * The CoinGecko endpoint is keyless (free tier — light usage only).
 * Cache for 60s in memory to avoid hammering them on every renderer mount.
 */

import { TOKENS, type Token } from './tokens';

export const HARD_PRICES: Record<string, number> = {
  LAX: 1.0001,
};

export const PLACEHOLDER_PRICES: Record<string, number> = {
  LITHO: 5.00,
  JOT:   0.50,
  IMAGE: 0.025,
};

// Symbol → CoinGecko coin id. Add entries here as more tokens get listed.
const COINGECKO_IDS: Record<string, string> = {
  LitBTC: 'bitcoin',
  FurGPT: 'furgpt',      // probably 404s today — fall back to placeholder
  COLLE:  'colle-ai',    // probably 404s today — fall back to placeholder
  SOL:    'solana',
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; prices: Record<string, number> } | null = null;

/** Fetch latest USD prices for all tokens. Cached for 60s. */
export async function fetchAllPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.prices;
  }

  const prices: Record<string, number> = {};

  // 1. Apply hard-coded prices first — never overridden.
  for (const [sym, p] of Object.entries(HARD_PRICES)) prices[sym] = p;

  // 2. Apply placeholders — never overridden by fetched prices.
  for (const [sym, p] of Object.entries(PLACEHOLDER_PRICES)) prices[sym] = p;

  // 3. Fetch only the symbols that have a CoinGecko id AND are not in
  //    HARD/PLACEHOLDER lists.
  const toFetch = Object.entries(COINGECKO_IDS).filter(
    ([sym]) => !(sym in HARD_PRICES) && !(sym in PLACEHOLDER_PRICES),
  );

  if (toFetch.length > 0) {
    try {
      const ids = toFetch.map(([, id]) => id).join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const data = (await res.json()) as Record<string, { usd?: number }>;
        for (const [sym, cgId] of toFetch) {
          const p = data[cgId]?.usd;
          if (typeof p === 'number') prices[sym] = p;
        }
      }
    } catch {
      // Network failure — keep the defaults from TOKENS.
    }
  }

  // 4. Anything still missing falls back to its TOKENS[].priceUsd.
  for (const t of TOKENS) {
    if (prices[t.sym] === undefined) prices[t.sym] = t.priceUsd;
  }

  cache = { at: Date.now(), prices };
  return prices;
}

/** Return tokens with their priceUsd fields updated from the latest fetch. */
export async function getTokensWithLivePrices(): Promise<Token[]> {
  const prices = await fetchAllPrices();
  return TOKENS.map(t => ({ ...t, priceUsd: prices[t.sym] ?? t.priceUsd }));
}
