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

import { fetchChainHistory, type HistoryAddresses, type HistoryRow } from '@thanos/sdk-core';

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
  /** Stable id — a send's txid/signature. Rows from the explorers use the
   *  explorer row id (a swap's legs share one hash) and set `hash`. */
  id:         string;
  /** The tx hash, when `id` isn't it. */
  hash?:      string;
  /** Lithosphere Mainnet: its own transaction hash (64 hex, no 0x), what
   *  LithoScan shows first. The hash above stays the 0x EVM hash. From the
   *  explorer, or looked up once for a send made here (saveNativeHash). */
  nativeHash?: string;
  chain:      'bitcoin' | 'evm' | 'solana' | 'cosmos';
  /** EVM chain it went out on — what lets resolvePendingTxs check it. */
  chainId?:   number;
  /** Network name from the explorer, e.g. "Base". */
  network?:   string;
  /** 'in' for a receive (from the explorers); sends may omit it. */
  direction?: 'in' | 'out';
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

/** Save a Lithosphere transaction's native hash onto every row with that 0x
 *  EVM hash (a swap's legs share one), so it's looked up only once. */
export function saveNativeHash(evmHash: string, nativeHash: string): void {
  const key = evmHash.toLowerCase();
  const all = loadPendingTxs();
  let changed = false;
  for (const t of all) {
    if ((t.hash ?? t.id).toLowerCase() === key && t.nativeHash !== nativeHash) { t.nativeHash = nativeHash; changed = true; }
  }
  if (changed) saveAll(all);
}

/* ─── History read layer ────────────────────────────────────────────────
   The Activity feed is this store: every send recorded at broadcast, plus
   every transfer in and out on the networks the explorers cover
   (syncExplorerHistory) — including ones made before Thanos or from another
   wallet. The Thanos indexer only covers the Makalu testnet, which the
   wallet no longer includes, so nothing else reports them.

   History is kept (client 2026-10-15: sends "still pending" a day later) —
   confirmed and failed rows stay, only the newest MAX_LOCAL are kept, and
   a send doesn't stay "Pending" for ever: resolvePendingTxs() checks it on
   its own chain. Same rules as the mobile app, desktop and the extension. */

/** Max entries to retain in the local store. */
const MAX_LOCAL = 500;
/** After this long, a send its chain has never heard of counts as dropped. */
const DROPPED_AFTER_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 6_000;
const MAX_RESOLVE_PER_PASS = 12;

/** Cap the store to the newest MAX_LOCAL (by broadcast time). Writes back
 *  only when something was dropped. Returns the surviving list, newest first. */
export function prunePendingTxs(): PendingTx[] {
  const all = loadPendingTxs();
  const kept = [...all].sort((a, b) => (b.broadcastAt || 0) - (a.broadcastAt || 0)).slice(0, MAX_LOCAL);
  if (kept.length !== all.length) saveAll(kept);
  return kept;
}

/** A recorded transaction projected into the indexer's activity shape, so
 *  the Activity feed renders it through the same row projector. `local`
 *  marks it as coming from this store. */
export interface LocalActivityItem {
  id:            string;
  type:          'send' | 'receive';
  symbol:        string;
  amount:        string;
  counterparty?: string;
  txHash:        string;
  /** Lithosphere Mainnet's native hash, once known. */
  nativeHash?:   string;
  ts?:           string;
  status:        'pending' | 'confirmed' | 'failed';
  /** Network name, when known — EVM sends no explorer has matched yet
   *  carry only their chainId. */
  network?:      string;
  chain:         PendingTx['chain'];
  chainId?:      number;
  local:         true;
}

const CHAIN_NETWORK: Partial<Record<PendingTx['chain'], string>> = {
  bitcoin: 'Bitcoin', solana: 'Solana', cosmos: 'Cosmos Hub',
};

/**
 * The wallet's history as activity rows, newest first: pending sends, then
 * settled ones (confirmed / failed) and transfers from the explorers. A
 * replaced (fee-bumped) tx is hidden — its replacement is the live one.
 * Rows whose hash the caller already shows (`indexedHashes`) are skipped.
 */
