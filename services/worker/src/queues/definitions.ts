/**
 * All BullMQ queue names in one place.
 * Import this in both the API (to enqueue) and the Worker (to process).
 */

// BullMQ doesn't allow ':' in queue names — use '-' as separator
export const QUEUES = {
  WALLET_SYNC:      'wallet-sync',
  LEP100_SYNC:      'lep100-sync',
  BRIDGE_POLL:      'bridge-poll',
  PORTFOLIO_REFRESH:'portfolio-refresh',
  PRICE_REFRESH:    'price-refresh',
  TX_CONFIRM:       'tx-confirm',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ─── Job payload types ───────────────────────────────────────────────────────

export interface WalletSyncJob {
  userId:    string;
  accountId: string;
  chainId:   number;
  address:   string;
  mode:      'incremental' | 'full';
}

export interface Lep100SyncJob {
  chainId:         number;
  contractAddress: string;
  mode:            'bootstrap' | 'incremental' | 'backfill';
  cursor?:         string;
}

export interface BridgePollJob {
  bridgeJobId:  string;
  executionId:  string;
  provider:     'multx';
  fromChainId:  number;
  toChainId:    number;
  attemptCount: number;
}

export interface PortfolioRefreshJob {
  userId:        string;
  walletAddress: string;
}

export interface PriceRefreshJob {
  symbols: string[];
}

export interface TxConfirmJob {
  txId:     string;
  chainId:  number;
  txHash:   string;
  chainKind:'evm' | 'lithic' | 'bitcoin' | 'solana';
}
