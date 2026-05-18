import type { SwapExecutionResult, SwapQuote, SwapQuoteRequest } from '../types';

/**
 * MultX cross-chain bridge client — talks to https://bridge.litho.ai.
 *
 * Per the Litho team this is an internal service: no API key, no auth
 * layer. Replaces the earlier `api.multx.local` placeholder stub.
 *
 * Verified endpoints (from bridge.litho.ai/docs — OpenAPI):
 *   GET /bridge/status/{txHash}      — bridge transaction status
 *   GET /bridge/signatures/{txHash}  — collected validator signatures
 *   GET /chains                      — supported bridge chains
 *   GET /health                      — liveness
 *
 * `quote` / `execute` below target the expected request/response shape
 * for a swap flow; the live bridge API does not expose those routes yet
 * (it is validator-signature based), so they will error until that API
 * lands. They are kept so the wallet's swap intent path compiles and
 * degrades gracefully.
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

  /** Quote a cross-chain swap. See the note above — endpoint unconfirmed. */
  async quote(request: SwapQuoteRequest): Promise<SwapQuote> {
    return this.json<SwapQuote>('POST', '/bridge/quote', request);
  }

  /** Execute a quoted swap. See the note above — endpoint unconfirmed. */
  async execute(quoteId: string, walletAddress: string): Promise<SwapExecutionResult> {
    return this.json<SwapExecutionResult>('POST', '/bridge/execute', { quoteId, walletAddress });
  }

  /** Bridge transaction status — keyed on the source-chain tx hash. */
  async status(txHash: string): Promise<MultXBridgeStatus> {
    return this.json<MultXBridgeStatus>('GET', `/bridge/status/${encodeURIComponent(txHash)}`);
  }

  /** Collected validator signatures for a bridge transaction. */
  async signatures(txHash: string): Promise<unknown> {
    return this.json('GET', `/bridge/signatures/${encodeURIComponent(txHash)}`);
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
