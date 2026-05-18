/**
 * Live token logo lookup for the web app.
 *
 * The static logo map and the CoinGecko top-250 fetch now live in
 * @thanos/sdk-core (tokens/logos.ts), shared with the other clients.
 * This module keeps the browser-specific layer: a 24h localStorage
 * cache and a subscription bus so mounted TokenIcons re-render when the
 * boot fetch resolves.
 *
 * Tokens not in top-250 (e.g. custom Lithosphere LEP100s) return null —
 * TokenIcon then falls back to the canonical brand-color letter avatar.
 */
import { staticLogoUrl, fetchTokenLogoMap } from '@thanos/sdk-core';

const CACHE_KEY = 'thanos.token_logos.v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

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
  const map = await fetchTokenLogoMap();
  writeCache(map);
  notifyListeners(); // tell mounted TokenIcons to re-evaluate
  return map;
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
 *   1. STATIC_LOGOS  — hardcoded in sdk-core, always available
 *   2. memory map    — populated by the boot fetch (top-250 by mcap)
 *   3. localStorage  — falls back to last-good cache on cold load
 */
export function getLogoUrl(sym: string): string | null {
  if (!sym) return null;
  // 1) Hardcoded hot-path (shared static map).
  const stat = staticLogoUrl(sym);
  if (stat) return stat;
  // 2) Dynamic map populated by preloadTokenLogos.
  const key = sym.toLowerCase();
  if (memoryMap === null) {
    const env = readCache();
    memoryMap = env?.map ?? {};
  }
  return memoryMap[key] ?? null;
}
