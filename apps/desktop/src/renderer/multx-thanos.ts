/**
 * MultX bridge (desktop): the shared Thanos bridge service with this app's
 * settings, storage and chains. Off unless the build sets
 * VITE_MULTX_ENABLED=true with VITE_MULTX_MANIFEST_URL and
 * VITE_MULTX_MANIFEST_SHA256 (release.yml maps the MULTX_* repository
 * variables) — routes, bridges and tokens come only from that manifest.
 */
import { createThanosBridge, multxThanosConfig, bridgeSigner, type ThanosBridge } from '@thanos/sdk-core';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { getActiveAccountIndex, isPrivateKeyWallet } from './vault';
import { getExtEvmChain } from './custom-assets';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const MULTX_CONFIG = multxThanosConfig(env.VITE_MULTX_ENABLED, env.VITE_MULTX_MANIFEST_URL, env.VITE_MULTX_MANIFEST_SHA256);

/** RPC this app uses for a chain (built-in or added in Settings). */
export function multxRpcUrl(chainId: number): string | undefined {
  return getExtEvmChain(chainId)?.rpcUrl;
}

/** Display name, gas coin and explorer for a chain id. */
export function multxChain(chainId: number): { name: string; nativeSymbol: string; explorerTx?: (hash: string) => string } {
  const chain = getExtEvmChain(chainId);
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

/** The active account's key: a private-key wallet's own, or the seed's at the active index. */
export function multxPrivateKey(seed: string[]): string {
  if (isPrivateKeyWallet(seed)) return seed[0].trim();
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${getActiveAccountIndex()}`).privateKey;
}

/** A signer for the active account on the route's source chain. */
export function multxSigner(seed: string[], chainId: number): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  return bridgeSigner(multxPrivateKey(seed), url, chainId);
}
