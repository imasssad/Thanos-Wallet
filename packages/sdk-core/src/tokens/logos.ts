/**
 * Token logo resolution — shared static map + CoinGecko top-250 fetch.
 *
 * The framework-agnostic parts live here so every client reuses them.
 * Browser-specific caching (localStorage) and React re-render plumbing
 * stay in each app — e.g. apps/web/lib/token-logos.ts wraps these with
 * a 24h localStorage cache and a subscription bus.
 *
 * CoinGecko symbols can collide (several "LION" entries); the first
 * occurrence wins, and the markets feed is market-cap-ordered, so the
 * largest project takes the symbol. Good enough for a wallet UI.
 */

const ENDPOINT =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';

/**
 * STATIC_LOGOS — hardcoded CoinGecko CDN URLs for well-known coins we
 * always render. Avoids a race when a component mounts before the
 * dynamic top-250 fetch resolves; these ids never change. Keys are
 * lowercase symbols.
 */
export const STATIC_LOGOS: Record<string, string> = {
  // Bitcoin family
  btc:    'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  litbtc: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  wbtc:   'https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png',
  // Layer 1s
  eth:    'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  sol:    'https://assets.coingecko.com/coins/images/4128/large/solana.png',
  bnb:    'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  matic:  'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  // POL = the rebranded MATIC; CoinGecko's image 32440 (polygon_pos) was
  // returning 403 as of Jun 2026, so we reuse the still-served 4713
  // (the old MATIC mark, which Polygon still uses everywhere).
  pol:    'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  avax:   'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
  atom:   'https://assets.coingecko.com/coins/images/1481/large/cosmos_hub.png',
  ada:    'https://assets.coingecko.com/coins/images/975/large/cardano.png',
  dot:    'https://assets.coingecko.com/coins/images/12171/large/polkadot.png',
  link:   'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
  doge:   'https://assets.coingecko.com/coins/images/5/large/dogecoin.png',
  xrp:    'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
  // Stables
  usdc:   'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
  usdt:   'https://assets.coingecko.com/coins/images/325/large/Tether.png',
  dai:    'https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png',
};

/** Hardcoded logo for a well-known symbol, or null. Case-insensitive. */
export function staticLogoUrl(sym: string): string | null {
  if (!sym) return null;
  return STATIC_LOGOS[sym.toLowerCase()] ?? null;
}

interface CGRow { symbol: string; image: string }

/**
 * Fetch the CoinGecko top-250 (by market cap) symbol → image-URL map.
 * Lower-cased keys, first occurrence wins. 8s timeout. Throws on a
 * network / HTTP failure so the caller can fall back to a cache.
 */
export async function fetchTokenLogoMap(): Promise<Record<string, string>> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(ENDPOINT, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`coingecko status ${res.status}`);
    const rows = (await res.json()) as CGRow[];
    const map: Record<string, string> = {};
    for (const r of rows) {
      const key = (r.symbol ?? '').toLowerCase();
      if (key && r.image && !map[key]) map[key] = r.image;
    }
    return map;
  } finally {
    clearTimeout(timer);
  }
}
