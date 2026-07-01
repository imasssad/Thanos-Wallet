/**
 * Portfolio snapshot cache — cached-first rendering.
 *
 * Persists the LAST-KNOWN-GOOD portfolio (assets + activity) per wallet
 * address in localStorage so the dashboard can paint real numbers the
 * instant it mounts, then refresh in the background. This is purely a UX
 * layer: it never changes fetch/timeout/offline logic and never stores
 * secrets — only public balances / activity that the indexer already
 * returns.
 *
 * Storage key: thanos.portfolio_cache:<lowercased address>
 *
 * The snapshot is keyed by the CURRENT wallet address (the context's
 * `evmAddress` already reflects the active account index), so switching
 * accounts loads that account's own cache.
 */
import type { IndexerAsset, IndexerActivityItem } from './indexer';

const KEY_PREFIX = 'thanos.portfolio_cache:';

export interface PortfolioSnapshot {
  assets:   IndexerAsset[];
  activity: IndexerActivityItem[];
  /** When this snapshot was captured (ms since epoch). */
  at:       number;
}

function keyFor(address: string): string {
  return KEY_PREFIX + address.toLowerCase();
}

/** Read the snapshot for an address, or null if none / unparseable. */
export function loadPortfolioSnapshot(address: string | null | undefined): PortfolioSnapshot | null {
  if (!address || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortfolioSnapshot;
    if (!parsed || !Array.isArray(parsed.assets) || !Array.isArray(parsed.activity)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist a snapshot for an address. Only call this after a SUCCESSFUL
 * fetch that produced real data — never with an offline/empty result, so
 * a good snapshot is never poisoned by a failed refresh.
 */
export function savePortfolioSnapshot(
  address: string | null | undefined,
  snapshot: Omit<PortfolioSnapshot, 'at'>,
): void {
  if (!address || typeof window === 'undefined') return;
  try {
    const payload: PortfolioSnapshot = { ...snapshot, at: Date.now() };
    localStorage.setItem(keyFor(address), JSON.stringify(payload));
  } catch {
    /* quota / serialization — non-fatal, cache just won't update */
  }
}
