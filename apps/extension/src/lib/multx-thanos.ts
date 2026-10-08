/**
 * MultX bridge (extension): the shared Thanos bridge service with this
 * extension's settings, storage and chains. Off unless the build sets
 * VITE_MULTX_ENABLED=true with VITE_MULTX_MANIFEST_URL and
 * VITE_MULTX_MANIFEST_SHA256 (release.yml maps the MULTX_* repository
 * variables) — routes, bridges and tokens come only from that manifest.
 * History lives in storage.local, shared by the popup and the side panel.
 */
import { createThanosBridge, multxThanosConfig, bridgeSigner, type ThanosBridge } from '@thanos/sdk-core';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { getActiveAccountIndex, isPrivateKeyWallet } from './vault';
import { allEvmChains } from './custom-assets';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const MULTX_CONFIG = multxThanosConfig(env.VITE_MULTX_ENABLED, env.VITE_MULTX_MANIFEST_URL, env.VITE_MULTX_MANIFEST_SHA256);

const chainById = (chainId: number) => allEvmChains().find((c) => c.chainId === chainId);

/** RPC this extension uses for a chain (built-in or added in Settings). */
export function multxRpcUrl(chainId: number): string | undefined {
  return chainById(chainId)?.rpcUrl;
}

/** Display name, gas coin and explorer for a chain id. */
export function multxChain(chainId: number): { name: string; nativeSymbol: string; explorerTx?: (hash: string) => string } {
  const chain = chainById(chainId);
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
      get: async (key) => {
        const r = await browser.storage.local.get(key);
        return typeof r[key] === 'string' ? (r[key] as string) : null;
      },
      set: async (key, value) => { await browser.storage.local.set({ [key]: value }); },
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
