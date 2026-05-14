'use client';
/**
 * On-chain LEP100 / ERC-20 token-allowance reader for Makalu.
 *
 * The wallet's "Permissions" view needs to show every spender the user
 * has approved to move tokens, with a one-click revoke button.
 * Approvals are an ERC-20-level concept: `approve(spender, amount)`
 * sets a per-owner-per-spender allowance that the spender can then call
 * `transferFrom` against.
 *
 * Strategy
 *   1. Try the indexer's `/lep100/approvals/:wallet` endpoint first.
 *      Indexer keeps the Approval log table up to date (see
 *      services/indexer/db.ts -> lep100_allowances). When it lands,
 *      the page becomes O(1).
 *   2. Live-fallback: scan Approval logs over the last N blocks for
 *      every canonical Makalu LEP100 contract, filtered by `owner`
 *      topic == wallet address. Then read `allowance(owner, spender)`
 *      live and discard zero / revoked rows.
 *
 * Only Makalu is covered here. External-EVM-chain approvals (Ethereum
 * mainnet etc.) need their own log-query setup and a per-chain known-
 * token list — landing in a follow-up commit.
 */
import {
  Contract, Interface, ZeroAddress, formatUnits, getAddress,
  type Provider,
} from 'ethers';
import { getMakaluProvider, MAKALU_CHAIN_ID } from './rpc';
import { TOKENS, type Token } from './tokens';

/* ─── Types ────────────────────────────────────────────────────────────── */

export interface AllowanceRow {
  /** EIP-155 chain id — 700777 for Makalu today. */
  chainId:        number;
  /** ERC-20 contract address (lower-cased). */
  tokenAddress:   string;
  /** Token display symbol (resolved from TOKENS, falls back to '?'). */
  symbol:         string;
  /** Human-readable name. */
  name:           string;
  /** Spender address (lower-cased). */
  spender:        string;
  /** Raw allowance in token's smallest unit. */
  amountRaw:      bigint;
  /** Human-readable amount string (e.g. "1.0", "100000.0"). */
  amount:         string;
  /** True when amount > 2**240 — interpreted as effectively unlimited. */
  unlimited:      boolean;
  /** Token decimals — used by callers to render. */
  decimals:       number;
}

const APPROVAL_ABI_FRAGMENT = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const APPROVAL_IFACE = new Interface(APPROVAL_ABI_FRAGMENT);

/* Conventional "approved unlimited" sentinel — most dApps use max-uint256
   (2**256-1). Treat anything ≥ 2**240 as unlimited so we can display
   "Unlimited" instead of an 80-char number. */
const UNLIMITED_THRESHOLD = 1n << 240n;

/* How far back we scan when the indexer is offline. Makalu blocks are
   ~2s, so 200k blocks ≈ 4.6 days. The indexer covers anything older. */
const LIVE_LOOKBACK_BLOCKS = Number(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_ALLOWANCE_LOOKBACK_BLOCKS) || 200_000,
);
/* Per-batch range — Makalu RPC node range limit is conservative; 2k is safe. */
const SCAN_BATCH = 2_000;

/* ─── Indexer path (preferred) ─────────────────────────────────────────── */

interface IndexerApprovalItem {
  chainId?:        number;
  contractAddress: string;
  symbol?:         string;
  name?:           string;
  decimals?:       number;
  spender:         string;
  amount:          string;    // raw bigint string
}

async function fetchFromIndexer(walletAddress: string): Promise<AllowanceRow[] | null> {
  const base =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_INDEXER_URL)
    || '/indexer';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${base}/lep100/approvals/${encodeURIComponent(walletAddress)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json() as { items?: IndexerApprovalItem[] };
    if (!Array.isArray(json.items)) return null;
    if (json.items.length === 0) return null;     // empty → fall through to live scan
    return json.items.map((a): AllowanceRow => {
      const amountRaw = BigInt(a.amount || '0');
      const decimals  = a.decimals ?? 18;
      const tokenCanon = TOKENS.find(t => t.address?.toLowerCase() === a.contractAddress.toLowerCase());
      return {
        chainId:      a.chainId ?? MAKALU_CHAIN_ID,
        tokenAddress: a.contractAddress.toLowerCase(),
        symbol:       a.symbol ?? tokenCanon?.sym ?? '?',
        name:         a.name   ?? tokenCanon?.name ?? a.symbol ?? '?',
        spender:      a.spender.toLowerCase(),
        amountRaw,
        amount:       formatUnits(amountRaw, decimals),
        unlimited:    amountRaw >= UNLIMITED_THRESHOLD,
        decimals,
      };
    });
  } catch {
    return null;
  }
}

