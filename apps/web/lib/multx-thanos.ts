/**
 * MultX bridge (web): the shared Thanos bridge service with this app's
 * settings, storage and chains. Off unless the build sets
 * NEXT_PUBLIC_MULTX_ENABLED=true with NEXT_PUBLIC_MULTX_MANIFEST_URL and
 * NEXT_PUBLIC_MULTX_MANIFEST_SHA256 — routes, bridges and tokens come only
 * from that signed manifest.
 */
import { createThanosBridge, multxThanosConfig, bridgeSigner, type ThanosBridge } from '@thanos/sdk-core';
import { browserRpcUrl, findEvmChain } from './evm-chains';
import { walletFromSeed } from './signer';

export const MULTX_CONFIG = multxThanosConfig(
  process.env.NEXT_PUBLIC_MULTX_ENABLED,
  process.env.NEXT_PUBLIC_MULTX_MANIFEST_URL,
  process.env.NEXT_PUBLIC_MULTX_MANIFEST_SHA256,
);

/** RPC this app uses for a chain (built-in or added in Settings). */
export function multxRpcUrl(chainId: number): string | undefined {
  const chain = findEvmChain(chainId);
  return chain ? browserRpcUrl(chain.rpcUrl) : undefined;
}

/** Display name, gas coin and explorer for a chain id. */
export function multxChain(chainId: number): { name: string; nativeSymbol: string; explorerTx?: (hash: string) => string } {
  const chain = findEvmChain(chainId);
  if (!chain) return { name: `Chain ${chainId}`, nativeSymbol: 'gas' };
  const base = chain.explorerUrl.replace(/\/+$/, '');
  return { name: chain.name, nativeSymbol: chain.nativeSymbol, explorerTx: base ? (h) => `${base}/tx/${h}` : undefined };
}

let instance: ThanosBridge | null = null;
export function thanosBridge(): ThanosBridge {
  instance ??= createThanosBridge({
    config: MULTX_CONFIG,
    rpcUrlFor: multxRpcUrl,
    store: {
      get: async (key) => { try { return localStorage.getItem(key); } catch { return null; } },
      set: async (key, value) => { localStorage.setItem(key, value); },
    },
  });
  return instance;
}

/** A signer for the unlocked account on the route's source chain. */
export function multxSigner(
  source: { privateKey?: string; seed: string[]; accountIdx: number },
  chainId: number,
): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  const key = source.privateKey ?? walletFromSeed(source.seed, undefined, source.accountIdx).privateKey;
  return bridgeSigner(key, url, chainId);
}
