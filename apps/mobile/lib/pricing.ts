/**
 * Token pricing for the mobile app.
 *
 * A detached copy of @thanos/sdk-core's tokens/pricing.ts — kept local
 * because EAS Cloud builds can't resolve workspace packages (same as
 * api-client.ts / indexer.ts).
 *
 * HARD_PRICES are fixed by client spec; PLACEHOLDER_PRICES stand in
 * until a real oracle is wired; everything else comes from CoinGecko's
 * keyless public API. 60s in-memory cache.
 */
export const HARD_PRICES: Record<string, number> = {
  LAX: 1.0001,
};

export const PLACEHOLDER_PRICES: Record<string, number> = {
  LITHO: 5.0,
  JOT:   0.5,
  IMAGE: 0.025,
};

const COINGECKO_IDS: Record<string, string> = {
  LitBTC: 'bitcoin',
  FurGPT: 'furgpt',
  COLLE:  'colle-ai',
  SOL:    'solana',
  BTC:    'bitcoin',
  ATOM:   'cosmos',
  ETH:    'ethereum',
  BNB:    'binancecoin',
  POL:    'matic-network',
  MATIC:  'matic-network',
  AVAX:   'avalanche-2',
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; prices: Record<string, number> } | null = null;

/**
 * Latest USD prices for the ecosystem symbols this knows about. Cached
 * 60s. Network failure is swallowed — hard + placeholder prices are
 * still returned. A symbol with no known price is simply absent.
 */
export async function fetchEcosystemPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.prices };
  }

  const prices: Record<string, number> = {};
  for (const [sym, p] of Object.entries(HARD_PRICES)) prices[sym] = p;
  for (const [sym, p] of Object.entries(PLACEHOLDER_PRICES)) prices[sym] = p;

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
      // Network failure — hard + placeholder prices only.
    }
  }

  cache = { at: Date.now(), prices };
  return { ...prices };
}
