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
export const COINGECKO_IDS: Record<string, string> = {
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

/** A snapshot of price + 24h change for one symbol. `chg24h` is `null`
 *  when we don't have a real source (Litho ecosystem tokens). Callers
 *  should render `chg24h === null` as a "—" placeholder, NEVER as 0% —
 *  rendering 0% reads as "this asset didn't move," which is a lie. */
export interface PriceQuote {
  /** USD price. Always a number — hard/placeholder/live fallback chain
   *  guarantees a value. */
  usd: number;
  /** 24h price change as a signed percent (e.g. -3.42 = -3.42%). `null`
   *  when CoinGecko doesn't list the symbol; never inferred from
   *  hard/placeholder defaults. */
  chg24h: number | null;
  /** 7d price change. Same null semantics. */
  chg7d: number | null;
}

let quoteCache: { at: number; quotes: Record<string, PriceQuote> } | null = null;

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

/**
 * Latest USD price + 24h + 7d change for every ecosystem symbol.
 * Hard/placeholder prices contribute `usd` but `chg24h`/`chg7d` stay
 * `null` for them — we don't have a real movement source for the Litho
 * ecosystem tokens, and faking 0% would lie to the user. Mainstream
 * coins (BTC, SOL, ETH, BNB, etc.) get real numbers via CoinGecko's
 * `/coins/markets?price_change_percentage=24h,7d`. Same 60s cache as
 * `fetchEcosystemPrices`, separate cache slot.
 */
export async function fetchPriceQuotes(): Promise<Record<string, PriceQuote>> {
  if (quoteCache && Date.now() - quoteCache.at < CACHE_TTL_MS) {
    return { ...quoteCache.quotes };
  }

  const quotes: Record<string, PriceQuote> = {};

  // 1. Hard + placeholder prices get a usd but null change — we don't
  //    have a real movement source for them.
  for (const [sym, p] of Object.entries(HARD_PRICES))         quotes[sym] = { usd: p, chg24h: null, chg7d: null };
  for (const [sym, p] of Object.entries(PLACEHOLDER_PRICES))  quotes[sym] = { usd: p, chg24h: null, chg7d: null };

  // 2. Fetch CoinGecko-listed symbols with markets endpoint (gives us
  //    price + 24h change + 7d change in one round-trip). The /simple/
  //    price endpoint doesn't include change %; /coins/markets does.
  const toFetch = Object.entries(COINGECKO_IDS).filter(
    ([sym]) => !(sym in HARD_PRICES) && !(sym in PLACEHOLDER_PRICES),
  );
  if (toFetch.length > 0) {
    try {
      const ids = toFetch.map(([, id]) => id).join(',');
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&price_change_percentage=24h,7d`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const data = (await res.json()) as Array<{
          id: string;
          current_price?: number;
          price_change_percentage_24h?: number;
          price_change_percentage_7d_in_currency?: number;
        }>;
        const byId = new Map(data.map((r) => [r.id, r]));
        for (const [sym, cgId] of toFetch) {
          const row = byId.get(cgId);
          if (row && typeof row.current_price === 'number') {
            quotes[sym] = {
              usd:    row.current_price,
              chg24h: typeof row.price_change_percentage_24h === 'number'
                ? +row.price_change_percentage_24h.toFixed(2) : null,
              chg7d:  typeof row.price_change_percentage_7d_in_currency === 'number'
                ? +row.price_change_percentage_7d_in_currency.toFixed(2) : null,
            };
          }
        }
      }
    } catch {
      // Network failure — return whatever we have from hard/placeholder.
    }
  }

  quoteCache = { at: Date.now(), quotes };
  return { ...quotes };
}