export function pendingActivityRows(indexedHashes: Iterable<string>): LocalActivityItem[] {
  const seen = new Set<string>();
  for (const h of indexedHashes) if (h) seen.add(h.toLowerCase());
  return prunePendingTxs()
    .filter(t => t.status !== 'replaced' && !seen.has((t.hash ?? t.id).toLowerCase()))
    .map(t => ({
      id:           t.id,
      type:         t.direction === 'in' ? 'receive' as const : 'send' as const,
      symbol:       t.symbol,
      amount:       t.amount,
      counterparty: t.recipient,
      txHash:       t.hash ?? t.id,
      nativeHash:   t.nativeHash,
      ts:           new Date(t.broadcastAt).toISOString(),
      status:       t.status === 'broadcast' ? 'pending' as const : t.status === 'failed' ? 'failed' as const : 'confirmed' as const,
      network:      t.network ?? CHAIN_NETWORK[t.chain],
      chain:        t.chain,
      chainId:      t.chainId,
      local:        true as const,
    }));
}

/* ─── Settling pending sends on their own chain ─────────────────────── */

type Lookup = 'confirmed' | 'failed' | 'unknown' | null;

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const timed = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), LOOKUP_TIMEOUT_MS))]);

async function lookupEvmOn(chainId: number, hash: string): Promise<Lookup> {
  let m: typeof import('./evm-chains');
  try { m = await import('./evm-chains'); } catch { return null; }
  if (!m.findEvmChain(chainId)) return null;
  try {
    const provider = m.getEvmProvider(chainId);
    const receipt = await timed(provider.getTransactionReceipt(hash));
    if (receipt === 'timeout') return null;
    if (receipt) return receipt.status === 1 ? 'confirmed' : 'failed';
    const tx = await timed(provider.getTransaction(hash));
    if (tx === 'timeout') return null;
    return tx ? null : 'unknown';
  } catch {
    return null;
  }
}

/** Sends saved before the chain was recorded: Lithosphere Mainnet first,
 *  then the other built-in EVM networks; most must answer for "unknown". */
async function lookupEvmAnywhere(hash: string): Promise<Lookup> {
  let m: typeof import('./evm-chains');
  try { m = await import('./evm-chains'); } catch { return null; }
  const ids = [9005, ...m.EVM_CHAINS.map(c => c.chainId).filter(id => id !== 9005)];
  let answered = 0;
  for (const id of ids) {
    const r = await lookupEvmOn(id, hash);
    if (r === 'confirmed' || r === 'failed') return r;
    if (r === 'unknown') answered++;
  }
  return answered >= Math.min(5, ids.length) ? 'unknown' : null;
}

async function lookupBitcoin(hash: string): Promise<Lookup> {
  const r = await fetchJson(`https://mempool.space/api/tx/${encodeURIComponent(hash)}/status`);
  if (!r) return null;
  if (r.status === 404) return 'unknown';
  return (r.body as { confirmed?: boolean } | null)?.confirmed ? 'confirmed' : null;
}

async function lookupSolana(sig: string): Promise<Lookup> {
  for (const url of ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com']) {
    const r = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[sig], { searchTransactionHistory: true }] }),
    });
    const value = (r?.body as { result?: { value?: Array<{ err: unknown; confirmationStatus?: string } | null> } } | null)?.result?.value;
    if (!Array.isArray(value)) continue;
    const st = value[0];
    if (!st) return 'unknown';
    if (st.err) return 'failed';
    return st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized' ? 'confirmed' : null;
  }
  return null;
}

async function lookupCosmos(hash: string): Promise<Lookup> {
  const r = await fetchJson(`https://cosmos-rest.publicnode.com/cosmos/tx/v1beta1/txs/${encodeURIComponent(hash)}`);
  if (!r) return null;
  const code = (r.body as { tx_response?: { code?: number } } | null)?.tx_response?.code;
  if (r.status === 200 && typeof code === 'number') return code === 0 ? 'confirmed' : 'failed';
  return r.status === 404 || r.status === 400 ? 'unknown' : null;
}

