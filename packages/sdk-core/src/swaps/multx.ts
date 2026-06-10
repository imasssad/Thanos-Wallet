import type { SwapExecutionResult, SwapQuote, SwapQuoteRequest } from '../types';

/**
 * MultX cross-chain bridge client — talks to https://bridge.litho.ai.
 *
 * Per the Litho team this is an internal service: no API key, no auth
 * layer. Replaces the earlier `api.multx.local` placeholder stub.
 *
 * Confirmed API surface (Litho infra team, 2026-06-10, all verified live):
 *   GET /bridge/status/{txHash}        — bridge transaction status
 *   GET /bridge/signatures/{txHash}    — collected validator signatures
 *   GET /bridge/transactions/{address} — bridge history for an address
 *   GET /chains                        — supported bridge chains
 *   GET /health                        — liveness ({ status: 'ok' })
 *
 * The bridge does NOT do quoting or routing — it is validator-signature
 * based. Swap quotes/routing come from the Ignite DEX (`dex/ignite.ts`);
 * `quote`/`execute` below throw immediately with a clear error so legacy
 * callers degrade to the Ignite path without a wasted network round-trip.
 */
export interface MultXConfig {
  /** Base URL; defaults to the production bridge. */
  baseUrl?: string;
}

const DEFAULT_BASE = 'https://bridge.litho.ai';

/** Mirrors `BridgeStatus` in the MultX OpenAPI. */
export interface MultXBridgeStatus {
  txHash:               string;
  status:               'pending' | 'signing' | 'completed' | 'failed';
  fromAddress?:         string;
  tokenAddress?:        string;
  amount?:              string;
  targetChain?:         number;
  signaturesCollected?: number;
  signaturesRequired?:  number;
  releaseTxHash?:       string | null;
  timestamp?:           string;
}

/** A supported bridge chain — mirrors an entry of GET /chains. */
export interface MultXChain {
  chainId: number;
  name:    string;
  symbol:  string;
  bridge:  string;
}

/** One row of GET /bridge/transactions/{address}. */
export interface MultXBridgeTransaction {
  txHash:        string;
  status:        'pending' | 'signing' | 'completed' | 'failed';
  fromAddress?:  string;
  tokenAddress?: string;
  amount?:       string;
  targetChain?:  number;
  releaseTxHash?: string | null;
  timestamp?:    string;
}

/** Paged response of GET /bridge/transactions/{address}. */
export interface MultXBridgeTransactionPage {
  transactions: MultXBridgeTransaction[];
  nextCursor:   string | null;
  count:        number;
}

/** Thrown by the deprecated quote/execute methods — the bridge has no
 *  quote/routing API by design. Callers should quote via the Ignite DEX
 *  client instead (see `dex/ignite.ts`). */
export class MultXQuotesUnsupported extends Error {
  constructor(method: string) {
    super(`MultX bridge has no ${method} API — swap quotes/routing come from the Ignite DEX`);
    this.name = 'MultXQuotesUnsupported';
  }
}

export class MultXClient {
  private readonly baseUrl: string;

  constructor(config: MultXConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body:    body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MultX ${method} ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** @deprecated The bridge has no quote API. Quote via the Ignite DEX
   *  client (`createIgniteClient`) instead. Throws immediately. */
  async quote(request: SwapQuoteRequest): Promise<SwapQuote> {
    void request;
    throw new MultXQuotesUnsupported('quote');
  }

  /** @deprecated The bridge has no execute API. Execute swaps via the
   *  Ignite DEX client instead. Throws immediately. */
  async execute(quoteId: string, walletAddress: string): Promise<SwapExecutionResult> {
    void quoteId; void walletAddress;
    throw new MultXQuotesUnsupported('execute');
  }

  /** Bridge transaction status — keyed on the source-chain tx hash. */
  async status(txHash: string): Promise<MultXBridgeStatus> {
    return this.json<MultXBridgeStatus>('GET', `/bridge/status/${encodeURIComponent(txHash)}`);
  }

  /** Collected validator signatures for a bridge transaction. */
  async signatures(txHash: string): Promise<unknown> {
    return this.json('GET', `/bridge/signatures/${encodeURIComponent(txHash)}`);
  }

  /** Bridge transaction history for an address (verified live route).
   *  Pass `cursor` from a previous page's `nextCursor` to paginate. */
  async transactions(address: string, cursor?: string): Promise<MultXBridgeTransactionPage> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.json<MultXBridgeTransactionPage>(
      'GET', `/bridge/transactions/${encodeURIComponent(address)}${qs}`,
    );
  }

  /** Supported bridge chains. */
  async chains(): Promise<MultXChain[]> {
    const res = await this.json<{ chains: MultXChain[] }>('GET', '/chains');
    return res.chains ?? [];
  }

  /** Liveness probe. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.json('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }
}
