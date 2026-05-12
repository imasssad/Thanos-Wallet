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

interface CacheEnvelope {
  ts:  number;
  map: Record<string, string>;
}

let memoryMap: Record<string, string> | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

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
 * Reads the cache lazily on first call so SSR is safe.
 */
export function getLogoUrl(sym: string): string | null {
  if (!sym) return null;
  if (memoryMap === null) {
    const env = readCache();
    memoryMap = env?.map ?? {};
  }
  return memoryMap[sym.toLowerCase()] ?? null;
}
