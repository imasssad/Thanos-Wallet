/**
 * MultX bridge (web): the shared Thanos bridge service with this app's
 * settings, storage and chains. Off unless the build sets
 * NEXT_PUBLIC_MULTX_ENABLED=true with NEXT_PUBLIC_MULTX_MANIFEST_URL and
 * NEXT_PUBLIC_MULTX_MANIFEST_SHA256 — routes, bridges and tokens come only
 * from that signed manifest.
 */
import { JsonRpcProvider, type Signer } from 'ethers';
import { createThanosBridge, multxThanosConfig, bridgeSigner, createRemoteEvmSigner, lithoscanTxUrl, type ThanosBridge } from '@thanos/sdk-core';
import { browserRpcUrl, findEvmChain } from './evm-chains';
import { getSignerAddress, signerSignTransaction } from './signer-client';

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
  // LithoScan's tx pages are /txs/<hash>.
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

/** A signer for the unlocked account on the route's source chain.
 *
 * H-1 residual, closed: this used to derive a raw private key from the
 * seed right here in the main thread (`walletFromSeed(seed, ...).
 * privateKey`) just to hand it to `bridgeSigner` — exactly the
 * "seed re-crosses into wherever signing actually happens" gap the H-1
 * work closed for every other EVM path. A private-key-imported wallet
 * still goes through `bridgeSigner` directly (that key is already
 * surfaced to the UI by the import flow itself — a separate, accepted
 * exposure, not this one); the mnemonic/HD case now routes through the
 * same signing Worker every native/ERC-20 send already uses, which
 * never hands its cached seed back to the main thread. */
export function multxSigner(
  source: { privateKey?: string },
  chainId: number,
): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  if (source.privateKey) return bridgeSigner(source.privateKey, url, chainId);
  throw new Error('multxSigner: use multxRemoteSigner() for a mnemonic/HD account');
}

/** The mnemonic/HD-account counterpart of multxSigner() — see its doc
 *  comment. Reads the already-unlocked account's address from the
 *  Worker (no secret crosses back to the main thread) and routes every
 *  signed transaction through the Worker's existing sign-transaction op. */
export async function multxRemoteSigner(chainId: number): Promise<Signer> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  const { address } = await getSignerAddress();
  const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true, cacheTimeout: -1 });
  return createRemoteEvmSigner({
    address,
    provider,
    sendTransaction: (tx) => signerSignTransaction({
      chainId,
      rpcUrl: url,
      to:                    tx.to as string,
      value:                 tx.value?.toString(),
      data:                  tx.data as string | undefined,
      gasLimit:              tx.gasLimit?.toString(),
      maxFeePerGas:          tx.maxFeePerGas?.toString(),
      maxPriorityFeePerGas:  tx.maxPriorityFeePerGas?.toString(),
    }),
  });
}
