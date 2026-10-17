/**
 * Thanos MultiSig on desktop: the shared screens (@thanos/multisig, as in the web app and the
 * extension) with a bridge to the main-process signer, where the seed lives. VITE_MULTISIG_*
 * point a build at a testnet or local chain; otherwise Lithosphere Mainnet with the published
 * Litho Vault deployment.
 */
import React, { useMemo } from 'react';
import { jsonSafe, multisigNetwork, type MultisigNetwork, type WalletBridge } from '@thanos/multisig';
import { ThanosMultiSig } from '@thanos/multisig/react';
import '@thanos/multisig/styles.css';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

let cached: MultisigNetwork | null = null;
function desktopMultisigNetwork(): MultisigNetwork {
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

/** The active account's bridge; its HD path is fixed when made, and checked against the main process before each signature. */
function desktopMultisigBridge(address: string, accountIndex: number, unlocked: boolean): WalletBridge {
  const hdPath = `m/44'/60'/0'/0/${accountIndex}`;
  const signer = window.thanosDesktop?.signer;
  const check = async () => {
    if (!signer) throw new Error('The desktop signer is not available');
    if ((await signer.address(hdPath)).toLowerCase() !== address.toLowerCase()) throw new Error('The active account changed. Go back and try again.');
    return signer;
  };
  return {
    address,
    canSign: unlocked && !!signer,
    cannotSignReason: 'Unlock your wallet to act on multisigs',
    sendTransaction: async (tx) =>
      (await check()).sendTx(hdPath, { to: tx.to, data: tx.data, value: tx.value.toString(), gas: tx.gasLimit.toString() }, { chainId: tx.chainId, rpcUrl: tx.rpcUrl }),
    signTypedData: async ({ domain, types, message }) =>
      (await check()).typedData(hdPath, jsonSafe({ domain: domain as Record<string, unknown>, types, value: message })),
    openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  };
}

export function MultiSigView({ address, accountIndex, unlocked }: { address: string; accountIndex: number; unlocked: boolean }) {
  const network = useMemo(() => desktopMultisigNetwork(), []);
  const bridge = useMemo(() => (address ? desktopMultisigBridge(address, accountIndex, unlocked) : null), [address, accountIndex, unlocked]);
  return (
    <div className="view-pad" style={{ padding: '24px 28px' }}>
      <ThanosMultiSig network={network} bridge={bridge} />
    </div>
  );
}
