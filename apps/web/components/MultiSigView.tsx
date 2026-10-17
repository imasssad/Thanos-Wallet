'use client';
/**
 * Thanos MultiSig — shared multisig accounts on Lithosphere (Litho Vault, LEP100-15). The screens
 * are @thanos/multisig, the same ones the extension and the desktop app show; this view only
 * hands them the unlocked wallet's signer.
 */
import React, { useMemo } from 'react';
import { ThanosMultiSig } from '@thanos/multisig/react';
import '@thanos/multisig/styles.css';
import { useWallet } from './shell/AppShell';
import { webMultisigBridge, webMultisigNetwork } from '../lib/multisig';

export function MultiSigView() {
  const wallet = useWallet();
  const network = useMemo(() => webMultisigNetwork(), []);
  const bridge = useMemo(
    () => (wallet?.evmAddress ? webMultisigBridge({ evmAddress: wallet.evmAddress, seed: wallet.seed, privateKey: wallet.privateKey }) : null),
    [wallet?.evmAddress, wallet?.seed, wallet?.privateKey],
  );
  return (
    <div className="main-area settings-view">
      <div className="settings-wrap">
        <ThanosMultiSig network={network} bridge={bridge} />
      </div>
    </div>
  );
}
