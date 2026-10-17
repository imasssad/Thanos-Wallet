/**
 * Thanos MultiSig (LEP100-15 §82–84) for the web app, the extension popup and the desktop app.
 * Each app renders <ThanosMultiSig> where its MultiSig tab goes and passes a WalletBridge to its
 * own signer; everything else (finding multisigs, reviewing, approving, executing, creating) is
 * the same code everywhere. The mobile app has the same screens in React Native.
 */
import { useCallback, useMemo, useState } from 'react';
import { getAddress } from 'ethers';
import { explorerAddressUrl, explorerTxUrl } from '@litho-vault/sdk';
import type { WalletBridge } from '../bridge';
import { MultisigClient } from '../client';
import type { MultisigNetwork } from '../config';
import type { KeyValueStore } from '../store';
import { MultisigContext, type MultisigUi, type Route } from './context';
import { AddScreen } from './screens/AddScreen';
import { CreateScreen } from './screens/CreateScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProposalScreen } from './screens/ProposalScreen';
import { TransferScreen } from './screens/TransferScreen';
import { VaultScreen } from './screens/VaultScreen';

export interface ThanosMultiSigProps {
  network: MultisigNetwork;
  /** The unlocked wallet; null while it is locked (the screens then only read). */
  bridge: WalletBridge | null;
  store?: KeyValueStore;
  /** The extension popup's narrow layout. */
  compact?: boolean;
  /** Shown as Back on the first screen (the popup returns to the wallet). */
  onExit?: () => void;
  className?: string;
}

function defaultOpen(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function ThanosMultiSig({ network, bridge, store, compact, onExit, className }: ThanosMultiSigProps) {
  const account = bridge ? (getAddress(bridge.address) as `0x${string}`) : null;
  // A new client per account, so nothing from one account's session carries into another's.
  const client = useMemo(() => new MultisigClient(network, bridge, { store }), [network, account, bridge?.canSign, store]);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1]!;

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const open = bridge?.openUrl ? (url: string) => bridge.openUrl!(url) : defaultOpen;

  const ui: MultisigUi = {
    client,
    chainId: network.chain.id,
    account,
    canSign: !!bridge?.canSign,
    cannotSignReason: bridge ? (bridge.canSign ? null : bridge.cannotSignReason ?? 'This account cannot sign here') : 'Unlock your wallet to act on multisigs',
    go,
    replace,
    back,
    openUrl: open,
    explorerTx: (hash) => explorerTxUrl(network.chain, hash),
    explorerAddress: (address) => explorerAddressUrl(network.chain, address),
  };

  const first = stack.length === 1;
  const onBack = first ? onExit : back;
  return (
    <MultisigContext.Provider value={ui}>
      <div className={`tms ${compact ? 'tms-compact' : ''} ${className ?? ''}`} data-testid="thanos-multisig">
        {route.name === 'home' && <HomeScreen onBack={onBack} />}
        {route.name === 'vault' && <VaultScreen key={route.address} address={route.address} onBack={onBack} />}
        {route.name === 'proposal' && <ProposalScreen key={`${route.address}:${route.id}`} address={route.address} id={route.id} onBack={onBack} />}
        {route.name === 'transfer' && <TransferScreen address={route.address} onBack={onBack} />}
        {route.name === 'create' && <CreateScreen onBack={onBack} />}
        {route.name === 'add' && <AddScreen onBack={onBack} />}
      </div>
    </MultisigContext.Provider>
  );
}
