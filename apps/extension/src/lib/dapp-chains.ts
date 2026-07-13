/**
 * Chains the dApp-facing provider can switch to and sign on.
 *
 * SECURITY (2026-06 audit): the extension was previously pinned to Makalu
 * because advertising other chains without per-chain provider routing let a
 * dApp think it got an eip155:1 tx while the wallet broadcast on 700777.
 * This registry is the single source of truth for the switchable set; every
 * signer path routes the transaction through the RPC that matches the active
 * chain, and the approval sheet shows that chain — so the advertised chain,
 * the signed chainId, and the broadcast RPC can never diverge.
 *
 * Makalu keeps its existing FallbackProvider (via @thanos/sdk-core); the 8
 * external EVM chains reuse the verified RPC config in evm-external.ts.
 */
import { EXT_EVM_CHAINS } from './evm-external';

export interface DappChain {
  chainId:      number;
  name:         string;
  rpcUrl:       string;   // '' for Makalu → signer uses the sdk FallbackProvider
  nativeSymbol: string;
}

export const MAKALU_CHAIN_ID = 700777;

export const DAPP_CHAINS: readonly DappChain[] = [
  { chainId: MAKALU_CHAIN_ID, name: 'Lithosphere Makalu', rpcUrl: '', nativeSymbol: 'LITHO' },
  ...EXT_EVM_CHAINS.map((c) => ({
    chainId: c.chainId, name: c.name, rpcUrl: c.rpcUrl, nativeSymbol: c.nativeSymbol,
  })),
];

export const toChainHex = (id: number): string => `0x${id.toString(16)}`;

export function dappChainByHex(hex: string): DappChain | undefined {
  const h = (hex || '').toLowerCase();
  return DAPP_CHAINS.find((c) => toChainHex(c.chainId) === h);
}

export function dappChainById(id: number): DappChain | undefined {
  return DAPP_CHAINS.find((c) => c.chainId === id);
}

export const isMakalu = (id: number): boolean => id === MAKALU_CHAIN_ID;
