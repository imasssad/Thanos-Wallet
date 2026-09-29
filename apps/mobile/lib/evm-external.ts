/**
 * EVM network support for the mobile wallet — Lithosphere Mainnet, Ethereum,
 * BNB Chain, Polygon, Base, Arbitrum, Optimism, Linea, Avalanche, plus
 * user-added custom networks. One `0x` keypair, routed through each chain's
 * own RPC.
 *
 * Mirrors apps/web/lib/evm-chains.ts + apps/web/lib/evm-tokens.ts. Pure ethers
 * v6 + fetch — no native modules, bundles fine under Metro/Hermes.
 *
 * Every token address + decimals below was VERIFIED on-chain (symbol()/
 * decimals()) — a wrong token address is a fund-loss bug, so do not edit
 * without re-verifying. USDT/USDC are 6 decimals everywhere EXCEPT BSC (18).
 */
import { Contract, JsonRpcProvider, formatUnits, type Provider } from 'ethers';
import { allEvmChains, allTokensForChain } from './custom-assets';

export interface ExtEvmChain {
  chainId:      number;
  name:         string;
  slug:         string;
  rpcUrl:       string;
  nativeSymbol: string;   // ETH / BNB / POL / AVAX
  nativeName:   string;
  explorerUrl:  string;
  color:        string;
}

/** The built-in EVM networks, Lithosphere Mainnet first. Order = display
 *  order. The Makalu testnet (700777) isn't built in any more (2026-09-29) —
 *  users add it back as a custom network. */
export const EXT_EVM_CHAINS: readonly ExtEvmChain[] = [
  { chainId: 9005,  name: 'Lithosphere', slug: 'lithosphere', rpcUrl: 'https://rpc-mainnet.litho.ai',           nativeSymbol: 'LITHO', nativeName: 'Lithosphere',       explorerUrl: 'https://lithoscan.ai',            color: '#22c55e' },
  { chainId: 1,     name: 'Ethereum',  slug: 'ethereum',  rpcUrl: 'https://ethereum.publicnode.com',         nativeSymbol: 'ETH',  nativeName: 'Ether',              explorerUrl: 'https://etherscan.io',            color: '#627eea' },
  { chainId: 56,    name: 'BNB Chain', slug: 'bsc',       rpcUrl: 'https://bsc-dataseed.bnbchain.org',       nativeSymbol: 'BNB',  nativeName: 'BNB',                explorerUrl: 'https://bscscan.com',             color: '#f3ba2f' },
  { chainId: 137,   name: 'Polygon',   slug: 'polygon',   rpcUrl: 'https://polygon-bor-rpc.publicnode.com',  nativeSymbol: 'POL',  nativeName: 'Polygon',            explorerUrl: 'https://polygonscan.com',         color: '#8247e5' },
  { chainId: 8453,  name: 'Base',      slug: 'base',      rpcUrl: 'https://mainnet.base.org',                nativeSymbol: 'ETH',  nativeName: 'Ether (Base)',       explorerUrl: 'https://basescan.org',            color: '#0052ff' },
  { chainId: 42161, name: 'Arbitrum',  slug: 'arbitrum',  rpcUrl: 'https://arb1.arbitrum.io/rpc',            nativeSymbol: 'ETH',  nativeName: 'Ether (Arbitrum)',   explorerUrl: 'https://arbiscan.io',             color: '#28a0f0' },
  { chainId: 59144, name: 'Linea',     slug: 'linea',     rpcUrl: 'https://rpc.linea.build',                 nativeSymbol: 'ETH',  nativeName: 'Ether (Linea)',      explorerUrl: 'https://lineascan.build',         color: '#62dfff' },
  { chainId: 10,    name: 'Optimism',  slug: 'optimism',  rpcUrl: 'https://mainnet.optimism.io',             nativeSymbol: 'ETH',  nativeName: 'Ether (Optimism)',   explorerUrl: 'https://optimistic.etherscan.io', color: '#ff0420' },
  { chainId: 43114, name: 'Avalanche', slug: 'avalanche', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',   nativeSymbol: 'AVAX', nativeName: 'Avalanche',          explorerUrl: 'https://snowtrace.io',            color: '#e84142' },
];

export function getExtEvmChain(chainId: number): ExtEvmChain | undefined {
  // Merged: built-in EXT_EVM_CHAINS + user-added custom networks.
  return allEvmChains().find(c => c.chainId === chainId);
}

export interface ExtEvmToken {
  chainId:  number;
  symbol:   string;
  name:     string;
  address:  string;
  decimals: number;
}

/** External-chain token catalog — every address VERIFIED on-chain via
 *  symbol()/decimals()/name() before inclusion (USDT/USDC 2026-06-20;
 *  ecosystem tokens 2026-07-15). Keep in sync with apps/web/lib/evm-tokens.ts. */
export const EXT_EVM_TOKENS: readonly ExtEvmToken[] = [
  { chainId: 1,     symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6  },
  { chainId: 1,     symbol: 'USDC', name: 'USD Coin',   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6  },
  { chainId: 56,    symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { chainId: 56,    symbol: 'USDC', name: 'USD Coin',   address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { chainId: 137,   symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6  },
  { chainId: 137,   symbol: 'USDC', name: 'USD Coin',   address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6  },
  { chainId: 42161, symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6  },
  { chainId: 42161, symbol: 'USDC', name: 'USD Coin',   address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6  },
  { chainId: 8453,  symbol: 'USDC', name: 'USD Coin',   address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  },
  { chainId: 10,    symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6  },
  { chainId: 10,    symbol: 'USDC', name: 'USD Coin',   address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6  },
  { chainId: 43114, symbol: 'USDT', name: 'Tether USD', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6  },
  { chainId: 43114, symbol: 'USDC', name: 'USD Coin',   address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6  },
  // ─── LITHO-ecosystem tokens on external chains (client request 2026-07-15:
  // "wrapped tokens on BNB and other chains are missing"). Addresses from the
  // projects' CoinGecko listings, then INDEPENDENTLY verified on-chain
  // (symbol/decimals/name read via each chain's RPC) before inclusion.
  // LITHO / FGPT / JOT / LAX external deployments are NOT listed anywhere
  // verifiable — add only with team-confirmed addresses, never from memory.
  { chainId: 56,    symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 1,     symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 56,    symbol: 'AGII',  name: 'AGII',           address: '0x328fd053c4bb968875afd9ad0af36fcf4a0bdda9', decimals: 18 },
  { chainId: 1,     symbol: 'AGII',  name: 'AGII',           address: '0x75d86078625d1e2f612de2627d34c7bc411c18b8', decimals: 18 },
  { chainId: 1,     symbol: 'IMAGE', name: 'Imagen Network', address: '0x1c3547dfa9ce7acd9c54ae49244575fa65bc75e2', decimals: 18 },
  { chainId: 1,     symbol: 'COLLE', name: 'Colle AI',       address: '0xc36983d3d9d379ddfb306dfb919099cb6730e355', decimals: 18 },
  { chainId: 56,    symbol: 'COLLE', name: 'Colle AI',       address: '0xaeb63742f2c7dd1538bbe2285b6789017a06b58b', decimals: 18 },
];

export function extEvmTokensForChain(chainId: number): ExtEvmToken[] {
  return EXT_EVM_TOKENS.filter(t => t.chainId === chainId);
}

/* ─── Providers (memoised) ───────────────────────────────────────────── */
// Keyed by chain + RPC so a custom network re-added with another RPC in the
// same session gets a fresh provider.
const providers = new Map<string, Provider>();
export function getExtEvmProvider(chainId: number): Provider {
  const chain = getExtEvmChain(chainId);
  if (!chain) throw new Error(`evm-external: unsupported chainId ${chainId}`);
  const key = `${chainId}|${chain.rpcUrl}`;
  const hit = providers.get(key);
  if (hit) return hit;
  const p = new JsonRpcProvider(chain.rpcUrl, chainId, { staticNetwork: true });
  providers.set(key, p);
  return p;
}

const ERC20_BALANCE_ABI  = ['function balanceOf(address owner) view returns (uint256)'];

/* ─── Balance reads (parallel, error-tolerant) ───────────────────────── */

/** One slow public RPC must not hold up every other network's balance. */
const BALANCE_READ_TIMEOUT_MS = 12_000;
/** Run a read; null if it throws, rejects or takes too long. */
function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), BALANCE_READ_TIMEOUT_MS); });
  const attempt = (async () => { try { return await read(); } catch { return null; } })();
  return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer));
}

