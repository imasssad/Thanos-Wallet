import type { NetworkConfig } from '../types';

// rpcUrls is ordered [primary, fallback] — every consumer builds an
// ethers FallbackProvider over the list so a stalled primary rotates
// to the fallback transparently.
export const MAKALU_TESTNET: NetworkConfig = {
  id: 'lithosphere-makalu',
  chainId: 700777,
  name: 'Lithosphere Makalu',
  kind: 'lithic',
  rpcUrls: ['https://rpc.litho.ai', 'https://rpc-2.litho.ai'],
  // makalu.litho.ai is the canonical Makalu explorer host (Litho-confirmed).
  blockExplorerUrl: 'https://makalu.litho.ai',
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
  extras: {
    restUrl: 'https://api.litho.ai',
    wsUrl: 'wss://rpc.litho.ai/websocket',
    cosmosChainId: 'lithosphere_700777-2',
    bech32Prefix: 'litho',
    isTestnet: true
  }
};

// Kamet was promoted from testnet to mainnet on 2026-05-18 (chainId / state
// unchanged). Canonical config confirmed by the Litho team 2026-06-15:
//   • EVM chainId 900523 (0xDBDAB), Cosmos chainId lithosphere_900523-2
//   • RPC: rpc-3.litho.ai is the SOLE canonical node. The deprecated 2-level
//     host is removed entirely — never reference it.
//   • REST: api-3.litho.ai · Explorer: explorer-3.litho.ai
// CORS: rpc-3 sends no CORS headers, so browser/extension callers MUST go
// through the same-origin proxy (/rpc/kamet, see apps/web/next.config.js).
// Only the server-side indexer/worker may call rpc-3 directly.
export const KAMET_MAINNET: NetworkConfig = {
  id: 'lithosphere-kamet',
  chainId: 900523,
  name: 'Lithosphere Kamet',
  kind: 'lithic',
  rpcUrls: ['https://rpc-3.litho.ai'],
  blockExplorerUrl: 'https://explorer-3.litho.ai',
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
  extras: {
    restUrl: 'https://api-3.litho.ai',
    wsUrl: 'wss://rpc-3.litho.ai/websocket',
    cosmosChainId: 'lithosphere_900523-2',
    bech32Prefix: 'litho',
    isMainnet: true
  }
};

/** @deprecated Kamet is mainnet since 2026-05-18 — use KAMET_MAINNET. Retained for back-compat. */
export const KAMET_TESTNET = KAMET_MAINNET;

export const ETHEREUM: NetworkConfig = {
  id: 'ethereum',
  chainId: 1,
  name: 'Ethereum',
  kind: 'evm',
  // ethereum.publicnode.com is reliable + no auth + no rate-limit error
  // header. eth.merkle.io is the secondary so a stalled primary rotates
  // transparently via FallbackProvider. The previous default
  // (eth.llamarpc.com) started returning Cloudflare 526 (Invalid SSL
  // Certificate) intermittently in Jun 2026 — moved off it entirely.
  rpcUrls: [
    'https://ethereum.publicnode.com',
    'https://eth.merkle.io',
  ],
  blockExplorerUrl: 'https://etherscan.io',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
};

export const BSC: NetworkConfig = {
  id: 'bsc',
  chainId: 56,
  name: 'BNB Smart Chain',
  kind: 'evm',
  rpcUrls: ['https://bsc-dataseed.binance.org'],
  blockExplorerUrl: 'https://bscscan.com',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }
};

export const BITCOIN_MAINNET: NetworkConfig = {
  id: 'bitcoin-mainnet',
  chainId: 1000000,
  name: 'Bitcoin',
  kind: 'bitcoin',
  rpcUrls: ['https://mempool.space/api'],
  blockExplorerUrl: 'https://mempool.space',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 8 }
};

export const BITCOIN_TESTNET: NetworkConfig = {
  id: 'bitcoin-testnet',
  chainId: 1000001,
  name: 'Bitcoin Testnet',
  kind: 'bitcoin',
  rpcUrls: ['https://mempool.space/testnet/api'],
  blockExplorerUrl: 'https://mempool.space/testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 8 }
};

export const SOLANA_MAINNET: NetworkConfig = {
  id: 'solana-mainnet',
  chainId: 900,
  name: 'Solana',
  kind: 'solana',
  rpcUrls: ['https://api.mainnet-beta.solana.com'],
  blockExplorerUrl: 'https://explorer.solana.com',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 }
};

export const SOLANA_DEVNET: NetworkConfig = {
  id: 'solana-devnet',
  chainId: 901,
  name: 'Solana Devnet',
  kind: 'solana',
  rpcUrls: ['https://api.devnet.solana.com'],
  blockExplorerUrl: 'https://explorer.solana.com/?cluster=devnet',
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 }
};

export const SUPPORTED_NETWORKS = [
  MAKALU_TESTNET,
  KAMET_MAINNET,
  ETHEREUM,
  BSC,
  BITCOIN_MAINNET,
  BITCOIN_TESTNET,
  SOLANA_MAINNET,
  SOLANA_DEVNET
];

export function getNetworkByChainId(chainId: number): NetworkConfig {
  const network = SUPPORTED_NETWORKS.find((item) => item.chainId === chainId);
  if (!network) throw new Error(`Unsupported chainId: ${chainId}`);
  return network;
}
