import { KAMET_MAINNET } from '../chains/networks';

/**
 * MultX bridge configuration for Kamet (mainnet).
 *
 * The Kamet-side bridge contract (0x3a89…F263) was verified live on
 * 2026-06-10 (eth_getCode returned bytecode on rpc-3.litho.ai). The
 * destination-chain bridges below are the current testnet dry-run targets
 * (Sepolia + Base Sepolia); ETH / BNB / Base mainnet are pending the
 * security audit + treasury allocation and should be appended here once live.
 *
 * Source of truth: litho-validator-infra docs/integrations/THANOS_INTEGRATION_SPEC.md §4
 * and bridge-api deployment records.
 */

export interface MultXBridgeChain {
  chainId: number;
  name: string;
  bridgeAddress: string;
  network: 'mainnet' | 'testnet';
}

export interface KametMultXConfig {
  /** Canonical Kamet (source) bridge contract. */
  bridgeAddress: string;
  /** Kamet EVM chainId. */
  chainId: number;
  /** Public bridge API (signature aggregation + status). */
  bridgeApiUrl: string;
  /** Kamet EVM JSON-RPC the bridge UI reads from. */
  rpcUrl: string;
  /** Destination chains reachable from Kamet via MultX. */
  destinationChains: MultXBridgeChain[];
}

export const KAMET_MULTX_BRIDGE: KametMultXConfig = {
  bridgeAddress: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',
  chainId: KAMET_MAINNET.chainId,
  bridgeApiUrl: 'https://bridge.litho.ai',
  rpcUrl: 'https://rpc-3.litho.ai',
  destinationChains: [
    {
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      bridgeAddress: '0xfdA3b83FE8438123eAF5153945A46F8fcF6175f4',
      network: 'testnet'
    },
    {
      chainId: 84532,
      name: 'Base Sepolia',
      bridgeAddress: '0xfdA3b83FE8438123eAF5153945A46F8fcF6175f4',
      network: 'testnet'
    }
  ]
};
