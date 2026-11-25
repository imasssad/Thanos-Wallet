/**
 * The MultiSig tab: Thanos MultiSig's shared screens (@thanos/multisig, the same ones the web and
 * desktop apps show) in the popup's narrow layout, signing through the offscreen document.
 */
import React, { useMemo } from 'react';
import { ThanosMultiSig } from '@thanos/multisig/react';
import '@thanos/multisig/styles.css';
import { extensionMultisigBridge, extensionMultisigNetwork } from '../../lib/multisig';

export function MultiSigScreen({ seed, evmAddr, accountIndex }: { seed: string[]; evmAddr: string; accountIndex: number }) {
  const network = useMemo(() => extensionMultisigNetwork(), []);
  // accountIndex stays a dep so a switch rebuilds the bridge for the new
  // address even though the signing itself no longer takes an explicit path
  // (extensionMultisigBridge checks the offscreen signer's own cached
  // account against `evmAddr` before every signature).
  const bridge = useMemo(() => (evmAddr ? extensionMultisigBridge(seed, evmAddr) : null), [seed, evmAddr, accountIndex]);
  return (
    <div className="screen-pad" style={{ padding: 14 }}>
      <ThanosMultiSig network={network} bridge={bridge} compact />
    </div>
  );
}
