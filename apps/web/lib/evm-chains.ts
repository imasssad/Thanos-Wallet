/**
 * EVM chain registry — every chain the wallet transacts on with the
 * same `0x` keypair. Lithosphere Makalu has its own helper
 * (`lib/rpc.ts`) because it gets a FallbackProvider over three private
 * endpoints. For the public EVM chains below we use a single public
 * RPC each — fine for read-side balance polls; for sends we'd want a
 * fallback list per chain (FUTURE).
 *
 * All chains share the wallet's single EVM address; switching chains
 * is purely a question of which RPC we hit + how we display the row.
 *
 * Public surface:
 *   - EVM_CHAINS                — the full list
 *   - getEvmChain(chainId)      — lookup
 *   - getEvmProvider(chainId)   — memoised JsonRpcProvider
 *   - getEvmNativeBalance(chainId, address)
 *                               — human-readable native coin balance
 */
import { JsonRpcProvider, formatUnits, type Provider } from 'ethers';

export interface EvmChain {
  /** EIP-155 numeric chain ID. */
  chainId:        number;
  /** Display name, e.g. 'Ethereum'. */
  name:           string;
  /** Short ID used in URLs / API params. */
  slug:           string;
  /** Public RPC URL. Sweep these every few months — they rotate. */
  rpcUrl:         string;
  /** Native gas-coin ticker — ETH for L1/L2s on Ethereum, BNB for BSC, etc. */
  nativeSymbol:   string;
  /** Friendly name for the gas coin — 'Ether' / 'Binance Coin' / 'Polygon'. */
  nativeName:     string;
  /** Always 18 for EVM-native coins. Kept explicit for clarity. */
  decimals:       18;
  /** Block-explorer base URL — used to build /tx/<hash> + /address/<addr> links. */
  explorerUrl:    string;
  /** Brand colour for avatar fallback if the icon CDN is unreachable. */
  color:          string;
  /** CoinGecko id for the chain's native coin — feeds usePrices(). */
  coingeckoId:    string;
}

/** All EVM chains the wallet displays as first-class rows.
 *
 *  Order matters — first row is shown first in the Tokens tab. Ethereum
 *  is the de-facto default, BNB / Polygon / Base are the next-most-used
 *  consumer chains, the L2s (Arbitrum / Linea / OP / Avalanche) follow.
 *
 *  Excluded:
 *   - Lithosphere Makalu — has its own first-class flow in lib/rpc.ts +
 *     services/indexer; not duplicated here.
 *   - Testnets — production list only.
 */
export const EVM_CHAINS: readonly EvmChain[] = [
  {
    chainId:      1,
    name:         'Ethereum',
    slug:         'ethereum',
    rpcUrl:       'https://ethereum.publicnode.com',
    nativeSymbol: 'ETH',
    nativeName:   'Ether',
    decimals:     18,
    explorerUrl:  'https://etherscan.io',
    color:        '#627eea',
    coingeckoId:  'ethereum',
  },
  {
    chainId:      56,
    name:         'BNB Chain',
    slug:         'bsc',
    rpcUrl:       'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    nativeName:   'BNB',
    decimals:     18,
    explorerUrl:  'https://bscscan.com',
    color:        '#f3ba2f',
    coingeckoId:  'binancecoin',
  },
  {
    chainId:      137,
    name:         'Polygon',
    slug:         'polygon',
    rpcUrl:       'https://polygon-rpc.com',
    nativeSymbol: 'POL',
    nativeName:   'Polygon',
    decimals:     18,
    explorerUrl:  'https://polygonscan.com',
    color:        '#8247e5',
    coingeckoId:  'matic-network',
  },
  {
    chainId:      8453,
    name:         'Base',
    slug:         'base',
    rpcUrl:       'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    nativeName:   'Ether (Base)',
    decimals:     18,
    explorerUrl:  'https://basescan.org',
    color:        '#0052ff',
    coingeckoId:  'ethereum',     // ETH on Base tracks ETH price 1:1
  },
  {
    chainId:      42161,
    name:         'Arbitrum',
    slug:         'arbitrum',
    rpcUrl:       'https://arb1.arbitrum.io/rpc',
    nativeSymbol: 'ETH',
    nativeName:   'Ether (Arbitrum)',
    decimals:     18,
    explorerUrl:  'https://arbiscan.io',
    color:        '#28a0f0',
    coingeckoId:  'ethereum',
  },
  {
    chainId:      59144,
    name:         'Linea',
    slug:         'linea',
    rpcUrl:       'https://rpc.linea.build',
    nativeSymbol: 'ETH',
    nativeName:   'Ether (Linea)',
    decimals:     18,
    explorerUrl:  'https://lineascan.build',
    color:        '#62dfff',
    coingeckoId:  'ethereum',
  },
  {
    chainId:      10,
    name:         'Optimism',
    slug:         'optimism',
    rpcUrl:       'https://mainnet.optimism.io',
    nativeSymbol: 'ETH',
    nativeName:   'Ether (Optimism)',
    decimals:     18,
    explorerUrl:  'https://optimistic.etherscan.io',
    color:        '#ff0420',
    coingeckoId:  'ethereum',
  },
  {
    chainId:      43114,
    name:         'Avalanche',
    slug:         'avalanche',
    rpcUrl:       'https://api.avax.network/ext/bc/C/rpc',
    nativeSymbol: 'AVAX',
    nativeName:   'Avalanche',
    decimals:     18,
    explorerUrl:  'https://snowtrace.io',
    color:        '#e84142',
    coingeckoId:  'avalanche-2',
  },
] as const;

/** Quick lookup. */
export function getEvmChain(chainId: number): EvmChain | undefined {
  return EVM_CHAINS.find(c => c.chainId === chainId);
}

/* ─── Providers ──────────────────────────────────────────────────────── */
/* Memoised so concurrent components don't each open their own pool. */

const providers = new Map<number, Provider>();

export function getEvmProvider(chainId: number): Provider {
  const hit = providers.get(chainId);
  if (hit) return hit;
  const chain = getEvmChain(chainId);
  if (!chain) throw new Error(`evm: unsupported chainId ${chainId}`);
  const p = new JsonRpcProvider(chain.rpcUrl, chainId);
  providers.set(chainId, p);
  return p;
}

/* ─── Balance helpers ────────────────────────────────────────────────── */

/** Native gas-coin balance for an address on the given EVM chain.
 *  Returns a human-readable decimal string (e.g. '0.012345'). */
export async function getEvmNativeBalance(chainId: number, address: string): Promise<string> {
  const wei = await getEvmProvider(chainId).getBalance(address);
  return formatUnits(wei, 18);
}

/** Fetch native balances across every chain in EVM_CHAINS in parallel.
 *  Each chain that errors out is just omitted from the result — the
 *  caller treats missing entries as zero. */
export async function getAllEvmNativeBalances(address: string): Promise<Array<{ chain: EvmChain; balance: number }>> {
  if (!address) return [];
  const results = await Promise.allSettled(
    EVM_CHAINS.map(async (c) => {
      const decimal = await getEvmNativeBalance(c.chainId, address);
      return { chain: c, balance: parseFloat(decimal) || 0 };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ chain: EvmChain; balance: number }> => r.status === 'fulfilled')
    .map(r => r.value);
}
