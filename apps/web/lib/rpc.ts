/**
 * Lithosphere RPC providers for the web app.
 *
 * The failover logic now lives in @thanos/sdk-core (chains/provider.ts)
 * so every client — web, desktop, extension, mobile — shares one
 * implementation. This module is a thin web-specific adapter: it reads
 * env overrides (NEXT_PUBLIC_LITHO_RPC for Makalu, NEXT_PUBLIC_KAMET_RPC
 * for Kamet) and injects them into the shared factory, then re-exports
 * both Lithosphere providers.
 *
 * FallbackProvider behaviour (in sdk-core): quorum 1, all endpoints
 * priority 1, 1500ms stall timeout before rotating to the next.
 */
import {
  getMakaluProvider as sdkGetMakaluProvider,
  getKametProvider  as sdkGetKametProvider,
  listRpcUrls as sdkListRpcUrls,
  setRpcUrls,
} from '@thanos/sdk-core';

export const MAKALU_CHAIN_ID = 700777;
export const KAMET_CHAIN_ID  = 900523;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (typeof process !== 'undefined' ? (process as any).env : {}) || {};

// If NEXT_PUBLIC_LITHO_RPC is set (comma-separated), override the shared
// endpoint list for Makalu. Runs once at module load — before any
// getMakaluProvider() call, which is when the provider is memoised.
const makaluEnvUrls = String(env.NEXT_PUBLIC_LITHO_RPC || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (makaluEnvUrls.length > 0) setRpcUrls(MAKALU_CHAIN_ID, makaluEnvUrls);

// Same envelope for Kamet — NEXT_PUBLIC_KAMET_RPC overrides the
// rpc.kamet.litho.ai / rpc-3.litho.ai defaults from sdk-core's
// networks.ts. Optional; absence leaves the defaults in place.
const kametEnvUrls = String(env.NEXT_PUBLIC_KAMET_RPC || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (kametEnvUrls.length > 0) setRpcUrls(KAMET_CHAIN_ID, kametEnvUrls);

/** Singleton Makalu provider with automatic RPC failover. */
export function getMakaluProvider() {
  return sdkGetMakaluProvider();
}

/** Singleton Kamet provider with automatic RPC failover. */
export function getKametProvider() {
  return sdkGetKametProvider();
}

/** Pick the right provider for a Lithosphere chain id. Throws for
 *  anything that isn't Makalu or Kamet so callers can't silently route
 *  an EVM-chain tx through a Lithosphere provider. */
export function getLithoProvider(chainId: number) {
  if (chainId === MAKALU_CHAIN_ID) return getMakaluProvider();
  if (chainId === KAMET_CHAIN_ID)  return getKametProvider();
  throw new Error(`getLithoProvider: not a Lithosphere chain id: ${chainId}`);
}

/** Read-only access to the URL list, for diagnostics / health badges. */
export function listRpcUrls(chainId: number = MAKALU_CHAIN_ID): string[] {
  return sdkListRpcUrls(chainId);
}
