/**
 * MultX bridge (mobile): the shared Thanos bridge service (lib/multx-thanos,
 * a synced copy of packages/sdk-core/src/multx-thanos) with this app's
 * settings, storage and chains. Off unless the build sets
 * EXPO_PUBLIC_MULTX_ENABLED=true with EXPO_PUBLIC_MULTX_MANIFEST_URL and
 * EXPO_PUBLIC_MULTX_MANIFEST_SHA256 (mobile-release.yml writes them from
 * the MULTX_* repository variables) — routes, bridges and tokens come only
 * from that manifest.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { createThanosBridge, multxThanosConfig, bridgeSigner, type ThanosBridge } from './multx-thanos/service';
import { allEvmChains } from './custom-assets';
import { getActiveAccountIndex } from './accounts';

export const MULTX_CONFIG = multxThanosConfig(
  process.env.EXPO_PUBLIC_MULTX_ENABLED,
  process.env.EXPO_PUBLIC_MULTX_MANIFEST_URL,
  process.env.EXPO_PUBLIC_MULTX_MANIFEST_SHA256,
);

const chainById = (chainId: number) => allEvmChains().find((c) => c.chainId === chainId);

/** RPC this app uses for a chain (built-in or added in Settings). */
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
    // React Native has no WebCrypto for the manifest's hash check.
    sha256Hex: async (text) => bytesToHex(sha256(utf8ToBytes(text))),
    store: {
      get: (key) => AsyncStorage.getItem(key),
      set: (key, value) => AsyncStorage.setItem(key, value),
    },
  });
  return instance;
}

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** The active account's key: a private-key wallet's own, or the seed's at the active index. */
export function multxPrivateKey(seed: string[]): string {
  if (seed.length === 1 && PRIVATE_KEY_RE.test(seed[0].trim())) return seed[0].trim();
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${getActiveAccountIndex()}`).privateKey;
}

/** A signer for the active account on the route's source chain. */
export function multxSigner(seed: string[], chainId: number): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  return bridgeSigner(multxPrivateKey(seed), url, chainId);
}
