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
 * Every chain reuses the verified RPC config in evm-external.ts. Lithosphere
 * Mainnet (9005) is the default. Makalu is no longer built in (2026-09-29,
 * client request): a user who wants the testnet adds it as a custom network,
 * and it then routes like any other chain.
 */
import { EXT_EVM_CHAINS } from './evm-external';
import { customChains } from './custom-assets';

export interface DappChain {
  chainId:      number;
  name:         string;
  rpcUrl:       string;
  nativeSymbol: string;
}

/** Lithosphere Mainnet — the chain a dApp sees until it switches. */
export const DEFAULT_DAPP_CHAIN_ID = 9005;

export const DAPP_CHAINS: readonly DappChain[] = EXT_EVM_CHAINS.map((c) => ({
  chainId: c.chainId, name: c.name, rpcUrl: c.rpcUrl, nativeSymbol: c.nativeSymbol,
}));

export const toChainHex = (id: number): string => `0x${id.toString(16)}`;

/** Built-in switchable chains + user-added custom networks (deduped). The
 *  custom overlay is primed by loadCustomAssets() at background/popup startup. */
export function allDappChains(): DappChain[] {
  const seen = new Set(DAPP_CHAINS.map((c) => c.chainId));
  const extra: DappChain[] = customChains()
    .filter((c) => !seen.has(c.chainId))
    .map((c) => ({ chainId: c.chainId, name: c.name, rpcUrl: c.rpcUrl, nativeSymbol: c.nativeSymbol }));
  return [...DAPP_CHAINS, ...extra];
}

export function dappChainByHex(hex: string): DappChain | undefined {
  const h = (hex || '').toLowerCase();
  return allDappChains().find((c) => toChainHex(c.chainId) === h);
}

export function dappChainById(id: number): DappChain | undefined {
  return allDappChains().find((c) => c.chainId === id);
}

