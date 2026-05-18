/**
 * CoinGecko price fetch for the Lithosphere ecosystem — shared by every
 * client.
 *
 * Three categories:
 *  1. HARD_PRICES       — fixed by client spec, NEVER fetched (LAX).
 *  2. PLACEHOLDER_PRICES — used until a real oracle is wired (LITHO,
 *     JOT, IMAGE); a CoinGecko value for these is ignored on purpose.
 *  3. Everything else   — fetched from CoinGecko's keyless public
 *     simple/price API by coin id.
 *
 * Returns only the prices it knows. A symbol with no hard/placeholder
 * value and no CoinGecko listing is simply absent — callers merge in
 * their own token-table default for those. Cached 60s in memory.
 */
export const HARD_PRICES: Record<string, number> = {
  LAX: 1.0001,
};

export const PLACEHOLDER_PRICES: Record<string, number> = {
  LITHO: 5.0,
  JOT:   0.5,
  IMAGE: 0.025,
};

/** Symbol → CoinGecko coin id. Add entries as more tokens get listed. */
const COINGECKO_IDS: Record<string, string> = {
  LitBTC: 'bitcoin',
  FurGPT: 'furgpt',     // probably 404s today — falls back to caller default
  COLLE:  'colle-ai',   // probably 404s today — falls back to caller default
  SOL:    'solana',
  BTC:    'bitcoin',
  ATOM:   'cosmos',
  // ─── EVM native coins ───────────────────────────────────────────
  ETH:    'ethereum',
  BNB:    'binancecoin',
  POL:    'matic-network',
  MATIC:  'matic-network',
  AVAX:   'avalanche-2',
};

const CACHE_TTL_MS = 60_000;
let cache: { at: number; prices: Record<string, number> } | null = null;

/**
 * Latest USD prices for the ecosystem symbols this module knows about
 * (hard + placeholder + CoinGecko-listed). Cached for 60s. Network
 * failure is swallowed — you get hard + placeholder prices regardless.
 */
export async function fetchEcosystemPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.prices };
  }

  const prices: Record<string, number> = {};

  // 1. Hard-coded prices — never overridden.
  for (const [sym, p] of Object.entries(HARD_PRICES)) prices[sym] = p;
  // 2. Placeholders — never overridden by fetched prices.
  for (const [sym, p] of Object.entries(PLACEHOLDER_PRICES)) prices[sym] = p;

  // 3. Fetch the symbols that have a CoinGecko id and aren't hard/placeholder.
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
      // Network failure — return hard + placeholder prices only.
    }
  }

  cache = { at: Date.now(), prices };
  return { ...prices };
}
