/**
 * MultX bridge (extension): the shared Thanos bridge service with this
 * extension's settings, storage and chains. Off unless the build sets
 * VITE_MULTX_ENABLED=true with VITE_MULTX_MANIFEST_URL and
 * VITE_MULTX_MANIFEST_SHA256 (release.yml maps the MULTX_* repository
 * variables) — routes, bridges and tokens come only from that manifest.
 * History lives in storage.local, shared by the popup and the side panel.
 */
import { createThanosBridge, multxThanosConfig, bridgeSigner, createRemoteEvmSigner, lithoscanTxUrl, type ThanosBridge } from '@thanos/sdk-core';
import { HDNodeWallet, JsonRpcProvider, Mnemonic, type Signer } from 'ethers';
import { getActiveAccountIndex, isPrivateKeyWallet } from './vault';
import { allEvmChains } from './custom-assets';
import { getSignerAddress, signAndBroadcastTx } from '../entrypoints/popup/offscreen-sign';

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
  // LithoScan's transaction pages are /txs/<hash>.
  if (chainId === 9005) return { name: chain.name, nativeSymbol: chain.nativeSymbol, explorerTx: lithoscanTxUrl };
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

/** The active account's key: a private-key wallet's own, or the seed's at
 *  the active index. Still used for display (deriving the address shown
 *  before a transfer, MultXBridgePanel.tsx) — that non-signing use is a
 *  separate, larger pattern (reading the seed into component state purely
 *  to show an address) left open across every client, not this signing
 *  path. multxSigner() itself no longer calls this for the signing case —
 *  see its doc comment. */
export function multxPrivateKey(seed: string[]): string {
  if (isPrivateKeyWallet(seed)) return seed[0].trim();
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${getActiveAccountIndex()}`).privateKey;
}

/** A signer for a private-key-imported account on the route's source
 *  chain — that key is already surfaced to the UI by the import flow
 *  itself (a separate, accepted exposure), so handing it to `bridgeSigner`
 *  directly adds nothing new.
 *
 * H-1 residual, closed for the mnemonic/HD case: this used to derive a
 * raw private key from the seed right here for EVERY wallet, re-crossing
 * the seed into exactly the state the H-1 work's offscreen-signer caching
 * closed for every other EVM signing path. A mnemonic/HD account now
 * routes through that same cache instead — see multxRemoteSigner(). */
export function multxSigner(privateKey: string, chainId: number): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  return bridgeSigner(privateKey, url, chainId);
}

/** The mnemonic/HD-account counterpart of multxSigner() — see its doc
 *  comment. Reads the already-unlocked account's address from the
 *  offscreen signer (no secret crosses back to the popup) and routes
 *  every signed transaction through its existing sign.evm-tx op. */
export async function multxRemoteSigner(chainId: number): Promise<Signer> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  const address  = await getSignerAddress();
  const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true, cacheTimeout: -1 });
  return createRemoteEvmSigner({
    address,
    provider,
    sendTransaction: async (tx) => ({
      hash: await signAndBroadcastTx({
        tx: {
          to:        tx.to as string,
          value:     tx.value?.toString(),
          data:      tx.data as string | undefined,
          gasLimit:  tx.gasLimit?.toString(),
          gasPrice:  tx.gasPrice?.toString(),
          nonce:     tx.nonce ?? undefined,
          chainId,
        },
        chainId,
        rpcUrl: url,
      }),
    }),
  });
}