/* ─── Live RPC path (fallback) ─────────────────────────────────────────── */

/** Pad an address to a 32-byte topic, lower-cased. */
function addressToTopic(addr: string): string {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

const APPROVAL_TOPIC = APPROVAL_IFACE.getEvent('Approval')!.topicHash;

/** Resolve the list of LEP100 contracts the UI knows about. Same source
 *  as the indexer (services/indexer/src/chain.ts default list). */
function makaluLepTokens(): Token[] {
  return TOKENS.filter(t => t.chain === 'Makalu' && !!t.address);
}

async function scanContractForSpenders(args: {
  provider:        Provider;
  contractAddress: string;
  ownerAddress:    string;
  fromBlock:       number;
  toBlock:         number;
}): Promise<Set<string>> {
  const spenders = new Set<string>();
  const ownerTopic = addressToTopic(args.ownerAddress);
  let from = args.fromBlock;
  while (from <= args.toBlock) {
    const to = Math.min(from + SCAN_BATCH - 1, args.toBlock);
    try {
      const logs = await args.provider.getLogs({
        address: args.contractAddress,
        fromBlock: from,
        toBlock:   to,
        topics:    [APPROVAL_TOPIC, ownerTopic],
      });
      for (const log of logs) {
        const spender = '0x' + log.topics[2].slice(26);
        spenders.add(spender.toLowerCase());
      }
    } catch {
      /* One batch failed — keep going so a transient blip doesn't lose
         all data. Spenders missed here would re-appear on next refresh. */
    }
    from = to + 1;
  }
  return spenders;
}

async function fetchLive(walletAddress: string): Promise<AllowanceRow[]> {
  const provider = getMakaluProvider();
  let owner: string;
  try { owner = getAddress(walletAddress); }
  catch { return []; }

  const tokens = makaluLepTokens();
  if (tokens.length === 0) return [];

  const head = await provider.getBlockNumber();
  const fromBlock = Math.max(0, head - LIVE_LOOKBACK_BLOCKS);

  /* Discover (token, spender) pairs in parallel. */
  const pairLists = await Promise.all(tokens.map(async (t) => {
    const spenders = await scanContractForSpenders({
      provider,
      contractAddress: t.address!.toLowerCase(),
      ownerAddress:    owner,
      fromBlock,
      toBlock:         head,
    });
    return { token: t, spenders };
  }));

  /* Read live allowance(owner, spender) for each pair, drop zeroes. */
  const out: AllowanceRow[] = [];
  for (const { token, spenders } of pairLists) {
    if (spenders.size === 0) continue;
    const contract = new Contract(token.address!, APPROVAL_ABI_FRAGMENT, provider);
    const checks = await Promise.all(
      Array.from(spenders).map(async (sp) => {
        try {
          const live = await contract.allowance(owner, sp) as bigint;
          return { spender: sp, live };
        } catch {
          return { spender: sp, live: 0n };
        }
      }),
    );
    for (const { spender, live } of checks) {
      if (live === 0n || spender === ZeroAddress.toLowerCase()) continue;
      out.push({
        chainId:      MAKALU_CHAIN_ID,
        tokenAddress: token.address!.toLowerCase(),
        symbol:       token.sym,
        name:         token.name,
        spender,
        amountRaw:    live,
        amount:       formatUnits(live, token.decimals),
        unlimited:    live >= UNLIMITED_THRESHOLD,
        decimals:     token.decimals,
      });
    }
  }
  return out;
}

/* ─── Public API ─────────────────────────────────────────────────────── */

/**
 * Fetch the current set of non-zero token allowances for `walletAddress`
 * on Makalu. Tries the indexer first; falls back to a live RPC scan.
 */
export async function fetchTokenAllowances(walletAddress: string): Promise<AllowanceRow[]> {
  if (!walletAddress) return [];
  const indexed = await fetchFromIndexer(walletAddress);
  if (indexed && indexed.length > 0) return indexed;
  return fetchLive(walletAddress);
}
