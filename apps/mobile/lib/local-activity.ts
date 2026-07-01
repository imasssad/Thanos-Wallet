/**
 * Optimistic local activity log (mobile).
 *
 * The indexer only sees LEP100 Transfer events on Makalu, so native LITHO and
 * external-chain sends never appear in the Activity feed right away — a user
 * sends a tx and nothing shows until the indexer catches up (if ever). We
 * record every successful send locally (keyed by the wallet's EVM address,
 * backed by AsyncStorage) the instant the broadcast returns a hash, and the
 * activity hook merges it into the feed, deduped against the indexer by tx
 * hash. Once the indexer reports the tx the local copy drops out, so the real
 * (confirmed) row replaces the optimistic "Pending" one with no double entry.
 *
 * Entries are shaped like IndexerActivityItem so they render through the same
 * row code. status is always 'pending' while local-only. The list is capped at
 * 50 entries and entries older than 24h are dropped on read, so a dropped or
 * failed tx never lingers forever.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IndexerActivityItem } from './indexer';

const PREFIX = 'local_activity:';
const MAX = 50;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** A locally-recorded, not-yet-indexed send. Shaped to render as an
 *  IndexerActivityItem; `status` is 'pending' and `type` is 'send'. The
 *  human-readable `amount` (what the user typed) is stored — pending rows are
 *  rendered without formatUnits, unlike indexer rows. `tsMs` is kept for the
 *  24h expiry-on-read; `ts` is the ISO string the UI already understands. */
export interface LocalActivityItem extends IndexerActivityItem {
  type:   'send';
  status: 'pending';
  /** epoch ms — used only for expiry, never rendered. */
  tsMs:   number;
}

/** Minimal input at the call site: everything else is derived. */
export interface LocalActivityInput {
  hash:   string;
  sym:    string;
  amount: string;   // human-readable, e.g. "1.5"
  ts:     number;   // epoch ms
  type?:  'send';
}

const keyFor = (addr: string) => PREFIX + (addr || '').toLowerCase();

/** Read the wallet's local (unconfirmed) sends, freshest first. Entries older
 *  than 24h are filtered out here so a stuck/failed tx self-heals. */
export async function getLocalActivity(addr: string): Promise<LocalActivityItem[]> {
  if (!addr) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(addr));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return (arr as LocalActivityItem[]).filter(
      (t) => t && typeof t.tsMs === 'number' && now - t.tsMs < TTL_MS,
    );
  } catch {
    return [];
  }
}

/** Record a just-broadcast send. Called AFTER a tx hash is returned — never
 *  touches signing/broadcast. Deduped by hash; capped at 50; best-effort (a
 *  storage failure just skips the optimistic row, it never breaks the send). */
export async function addLocalActivity(addr: string, tx: LocalActivityInput): Promise<void> {
  if (!addr || !tx.hash) return;
  try {
    const arr = await getLocalActivity(addr);
    if (arr.some((t) => t.txHash === tx.hash)) return; // already recorded
    const item: LocalActivityItem = {
      id:     tx.hash,
      txHash: tx.hash,
      type:   'send',
      symbol: tx.sym,
      amount: String(tx.amount).replace(/^[+-]/, ''),
      ts:     new Date(tx.ts).toISOString(),
      tsMs:   tx.ts,
      status: 'pending',
    };
    const next = [item, ...arr].slice(0, MAX);
    await AsyncStorage.setItem(keyFor(addr), JSON.stringify(next));
  } catch {
    /* storage full / disabled — non-fatal, just skip the optimistic entry */
  }
}
