/**
 * Optimistic local activity log (mobile).
 *
 * Only native LITHO on Lithosphere Mainnet has a feed (the explorer), so most
 * sends would never appear in the Activity feed at all. We record every
 * successful send locally (keyed by the wallet's EVM address, backed by
 * AsyncStorage) the instant the broadcast returns a hash, and the activity
 * hook merges it into the feed, deduped against the explorer by tx hash. Once
 * the explorer reports the tx the local copy drops out, so the real
 * (confirmed) row replaces the optimistic "Pending" one with no double entry.
 *
 * Entries are shaped like IndexerActivityItem so they render through the same
 * row code. status starts 'pending'. The list is capped at 50 entries and
 * entries older than 24h are dropped on read, so a dropped or failed tx never
 * lingers forever.
 *
 * RESOLUTION (added 2026-09-16, client-reported "some txns show pending yet
 * sent already"): Mainnet native LITHO gets promoted out of "Pending" by the
 * explorer feed (explorer-activity.ts). Every other send — tokens on 9005,
 * the external EVM chains (Ethereum/BNB/Polygon/Base/Arbitrum/Linea/
 * Optimism/Avalanche) and custom networks — has no explorer coverage, and
 * those rows stayed "Pending" forever. resolvePendingActivity() below closes
 * that gap directly: it polls the tx's OWN chain RPC for a receipt and flips
 * the stored status in place.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IndexerActivityItem } from './indexer';

const PREFIX = 'local_activity:';
const MAX = 50;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Cap per resolve pass — this runs on every Activity screen mount + pull-to-
// refresh; unbounded RPC fan-out on a large local backlog would be wasteful
// and slow to paint. 50 stored rows max anyway, but pending ones are rare.
const MAX_RESOLVE_PER_PASS = 12;
const RECEIPT_TIMEOUT_MS = 6_000;

/** A locally-recorded, not-yet-indexed send. Shaped to render as an
 *  IndexerActivityItem; `type` is always 'send'. The human-readable `amount`
 *  (what the user typed) is stored — pending rows are rendered without
 *  formatUnits, unlike indexer rows. `tsMs` is kept for the 24h expiry-on-
 *  read; `ts` is the ISO string the UI already understands. `chainId` is
 *  what lets resolvePendingActivity find the right RPC to check — absent on
 *  rows recorded before this field existed, which just stay unresolved by
 *  this path (they still resolve via the explorer feeds if on a Litho chain). */
export interface LocalActivityItem extends IndexerActivityItem {
  type:     'send';
  status:   'pending' | 'confirmed' | 'failed';
  /** epoch ms — used only for expiry, never rendered. */
  tsMs:     number;
  chainId?: number;
}

/** Minimal input at the call site: everything else is derived. */
export interface LocalActivityInput {
  hash:     string;
  sym:      string;
  amount:   string;   // human-readable, e.g. "1.5"
  ts:       number;   // epoch ms
  type?:    'send';
  /** The chain this was actually broadcast on — what lets
   *  resolvePendingActivity check its receipt. */
  chainId?: number;
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
      id:      tx.hash,
      txHash:  tx.hash,
      type:    'send',
      symbol:  tx.sym,
      amount:  String(tx.amount).replace(/^[+-]/, ''),
      ts:      new Date(tx.ts).toISOString(),
      tsMs:    tx.ts,
      status:  'pending',
      chainId: tx.chainId,
    };
    const next = [item, ...arr].slice(0, MAX);
    await AsyncStorage.setItem(keyFor(addr), JSON.stringify(next));
  } catch {
    /* storage full / disabled — non-fatal, just skip the optimistic entry */
  }
}

/** Poll each still-pending row's OWN chain for a receipt and flip its status
 *  in place — see the module doc for why this exists (external EVM chains +
 *  non-native Mainnet assets have no indexer/explorer coverage at all, so
 *  nothing else was ever going to un-stick them). Rows with no chainId (rows
 *  from before this field, or BTC/SOL/ATOM sends) are left untouched. Best-effort —
 *  a chain that can't be reached just stays pending and gets retried on the
 *  next call (screen mount / pull-to-refresh). Returns the up-to-date list
 *  (same list getLocalActivity would return) so callers don't need a second
 *  read. */
export async function resolvePendingActivity(addr: string): Promise<LocalActivityItem[]> {
  const arr = await getLocalActivity(addr);
  if (!addr) return arr;
  const pending = arr.filter((t) => t.status === 'pending' && t.chainId != null).slice(0, MAX_RESOLVE_PER_PASS);
  if (pending.length === 0) return arr;

  let evm: typeof import('./evm-external') | null = null;
  try { evm = await import('./evm-external'); } catch { return arr; }

  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);

  const resolutions = await Promise.allSettled(pending.map(async (t) => {
    const chain = evm!.getExtEvmChain(t.chainId!);
    if (!chain) return null; // not a chain this module knows an RPC for
    const receipt = await withTimeout(evm!.getExtEvmProvider(t.chainId!).getTransactionReceipt(t.txHash!), RECEIPT_TIMEOUT_MS);
    if (!receipt) return null; // still pending, or unreachable — leave as-is
    const status: 'confirmed' | 'failed' = receipt.status === 1 ? 'confirmed' : 'failed';
    return { hash: t.txHash!, status };
  }));

  const updates = new Map<string, 'confirmed' | 'failed'>();
  for (const r of resolutions) {
    if (r.status === 'fulfilled' && r.value) updates.set(r.value.hash, r.value.status);
  }
  if (updates.size === 0) return arr;

  const next = arr.map((t) => (t.txHash && updates.has(t.txHash) ? { ...t, status: updates.get(t.txHash)! } : t));
  try { await AsyncStorage.setItem(keyFor(addr), JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}
