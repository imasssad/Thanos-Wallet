/**
 * Native LITHO activity from the Lithosphere chain explorers — desktop.
 *
 * Ported from apps/mobile/lib/makalu-explorer.ts (same API, same explorer
 * codebase across all three chains — verified live). The indexer
 * (services/indexer) only records LEP100 token Transfer EVENTS
 * (eth_getLogs) on Makalu; native LITHO value transfers emit no logs, so
 * they never reach /portfolio/:address's `activity` array, on ANY chain —
 * desktop had NO native-LITHO activity coverage at all before this file
 * existed, not even on Makalu. That's the root cause of the client's
 * "need all activity to show": a native LITHO send never appeared except
 * as the optimistic local "Pending" row (local-activity.ts), which then
 * never resolved to a confirmed row since nothing ever reported it.
 *
 * Each explorer exposes GET /api/txs?address=<0x|litho1> — full
 * transactions, not just logged events.
 */
import { formatUnits } from 'ethers';

const MAKALU_API  = 'https://makalu.litho.ai/api';
const KAMET_API   = 'https://kamet.litho.ai/api';
// Lithosphere Mainnet's explorer — same codebase, verified live 2026-09-15.
// The wallet defaults to Mainnet now, so this is the one that matters most.
const MAINNET_API = 'https://lithoscan.ai/api';

/** Shape matches portfolio.ts's local IndexerActivityItem exactly (id,
 *  type, symbol, amount, txHash?, ts?, status?) so callers can splice
 *  these rows directly into pf.activity before the DisplayTx mapping. */
export interface ExplorerActivityItem {
  id:      string;
  type:    string;
  symbol:  string;
  amount:  string;
  txHash?: string;
  ts?:     string;
  status?: string;
}

interface ExplorerTx {
  hash?: string;
  evmHash?: string;
  value?: string;
  inputData?: string;
  timestamp?: string;
  evmFromAddr?: string;
  evmToAddr?: string;
  success?: boolean;
}

async function fetchExplorerNativeActivity(
  api: string,
  idPrefix: string,
  address: string,
  timeoutMs: number,
): Promise<ExplorerActivityItem[]> {
  if (!address) return [];
  const me = address.toLowerCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${api}/txs?address=${encodeURIComponent(address)}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { txs?: ExplorerTx[] } | null;
    const out: ExplorerActivityItem[] = [];
    for (const t of json?.txs ?? []) {
      const from = (t.evmFromAddr ?? '').toLowerCase();
      const to   = (t.evmToAddr ?? '').toLowerCase();
      if (from !== me && to !== me) continue;
      // Native value transfers only — LEP100 token transfers arrive via the
      // indexer feed, so skipping calldata-bearing txs avoids double rows.
      if ((t.inputData ?? '0x') !== '0x') continue;
      let wei = 0n;
      try { wei = BigInt(t.value ?? '0'); } catch { continue; }
      if (wei <= 0n) continue;
      const isReceive = to === me;
      const txHash = t.evmHash || t.hash || '';
      if (!txHash) continue;
      out.push({
        id:     `${idPrefix}:${txHash}`,
        type:   isReceive ? 'receive' : 'send',
        symbol: 'LITHO',
        amount: formatUnits(wei, 18),
        txHash,
        ts:     t.timestamp,
        status: t.success === false ? 'failed' : 'confirmed',
      });
    }
    return out.slice(0, 50);
  } catch {
    return []; // explorer unreachable — indexer feed still renders
  } finally {
    clearTimeout(timer);
  }
}

export function fetchMakaluNativeActivity(address: string, timeoutMs = 8_000): Promise<ExplorerActivityItem[]> {
  return fetchExplorerNativeActivity(MAKALU_API, 'makalu', address, timeoutMs);
}
export function fetchKametNativeActivity(address: string, timeoutMs = 8_000): Promise<ExplorerActivityItem[]> {
  return fetchExplorerNativeActivity(KAMET_API, 'kamet', address, timeoutMs);
}
export function fetchMainnetNativeActivity(address: string, timeoutMs = 8_000): Promise<ExplorerActivityItem[]> {
  return fetchExplorerNativeActivity(MAINNET_API, 'mainnet', address, timeoutMs);
}

/** Merge indexer rows + native-explorer rows, deduped by tx hash (indexer
 *  wins on a collision), newest first. */
export function mergeNativeActivity<T extends { txHash?: string; ts?: string }>(
  indexer: T[],
  native: ExplorerActivityItem[],
): T[] {
  const seen = new Set(indexer.map((i) => i.txHash).filter(Boolean));
  const merged = [...indexer, ...(native.filter((n) => !seen.has(n.txHash)) as unknown as T[])];
  return merged.sort((a, b) => (b.ts ? Date.parse(b.ts) : 0) - (a.ts ? Date.parse(a.ts) : 0));
}
