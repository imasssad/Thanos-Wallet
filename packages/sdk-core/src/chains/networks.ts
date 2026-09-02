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

// CORRECTION (2026-09-02, client-confirmed): Kamet is a TESTNET — the
// "promoted to mainnet 2026-05-18" note this comment used to carry was
// wrong (or reverted; either way, no longer true) and led straight to a
// docs mistake (packages/connect/README.md + the /docs page called it
// Mainnet). The `isMainnet: true` flag below was never actually read by
// any client UI (verified — nothing imports it), so correcting it here is
// a pure metadata fix with zero behavior change. The exported const name
// (`KAMET_MAINNET`) is kept as-is to avoid a repo-wide rename; don't take
// the name as a truth claim — `extras.isMainnet` is the truth claim, and
// it's now false.
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
    isMainnet: false,
    isTestnet: true
  }
};

/** Kamet is a testnet — kept as an alias of KAMET_MAINNET (same config,
 *  chainId/state unchanged) since that's still the exported name everything
 *  imports; see the correction note above. */
export const KAMET_TESTNET = KAMET_MAINNET;

// Lithosphere Mainnet — the flagship Litho L1, live 2026-08. EVM chainId 9005
// (0x2325), Cosmos lithosphere_9005-1. dApps (lithoscan.ai) switch/add to it via
// the wallet provider; the wallet must recognise it as a first-class network.
export const LITHOSPHERE_MAINNET: NetworkConfig = {
  id: 'lithosphere-mainnet',
  chainId: 9005,
  name: 'Lithosphere',
  kind: 'lithic',
  rpcUrls: ['https://rpc-mainnet.litho.ai'],
  blockExplorerUrl: 'https://lithoscan.ai',
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
  extras: {
    cosmosChainId: 'lithosphere_9005-1',
    bech32Prefix: 'litho',
    isMainnet: true,
  },
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
  LITHOSPHERE_MAINNET,
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
