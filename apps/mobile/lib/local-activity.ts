/**
 * The wallet's own send history (mobile).
 *
 * Only native LITHO on Lithosphere Mainnet has a feed (the explorer), so most
 * sends — tokens on 9005, the external EVM chains, custom networks, BTC, SOL,
 * ATOM — would never appear in Activity at all. Every successful send is
 * recorded here (keyed by the wallet's EVM address, in AsyncStorage) the
 * moment the broadcast returns a hash, with what the detail sheet needs:
 * recipient, sender, network, token contract and memo. The activity hook
 * merges it into the feed, deduped against the explorer by tx hash.
 *
 * History is kept (client 2026-10-11: "keep all the history in the
 * activity") — entries are no longer dropped after 24h, only past the newest
 * MAX. A send that never confirms doesn't stay "Pending" for ever:
 * resolvePendingActivity() checks each pending row on its own chain and
 * marks it confirmed or failed — failed also when, a day on, the chain has no
 * record of it at all (dropped from the mempool).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IndexerActivityItem } from './indexer';

const PREFIX = 'local_activity:';
const MAX = 500;
/** After this long, a send its chain has never heard of counts as dropped. */
const DROPPED_AFTER_MS = 24 * 60 * 60 * 1000;
// Cap per resolve pass — this runs on every Activity screen mount + pull-to-
// refresh; pending rows are rare, but don't fan out unbounded.
const MAX_RESOLVE_PER_PASS = 12;
const LOOKUP_TIMEOUT_MS = 6_000;

export type SendChainKind = 'evm' | 'bitcoin' | 'solana' | 'cosmos';

/** A send recorded on this device. Shaped to render as an IndexerActivityItem;
 *  `type` is always 'send' and `counterparty` is the recipient. */
export interface LocalActivityItem extends IndexerActivityItem {
  type:          'send';
  status:        'pending' | 'confirmed' | 'failed';
  /** epoch ms of the broadcast. */
  tsMs:          number;
  /** EVM chain the send was broadcast on (absent for BTC/SOL/ATOM). */
  chainId?:      number;
  chain?:        SendChainKind;
  networkName?:  string;
  fromAddress?:  string;
  /** ERC-20 contract, for a token send. */
  tokenAddress?: string;
  memo?:         string;
}

/** What the send screen knows at broadcast time. */
export interface LocalActivityInput {
  hash:          string;
  sym:           string;
  amount:        string;   // human-readable, e.g. "1.5"
  ts:            number;   // epoch ms
  type?:         'send';
  /** The chain this was actually broadcast on — what lets
   *  resolvePendingActivity check its receipt. */
  chainId?:      number;
  chain?:        SendChainKind;
  networkName?:  string;
  to?:           string;
  from?:         string;
  tokenAddress?: string;
  memo?:         string;
}

const keyFor = (addr: string) => PREFIX + (addr || '').toLowerCase();

/** The wallet's recorded sends, newest first. */
export async function getLocalActivity(addr: string): Promise<LocalActivityItem[]> {
  if (!addr) return [];
  try {
    const raw = await AsyncStorage.getItem(keyFor(addr));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return (arr as LocalActivityItem[]).filter((t) => t && typeof t.tsMs === 'number' && !!t.txHash
      // Rows saved before sends recorded their chain can never be checked;
      // those still pending go after a day, as they always did.
      && !(t.status === 'pending' && t.chainId == null && !t.chain && now - t.tsMs > DROPPED_AFTER_MS));
  } catch {
    return [];
  }
}

/** Record a just-broadcast send. Called AFTER a tx hash is returned — never
 *  touches signing/broadcast. Deduped by hash; best-effort (a storage
 *  failure just skips the row, it never breaks the send). */
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
      chain:   tx.chain ?? (tx.chainId != null ? 'evm' : undefined),
      ...(tx.to ? { counterparty: tx.to } : {}),
      ...(tx.from ? { fromAddress: tx.from } : {}),
      ...(tx.networkName ? { networkName: tx.networkName } : {}),
      ...(tx.tokenAddress ? { tokenAddress: tx.tokenAddress } : {}),
      ...(tx.memo ? { memo: tx.memo } : {}),
    };
    const next = [item, ...arr].slice(0, MAX);
    await AsyncStorage.setItem(keyFor(addr), JSON.stringify(next));
  } catch {
    /* storage full / disabled — non-fatal, just skip the row */
  }
}

/** confirmed / failed once the chain has settled it, 'unknown' while the
 *  chain has no record of it, null when it couldn't be asked (or is still
 *  pending). */
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

async function lookupEvm(t: LocalActivityItem): Promise<Lookup> {
  let evm: typeof import('./evm-external');
  try { evm = await import('./evm-external'); } catch { return null; }
  if (!evm.getExtEvmChain(t.chainId!)) return null; // no RPC for this chain
  const provider = evm.getExtEvmProvider(t.chainId!);
  const timed = <T,>(p: Promise<T>) => Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), LOOKUP_TIMEOUT_MS))]);
  try {
    const receipt = await timed(provider.getTransactionReceipt(t.txHash!));
    if (receipt === 'timeout') return null;
    if (receipt) return receipt.status === 1 ? 'confirmed' : 'failed';
    const tx = await timed(provider.getTransaction(t.txHash!));
    if (tx === 'timeout') return null;
    return tx ? null : 'unknown';
  } catch {
    return null;
  }
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
    const s = value[0];
    if (!s) return 'unknown';
    if (s.err) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'confirmed' : null;
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

function lookup(t: LocalActivityItem): Promise<Lookup> {
  if (t.chainId != null) return lookupEvm(t);
  if (t.chain === 'bitcoin') return lookupBitcoin(t.txHash!);
  if (t.chain === 'solana') return lookupSolana(t.txHash!);
  if (t.chain === 'cosmos') return lookupCosmos(t.txHash!);
  return Promise.resolve(null);
}

/** Check each still-pending row on its OWN chain and settle it in place:
 *  confirmed, failed (reverted), or failed because a day on the chain has
 *  no record of it. A chain that can't be reached leaves the row pending for
 *  the next call (screen mount / pull-to-refresh). Returns the up-to-date
 *  list, newest first. */
export async function resolvePendingActivity(addr: string): Promise<LocalActivityItem[]> {
  const arr = await getLocalActivity(addr);
  if (!addr) return arr;
  const pending = arr.filter((t) => t.status === 'pending').slice(0, MAX_RESOLVE_PER_PASS);
  if (pending.length === 0) return arr;

  const now = Date.now();
  const results = await Promise.allSettled(pending.map(async (t) => {
    const r = await lookup(t);
    if (r === 'confirmed' || r === 'failed') return { hash: t.txHash!, status: r };
    if (r === 'unknown' && now - t.tsMs > DROPPED_AFTER_MS) return { hash: t.txHash!, status: 'failed' as const };
    return null;
  }));

  const updates = new Map<string, 'confirmed' | 'failed'>();
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) updates.set(r.value.hash, r.value.status);
  }
  if (updates.size === 0) return arr;

  const next = arr.map((t) => (t.txHash && updates.has(t.txHash) ? { ...t, status: updates.get(t.txHash)! } : t));
  try { await AsyncStorage.setItem(keyFor(addr), JSON.stringify(next)); } catch { /* best-effort */ }
  return next;
}
