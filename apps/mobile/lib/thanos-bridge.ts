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
import { HDNodeWallet, JsonRpcProvider, Mnemonic, type Signer } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { createThanosBridge, multxThanosConfig, bridgeSigner, createRemoteEvmSigner, type ThanosBridge } from './multx-thanos/service';
import { allEvmChains } from './custom-assets';
import { lithoscanTxUrl } from './chain-history';
import { getActiveAccountIndex } from './accounts';
import { deriveAddress, signAndBroadcast } from './signer';

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

/** Display name, gas coin and explorer for a chain id (LithoScan's
 *  transaction pages are /txs/<hash>). */
export function multxChain(chainId: number): { name: string; nativeSymbol: string; explorerTx?: (hash: string) => string } {
  const chain = chainById(chainId);
  if (!chain) return { name: `Chain ${chainId}`, nativeSymbol: 'gas' };
  if (chainId === 9005) return { name: chain.name, nativeSymbol: chain.nativeSymbol, explorerTx: lithoscanTxUrl };
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

/** HD path for the active EVM account — matches lib/signer.ts's own default. */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

/** The active account's key: a private-key wallet's own, or the seed's at
 *  the active index. Still used for display (the address shown before a
 *  transfer) — that non-signing use is a separate, larger pattern left
 *  open across every client, not this signing path. multxSigner() itself
 *  no longer calls this for the signing case — see its doc comment. */
export function multxPrivateKey(seed: string[]): string {
  if (seed.length === 1 && PRIVATE_KEY_RE.test(seed[0].trim())) return seed[0].trim();
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), activeHdPath()).privateKey;
}

/** A signer for a private-key-imported account on the route's source
 *  chain — that key is already surfaced to the UI by the import flow
 *  itself (a separate, accepted exposure), so handing it to `bridgeSigner`
 *  directly adds nothing new.
 *
 * H-1 residual, closed for the mnemonic/HD case: this used to derive a
 * raw private key from the seed right here for EVERY wallet. lib/signer.ts
 * already caches the seed in module scope (set once at unlock) for every
 * other EVM signing path on this client — a mnemonic/HD account now
 * routes through that same cache instead — see multxRemoteSigner(). */
export function multxSigner(privateKey: string, chainId: number): ReturnType<typeof bridgeSigner> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  return bridgeSigner(privateKey, url, chainId);
}

/** The mnemonic/HD-account counterpart of multxSigner() — see its doc
 *  comment. Reads the already-unlocked account's address from
 *  lib/signer.ts's cache (no secret crosses out of that module) and
 *  routes every signed transaction through its existing signAndBroadcast. */
export async function multxRemoteSigner(chainId: number): Promise<Signer> {
  const url = multxRpcUrl(chainId);
  if (!url) throw new Error(`No RPC for chain ${chainId}`);
  const path     = activeHdPath();
  const address  = deriveAddress(path);
  const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true, cacheTimeout: -1 });
  return createRemoteEvmSigner({
    address,
    provider,
    sendTransaction: async (tx) => ({
      hash: await signAndBroadcast(path, tx, { chainId, rpcUrl: url }),
    }),
  });
}
