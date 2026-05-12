/**
 * Typed client for services/indexer.
 *
 * The indexer runs on the same VPS as the API and is reverse-proxied at
 * /indexer (configurable via NEXT_PUBLIC_INDEXER_URL for dev / preview).
 * It exposes balances + transfer history derived from on-chain eth_getLogs
 * sync, so the UI can show real chain state instead of the canonical token
 * stub we used during the design phase.
 *
 * Every function here:
 *   1) Returns parsed typed data on success
 *   2) Throws IndexerOffline on network / 5xx so the UI can fall back to
 *      its local canonical TOKENS list and still render something useful
 */

const BASE_URL =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_INDEXER_URL)
  || '/indexer';

export class IndexerOffline extends Error {
  constructor(public readonly cause?: unknown) {
    super('indexer offline');
    this.name = 'IndexerOffline';
  }
}

/* ─── Shared types — mirror services/indexer/src/server.ts responses ──── */

export interface IndexerAsset {
  chainId:    number;
  symbol:     string;
  name:       string;
  decimals:   number;
  /** Raw balance string (wei / smallest unit). Big number; never cast to JS number. */
  balance:    string;
  native?:    boolean;
  tokenAddress?: string;
}

export interface IndexerPortfolio {
  walletAddress: string;
  updatedAt:     string;
  assets:        IndexerAsset[];
  activity:      IndexerActivityItem[];
}

export interface IndexerActivityItem {
  /** Stable id from the indexer (event log hash or synthesised). */
  id:        string;
  type:      'send' | 'receive' | 'swap' | 'approval' | 'mint' | 'burn' | string;
  symbol:    string;
  amount:    string;   // raw or display, kept as string so we don't lose precision
  /** Counterparty address (from for receive, to for send). */
  counterparty?: string;
  txHash?:   string;
  blockNumber?: number;
  /** ISO timestamp from the chain block. */
  ts?:       string;
  status?:   'pending' | 'confirmed' | 'failed' | string;
}

/* ─── Low-level fetch with timeout + 5xx-as-offline ─────────────────── */

async function getJson<T>(path: string, timeoutMs = 6_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new IndexerOffline(`status ${res.status}`);
    return await res.json() as T;
  } catch (e) {
    if (e instanceof IndexerOffline) throw e;
    throw new IndexerOffline(e);
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Public API ────────────────────────────────────────────────────── */

/** Full portfolio (native LITHO + LEP100 balances + recent activity). */
export async function getPortfolio(walletAddress: string): Promise<IndexerPortfolio> {
  return getJson<IndexerPortfolio>(`/portfolio/${encodeURIComponent(walletAddress)}`);
}

/** LEP100 balances only — useful for the "discover tokens after import" flow. */
export async function getLep100Balances(walletAddress: string): Promise<IndexerAsset[]> {
  const data = await getJson<{ items: IndexerAsset[] }>(
    `/lep100/balances/${encodeURIComponent(walletAddress)}`,
  );
  return data.items ?? [];
}

/** Recent on-chain activity (transfers, approvals). */
export async function getActivity(walletAddress: string): Promise<IndexerActivityItem[]> {
  const data = await getJson<{ items: IndexerActivityItem[] }>(
    `/lep100/activity/${encodeURIComponent(walletAddress)}`,
  );
  return data.items ?? [];
}

/** Quick liveness probe — useful for showing a "Connected / Offline" badge. */
export async function isHealthy(): Promise<boolean> {
  try {
    await getJson<{ ok: boolean }>('/health', 2_500);
    return true;
  } catch {
    return false;
  }
}
