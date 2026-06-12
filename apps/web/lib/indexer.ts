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

/* ─── Wire normalisation ────────────────────────────────────────────── */

/* The indexer's actual wire shape drifted from this client's documented
 * types: services/indexer emits `kind`/`createdAt`/`title` on activity
 * rows (not `type`/`ts`) and `contractAddress` on assets (not
 * `tokenAddress`). Consumers coded against THIS file's types — e.g.
 * views.tsx activityToRow calls `item.type.charAt(0)`, which throws the
 * moment a real row arrives. Normalise both shapes here, accepting old
 * and new field names, so every consumer sees the documented contract. */

function normalizeActivity(raw: Record<string, unknown>): IndexerActivityItem {
  return {
    id:           String(raw.id ?? raw.txHash ?? `${raw.symbol}-${raw.createdAt ?? ''}`),
    type:         String(raw.type ?? raw.kind ?? 'transfer'),
    symbol:       String(raw.symbol ?? ''),
    amount:       String(raw.amount ?? '0'),
    counterparty: (raw.counterparty as string | undefined),
    txHash:       (raw.txHash as string | undefined),
    blockNumber:  (raw.blockNumber as number | undefined),
    ts:           (raw.ts as string | undefined) ?? (raw.createdAt as string | undefined),
    status:       (raw.status as string | undefined),
  };
}

function normalizeAsset(raw: Record<string, unknown>): IndexerAsset {
  return {
    chainId:      Number(raw.chainId ?? 700777),
    symbol:       String(raw.symbol ?? ''),
    name:         String(raw.name ?? raw.symbol ?? ''),
    decimals:     Number(raw.decimals ?? 18),
    balance:      String(raw.balance ?? '0'),
    native:       Boolean(raw.native),
    tokenAddress: (raw.tokenAddress as string | undefined) ?? (raw.contractAddress as string | undefined),
  };
}

/* ─── Public API ────────────────────────────────────────────────────── */

/** Full portfolio (native LITHO + LEP100 balances + recent activity). */
export async function getPortfolio(walletAddress: string): Promise<IndexerPortfolio> {
  const raw = await getJson<{ walletAddress: string; updatedAt: string; assets?: unknown[]; activity?: unknown[] }>(
    `/portfolio/${encodeURIComponent(walletAddress)}`,
  );
  return {
    walletAddress: raw.walletAddress,
    updatedAt:     raw.updatedAt,
    assets:        (raw.assets ?? []).map(a => normalizeAsset(a as Record<string, unknown>)),
    activity:      (raw.activity ?? []).map(a => normalizeActivity(a as Record<string, unknown>)),
  };
}

/** LEP100 balances only — useful for the "discover tokens after import" flow. */
export async function getLep100Balances(walletAddress: string): Promise<IndexerAsset[]> {
  const data = await getJson<{ items?: unknown[] }>(
    `/lep100/balances/${encodeURIComponent(walletAddress)}`,
  );
  return (data.items ?? []).map(a => normalizeAsset(a as Record<string, unknown>));
}

/** Recent on-chain activity (transfers, approvals). */
export async function getActivity(walletAddress: string): Promise<IndexerActivityItem[]> {
  const data = await getJson<{ items?: unknown[] }>(
    `/lep100/activity/${encodeURIComponent(walletAddress)}`,
  );
  return (data.items ?? []).map(a => normalizeActivity(a as Record<string, unknown>));
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
