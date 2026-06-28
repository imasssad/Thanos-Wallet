/**
 * External-EVM static metadata — chain list + USDT/USDC catalog.
 *
 * Split out of evm-external.ts so the renderer can import the *data* (to build
 * the Send asset list, render chain labels, etc.) WITHOUT pulling in ethers.
 * evm-external.ts re-exports everything here, so there is a single source of
 * truth; only the heavy provider/balance/send code stays behind the dynamic
 * import. Mirrors apps/web/lib/evm-chains.ts + evm-tokens.ts.
 *
 * Every token address + decimals was VERIFIED on-chain — a wrong address is a
 * fund-loss bug, so do not edit without re-verifying. USDT/USDC are 6 decimals
 * everywhere EXCEPT BSC (18).
 */

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

/** The 8 external EVM chains shown as first-class rows. Order = display order. */
export const EXT_EVM_CHAINS: readonly ExtEvmChain[] = [
  { chainId: 1,     name: 'Ethereum',  slug: 'ethereum',  rpcUrl: 'https://ethereum.publicnode.com',         nativeSymbol: 'ETH',  nativeName: 'Ether',              explorerUrl: 'https://etherscan.io',            color: '#627eea' },
  { chainId: 56,    name: 'BNB Chain', slug: 'bsc',       rpcUrl: 'https://bsc-dataseed.binance.org',        nativeSymbol: 'BNB',  nativeName: 'BNB',                explorerUrl: 'https://bscscan.com',             color: '#f3ba2f' },
  { chainId: 137,   name: 'Polygon',   slug: 'polygon',   rpcUrl: 'https://polygon-bor-rpc.publicnode.com',  nativeSymbol: 'POL',  nativeName: 'Polygon',            explorerUrl: 'https://polygonscan.com',         color: '#8247e5' },
  { chainId: 8453,  name: 'Base',      slug: 'base',      rpcUrl: 'https://mainnet.base.org',                nativeSymbol: 'ETH',  nativeName: 'Ether (Base)',       explorerUrl: 'https://basescan.org',            color: '#0052ff' },
  { chainId: 42161, name: 'Arbitrum',  slug: 'arbitrum',  rpcUrl: 'https://arb1.arbitrum.io/rpc',            nativeSymbol: 'ETH',  nativeName: 'Ether (Arbitrum)',   explorerUrl: 'https://arbiscan.io',             color: '#28a0f0' },
  { chainId: 59144, name: 'Linea',     slug: 'linea',     rpcUrl: 'https://rpc.linea.build',                 nativeSymbol: 'ETH',  nativeName: 'Ether (Linea)',      explorerUrl: 'https://lineascan.build',         color: '#62dfff' },
  { chainId: 10,    name: 'Optimism',  slug: 'optimism',  rpcUrl: 'https://mainnet.optimism.io',             nativeSymbol: 'ETH',  nativeName: 'Ether (Optimism)',   explorerUrl: 'https://optimistic.etherscan.io', color: '#ff0420' },
  { chainId: 43114, name: 'Avalanche', slug: 'avalanche', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',   nativeSymbol: 'AVAX', nativeName: 'Avalanche',          explorerUrl: 'https://snowtrace.io',            color: '#e84142' },
];

export function getExtEvmChain(chainId: number): ExtEvmChain | undefined {
  return EXT_EVM_CHAINS.find(c => c.chainId === chainId);
}

export interface ExtEvmToken {
  chainId:  number;
  symbol:   'USDT' | 'USDC';
  name:     string;
  address:  string;
  decimals: number;
}

/** USDT/USDC catalog — addresses VERIFIED on-chain 2026-06-20 (same as web). */
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
];

export function extEvmTokensForChain(chainId: number): ExtEvmToken[] {
  return EXT_EVM_TOKENS.filter(t => t.chainId === chainId);
}
