/**
 * Local pending-transaction store.
 *
 * Persists the user's broadcast-but-not-yet-confirmed txs in localStorage
 * so the UI can:
 *   - show a "Pending" panel in the Transactions view
 *   - offer a "Bump fee" affordance for BTC RBF
 *   - reconcile against indexer activity once the tx confirms
 *
 * The store is intentionally small and local. The backend doesn't need
 * to know about pending txs — the indexer will pick them up via Transfer
 * logs once they confirm. This is purely a UX layer.
 *
 * Storage key: thanos.pending_txs (JSON array of PendingTx)
 */

export type PendingTxStatus = 'broadcast' | 'replaced' | 'confirmed' | 'failed';

/** BTC-specific snapshot needed to build an RBF replacement. */
export interface BtcSnapshot {
  /** UTXOs spent by the original tx (txid + vout + value sat). Required
   *  so the replacement re-spends the same inputs. */
  inputs:        Array<{ txid: string; vout: number; valueSat: number }>;
  /** Recipient address (same on the replacement). */
  recipient:     string;
  /** Amount paid to the recipient (same on the replacement; the fee bump
   *  comes out of change, not out of the recipient's output). */
  amountSats:    number;
  /** The sender's own bc1q… address — used as the change destination on
   *  the replacement. */
  changeAddress: string;
  /** sat/vB used on the original broadcast. The replacement must beat it. */
  feeRateSatPerVb: number;
  /** Total fee paid (sats) on the original. */
  feeSats:       number;
  /** Rough vsize used to compute the fee. Inputs + outputs heuristic. */
  vbytes:        number;
}

export interface PendingTx {
  /** Stable id — for BTC this IS the txid; for other chains, txid/signature too. */
  id:         string;
  chain:      'bitcoin' | 'evm' | 'solana';
  symbol:     string;
  recipient:  string;
  /** Human-readable amount as entered by the user. */
  amount:     string;
  /** Optional contract address for EVM ERC-20 sends. */
  tokenAddress?: string;
  status:     PendingTxStatus;
  /** Original broadcast time (ms since epoch). */
  broadcastAt: number;
  /** Last status update (ms). */
  updatedAt:  number;
  /** When status becomes 'replaced', this points to the replacement's id. */
  replacedBy?: string;
  /** BTC-only: snapshot used to build an RBF replacement. */
  btc?:       BtcSnapshot;
}

const STORAGE_KEY = 'thanos.pending_txs';

export function loadPendingTxs(): PendingTx[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingTx[];
  } catch {
    return [];
  }
}

function saveAll(list: PendingTx[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** Append a tx (or replace if id already exists — useful for status updates). */
export function recordPendingTx(tx: PendingTx): void {
  const all = loadPendingTxs();
  const idx = all.findIndex(t => t.id === tx.id);
  if (idx >= 0) all[idx] = { ...tx, updatedAt: Date.now() };
  else          all.unshift({ ...tx, updatedAt: Date.now() });
  saveAll(all);
}

export function findPendingTx(id: string): PendingTx | null {
  return loadPendingTxs().find(t => t.id === id) ?? null;
}

/** Mark a tx replaced by a new one (RBF). Both tx rows remain so the user
 *  can see the chain of replacements; the UI hides the superseded ones. */
export function markReplaced(originalId: string, replacementId: string): void {
  const all = loadPendingTxs();
  const idx = all.findIndex(t => t.id === originalId);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: 'replaced', replacedBy: replacementId, updatedAt: Date.now() };
  saveAll(all);
}

export function markConfirmed(id: string): void {
  const all = loadPendingTxs();
  const idx = all.findIndex(t => t.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: 'confirmed', updatedAt: Date.now() };
  saveAll(all);
}

export function markFailed(id: string): void {
  const all = loadPendingTxs();
  const idx = all.findIndex(t => t.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status: 'failed', updatedAt: Date.now() };
  saveAll(all);
}

/** Live (non-replaced, non-confirmed, non-failed) BTC txs that can be bumped. */
export function bumpableBtcTxs(): PendingTx[] {
  return loadPendingTxs().filter(t => t.chain === 'bitcoin' && t.status === 'broadcast' && t.btc);
}

/** Drop a tx entirely — used when the user clears history. */
export function removeTx(id: string): void {
  const next = loadPendingTxs().filter(t => t.id !== id);
  saveAll(next);
}

/* ─── Optimistic-activity read layer ────────────────────────────────────
   The Activity feed shows a locally-recorded send as a "Pending" row the
   instant it's broadcast, then drops the local copy once the indexer
   returns the same tx hash (dedup by hash → the real confirmed row wins).
   These helpers keep the store bounded (cap 50, expire >24h) and expose
   the still-unconfirmed sends as activity-shaped rows. Purely a UX layer —
   no signing/broadcast state lives here. */

/** Max entries to retain in the local store. */
const MAX_LOCAL = 50;
/** Entries older than this (ms) are pruned on read — a dropped/failed tx
 *  never lingers in the Pending list forever. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Prune the store on read: drop entries >24h old and anything already
 *  reconciled (confirmed/failed), then cap to the newest MAX_LOCAL. Writes
 *  back only when something actually changed. Returns the surviving list. */
export function prunePendingTxs(now = Date.now()): PendingTx[] {
  const all = loadPendingTxs();
  const kept = all
    .filter(t => t.status !== 'confirmed' && t.status !== 'failed')
    .filter(t => now - (t.broadcastAt || t.updatedAt || 0) < MAX_AGE_MS)
    .slice(0, MAX_LOCAL);
  if (kept.length !== all.length) saveAll(kept);
  return kept;
}

/** A pending send projected into the indexer's activity shape, so the
 *  Activity feed can render it through the same row projector. `local`
 *  flags it as unconfirmed (drives the "Pending" badge). */
export interface LocalActivityItem {
  id:            string;
  type:          'send';
  symbol:        string;
  amount:        string;
  counterparty?: string;
  txHash:        string;
  ts?:           string;
  status:        'pending';
  /** Marker: this row is local-only (not yet in the indexer result). */
  local:         true;
}

/**
 * Still-unconfirmed local sends as activity rows, deduped against the
 * indexer's hashes. Once the indexer returns a tx's hash, its local row
 * is dropped (the real confirmed row takes over) — reconciliation by hash.
 * Expires >24h entries and prunes reconciled ones as a side effect.
 */
export function pendingActivityRows(indexedHashes: Iterable<string>): LocalActivityItem[] {
  const seen = new Set<string>();
  for (const h of indexedHashes) if (h) seen.add(h.toLowerCase());
  return prunePendingTxs()
    .filter(t => t.status === 'broadcast' && !seen.has(t.id.toLowerCase()))
    .map(t => ({
      id:           t.id,
      type:         'send' as const,
      symbol:       t.symbol,
      amount:       t.amount,
      counterparty: t.recipient,
      txHash:       t.id,
      ts:           new Date(t.broadcastAt).toISOString(),
      status:       'pending' as const,
      local:        true as const,
    }));
}
