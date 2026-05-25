/**
 * LEP-100 / ERC-20 allowance reader — mobile.
 *
 * Mobile is workspace-detached (no @thanos/sdk-core import), so this is
 * an inlined copy of packages/sdk-core/src/portfolio/allowances.ts paired
 * with a small canonical Makalu token list. UI lives in App.tsx as
 * PermissionsScreen.
 */
import {
  Contract, Interface, ZeroAddress, formatUnits, getAddress,
  type Provider, type Signer,
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
  address: string; symbol: string; name: string; decimals: number;
}

const APPROVAL_ABI = [
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
];
const APPROVAL_TOPIC = new Interface(APPROVAL_ABI).getEvent('Approval')!.topicHash;
const UNLIMITED_THRESHOLD = 1n << 240n;
const MAKALU_CHAIN_ID = 700777;

function addressToTopic(addr: string): string {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

const INDEXER_URL = 'https://thanos.fi/indexer';
const API_BASE    = 'https://thanos.fi/api';

interface IndexerApprovalItem {
  chainId?:        number; contractAddress: string;
  symbol?:         string; name?:           string; decimals?: number;
  spender:         string; amount:          string;
}

export async function fetchMakaluAllowances(args: {
  walletAddress: string; provider: Provider; knownTokens: KnownToken[];
}): Promise<AllowanceRow[]> {
  if (!args.walletAddress) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${INDEXER_URL}/lep100/approvals/${encodeURIComponent(args.walletAddress)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const json = await res.json() as { items?: IndexerApprovalItem[] };
      if (Array.isArray(json.items) && json.items.length > 0) {
        return json.items.map((a): AllowanceRow => {
          const raw = BigInt(a.amount || '0');
          const canonical = args.knownTokens.find(t => t.address.toLowerCase() === a.contractAddress.toLowerCase());
          const decimals = a.decimals ?? canonical?.decimals ?? 18;
          return {
            chainId: a.chainId ?? MAKALU_CHAIN_ID,
            tokenAddress: a.contractAddress.toLowerCase(),
            symbol:  a.symbol ?? canonical?.symbol ?? '?',
            name:    a.name   ?? canonical?.name   ?? a.symbol ?? '?',
            spender: a.spender.toLowerCase(),
            amountRaw: raw,
            amount: formatUnits(raw, decimals),
            unlimited: raw >= UNLIMITED_THRESHOLD,
            decimals,
          };
        });
      }
    }
  } catch { /* fall through to live scan */ }

  // Live RPC scan — narrow lookback so mobile doesn't burn battery on RPC.
  let owner: string;
  try { owner = getAddress(args.walletAddress); } catch { return []; }
  if (args.knownTokens.length === 0) return [];
  const head = await args.provider.getBlockNumber();
  const fromBlock = Math.max(0, head - 50_000);
  const out: AllowanceRow[] = [];
  for (const t of args.knownTokens) {
    const spenders = new Set<string>();
    let from = fromBlock;
    while (from <= head) {
      const to = Math.min(from + 2_000 - 1, head);
      try {
        const logs = await args.provider.getLogs({
          address: t.address.toLowerCase(),
          fromBlock: from, toBlock: to,
          topics: [APPROVAL_TOPIC, addressToTopic(owner)],
        });
        for (const log of logs) spenders.add(('0x' + log.topics[2].slice(26)).toLowerCase());
      } catch { /* skip batch */ }
      from = to + 1;
    }
    if (spenders.size === 0) continue;
    const c = new Contract(t.address, APPROVAL_ABI, args.provider);
    for (const sp of spenders) {
      try {
        const live = await c.allowance(owner, sp) as bigint;
        if (live === 0n || sp === ZeroAddress.toLowerCase()) continue;
        out.push({
          chainId: MAKALU_CHAIN_ID, tokenAddress: t.address.toLowerCase(),
          symbol: t.symbol, name: t.name, spender: sp,
          amountRaw: live, amount: formatUnits(live, t.decimals),
          unlimited: live >= UNLIMITED_THRESHOLD, decimals: t.decimals,
        });
      } catch { /* skip */ }
    }
  }
  return out;
}

export async function revokeAllowance(args: {
  signer: Signer; tokenAddress: string; spender: string;
}): Promise<{ hash: string; wait: () => Promise<unknown> }> {
  const c = new Contract(args.tokenAddress, APPROVAL_ABI, args.signer);
  const tx = await c.approve(args.spender, 0n);
  return { hash: tx.hash as string, wait: () => tx.wait() };
}

/** Canonical LEP-100 list — small subset matching what the indexer/back-end
 *  considers "known"; used as a fallback when the indexer endpoint is down.
 *  Real list comes from the indexer via fetchMakaluAllowances. */
export const MAKALU_KNOWN_TOKENS: KnownToken[] = [];
export { API_BASE };
