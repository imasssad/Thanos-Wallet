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
  blockExplorerUrl: 'https://explorer.litho.ai',
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 }
};

export const KAMET_TESTNET: NetworkConfig = {
  id: 'lithosphere-kamet',
  chainId: 900523,
  name: 'Lithosphere Kamet',
  kind: 'lithic',
  // rpc-3.litho.ai listed first because rpc.kamet.litho.ai has been
  // reliably failing TLS handshake behind Cloudflare since 2026-06.
  // Until Litho ops fixes the cert / SNI on the kamet.* subdomain,
  // every Kamet read should hit the working endpoint on the first try
  // rather than wait for the 1.5s stallTimeout to rotate the
  // FallbackProvider. Order will revert once the primary is healthy.
  rpcUrls: ['https://rpc-3.litho.ai', 'https://rpc.kamet.litho.ai'],
  blockExplorerUrl: 'https://kamet.litho.ai',
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 }
};

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
  KAMET_TESTNET,
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
