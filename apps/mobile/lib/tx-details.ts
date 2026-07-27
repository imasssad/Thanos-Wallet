/**
 * On-chain transaction detail lookup (mobile twin of
 * packages/sdk-core/src/portfolio/tx-details.ts).
 *
 * Kept as a detached copy for the same reason as lib/price-history.ts and
 * lib/fx.ts: EAS builds can't resolve the workspace @thanos/sdk-core dep, so
 * the mobile app carries local mirrors. Keep in sync with the sdk-core version.
 *
 * Powers the "tap a past activity row" detail sheet: given a tx hash we probe
 * the known chains' RPCs (Makalu first, then the 8 external EVM chains), read
 * the transaction + receipt, and return the network fee (native + fiat), nonce,
 * status, from/to and a block-explorer link. Any field we can't establish is
 * null so the UI renders "—" rather than a fabricated value; the whole call is
 * null for non-EVM hashes (they keep their existing explorer links).
 */
import { fetchEcosystemPrices } from './pricing';

interface TxChain {
  chainId:      number;
  name:         string;
  rpcUrl:       string;
  nativeSymbol: string;
  explorer:     string;
}

const TX_CHAINS: readonly TxChain[] = [
  { chainId: 700777, name: 'Lithosphere Makalu', rpcUrl: 'https://rpc.litho.ai',                    nativeSymbol: 'LITHO', explorer: 'https://makalu.litho.ai' },
  { chainId: 1,      name: 'Ethereum',           rpcUrl: 'https://ethereum.publicnode.com',         nativeSymbol: 'ETH',   explorer: 'https://etherscan.io' },
  { chainId: 56,     name: 'BNB Chain',          rpcUrl: 'https://bsc-dataseed.binance.org',        nativeSymbol: 'BNB',   explorer: 'https://bscscan.com' },
  { chainId: 137,    name: 'Polygon',            rpcUrl: 'https://polygon-bor-rpc.publicnode.com',  nativeSymbol: 'POL',   explorer: 'https://polygonscan.com' },
  { chainId: 8453,   name: 'Base',               rpcUrl: 'https://mainnet.base.org',                nativeSymbol: 'ETH',   explorer: 'https://basescan.org' },
  { chainId: 42161,  name: 'Arbitrum',           rpcUrl: 'https://arb1.arbitrum.io/rpc',            nativeSymbol: 'ETH',   explorer: 'https://arbiscan.io' },
  { chainId: 10,     name: 'Optimism',           rpcUrl: 'https://mainnet.optimism.io',             nativeSymbol: 'ETH',   explorer: 'https://optimistic.etherscan.io' },
  { chainId: 43114,  name: 'Avalanche',          rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',   nativeSymbol: 'AVAX',  explorer: 'https://snowtrace.io' },
  { chainId: 59144,  name: 'Linea',              rpcUrl: 'https://rpc.linea.build',                 nativeSymbol: 'ETH',   explorer: 'https://lineascan.build' },
];

const chainById = (id: number): TxChain | undefined => TX_CHAINS.find((c) => c.chainId === id);

export interface OnchainTxDetails {
  chainId:       number;
  networkName:   string;
  nativeSymbol:  string;
  feeNative:     number | null;
  feeUsd:        number | null;
  nonce:         number | null;
  from:          string | null;
  to:            string | null;
  status:        'success' | 'failed' | 'pending' | null;
  blockNumber:   number | null;
  explorerTxUrl: string;
}

const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; d: OnchainTxDetails | null }>();

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'rpc error');
  return j.result;
}

interface RawTx { from?: string; to?: string; nonce?: string; gasPrice?: string; blockNumber?: string }
interface RawReceipt { gasUsed?: string; effectiveGasPrice?: string; status?: string; blockNumber?: string }

export async function fetchOnchainTxDetails(
  txHash: string,
  opts?: { chainId?: number },
): Promise<OnchainTxDetails | null> {
  if (!txHash || !EVM_HASH.test(txHash)) return null;
  const key = `${opts?.chainId ?? 'auto'}:${txHash.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.d;

  const candidates = opts?.chainId
    ? ([chainById(opts.chainId)].filter(Boolean) as TxChain[])
    : TX_CHAINS;
  if (candidates.length === 0) return null;

  const probes = await Promise.all(
    candidates.map(async (c) => {
      try {
        const tx = (await rpcCall(c.rpcUrl, 'eth_getTransactionByHash', [txHash])) as RawTx | null;
        return tx ? { c, tx } : null;
      } catch {
        return null;
      }
    }),
  );
  const found = probes.find(Boolean) as { c: TxChain; tx: RawTx } | undefined;
  if (!found) {
    cache.set(key, { at: Date.now(), d: null });
    return null;
  }

  const { c, tx } = found;
  let feeNative: number | null = null;
  let status: OnchainTxDetails['status'] = 'pending';
  let blockNumber: number | null = tx.blockNumber ? parseInt(tx.blockNumber, 16) : null;
  try {
    const rcpt = (await rpcCall(c.rpcUrl, 'eth_getTransactionReceipt', [txHash])) as RawReceipt | null;
    if (rcpt) {
      const gasUsed = BigInt(rcpt.gasUsed ?? '0x0');
      const gasPrice = BigInt(rcpt.effectiveGasPrice ?? tx.gasPrice ?? '0x0');
      feeNative = Number(gasUsed * gasPrice) / 1e18;
      status = rcpt.status === '0x1' ? 'success' : rcpt.status === '0x0' ? 'failed' : 'pending';
      if (rcpt.blockNumber) blockNumber = parseInt(rcpt.blockNumber, 16);
    }
  } catch {
    /* receipt not yet available → pending, fee stays null */
  }

  let feeUsd: number | null = null;
  if (feeNative != null) {
    try {
      const prices = await fetchEcosystemPrices();
      const px = prices[c.nativeSymbol];
      if (typeof px === 'number' && isFinite(px)) feeUsd = feeNative * px;
    } catch {
      /* price unavailable → feeUsd stays null */
    }
  }

  const d: OnchainTxDetails = {
    chainId:       c.chainId,
    networkName:   c.name,
    nativeSymbol:  c.nativeSymbol,
    feeNative,
    feeUsd,
    nonce:         tx.nonce != null ? parseInt(tx.nonce, 16) : null,
    from:          tx.from ?? null,
    to:            tx.to ?? null,
    status,
    blockNumber,
    explorerTxUrl: `${c.explorer}/tx/${txHash}`,
  };
  cache.set(key, { at: Date.now(), d });
  return d;
}