/** Native gas-coin balance on every chain (built-in + custom). `balance` is
 *  null when that chain couldn't be read — callers keep the last-known value
 *  rather than painting a real balance as 0. */
export async function getAllExtEvmNativeBalances(address: string): Promise<Array<{ chain: ExtEvmChain; balance: number | null }>> {
  if (!address) return [];
  return Promise.all(allEvmChains().map(async (chain) => {
    const wei = await readOrNull(() => getExtEvmProvider(chain.chainId).getBalance(address));
    return { chain, balance: wei == null ? null : (parseFloat(formatUnits(wei, 18)) || 0) };
  }));
}

/** Minimal token shape the portfolio/send need — satisfied by both the
 *  built-in ExtEvmToken and user-added custom tokens. */
export interface ExtTokenLike { chainId: number; symbol: string; name: string; address: string; decimals: number }

/** ERC-20 balances on every chain — built-in + custom tokens. `balance` is
 *  null when the read failed (callers keep the last-known value). */
export async function getAllExtEvmTokenBalances(address: string): Promise<Array<{ token: ExtTokenLike; balance: number | null }>> {
  if (!address) return [];
  const all: ExtTokenLike[] = allEvmChains().flatMap((c) => allTokensForChain(c.chainId) as ExtTokenLike[]);
  return Promise.all(all.map(async (token) => {
    const raw = await readOrNull(() =>
      new Contract(token.address, ERC20_BALANCE_ABI, getExtEvmProvider(token.chainId)).balanceOf(address) as Promise<bigint>);
    return { token, balance: raw == null ? null : (parseFloat(formatUnits(raw, token.decimals)) || 0) };
  }));
}
