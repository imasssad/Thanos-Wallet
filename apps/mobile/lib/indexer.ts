/**
 * Indexer client for the mobile app.
 *
 * A detached copy of @thanos/sdk-core's IndexerClient — kept local
 * because EAS Cloud builds can't resolve monorepo workspace packages
 * (same reason apps/mobile/lib/api-client.ts is a local copy).
 *
 * Talks to services/indexer, reverse-proxied at /indexer on the API
 * host. Every call throws IndexerOffline on a network / 5xx failure so
 * the UI can show an offline state instead of crashing.
 */

const DEFAULT_BASE = 'https://thanos.fi/indexer';

function baseUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  return String(env.EXPO_PUBLIC_INDEXER_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/* ─── Response types — mirror services/indexer/src/server.ts ─────────── */

export interface IndexerAsset {
  chainId:       number;
  symbol:        string;
  name:          string;
  decimals:      number;
  /** Raw balance (smallest unit) as a string — never cast to a JS number. */
  balance:       string;
  native?:       boolean;
  tokenAddress?: string;
}

export interface IndexerActivityItem {
  id:            string;
  type:          'send' | 'receive' | 'swap' | 'approval' | 'mint' | 'burn' | string;
  symbol:        string;
  amount:        string;
  counterparty?: string;
  txHash?:       string;
  blockNumber?:  number;
  ts?:           string;
  status?:       'pending' | 'confirmed' | 'failed' | string;
}

export interface IndexerPortfolio {
  walletAddress: string;
  updatedAt:     string;
  assets:        IndexerAsset[];
  activity:      IndexerActivityItem[];
}

export class IndexerOffline extends Error {
  constructor(public readonly reason?: unknown) {
    super('indexer offline');
    this.name = 'IndexerOffline';
  }
}

/* ─── Low-level fetch with timeout ───────────────────────────────────── */

async function getJson<T>(path: string, timeoutMs = 8_000): Promise<T> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new IndexerOffline(`status ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof IndexerOffline) throw e;
    throw new IndexerOffline(e);
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Public API ─────────────────────────────────────────────────────── */

/** Full portfolio — native LITHO + LEP100 balances + recent activity. */
export async function getPortfolio(walletAddress: string): Promise<IndexerPortfolio> {
  return getJson<IndexerPortfolio>(`/portfolio/${encodeURIComponent(walletAddress)}`);
}

/** Recent on-chain activity for a wallet. */
export async function getActivity(walletAddress: string): Promise<IndexerActivityItem[]> {
  const data = await getJson<{ items: IndexerActivityItem[] }>(
    `/activity/${encodeURIComponent(walletAddress)}`,
  );
  return data.items ?? [];
}

/** Liveness probe — for a "Connected / Offline" badge. */
export async function isIndexerHealthy(): Promise<boolean> {
  try {
    await getJson('/health', 2_500);
    return true;
  } catch {
    return false;
  }
}