function lookup(t: PendingTx): Promise<Lookup> {
  const hash = t.hash ?? t.id;
  if (t.chain === 'bitcoin') return lookupBitcoin(hash);
  if (t.chain === 'solana') return lookupSolana(hash);
  if (t.chain === 'cosmos') return lookupCosmos(hash);
  return t.chainId != null ? lookupEvmOn(t.chainId, hash) : lookupEvmAnywhere(hash);
}

let resolving = false;
/** Check each still-pending send on its own chain and settle it in place:
 *  confirmed, failed (reverted), or failed because a day on its chain has
 *  no record of it. An unreachable chain leaves it pending for next time.
 *  Returns true when anything changed. */
export async function resolvePendingTxs(): Promise<boolean> {
  if (resolving || typeof window === 'undefined') return false;
  resolving = true;
  try {
    const pending = loadPendingTxs().filter(t => t.status === 'broadcast').slice(0, MAX_RESOLVE_PER_PASS);
    if (pending.length === 0) return false;
    const now = Date.now();
    const results = await Promise.allSettled(pending.map(async (t) => {
      const r = await lookup(t);
      if (r === 'confirmed' || r === 'failed') return { id: t.id, status: r };
      if (r === 'unknown' && now - (t.broadcastAt || 0) > DROPPED_AFTER_MS) return { id: t.id, status: 'failed' as const };
      return null;
    }));
    let changed = false;
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      if (r.value.status === 'confirmed') markConfirmed(r.value.id); else markFailed(r.value.id);
      changed = true;
    }
    return changed;
  } finally {
    resolving = false;
  }
}

/* ─── Full history from each network's explorer ─────────────────────── */

/** Every network is read at most this often per wallet; in between, each
 *  refresh reads Lithosphere Mainnet alone (one request). */
const FULL_SYNC_MS = 5 * 60 * 1000;
const syncKey = (evm: string) => `thanos.history_sync:${evm.toLowerCase()}`;
/** Etherscan API V2 key — turns on BNB Chain and Linea history. */
const ETHERSCAN_KEY = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || undefined;

export type OtherHistoryAddresses = Omit<HistoryAddresses, 'evm'>;

/** The wallet's Bitcoin / Solana / Cosmos addresses for syncExplorerHistory,
 *  derived as for their balances (Solana and Cosmos need a phrase). The
 *  chain libraries load on demand. */
export async function historyAddresses(seed?: string[], privateKey?: string): Promise<OtherHistoryAddresses> {
  const mnemonic = seed?.length ? seed.join(' ') : '';
  const out: OtherHistoryAddresses = {};
  if (!mnemonic && !privateKey) return out;
  await Promise.all([
    import('./bitcoin').then(m => {
      out.bitcoin = m.getBitcoinAddressFromSource(privateKey ? { kind: 'privateKey', privateKey } : { kind: 'mnemonic', mnemonic });
    }).catch(() => {}),
    // O-01 (H-1 residual, non-signing): both addresses come from the
    // signing Worker's own cache, not derived from `mnemonic` here.
    mnemonic ? import('./signer-client').then(async m => { out.solana = (await m.signerSolanaAddress()).address; }).catch(() => {}) : null,
    mnemonic ? import('./signer-client').then(async m => { out.cosmos = (await m.signerCosmosAddress()).address; }).catch(() => {}) : null,
  ]);
  return out;
}

/** Fold explorer rows into the saved list: newest first, newest MAX_LOCAL
 *  kept. A row is saved once, under its own id; a send saved at broadcast
 *  (keyed by its hash) takes the row's verdict — and, on Lithosphere, its
 *  native hash — instead of being listed twice. `changed` is false when
 *  nothing that survives the cap moved. */
