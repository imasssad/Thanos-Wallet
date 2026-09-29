/**
 * Native LITHO activity from the Lithosphere Mainnet explorer (lithoscan.ai).
 *
 * Native LITHO value transfers emit no logs, so nothing log-based ever
 * reports them — without this feed a Mainnet send or receive only ever
 * showed as the optimistic local "Pending" row. The explorer indexes full
 * transactions and exposes GET /api/txs?address=<0x|litho1> (verified live
 * 2026-09-15: {txs:[...],total,limit,offset}).
 *
 * (This was makalu-explorer.ts; its Makalu and Kamet testnet feeds are gone —
 * Makalu isn't part of the wallet any more, 2026-09-29.)
 *
 * Rows are mapped into the IndexerActivityItem shape so the Activity
 * screen renders them through the same row code.
 */
import { formatUnits } from 'ethers';
import type { IndexerActivityItem } from './indexer';

const MAINNET_API = 'https://lithoscan.ai/api';

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

/** Recent native-LITHO transfers involving `address` on Lithosphere
 *  Mainnet, newest first — or null when the explorer couldn't be reached
 *  (so the caller can say it's offline instead of showing an empty list). */
export function fetchMainnetNativeActivity(address: string, timeoutMs = 8_000): Promise<IndexerActivityItem[] | null> {
  return fetchExplorerNativeActivity(MAINNET_API, '', 'mainnet', address, timeoutMs);
}

async function fetchExplorerNativeActivity(
  api: string,
  labelSuffix: string,
  idPrefix: string,
  address: string,
  timeoutMs: number,
): Promise<IndexerActivityItem[] | null> {
  if (!address) return [];
  const me = address.toLowerCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${api}/txs?address=${encodeURIComponent(address)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { txs?: ExplorerTx[] } | null;
    const out: IndexerActivityItem[] = [];
    for (const t of json?.txs ?? []) {
      const from = (t.evmFromAddr ?? '').toLowerCase();
      const to   = (t.evmToAddr ?? '').toLowerCase();
      // The endpoint returns recent GLOBAL txs when the address is unknown —
      // keep only rows that genuinely involve this wallet.
      if (from !== me && to !== me) continue;
      // Native value transfers only (plain calls, no calldata) — contract
      // calls aren't native LITHO moves.
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
    return null; // explorer unreachable
  } finally {
    clearTimeout(timer);
  }
}

/** Merge two feeds: dedupe by tx hash (the first feed wins), newest first;
 *  rows without a timestamp sink to the end. */
export function mergeActivityFeeds(
  indexer: IndexerActivityItem[],
  native: IndexerActivityItem[],
): IndexerActivityItem[] {
  const seen = new Set(indexer.map((i) => i.txHash).filter(Boolean));
  const merged = [...indexer, ...native.filter((n) => !n.txHash || !seen.has(n.txHash))];
  return merged.sort((a, b) => (b.ts ? Date.parse(b.ts) : 0) - (a.ts ? Date.parse(a.ts) : 0));
}
