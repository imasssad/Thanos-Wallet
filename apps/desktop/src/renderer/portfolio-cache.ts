/**
 * Cached-first portfolio snapshots for the desktop wallet.
 *
 * Persists the last SUCCESSFUL portfolio fetch (public balances / prices /
 * activity only — never secrets) keyed by wallet address, so usePortfolio can
 * paint real last-known numbers instantly on mount instead of a blank "···"
 * while the background refresh runs.
 *
 * This is purely additive: it never touches fetch logic, timeouts, or the
 * existing offline/last-known contract. A snapshot is only written after a
 * fetch actually succeeded (see usePortfolio), so an offline/empty result can
 * never poison a good cache.
 */
import type { DisplayCoin, DisplayTx } from './portfolio';

const CACHE_PREFIX = 'thanos-portfolio-cache:';

export interface PortfolioSnapshot {
  coins:    DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  /** epoch ms of the successful fetch that produced this snapshot */
  at:       number;
}

function keyFor(address: string): string {
  return CACHE_PREFIX + (address || '').toLowerCase();
}

/** Synchronously read the snapshot for an address (or null if none / invalid). */
export function readSnapshot(address: string): PortfolioSnapshot | null {
  if (!address) return null;
  try {
    const raw = localStorage.getItem(keyFor(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortfolioSnapshot>;
    if (!parsed || !Array.isArray(parsed.coins)) return null;
    return {
      coins:    parsed.coins as DisplayCoin[],
      activity: Array.isArray(parsed.activity) ? (parsed.activity as DisplayTx[]) : [],
      totalUsd: typeof parsed.totalUsd === 'number' ? parsed.totalUsd : 0,
      at:       typeof parsed.at === 'number' ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

/** Persist a snapshot from a SUCCESSFUL fetch. Public data only. */
export function writeSnapshot(
  address: string,
  snap: Omit<PortfolioSnapshot, 'at'>,
): void {
  if (!address) return;
  try {
    const payload: PortfolioSnapshot = { ...snap, at: Date.now() };
    localStorage.setItem(keyFor(address), JSON.stringify(payload));
  } catch {
    /* storage full / disabled — cache is best-effort, never fatal */
  }
}
