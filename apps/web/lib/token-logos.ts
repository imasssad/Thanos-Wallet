/**
 * Live token logo lookup.
 *
 * Strategy:
 *   1. One bootstrap fetch of /coins/markets?per_page=250 from CoinGecko
 *      (no API key needed, free tier — ~6 KB JSON after parse).
 *   2. Build a symbol-keyed map (lower-cased) → image URL.
 *   3. Cache in localStorage for 24h so subsequent app loads are zero-network.
 *   4. Expose a sync getLogoUrl(sym) that reads the cached map.
 *
 * Tokens not in top-250 (e.g. custom Lithosphere LEP100s) return null —
 * TokenIcon then falls back to the canonical brand-color letter avatar.
 *
 * NOTE: CoinGecko symbols can collide (e.g. there are several "LION" entries).
 * We keep the FIRST occurrence we see, which is market-cap-ordered, so the
 * largest project wins. Good enough for a wallet UI.
 */

const CACHE_KEY = 'thanos.token_logos.v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const ENDPOINT  = 'https://api.coingecko.com/api/v3/coins/markets'
  + '?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';

/**
 * STATIC_LOGOS — hardcoded CoinGecko CDN URLs for the well-known coins
 * we know we'll always render (BTC, SOL, ETH, etc.).
 *
 * Two reasons we don't lean on the dynamic top-250 map for these:
 *   1. The boot fetch is fire-and-forget; if a component mounts before
 *      it resolves, getLogoUrl() returns null. Hardcoding eliminates
 *      that race.
 *   2. These URLs almost never change — CoinGecko keeps the same id
 *      forever — so there's no upside to fetching them dynamically.
 *
 * Keys are lowercase symbols. Look up via getLogoUrl(sym) which checks
 * this map first.
 */
const STATIC_LOGOS: Record<string, string> = {
  // Bitcoin family
  btc:    'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  litbtc: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',  // wrapped BTC variant
  wbtc:   'https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png',
  // Layer 1s
  eth:    'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  sol:    'https://assets.coingecko.com/coins/images/4128/large/solana.png',
  bnb:    'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  matic:  'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  pol:    'https://assets.coingecko.com/coins/images/32440/large/polygon_pos.png',
  avax:   'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
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

interface CacheEnvelope {
  ts:  number;
  map: Record<string, string>;
}

let memoryMap: Record<string, string> | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

/* Subscription bus — every TokenIcon mounts a listener so when the boot
   fetch resolves they re-render with the new URLs. Without this, the
   useMemo inside TokenIcon captures an empty map at mount and never
   updates. */
type Listener = () => void;
const listeners = new Set<Listener>();
function notifyListeners() {
  for (const l of listeners) {
    try { l(); } catch { /* ignore subscriber errors */ }
  }
}
export function subscribeToLogoMap(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

interface CGRow { symbol: string; image: string }

function readCache(): CacheEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope;
    if (!env || typeof env.ts !== 'number') return null;
    return env;
  } catch {
    return null;
  }
}

function writeCache(map: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    const env: CacheEnvelope = { ts: Date.now(), map };
    localStorage.setItem(CACHE_KEY, JSON.stringify(env));
  } catch {
    // Quota exceeded or disabled storage — non-fatal, we just lose persistence.
  }
}

async function fetchAndBuild(): Promise<Record<string, string>> {
  // 8s timeout — CoinGecko is usually <1s, but free tier can throttle.
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(ENDPOINT, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`coingecko status ${res.status}`);
    const rows = await res.json() as CGRow[];
    const map: Record<string, string> = {};
    for (const r of rows) {
      const key = (r.symbol ?? '').toLowerCase();
      if (key && r.image && !map[key]) map[key] = r.image;
    }
    writeCache(map);
    notifyListeners(); // tell mounted TokenIcons to re-evaluate
    return map;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kick off the boot fetch if the cache is stale/missing. Idempotent —
 * concurrent callers share the same in-flight promise. Call once from a
 * top-level layout or provider; lookups don't depend on this resolving
 * (they fall back to the brand letter while it's pending).
 */
export async function preloadTokenLogos(): Promise<void> {
  if (typeof window === 'undefined') return;

  const env = readCache();
  if (env && (Date.now() - env.ts) < CACHE_TTL) {
    memoryMap = env.map;
    return;
  }

  if (!inFlight) {
    inFlight = fetchAndBuild()
      .then(m => { memoryMap = m; return m; })
      .catch(err => {
        // Network blip / rate-limited. Keep any stale cache around so we
        // still return something useful on subsequent lookups.
        console.warn('[token-logos] preload failed', err);
        if (env) memoryMap = env.map;
        return env?.map ?? {};
      })
      .finally(() => { inFlight = null; });
  }
  await inFlight;
}

/**
 * Synchronous lookup. Returns the CoinGecko image URL or null.
 * Lookup order:
 *   1. STATIC_LOGOS  — hardcoded, always available, no race condition
 *   2. memory map    — populated by the boot fetch (top-250 by mcap)
 *   3. localStorage  — falls back to last-good cache on cold load
 */
export function getLogoUrl(sym: string): string | null {
  if (!sym) return null;
  const key = sym.toLowerCase();
  // 1) Hardcoded hot-path.
  if (STATIC_LOGOS[key]) return STATIC_LOGOS[key];
  // 2) Dynamic map populated by preloadTokenLogos.
  if (memoryMap === null) {
    const env = readCache();
    memoryMap = env?.map ?? {};
  }
  return memoryMap[key] ?? null;
}
