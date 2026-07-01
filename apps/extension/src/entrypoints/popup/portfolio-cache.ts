/**
 * Cached-first portfolio snapshots for the extension popup.
 *
 * The MV3 popup REMOUNTS empty on every open, so without a cache the user
 * always sees blank "···" / "Loading…" for the ~1s the indexer+pricing take.
 * We persist the last SUCCESSFUL portfolio to localStorage (survives popup
 * reopen) keyed by wallet address, then initialize usePortfolio state from it
 * synchronously on mount — so the popup paints real last-known numbers
 * instantly while a background refresh runs.
 *
 * Public data only (balances / prices / activity). Never secrets.
 * Additive: no fetch/timeout/offline logic changes.
 */
import type { DisplayCoin, DisplayTx } from './portfolio';

const PREFIX = 'thanos-portfolio-cache:';

export interface PortfolioSnapshot {
  coins: DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  /** epoch ms of the successful fetch that produced this snapshot */
  at: number;
}

function keyFor(address: string): string {
  return PREFIX + address;
}

/** Read this address's last-known snapshot, or null if none/invalid. */
export function loadSnapshot(address: string): PortfolioSnapshot | null {
  if (!address) return null;
  try {
    const raw = localStorage.getItem(keyFor(address));
    if (!raw) return null;
    const s = JSON.parse(raw) as PortfolioSnapshot;
    if (!s || !Array.isArray(s.coins) || !Array.isArray(s.activity)) return null;
    return {
      coins: s.coins,
      activity: s.activity,
      totalUsd: typeof s.totalUsd === 'number' ? s.totalUsd : 0,
      at: typeof s.at === 'number' ? s.at : 0,
    };
  } catch {
    return null;
  }
}

/** Persist a snapshot AFTER a successful fetch. Never call this with an
 *  offline/empty result — that would poison the cache. */
export function saveSnapshot(
  address: string,
  snap: Omit<PortfolioSnapshot, 'at'>,
): void {
  if (!address) return;
  try {
    const payload: PortfolioSnapshot = { ...snap, at: Date.now() };
    localStorage.setItem(keyFor(address), JSON.stringify(payload));
  } catch {
    /* quota / serialization — best-effort, never block the UI */
  }
}
