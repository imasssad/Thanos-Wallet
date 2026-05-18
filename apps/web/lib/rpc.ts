/**
 * Makalu RPC provider for the web app.
 *
 * The failover logic now lives in @thanos/sdk-core (chains/provider.ts)
 * so every client — web, desktop, extension, mobile — shares one
 * implementation. This module is a thin web-specific adapter: it reads
 * the NEXT_PUBLIC_LITHO_RPC env override and injects it into the shared
 * factory, then re-exports the Makalu provider.
 *
 * FallbackProvider behaviour (in sdk-core): quorum 1, all endpoints
 * priority 1, 1500ms stall timeout before rotating to the next.
 */
import {
  getMakaluProvider as sdkGetMakaluProvider,
  listRpcUrls as sdkListRpcUrls,
  setRpcUrls,
} from '@thanos/sdk-core';

export const MAKALU_CHAIN_ID = 700777;

// If NEXT_PUBLIC_LITHO_RPC is set (comma-separated), override the shared
// endpoint list for Makalu. Runs once at module load — before any
// getMakaluProvider() call, which is when the provider is memoised.
const envRpc =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_LITHO_RPC) || '';
const envUrls = String(envRpc).split(',').map((s) => s.trim()).filter(Boolean);
if (envUrls.length > 0) setRpcUrls(MAKALU_CHAIN_ID, envUrls);

/** Singleton Makalu provider with automatic RPC failover. */
export function getMakaluProvider() {
  return sdkGetMakaluProvider();
}

/** Read-only access to the URL list, for diagnostics / health badges. */
export function listRpcUrls(): string[] {
  return sdkListRpcUrls(MAKALU_CHAIN_ID);
}