export function mergeHistoryRows(saved: PendingTx[], rows: HistoryRow[], now = Date.now()): { list: PendingTx[]; changed: boolean } {
  const list = saved.map(t => ({ ...t }));
  const byKey = new Map<string, PendingTx>();
  for (const t of list) {
    byKey.set(t.id.toLowerCase(), t);
    // Saved under its hash (sends, older LITHO rows): matched on hash and
    // direction, so a swap's incoming leg still gets its own row.
    if (!t.hash) byKey.set(`${t.id.toLowerCase()}|${t.direction ?? 'out'}`, t);
  }
  const added = new Set<PendingTx>();
  let changed = false;
  for (const r of rows) {
    const id = r.id || r.hash;
    if (!id) continue;
    const hit = byKey.get(id.toLowerCase()) ?? byKey.get(`${r.hash.toLowerCase()}|${r.direction}`);
    if (hit) {
      if (hit.status === 'broadcast' && r.status !== 'pending') { hit.status = r.status; hit.updatedAt = now; changed = true; }
      if (!hit.network) { hit.network = r.networkName; changed = true; }
      if (r.nativeHash && hit.nativeHash !== r.nativeHash) { hit.nativeHash = r.nativeHash; changed = true; }
      continue;
    }
    const tx: PendingTx = {
      id, hash: r.hash, chain: r.chain,
      ...(r.nativeHash ? { nativeHash: r.nativeHash } : {}),
      ...(r.chainId != null ? { chainId: r.chainId } : {}),
      network: r.networkName, direction: r.direction,
      symbol: r.sym, recipient: r.counterparty ?? '', amount: r.amount,
      ...(r.tokenAddress ? { tokenAddress: r.tokenAddress } : {}),
      status: r.status === 'pending' ? 'broadcast' : r.status,
      broadcastAt: r.ts, updatedAt: now,
    };
    list.push(tx); added.add(tx); byKey.set(id.toLowerCase(), tx);
  }
  const kept = list.sort((a, b) => (b.broadcastAt || 0) - (a.broadcastAt || 0)).slice(0, MAX_LOCAL);
  // A row older than everything kept would only be dropped again.
  return { list: kept, changed: changed || kept.some(t => added.has(t)) };
}

let syncing = false;
/** Save the wallet's transfers from each network's explorer (sdk-core
 *  fetchChainHistory) into the history: every network the explorers cover
 *  at most every FULL_SYNC_MS per wallet, Lithosphere Mainnet alone in
 *  between. `others` are its non-EVM addresses (historyAddresses).
 *  Returns true when anything changed. */
export async function syncExplorerHistory(address: string, others: OtherHistoryAddresses = {}): Promise<boolean> {
  if (!address || syncing || typeof window === 'undefined') return false;
  syncing = true;
  try {
    let last = 0;
    try { last = Number(localStorage.getItem(syncKey(address))) || 0; } catch { /* storage off */ }
    const full = Date.now() - last >= FULL_SYNC_MS;
    // Tokens the wallet lists (built-in + user-added) always show.
    const knownTokens = full
      ? await import('./custom-assets').then(m => m.allEvmTokens().map(t => ({ chainId: t.chainId, address: t.address }))).catch(() => [])
      : [];
    const { rows } = await fetchChainHistory({ evm: address, ...others }, {
      sources:      full ? 'all' : 'lithosphere',
      lithoPages:   full ? 5 : 1,
      // Solana skips the per-transaction lookup for these.
      knownHashes:  loadPendingTxs().map(t => t.hash ?? t.id),
      knownTokens,
      etherscanKey: ETHERSCAN_KEY,
    });
    // Stamped even when a source failed: it's retried next window, not on
    // every refresh.
    if (full) { try { localStorage.setItem(syncKey(address), String(Date.now())); } catch { /* storage off */ } }
    // Re-read: a send may have been saved while the explorers answered.
    const { list, changed } = mergeHistoryRows(loadPendingTxs(), rows);
    if (changed) saveAll(list);
    return changed;
  } finally {
    syncing = false;
  }
}
