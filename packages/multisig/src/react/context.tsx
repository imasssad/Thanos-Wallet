import { createContext, useContext } from 'react';
import type { Address } from '@litho-vault/sdk';
import type { MultisigClient } from '../client';

export type Route =
  | { name: 'home' }
  | { name: 'vault'; address: Address }
  | { name: 'proposal'; address: Address; id: bigint }
  | { name: 'transfer'; address: Address }
  | { name: 'create' }
  | { name: 'add' };

export interface MultisigUi {
  client: MultisigClient;
  chainId: number;
  /** The wallet's account, or null when the wallet is locked. */
  account: Address | null;
  canSign: boolean;
  cannotSignReason: string | null;
  go(route: Route): void;
  /** Replaces the current screen (after creating something, so Back skips the form). */
  replace(route: Route): void;
  back(): void;
  openUrl(url: string): void;
  explorerTx(hash: string): string | null;
  explorerAddress(address: string): string | null;
}

export const MultisigContext = createContext<MultisigUi | null>(null);

export function useMultisig(): MultisigUi {
  const ui = useContext(MultisigContext);
  if (!ui) throw new Error('Thanos MultiSig screens must be inside <ThanosMultiSig>');
  return ui;
}
