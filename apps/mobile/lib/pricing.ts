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
// Static, authoritative prices — the only two assets priced without a live
// feed (matches apps/web: "only litho market info is static"; LAX is a peg).
export const HARD_PRICES: Record<string, number> = {
  LITHO: 8.82,
  LAX:   1.0001,
};

// No arbitrary placeholders — anything without a CoinGecko feed renders "—".
export const PLACEHOLDER_PRICES: Record<string, number> = {};

export const COINGECKO_IDS: Record<string, string> = {
  LitBTC: 'bitcoin',
  // No FGPT mapping — the CoinGecko id 'furgpt' no longer exists.
  IMAGE:  'imagen-ai',
  COLLE:  'colle-ai',
  AGII:   'agii',       // AGII — CoinGecko-confirmed 2026-07-15

  MUSA:   'mansa-ai',   // Mansa AI ($MUSA) — CoinGecko search-confirmed 2026-06-17
  SOL:    'solana',
  BTC:    'bitcoin',
  ATOM:   'cosmos',
  ETH:    'ethereum',
  BNB:    'binancecoin',
  POL:    'matic-network',
  MATIC:  'matic-network',
  AVAX:   'avalanche-2',
  USDT:   'tether',
  USDC:   'usd-coin',
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
      // HARD timeout. The home's portfolio load awaits this inside a Promise.all,
      // so a hanging price endpoint (no response) used to stall the whole home
      // for MINUTES until the OS socket timeout — the "blank/stuck after login"
      // report. Every other fetch in the app already bounds itself; prices was
      // the one that didn't. On abort the catch below returns hard/placeholder
      // prices so the home still paints.
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6_000);
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal })
        .finally(() => clearTimeout(timer));
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

/* ─── Market quotes (price + 24h/7d % + cap + volume + logo) ─────────────── */

export interface MarketQuote {
  usd:       number;
  chg24h:    number | null;
  chg7d:     number | null;
  marketCap: number | null;
  volume:    number | null;
  image:     string | null;
}

let mqCache: { at: number; quotes: Record<string, MarketQuote> } | null = null;

/** Full market data for the Market screen. Static (LITHO/LAX) get a usd with
 *  null change/cap/vol; CoinGecko-listed symbols get live figures via
 *  /coins/markets. Symbols with no feed are absent (UI renders "—"). 60s cache. */
export async function fetchMarketQuotes(): Promise<Record<string, MarketQuote>> {
  if (mqCache && Date.now() - mqCache.at < CACHE_TTL_MS) return { ...mqCache.quotes };

  const quotes: Record<string, MarketQuote> = {};
  for (const [sym, p] of Object.entries(HARD_PRICES)) {
    quotes[sym] = { usd: p, chg24h: null, chg7d: null, marketCap: null, volume: null, image: null };
  }

  const toFetch = Object.entries(COINGECKO_IDS).filter(([sym]) => !(sym in HARD_PRICES));
  if (toFetch.length > 0) {
    try {
      const ids = toFetch.map(([, id]) => id).join(',');
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&price_change_percentage=24h,7d`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const data = (await res.json()) as Array<{
          id: string; current_price?: number;
          price_change_percentage_24h?: number;
          price_change_percentage_7d_in_currency?: number;
          market_cap?: number; total_volume?: number; image?: string;
        }>;
        const byId = new Map(data.map((r) => [r.id, r]));
        for (const [sym, cgId] of toFetch) {
          const r = byId.get(cgId);
          if (r && typeof r.current_price === 'number') {
            quotes[sym] = {
              usd:       r.current_price,
              chg24h:    typeof r.price_change_percentage_24h === 'number' ? +r.price_change_percentage_24h.toFixed(2) : null,
              chg7d:     typeof r.price_change_percentage_7d_in_currency === 'number' ? +r.price_change_percentage_7d_in_currency.toFixed(2) : null,
              marketCap: typeof r.market_cap   === 'number' ? r.market_cap   : null,
              volume:    typeof r.total_volume === 'number' ? r.total_volume : null,
              image:     typeof r.image === 'string' ? r.image : null,
            };
          }
        }
      }
    } catch {
      // Network failure — return whatever static prices we have.
    }
  }

  mqCache = { at: Date.now(), quotes };
  return { ...quotes };
}
