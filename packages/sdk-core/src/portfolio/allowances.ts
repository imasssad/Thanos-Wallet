/**
 * Shared LEP-100 / ERC-20 allowance reader.
 *
 * Same hybrid model as apps/web/lib/allowances.ts but available to every
 * client (extension popup, desktop renderer, mobile App.tsx) without
 * each one re-implementing the indexer + live-scan plumbing.
 *
 * Strategy:
 *   1. Try the indexer's /lep100/approvals/:wallet endpoint first.
 *   2. Live RPC fallback: scan Approval logs over the last N blocks for
 *      each known LEP-100 contract and read allowance(owner, spender)
 *      live, dropping zeroes.
 */
import {
  Contract, Interface, ZeroAddress, formatUnits, getAddress,
  type Provider,
} from 'ethers';

export interface AllowanceRow {
  chainId:      number;
  tokenAddress: string;
  symbol:       string;
  name:         string;
  spender:      string;
  amountRaw:    bigint;
  amount:       string;
  unlimited:    boolean;
  decimals:     number;
}

export interface KnownToken {
  address:  string;
  symbol:   string;
  name:     string;
  decimals: number;
}

const APPROVAL_ABI = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];
const APPROVAL_IFACE = new Interface(APPROVAL_ABI);
const APPROVAL_TOPIC = APPROVAL_IFACE.getEvent('Approval')!.topicHash;

/** ≥ 2**240 is treated as unlimited (covers MaxUint256 and common variants). */
const UNLIMITED_THRESHOLD = 1n << 240n;

function addressToTopic(addr: string): string {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

interface IndexerApprovalItem {
  chainId?:        number;
  contractAddress: string;
  symbol?:         string;
  name?:           string;
  decimals?:       number;
  spender:         string;
  amount:          string;
}

export interface FetchAllowancesOptions {
  walletAddress: string;
  chainId:       number;
  provider:      Provider;
  /** Canonical LEP-100 token list — used in the live fallback path. */
  knownTokens:   KnownToken[];
  /** Indexer base URL (e.g. '/indexer'). When omitted, the live path runs immediately. */
  indexerUrl?:   string;
  /** Block-range lookback when scanning live. Default 200_000. */
  lookbackBlocks?: number;
  /** Per-batch block range. Default 2_000. */
  scanBatch?:    number;
}

export async function fetchTokenAllowances(opts: FetchAllowancesOptions): Promise<AllowanceRow[]> {
  if (!opts.walletAddress) return [];
  if (opts.indexerUrl) {
    const indexed = await fetchFromIndexer(opts.walletAddress, opts.chainId, opts.indexerUrl, opts.knownTokens);
    if (indexed && indexed.length > 0) return indexed;
  }
  return fetchLive(opts);
}

async function fetchFromIndexer(
  walletAddress: string, chainId: number, indexerUrl: string, knownTokens: KnownToken[],
): Promise<AllowanceRow[] | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${indexerUrl.replace(/\/$/, '')}/lep100/approvals/${encodeURIComponent(walletAddress)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json() as { items?: IndexerApprovalItem[] };
    if (!Array.isArray(json.items)) return null;
    return json.items.map((a): AllowanceRow => {
      const amountRaw = BigInt(a.amount || '0');
      const canonical = knownTokens.find(t => t.address.toLowerCase() === a.contractAddress.toLowerCase());
      const decimals  = a.decimals ?? canonical?.decimals ?? 18;
      return {
        chainId:      a.chainId ?? chainId,
        tokenAddress: a.contractAddress.toLowerCase(),
        symbol:       a.symbol ?? canonical?.symbol ?? '?',
        name:         a.name   ?? canonical?.name   ?? a.symbol ?? '?',
        spender:      a.spender.toLowerCase(),
        amountRaw,
        amount:       formatUnits(amountRaw, decimals),
        unlimited:    amountRaw >= UNLIMITED_THRESHOLD,
        decimals,
      };
    });
  } catch { return null; }
}

async function fetchLive(opts: FetchAllowancesOptions): Promise<AllowanceRow[]> {
  let owner: string;
  try { owner = getAddress(opts.walletAddress); } catch { return []; }
  if (opts.knownTokens.length === 0) return [];

  const head = await opts.provider.getBlockNumber();
  const lookback = opts.lookbackBlocks ?? 200_000;
  const batch    = opts.scanBatch     ?? 2_000;
  const fromBlock = Math.max(0, head - lookback);

  const pairLists = await Promise.all(opts.knownTokens.map(async (t) => {
    const spenders = new Set<string>();
    let from = fromBlock;
    while (from <= head) {
      const to = Math.min(from + batch - 1, head);
      try {
        const logs = await opts.provider.getLogs({
          address: t.address.toLowerCase(),
          fromBlock: from, toBlock: to,
          topics: [APPROVAL_TOPIC, addressToTopic(owner)],
        });
        for (const log of logs) spenders.add(('0x' + log.topics[2].slice(26)).toLowerCase());
      } catch { /* skip batch; recover on next refresh */ }
      from = to + 1;
    }
    return { token: t, spenders };
  }));

  const out: AllowanceRow[] = [];
  for (const { token, spenders } of pairLists) {
    if (spenders.size === 0) continue;
    const contract = new Contract(token.address, APPROVAL_ABI, opts.provider);
    const checks = await Promise.all(Array.from(spenders).map(async (sp) => {
      try { return { spender: sp, live: await contract.allowance(owner, sp) as bigint }; }
      catch { return { spender: sp, live: 0n }; }
    }));
    for (const { spender, live } of checks) {
      if (live === 0n || spender === ZeroAddress.toLowerCase()) continue;
      out.push({
        chainId:      opts.chainId,
        tokenAddress: token.address.toLowerCase(),
        symbol:       token.symbol, name: token.name,
        spender, amountRaw: live,
        amount:       formatUnits(live, token.decimals),
        unlimited:    live >= UNLIMITED_THRESHOLD,
        decimals:     token.decimals,
      });
    }
  }
  return out;
}

/** Submit an `approve(spender, 0)` revoke tx. The caller supplies the
 *  ethers `Signer` (wallet) connected to the right RPC. */
export async function revokeAllowance(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer:        any;
  tokenAddress:  string;
  spender:       string;
}): Promise<{ hash: string; wait: () => Promise<unknown> }> {
  const contract = new Contract(args.tokenAddress, APPROVAL_ABI, args.signer);
  const tx = await contract.approve(args.spender, 0n);
  return { hash: tx.hash as string, wait: () => tx.wait() };
}
