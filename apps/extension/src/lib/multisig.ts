/**
 * Thanos MultiSig in the extension: the network it runs on (VITE_MULTISIG_* for a testnet or
 * local build; Lithosphere Mainnet with the published Litho Vault deployment otherwise) and the
 * bridge to the offscreen signer, where keys are derived and used.
 */
import { jsonSafe, multisigNetwork, type MultisigNetwork, type WalletBridge } from '@thanos/multisig';
import { signAndBroadcastTx, signTypedData, getSignerAddress } from '../entrypoints/popup/offscreen-sign';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

let cached: MultisigNetwork | null = null;
export function extensionMultisigNetwork(): MultisigNetwork {
  cached ??= multisigNetwork({
    CHAIN_ID:       env.VITE_MULTISIG_CHAIN_ID,
    CHAIN_NAME:     env.VITE_MULTISIG_CHAIN_NAME,
    RPC_URL:        env.VITE_MULTISIG_RPC_URL,
    EXPLORER_URL:   env.VITE_MULTISIG_EXPLORER_URL,
    FACTORY:        env.VITE_MULTISIG_FACTORY,
    LENS:           env.VITE_MULTISIG_LENS,
    AI_GUARD:       env.VITE_MULTISIG_AI_GUARD,
    RECOVERY_GUARD: env.VITE_MULTISIG_RECOVERY_GUARD,
    FREEZE_GUARD:   env.VITE_MULTISIG_FREEZE_GUARD,
    IMPLEMENTATION: env.VITE_MULTISIG_IMPLEMENTATION,
    DEPLOY_BLOCK:   env.VITE_MULTISIG_DEPLOY_BLOCK,
    INDEXER_URL:    env.VITE_MULTISIG_INDEXER_URL,
    APP_URL:        env.VITE_MULTISIG_APP_URL,
  });
  return cached;
}

/**
 * The active account's bridge. Hardening-audit H-1: signing now goes through
 * the offscreen signer's own CACHED account (kept in sync with the popup's
 * active index via setSignerAccountIndex on every switch), not a per-call
 * hdPath — so `check()` below re-derives the offscreen's current address and
 * refuses to sign if it has drifted from the `address` this bridge was built
 * for, the same guard desktop's multisig.tsx uses around its own IPC bridge.
 */
export function extensionMultisigBridge(seed: string[], address: string): WalletBridge {
  const check = async () => {
    if ((await getSignerAddress()).toLowerCase() !== address.toLowerCase()) {
      throw new Error('The active account changed. Go back and try again.');
    }
  };
  return {
    address,
    canSign: seed.length > 0,
    cannotSignReason: 'Unlock your wallet to act on multisigs',
    sendTransaction: async (tx) => {
      await check();
      return signAndBroadcastTx({
        tx: { to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}`, gasLimit: tx.gasLimit.toString() },
        chainId: tx.chainId,
        rpcUrl: tx.rpcUrl,
      });
    },
    // Runtime messages are JSON: bigints travel as decimal strings (same signature).
    signTypedData: async ({ domain, types, message }) => {
      await check();
      return signTypedData({ payload: jsonSafe({ domain: domain as Record<string, unknown>, types, value: message }) });
    },
    openUrl: (url) => void browser.tabs.create({ url }),
  };
}
