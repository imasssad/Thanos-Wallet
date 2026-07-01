// Cached-first portfolio/activity snapshots (ADDITIVE — no fetch changes).
//
// After every SUCCESSFUL fetch we persist a small public snapshot keyed by the
// wallet address. On the next mount the hook hydrates from that snapshot so the
// UI paints real last-known numbers instantly (loading stays true — a
// background refresh runs and replaces the data). We NEVER cache secrets — only
// public balances / prices / activity — and we NEVER overwrite a good snapshot
// with an offline/empty result.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IndexerActivityItem } from './indexer';

const PORTFOLIO_PREFIX = 'portfolio_cache:';
const ACTIVITY_PREFIX  = 'activity_cache:';

/** Shape of a persisted portfolio asset row. Mirrors the display shape used by
 *  the home/assets screens, but declared structurally so this module has no
 *  dependency back into App.tsx. */
export interface CachedAsset {
  sym: string; name: string; chainId: number;
  balance: number; balanceText: string; decimals: number;
  priceUsd: number; usdValue: number; color: string;
  tokenAddress?: string;
  native: boolean;
}

export interface PortfolioSnapshot {
  assets: CachedAsset[];
  totalUsd: number;
  /** epoch ms of the successful fetch that produced this snapshot */
  at: number;
}

export interface ActivitySnapshot {
  items: IndexerActivityItem[];
  at: number;
}

/* ─────────────────────────── Portfolio ─────────────────────────── */

export async function getPortfolioSnapshot(address: string): Promise<PortfolioSnapshot | null> {
  if (!address) return null;
  try {
    const raw = await AsyncStorage.getItem(PORTFOLIO_PREFIX + address);
    if (!raw) return null;
    const snap = JSON.parse(raw) as PortfolioSnapshot;
    if (!snap || !Array.isArray(snap.assets)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Persist a portfolio snapshot. Guarded: an empty asset list is treated as a
 *  non-result and is NOT written, so a transient offline/empty fetch can never
 *  poison a previously good snapshot. */
export async function setPortfolioSnapshot(address: string, assets: CachedAsset[], totalUsd: number): Promise<void> {
  if (!address || !Array.isArray(assets) || assets.length === 0) return;
  try {
    const snap: PortfolioSnapshot = { assets, totalUsd, at: Date.now() };
    await AsyncStorage.setItem(PORTFOLIO_PREFIX + address, JSON.stringify(snap));
  } catch {
    /* best-effort cache write */
  }
}

/* ─────────────────────────── Activity ─────────────────────────── */

export async function getActivitySnapshot(address: string): Promise<ActivitySnapshot | null> {
  if (!address) return null;
  try {
    const raw = await AsyncStorage.getItem(ACTIVITY_PREFIX + address);
    if (!raw) return null;
    const snap = JSON.parse(raw) as ActivitySnapshot;
    if (!snap || !Array.isArray(snap.items)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Persist an activity snapshot. An empty list IS a valid result for activity
 *  (a brand-new wallet legitimately has no transactions), but to avoid clobbering
 *  a good snapshot with an empty one we only write non-empty lists. */
export async function setActivitySnapshot(address: string, items: IndexerActivityItem[]): Promise<void> {
  if (!address || !Array.isArray(items) || items.length === 0) return;
  try {
    const snap: ActivitySnapshot = { items, at: Date.now() };
    await AsyncStorage.setItem(ACTIVITY_PREFIX + address, JSON.stringify(snap));
  } catch {
    /* best-effort cache write */
  }
}
