/**
 * RPC providers per chain — used by tx-confirm and wallet-sync.
 *
 * Same chain list the web app cares about plus Makalu (Lithosphere) and
 * Kamet. Each provider is memoised so concurrent jobs share one HTTP
 * agent.
 *
 * Lazy-loaded ethers — we only need it for EVM receipt checks; if a
 * Bitcoin or Solana tx-confirm shows up we route to those clients
 * instead.
 */
import type { JsonRpcProvider } from 'ethers';

const RPC_URLS: Record<number, string[]> = {
  // Lithosphere
  700777: (process.env.LITHO_RPC_PRIMARY ?? 'https://rpc.litho.ai,https://rpc-2.litho.ai,https://rpc-3.litho.ai').split(',').map(s => s.trim()).filter(Boolean),
  900523: (process.env.KAMET_RPC ?? 'https://rpc.kamet.litho.ai').split(',').map(s => s.trim()).filter(Boolean),
  // Public chains
  1:     ['https://eth.llamarpc.com'],
  56:    ['https://bsc-dataseed.binance.org'],
  137:   ['https://polygon-rpc.com'],
  8453:  ['https://mainnet.base.org'],
  42161: ['https://arb1.arbitrum.io/rpc'],
  59144: ['https://rpc.linea.build'],
  10:    ['https://mainnet.optimism.io'],
  43114: ['https://api.avax.network/ext/bc/C/rpc'],
};

const providers = new Map<number, JsonRpcProvider>();

/** Build (and memoise) an ethers provider for the given EVM chain.
 *  Falls back to `null` for unknown chains — callers should branch on
 *  the chainKind instead. */
export async function getEvmProvider(chainId: number): Promise<JsonRpcProvider | null> {
  const cached = providers.get(chainId);
  if (cached) return cached;
  const urls = RPC_URLS[chainId];
  if (!urls || urls.length === 0) return null;
  const { JsonRpcProvider } = await import('ethers');
  const p = new JsonRpcProvider(urls[0], chainId);
  providers.set(chainId, p);
  return p;
}

/** Bitcoin / Solana receipts use the same public APIs the web app does
 *  — we just pass through the relevant URLs so processors can fetch. */
export const BITCOIN_MEMPOOL_API = process.env.BITCOIN_MEMPOOL_API ?? 'https://mempool.space/api';
export const SOLANA_RPC_URL      = process.env.SOLANA_RPC_URL      ?? 'https://api.mainnet-beta.solana.com';
