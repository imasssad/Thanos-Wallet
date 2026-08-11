/**
 * On-chain transaction detail lookup — powers the "tap a past activity row"
 * detail sheet across every client (web, mobile, desktop, extension).
 *
 * Activity rows from the indexer carry the hash / amount / counterparty / when,
 * but NOT the gas fee or nonce — those live only on chain. Given a tx hash we
 * probe the known chains' RPCs (Makalu first, then the 8 external EVM chains),
 * read the transaction + its receipt, and return the network fee (native +
 * fiat), nonce, status, from/to and a block-explorer link.
 *
 * Honesty rules (same as the rest of the app): any field we can't establish is
 * returned null so the UI renders "—" rather than a fabricated value. The whole
 * call returns null for non-EVM hashes (Bitcoin/Solana/Cosmos) — those get
 * their existing explorer links, no fee/nonce panel.
 *
 * CORS: every rpcUrl below is already whitelisted in the web CSP connect-src
 * (apps/web/next.config.js); the extension reaches them via host_permissions;
 * mobile/desktop are native (no CORS). rpc.litho.ai (Makalu) serves CORS
 * headers for browser callers — only Kamet's rpc-3 does not, and Kamet isn't
 * probed here.
 */
import { fetchPriceQuotes } from '../tokens/pricing';

interface TxChain {
  chainId:      number;
  name:         string;
  rpcUrl:       string;
  nativeSymbol: string;
  explorer:     string;   // base host — tx link is `${explorer}/tx/${hash}`
}

/* Makalu is probed first because the overwhelming majority of Thanos activity
   is on it; the external EVM chains mirror evm-external.ts / networks.ts. */
const TX_CHAINS: readonly TxChain[] = [
  { chainId: 700777, name: 'Lithosphere Makalu', rpcUrl: 'https://rpc.litho.ai',                    nativeSymbol: 'LITHO', explorer: 'https://makalu.litho.ai' },
  { chainId: 9005,   name: 'Lithosphere',        rpcUrl: 'https://rpc-mainnet.litho.ai',            nativeSymbol: 'LITHO', explorer: 'https://lithoscan.ai' },
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

/* Makalu's RPC (rpc.litho.ai) answers cross-origin POSTs with `ACAO: *` but its
   OPTIONS preflight omits Access-Control-Allow-Headers, so a browser JSON-RPC
   POST is blocked — fee/nonce came back "—" on the web app only (native clients
   have no CORS). The web sets this to its same-origin proxy ('/rpc/makalu',
   see apps/web/next.config.js) so Makalu lookups go through same-origin. Native
   clients leave it null and hit rpc.litho.ai directly. */
let makaluRpcOverride: string | null = null;
export function setTxMakaluRpc(url: string | null): void { makaluRpcOverride = url; }
const rpcUrlFor = (c: TxChain): string =>
  (c.chainId === 700777 && makaluRpcOverride) ? makaluRpcOverride : c.rpcUrl;

/* Makalu's explorer uses /txs/<hash> (a bare /tx/ 308-redirects there); the
   EVM explorers (Etherscan/BscScan/…) use /tx/<hash>. */
const explorerTx = (c: TxChain, hash: string): string =>
  `${c.explorer}/${c.chainId === 700777 ? 'txs' : 'tx'}/${hash}`;

/** Explorer tx URL for a known chain id, or null when the chain is unknown. */
export function evmExplorerTxUrl(chainId: number, hash: string): string | null {
  const c = chainById(chainId);
  return c ? explorerTx(c, hash) : null;
}

export interface OnchainTxDetails {
  chainId:       number;
  networkName:   string;
  nativeSymbol:  string;
  /** Gas fee in native units (gasUsed × effectiveGasPrice), null if unknown. */
  feeNative:     number | null;
  /** Fee converted to USD via the native token's live price, null if unknown. */
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

/**
 * Resolve fee / nonce / status / from-to / explorer for an EVM tx hash.
 * When `chainId` is known (caller has it), only that chain is queried; else we
 * probe all known chains in parallel and take the first (Makalu-priority) hit.
 * Returns null for non-EVM hashes or when the tx isn't found on any chain.
 */
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

  // Probe getTransactionByHash on each candidate concurrently; keep the first
  // in TX_CHAINS order (Makalu first) that actually returns the tx.
  const probes = await Promise.all(
    candidates.map(async (c) => {
      try {
        const tx = (await rpcCall(rpcUrlFor(c), 'eth_getTransactionByHash', [txHash])) as RawTx | null;
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
    const rcpt = (await rpcCall(rpcUrlFor(c), 'eth_getTransactionReceipt', [txHash])) as RawReceipt | null;
    if (rcpt) {
      const gasUsed = BigInt(rcpt.gasUsed ?? '0x0');
      const gasPrice = BigInt(rcpt.effectiveGasPrice ?? tx.gasPrice ?? '0x0');
      feeNative = Number(gasUsed * gasPrice) / 1e18;
      status = rcpt.status === '0x1' ? 'success' : rcpt.status === '0x0' ? 'failed' : 'pending';
      if (rcpt.blockNumber) blockNumber = parseInt(rcpt.blockNumber, 16);
    }
  } catch {
    /* receipt not yet available → treat as pending, fee stays null */
  }

  let feeUsd: number | null = null;
  if (feeNative != null) {
    try {
      const quotes = await fetchPriceQuotes();
      const px = quotes[c.nativeSymbol]?.usd;
      if (typeof px === 'number' && isFinite(px)) feeUsd = feeNative * px;
    } catch {
      /* price unavailable → feeUsd stays null (UI shows native only) */
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
    explorerTxUrl: explorerTx(c, txHash),
  };
  cache.set(key, { at: Date.now(), d });
  return d;
}

/** Test-only: clear the per-hash cache between cases. */
export function _resetTxDetailsCacheForTests(): void {
  cache.clear();
}
