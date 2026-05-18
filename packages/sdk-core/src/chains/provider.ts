/**
 * Shared EVM / Lithic RPC provider factory.
 *
 * One implementation of RPC failover for every client — web, desktop,
 * extension, mobile — and the worker. Before this, only the web app had
 * failover (apps/web/lib/rpc.ts); the other clients had a single
 * JsonRpcProvider with no fallback.
 *
 * For a chain with 2+ endpoints this builds an ethers FallbackProvider
 * over the network's `rpcUrls` (ordered [primary, fallback] in
 * chains/networks.ts), so a stalled primary (>1.5s) rotates to the
 * fallback transparently. `quorum: 1` — we prioritise availability over
 * consensus. A single-endpoint chain gets a plain JsonRpcProvider.
 *
 * Apps that need to override the endpoint list at runtime — e.g. the
 * web app reading NEXT_PUBLIC_LITHO_RPC — call `setRpcUrls(chainId,
 * urls)` once at startup, before the first `getEvmProvider()` call.
 */
import { FallbackProvider, JsonRpcProvider, type Provider } from 'ethers';
import { SUPPORTED_NETWORKS } from './networks';

/** Lithosphere Makalu — the main chain. */
const MAKALU_CHAIN_ID = 700777;
/** Lithosphere Kamet — the sister chain (DNNS lives here). */
const KAMET_CHAIN_ID = 900523;

/** Per-chain RPC overrides, injected by the host app at startup. */
const rpcOverrides = new Map<number, string[]>();

/**
 * Override the RPC endpoint list for a chain. Call once at startup
 * (before the first `getEvmProvider(chainId)` — providers are memoised
 * on first build, so a later override is ignored).
 */
export function setRpcUrls(chainId: number, urls: string[]): void {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (cleaned.length > 0) rpcOverrides.set(chainId, cleaned);
}

/** The endpoint list a chain will use: override first, else networks.ts. */
function rpcUrlsFor(chainId: number): string[] {
  const override = rpcOverrides.get(chainId);
  if (override && override.length > 0) return override;
  const net = SUPPORTED_NETWORKS.find((n) => n.chainId === chainId);
  return net?.rpcUrls ?? [];
}

const providers = new Map<number, Provider>();

/**
 * Memoised ethers provider for an EVM / Lithic chain, with RPC
 * failover. Returns `null` for an unknown chain or one with no rpcUrls
 * (Bitcoin / Solana use their own clients, not this factory).
 */
export function getEvmProvider(chainId: number): Provider | null {
  const cached = providers.get(chainId);
  if (cached) return cached;

  const urls = rpcUrlsFor(chainId);
  if (urls.length === 0) return null;

  const provider: Provider =
    urls.length === 1
      ? new JsonRpcProvider(urls[0], chainId)
      : new FallbackProvider(
          urls.map((url) => ({
            provider:     new JsonRpcProvider(url, chainId),
            priority:     1,
            weight:       1,
            stallTimeout: 1500,
          })),
          chainId,
          { quorum: 1 },
        );

  providers.set(chainId, provider);
  return provider;
}

/** The Makalu provider (chain 700777) with failover. */
export function getMakaluProvider(): Provider {
  const p = getEvmProvider(MAKALU_CHAIN_ID);
  if (!p) throw new Error('Makalu RPC is not configured');
  return p;
}

/** The Kamet provider (chain 900523) with failover. */
export function getKametProvider(): Provider {
  const p = getEvmProvider(KAMET_CHAIN_ID);
  if (!p) throw new Error('Kamet RPC is not configured');
  return p;
}

/** The RPC URL list a chain will use — for diagnostics / health UIs. */
export function listRpcUrls(chainId: number): string[] {
  return rpcUrlsFor(chainId);
}

/** Drop all memoised providers — for tests, or after `setRpcUrls`. */
export function resetProviders(): void {
  providers.clear();
}
