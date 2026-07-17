/**
 * Native LITHO activity from the Makalu explorer API.
 *
 * The indexer only records LEP100 token Transfer EVENTS (eth_getLogs) —
 * native LITHO value transfers emit no logs, so they never reach
 * /activity/:address. That made the wallet's core asset invisible in
 * Activity ("received 70,000 LITHO, zero rows"). The chain explorer
 * (makalu.litho.ai) indexes full transactions and exposes
 * GET /api/txs?address=<0x|litho1>.
 *
 * Field trust: the `value` field was cross-checked against
 * eth_getTransactionByHash on rpc.litho.ai — it is wei (18 decimals),
 * byte-for-byte identical (verified 2026-07-15).
 *
 * Rows are mapped into the IndexerActivityItem shape so the Activity
 * screen renders them through the exact same pipeline, merged + deduped
 * with the indexer feed by tx hash.
 */
import { formatUnits } from 'ethers';
import type { IndexerActivityItem } from './indexer';

const MAKALU_API = 'https://makalu.litho.ai/api';
// Kamet runs the SAME explorer codebase — identical /api/txs shape
// (verified live 2026-07-17), so both chains share one fetcher.
const KAMET_API  = 'https://kamet.litho.ai/api';

interface ExplorerTx {
  hash?: string;
  evmHash?: string;
  blockHeight?: number;
  value?: string;
  txType?: string;
  success?: boolean;
  inputData?: string;
  timestamp?: string;
  evmFromAddr?: string;
  evmToAddr?: string;
}

/** Recent native-LITHO transfers involving `address` on MAKALU, newest first. */
export function fetchNativeLithoActivity(address: string, timeoutMs = 8_000): Promise<IndexerActivityItem[]> {
  return fetchExplorerNativeActivity(MAKALU_API, '', 'makalu', address, timeoutMs);
}

/** Recent native-LITHO transfers involving `address` on KAMET, newest first.
 *  Labeled "(Kamet)" so rows are distinguishable from Makalu LITHO moves. */
export function fetchKametNativeActivity(address: string, timeoutMs = 8_000): Promise<IndexerActivityItem[]> {
  return fetchExplorerNativeActivity(KAMET_API, ' (Kamet)', 'kamet', address, timeoutMs);
}

async function fetchExplorerNativeActivity(
  api: string,
  labelSuffix: string,
  idPrefix: string,
  address: string,
  timeoutMs: number,
): Promise<IndexerActivityItem[]> {
  if (!address) return [];
  const me = address.toLowerCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${api}/txs?address=${encodeURIComponent(address)}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { txs?: ExplorerTx[] } | null;
    const out: IndexerActivityItem[] = [];
    for (const t of json?.txs ?? []) {
      const from = (t.evmFromAddr ?? '').toLowerCase();
      const to   = (t.evmToAddr ?? '').toLowerCase();
      // The endpoint returns recent GLOBAL txs when the address is unknown —
      // keep only rows that genuinely involve this wallet.
      if (from !== me && to !== me) continue;
      // Native value transfers only (plain calls, no calldata). LEP100 token
      // transfers arrive via the indexer feed — skipping them here prevents
      // double rows for the same tx.
      if ((t.inputData ?? '0x') !== '0x') continue;
      let wei = 0n;
      try { wei = BigInt(t.value ?? '0'); } catch { continue; }
      if (wei <= 0n) continue;
      const isReceive = to === me;
      const txHash = t.evmHash || t.hash || '';
      if (!txHash) continue;
      out.push({
        id:           `${idPrefix}:${txHash}`,
        type:         isReceive ? 'receive' : 'send',
        symbol:       'LITHO',
        amount:       formatUnits(wei, 18),
        counterparty: isReceive ? from : to,
        txHash,
        blockNumber:  t.blockHeight,
        ts:           t.timestamp,
        status:       t.success === false ? 'failed' : 'confirmed',
        title:        `${isReceive ? 'Received' : 'Sent'} LITHO${labelSuffix}`,
      });
    }
    return out.slice(0, 50);
  } catch {
    return []; // explorer unreachable — LEP100 feed still renders
  } finally {
    clearTimeout(timer);
  }
}

/** Merge indexer (LEP100) + native rows: dedupe by tx hash (indexer wins),
 *  newest first; rows without a timestamp sink to the end. */
export function mergeActivityFeeds(
  indexer: IndexerActivityItem[],
  native: IndexerActivityItem[],
): IndexerActivityItem[] {
  const seen = new Set(indexer.map((i) => i.txHash).filter(Boolean));
  const merged = [...indexer, ...native.filter((n) => !n.txHash || !seen.has(n.txHash))];
  return merged.sort((a, b) => (b.ts ? Date.parse(b.ts) : 0) - (a.ts ? Date.parse(a.ts) : 0));
}
