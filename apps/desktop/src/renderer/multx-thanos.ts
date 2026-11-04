/**
 * MultX bridge (desktop): the shared Thanos bridge service with this app's
 * settings, storage and chains. Off unless the build sets
 * VITE_MULTX_ENABLED=true with VITE_MULTX_MANIFEST_URL and
 * VITE_MULTX_MANIFEST_SHA256 (release.yml maps the MULTX_* repository
 * variables) — routes, bridges and tokens come only from that manifest.
 */
import { createThanosBridge, multxThanosConfig, bridgeSigner, createRemoteEvmSigner, lithoscanTxUrl, type ThanosBridge } from '@thanos/sdk-core';
import { HDNodeWallet, JsonRpcProvider, Mnemonic, type Signer } from 'ethers';
import { getActiveAccountIndex, isPrivateKeyWallet } from './vault';
import { getExtEvmChain } from './custom-assets';

/** HD path for the active EVM account — matches wc-signer.ts's activeHdPath(). */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

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
  // LithoScan's transaction pages are /txs/ (they take the 0x hash too).
  if (chainId === 9005) return { name: chain.name, nativeSymbol: chain.nativeSymbol, explorerTx: lithoscanTxUrl };
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

/** The active account's key: a private-key wallet's own, or the seed's at
 *  the active index. Still used for display (the address shown before a
 *  transfer) — that non-signing use is a separate, larger pattern left
 *  open across every client, not this signing path. multxSigner() itself
 *  no longer calls this for the signing case — see its doc comment. */
export function multxPrivateKey(seed: string[]): string {
  if (isPrivateKeyWallet(seed)) return seed[0].trim();
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), activeHdPath()).privateKey;
}

/** A signer for a private-key-imported account on the route's source
 *  chain — that key is already surfaced to the UI by the import flow
 *  itself (a separate, accepted exposure), so handing it to `bridgeSigner`
 *  directly adds nothing new.
 *
 * H-1 residual, closed for the mnemonic/HD case: this used to derive a
 * raw private key from the seed right here for EVERY wallet — exactly the
 * "WalletConnect always re-derived the key in the renderer" gap the H-1
 * work's main-process IPC bridge closed for every other EVM signing path
 * (wc-signer.ts). A mnemonic/HD account now routes through that same
 * bridge instead — see multxRemoteSigner(). */
export function multxSigner(privateKey: string, chainId: number): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  return bridgeSigner(privateKey, url, chainId);
}

/** The mnemonic/HD-account counterpart of multxSigner() — see its doc
 *  comment. Reads the already-unlocked account's address from the main-
 *  process signer bridge (no secret crosses back to the renderer) and
 *  routes every signed transaction through that same bridge's sendTx. */
export async function multxRemoteSigner(chainId: number): Promise<Signer> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  const bridge = typeof window !== 'undefined' ? window.thanosDesktop?.signer : undefined;
  if (!bridge) throw new Error('multxRemoteSigner: the main-process signer bridge is unavailable');
  const path     = activeHdPath();
  const address  = await bridge.address(path);
  const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true, cacheTimeout: -1 });
  return createRemoteEvmSigner({
    address,
    provider,
    sendTransaction: async (tx) => ({
      hash: await bridge.sendTx(path, {
        to:   tx.to as string,
        value:                tx.value?.toString(),
        data:                 tx.data as string | undefined,
        gas:                  tx.gasLimit?.toString(),
        maxFeePerGas:         tx.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
      }, { chainId, rpcUrl: url }),
    }),
  });
}
