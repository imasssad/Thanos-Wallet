/**
 * All BullMQ queue names in one place.
 * Import this in both the API (to enqueue) and the Worker (to process).
 */

export const QUEUES = {
  /** Sync wallet balances + transaction history from RPC */
  WALLET_SYNC:      'wallet:sync',
  /** LEP100 token balance + event sync */
  LEP100_SYNC:      'lep100:sync',
  /** Poll MultX bridge status until settled or failed */
  BRIDGE_POLL:      'bridge:poll',
  /** Refresh portfolio USD values */
  PORTFOLIO_REFRESH:'portfolio:refresh',
  /** Refresh token prices from CoinGecko */
  PRICE_REFRESH:    'price:refresh',
  /** Confirm pending transactions on-chain */
  TX_CONFIRM:       'tx:confirm',
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
