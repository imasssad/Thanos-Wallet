/**
 * Thanos MultiSig in the extension: the network it runs on (VITE_MULTISIG_* for a testnet or
 * local build; Lithosphere Mainnet with the published Litho Vault deployment otherwise) and the
 * bridge to the offscreen signer, where keys are derived and used.
 */
import { jsonSafe, multisigNetwork, type MultisigNetwork, type WalletBridge } from '@thanos/multisig';
import { signAndBroadcastTx, signTypedData } from '../entrypoints/popup/offscreen-sign';

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
 * The active account's bridge. The HD path is fixed when the bridge is made (the popup makes a
 * new one when the account changes), so a signature can never come from another account than
 * the one on screen. A private-key wallet is a single account; the offscreen ignores the path.
 */
export function extensionMultisigBridge(seed: string[], address: string, accountIndex: number): WalletBridge {
  const hdPath = `m/44'/60'/0'/0/${accountIndex}`;
  return {
    address,
    canSign: seed.length > 0,
    cannotSignReason: 'Unlock your wallet to act on multisigs',
    sendTransaction: (tx) =>
      signAndBroadcastTx({
        seed,
        hdPath,
        tx: { to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}`, gasLimit: tx.gasLimit.toString() },
        chainId: tx.chainId,
        rpcUrl: tx.rpcUrl,
      }),
    // Runtime messages are JSON: bigints travel as decimal strings (same signature).
    signTypedData: ({ domain, types, message }) =>
      signTypedData({ seed, hdPath, payload: jsonSafe({ domain: domain as Record<string, unknown>, types, value: message }) }),
    openUrl: (url) => void browser.tabs.create({ url }),
  };
}
