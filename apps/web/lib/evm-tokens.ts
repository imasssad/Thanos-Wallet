/**
 * EVM stablecoin catalog (USDT / USDC) for the chains the wallet tracks.
 *
 * External EVM chains were native-coin-only — so a USDT/USDC deposit from an
 * exchange arrived on-chain but was invisible. This catalog + balanceOf reader
 * surface stablecoin balances (and feed the Receive asset list). Every address
 * + decimals here was VERIFIED on-chain (symbol()/decimals()) on 2026-06-20 —
 * a wrong token address is a fund-loss bug, so do not edit without re-verifying.
 *
 * Note: USDT/USDC are 6 decimals everywhere EXCEPT BSC (18).
 */
import { Contract, formatUnits } from 'ethers';
import { getEvmProvider } from './evm-chains';

export interface EvmToken {
  chainId:  number;
  symbol:   'USDT' | 'USDC';
  name:     string;
  address:  string;
  decimals: number;
  coingeckoId: string;
}

export const EVM_TOKENS: readonly EvmToken[] = [
  // Ethereum (1)
  { chainId: 1,     symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,  coingeckoId: 'tether' },
  { chainId: 1,     symbol: 'USDC', name: 'USD Coin',   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6,  coingeckoId: 'usd-coin' },
  // BNB Chain (56) — 18 decimals
  { chainId: 56,    symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, coingeckoId: 'tether' },
  { chainId: 56,    symbol: 'USDC', name: 'USD Coin',   address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, coingeckoId: 'usd-coin' },
  // Polygon (137)
  { chainId: 137,   symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6,  coingeckoId: 'tether' },
  { chainId: 137,   symbol: 'USDC', name: 'USD Coin',   address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6,  coingeckoId: 'usd-coin' },
  // Arbitrum (42161)
  { chainId: 42161, symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6,  coingeckoId: 'tether' },
  { chainId: 42161, symbol: 'USDC', name: 'USD Coin',   address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6,  coingeckoId: 'usd-coin' },
  // Base (8453) — USDC only
  { chainId: 8453,  symbol: 'USDC', name: 'USD Coin',   address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  coingeckoId: 'usd-coin' },
  // Optimism (10)
  { chainId: 10,    symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6,  coingeckoId: 'tether' },
  { chainId: 10,    symbol: 'USDC', name: 'USD Coin',   address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6,  coingeckoId: 'usd-coin' },
  // Avalanche (43114)
  { chainId: 43114, symbol: 'USDT', name: 'Tether USD', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6,  coingeckoId: 'tether' },
  { chainId: 43114, symbol: 'USDC', name: 'USD Coin',   address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6,  coingeckoId: 'usd-coin' },
];

/** Stablecoins available on a given chain (for the Receive asset list). */
export function evmTokensForChain(chainId: number): EvmToken[] {
  return EVM_TOKENS.filter(t => t.chainId === chainId);
}

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

/** Read every catalog stablecoin balance across all chains in parallel.
 *  Each chain/token that errors is omitted (treated as zero); only non-zero
 *  balances are returned. */
export async function getAllEvmTokenBalances(
  address: string,
): Promise<Array<{ token: EvmToken; balance: number }>> {
  if (!address) return [];
  const results = await Promise.allSettled(
    EVM_TOKENS.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return { token: t, balance: parseFloat(formatUnits(raw, t.decimals)) };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ token: EvmToken; balance: number }> =>
      r.status === 'fulfilled' && r.value.balance > 0)
    .map(r => r.value);
}
