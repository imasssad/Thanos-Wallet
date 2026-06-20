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
import type { Provider } from 'ethers';

/** Comma-split a URL list env var with a default. */
function urls(envVal: string | undefined, fallback: string): string[] {
  return String(envVal ?? fallback).split(',').map(s => s.trim()).filter(Boolean);
}

const RPC_URLS: Record<number, string[]> = {
  // Lithosphere — [primary, fallback].
  700777: urls(process.env.LITHO_RPC_PRIMARY && `${process.env.LITHO_RPC_PRIMARY},${process.env.LITHO_RPC_FALLBACK ?? 'https://rpc-2.litho.ai'}`,
               'https://rpc.litho.ai,https://rpc-2.litho.ai'),
  900523: urls(process.env.KAMET_RPC_PRIMARY && `${process.env.KAMET_RPC_PRIMARY},${process.env.KAMET_RPC_FALLBACK ?? 'https://rpc-3.litho.ai'}`,
               'https://rpc-3.litho.ai'),
  // Public chains
  1:     ['https://ethereum.publicnode.com', 'https://eth.merkle.io'],
  56:    ['https://bsc-dataseed.binance.org'],
  137:   ['https://polygon-bor-rpc.publicnode.com'],
  8453:  ['https://mainnet.base.org'],
  42161: ['https://arb1.arbitrum.io/rpc'],
  59144: ['https://rpc.linea.build'],
  10:    ['https://mainnet.optimism.io'],
  43114: ['https://api.avax.network/ext/bc/C/rpc'],
};

const providers = new Map<number, Provider>();

/** Build (and memoise) an ethers provider for the given EVM chain.
 *  When the chain has 2+ RPC URLs a FallbackProvider is built so a
 *  stalled primary (>1.5s) rotates to the fallback transparently.
 *  Returns `null` for unknown chains — callers branch on chainKind. */
export async function getEvmProvider(chainId: number): Promise<Provider | null> {
  const cached = providers.get(chainId);
  if (cached) return cached;
  const list = RPC_URLS[chainId];
  if (!list || list.length === 0) return null;
  const { JsonRpcProvider, FallbackProvider } = await import('ethers');
  const p: Provider = list.length === 1
    ? new JsonRpcProvider(list[0], chainId)
    : new FallbackProvider(
        list.map(url => ({
          provider:     new JsonRpcProvider(url, chainId),
          priority:     1,
          weight:       1,
          stallTimeout: 1500,
        })),
        chainId,
        { quorum: 1 },
      );
  providers.set(chainId, p);
  return p;
}

/** Bitcoin / Solana receipts use the same public APIs the web app does
 *  — we just pass through the relevant URLs so processors can fetch. */
export const BITCOIN_MEMPOOL_API = process.env.BITCOIN_MEMPOOL_API ?? 'https://mempool.space/api';
export const SOLANA_RPC_URL      = process.env.SOLANA_RPC_URL      ?? 'https://api.mainnet-beta.solana.com';
