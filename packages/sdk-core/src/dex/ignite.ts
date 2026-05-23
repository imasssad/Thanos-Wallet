import type {
  BridgeStatus, SwapExecutionResult, SwapQuote, SwapQuoteRequest,
} from '../types';

/**
 * Ignite DEX integration — Lithosphere same-chain AMM at https://ignite.litho.ai.
 *
 * MultX bridges *across* chains; Ignite swaps *within* one. The swap UI
 * quotes both in parallel and routes to whichever returns the better
 * output. This file holds the canonical interface every platform
 * (web / desktop / mobile / extension) consumes — so when the real
 * Ignite REST API spec lands, only `LiveIgniteClient.*` changes.
 *
 * Currently:
 *   - `MockIgniteClient`     — deterministic canned quotes, no network.
 *                              Used by tests + UI dev when no backend.
 *   - `LiveIgniteClient`     — calls the real endpoints. Skeleton paths
 *                              are wired but every method throws
 *                              `IgniteNotImplemented` until the Ignite
 *                              team confirms the request/response shape.
 *   - `createIgniteClient`   — factory chooses mock vs live based on
 *                              `kind`. Defaults to `mock` so the wallet
 *                              never hits an unconfirmed endpoint by
 *                              accident in production builds.
 *
 * Swap from mock to live by flipping one call:
 *     wallet.engine.ignite = createIgniteClient({ kind: 'live' });
 *
 * Once Ignite ships their OpenAPI, fill in the bodies in LiveIgniteClient
 * and remove the `IgniteNotImplemented` throws — every existing call
 * site keeps working unchanged.
 */

/* ─── External-app deep-link helper (unchanged) ───────────────────────── */

/** Build a URL that opens the Ignite web app on a specific market. */
export function getIgniteDexUrl(params?: { symbol?: string; chain?: string }): string {
  const url = new URL('https://ignite.litho.ai/');
  if (params?.symbol) url.searchParams.set('symbol', params.symbol);
  if (params?.chain)  url.searchParams.set('chain',  params.chain);
  return url.toString();
}

/* ─── Errors ──────────────────────────────────────────────────────────── */

export class IgniteUnavailable extends Error {
  constructor(message = 'Ignite DEX is unavailable') {
    super(message);
    this.name = 'IgniteUnavailable';
  }
}

/** Thrown by `LiveIgniteClient` for any method whose spec hasn't landed. */
export class IgniteNotImplemented extends Error {
  constructor(method: string) {
    super(`Ignite live client: ${method} is not implemented until the API spec is confirmed`);
    this.name = 'IgniteNotImplemented';
  }
}

/* ─── Interface every platform consumes ───────────────────────────────── */

export interface IgniteClient {
  /** Quote a same-chain swap. Returns a provider-tagged SwapQuote. */
  quote(req: SwapQuoteRequest): Promise<SwapQuote>;

  /** Execute a previously-issued quote. `walletAddress` is the signer
   *  the wallet will use to sign the swap tx. */
  execute(quoteId: string, walletAddress: string): Promise<SwapExecutionResult>;

  /** Poll the execution status. Mirrors the BridgeStatus shape so
   *  UI code can hold either MultX or Ignite results in one slot. */
  getStatus(executionId: string): Promise<BridgeStatus>;

  /** Liveness probe — `false` lets the UI fall back to MultX or the
   *  indicative price-table rate without surfacing an error. */
  isHealthy(): Promise<boolean>;
}

/* ─── Mock implementation — deterministic, no network ─────────────────── */

/**
 * `MockIgniteClient` produces a deterministic quote from a baked-in
 * USD price table. It exists so:
 *   - tests can verify the SwapModal's "better-of-multx-vs-ignite" picker
 *     without a network,
 *   - UI dev can compose against a stable response shape before the real
 *     backend exists,
 *   - the integration interface itself is exercised — if its shape
 *     drifts, the mock breaks first.
 *
 * Prices are intentionally tiny — the mock should never look like a real
 * production quote, and the symbols list is short on purpose so callers
 * notice the boundary and don't ship the mock by accident.
 */
const MOCK_PRICES_USD: Record<string, number> = {
  LITHO:  1.20,
  LitBTC: 65_000,
  LitETH: 3_200,
  USDL:   1.00,
  LAX:    0.45,
};

export interface MockIgniteConfig {
  /** Override prices for a specific test. Merged onto MOCK_PRICES_USD. */
  prices?: Record<string, number>;
  /** Latency injection — ms before resolving. Default 0. */
  latencyMs?: number;
  /** Force `isHealthy()` to return this. Default true. */
  healthy?: boolean;
  /** Fee in basis points charged on the input side. Default 30 (0.3%). */
  feeBps?: number;
}

export class MockIgniteClient implements IgniteClient {
  private readonly prices:    Record<string, number>;
  private readonly latencyMs: number;
  private readonly healthy:   boolean;
  private readonly feeBps:    number;

  constructor(config: MockIgniteConfig = {}) {
    this.prices    = { ...MOCK_PRICES_USD, ...(config.prices ?? {}) };
    this.latencyMs = config.latencyMs ?? 0;
    this.healthy   = config.healthy   ?? true;
    this.feeBps    = config.feeBps    ?? 30;
  }

  private async sleep(): Promise<void> {
    if (this.latencyMs > 0) await new Promise(r => setTimeout(r, this.latencyMs));
  }

  async quote(req: SwapQuoteRequest): Promise<SwapQuote> {
    await this.sleep();
    const inPrice  = this.prices[req.fromToken];
    const outPrice = this.prices[req.toToken];
    if (inPrice === undefined || outPrice === undefined) {
      throw new IgniteUnavailable(`Mock: no price for ${req.fromToken}/${req.toToken}`);
    }
    const amountIn = Number(req.amount);
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      throw new IgniteUnavailable(`Mock: invalid amount ${req.amount}`);
    }
    // Apply fee on the input, then convert at the price ratio.
    const inAfterFee = amountIn * (1 - this.feeBps / 10_000);
    const rawOut     = (inAfterFee * inPrice) / outPrice;
    // Bake in a small fixed price impact so the field is observable.
    const priceImpactBps = 12;
    const amountOut      = rawOut * (1 - priceImpactBps / 10_000);

    return {
      provider:        'ignite',
      quoteId:         `mock-ignite-${req.fromToken}-${req.toToken}-${Date.now()}`,
      amountIn:        req.amount,
      amountOut:       amountOut.toFixed(8),
      route:           [req.fromToken, req.toToken],
      estimatedSeconds: 6,
      feeUsd:          (amountIn * inPrice * (this.feeBps / 10_000)).toFixed(4),
      priceImpactBps,
      expiresAtMs:     Date.now() + 30_000,
    };
  }

  async execute(quoteId: string, walletAddress: string): Promise<SwapExecutionResult> {
    await this.sleep();
    if (!quoteId.startsWith('mock-ignite-')) {
      throw new IgniteUnavailable(`Mock: unknown quoteId ${quoteId}`);
    }
    if (!walletAddress) throw new IgniteUnavailable('Mock: walletAddress is required');
    return {
      provider:    'ignite',
      status:      'submitted',
      executionId: `mock-exec-${quoteId.slice('mock-ignite-'.length)}`,
      swapTxHash:  `0x${'0'.repeat(63)}1`,
    };
  }

  async getStatus(executionId: string): Promise<BridgeStatus> {
    await this.sleep();
    return {
      provider:          'ignite',
      status:            'completed',
      executionId,
      fromChainId:       700777,
      toChainId:         700777,
      fromToken:         'mock-from',
      toToken:           'mock-to',
      sourceTxHash:      `0x${'0'.repeat(63)}1`,
      destinationTxHash: `0x${'0'.repeat(63)}1`,
      updatedAt:         new Date().toISOString(),
    };
  }

  async isHealthy(): Promise<boolean> {
    await this.sleep();
    return this.healthy;
  }
}

/* ─── Live implementation — skeleton until Ignite confirms the spec ───── */

export interface LiveIgniteConfig {
  baseUrl?: string;
  /** Request timeout in ms. Default 8s — DEX quotes can be slow. */
  timeoutMs?: number;
}

const DEFAULT_LIVE_BASE = 'https://ignite.litho.ai';

/**
 * LiveIgniteClient — talks to https://ignite.litho.ai. Endpoints are
 * provisional (mirrored from the existing `apps/web/lib/ignite.ts`
 * which we authored ahead of the spec) and every method throws
 * `IgniteNotImplemented` until the Ignite team confirms the contract.
 *
 * When the spec lands:
 *   1. Replace each `throw new IgniteNotImplemented(...)` with the
 *      mapped fetch + response shaping.
 *   2. Update the `pathTemplates` block below if endpoint paths change.
 *   3. Add an end-to-end test that hits a sandbox URL.
 */
export class LiveIgniteClient implements IgniteClient {
  private readonly baseUrl:   string;
  private readonly timeoutMs: number;

  /** Endpoint paths we expect — kept here as a single source of truth so
   *  switching to the real spec is a one-block edit. */
  static readonly pathTemplates = {
    quote:    '/api/v1/quote',
    execute:  '/api/v1/swap',
    status:   '/api/v1/status/:id',
    health:   '/api/v1/health',
  } as const;

  constructor(config: LiveIgniteConfig = {}) {
    this.baseUrl   = (config.baseUrl ?? DEFAULT_LIVE_BASE).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 8_000;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async quote(_req: SwapQuoteRequest): Promise<SwapQuote> {
    throw new IgniteNotImplemented('quote');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_quoteId: string, _walletAddress: string): Promise<SwapExecutionResult> {
    throw new IgniteNotImplemented('execute');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getStatus(_executionId: string): Promise<BridgeStatus> {
    throw new IgniteNotImplemented('getStatus');
  }

  /** Health is implementable without the spec — a 200 on / is enough to
   *  prove the host is alive. Returning `false` triggers the UI's fallback
   *  to MultX or the indicative price-table rate, which is the safe path
   *  while the live client is still a skeleton. */
  async isHealthy(): Promise<boolean> {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), Math.min(this.timeoutMs, 3_000));
    try {
      const res = await fetch(`${this.baseUrl}${LiveIgniteClient.pathTemplates.health}`, {
        method: 'GET', signal: ctrl.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }
}

/* ─── Factory ─────────────────────────────────────────────────────────── */

export type IgniteClientKind = 'mock' | 'live';

export interface CreateIgniteClientConfig {
  kind?:      IgniteClientKind;
  /** Forwarded to MockIgniteClient when kind === 'mock'. */
  mock?:      MockIgniteConfig;
  /** Forwarded to LiveIgniteClient when kind === 'live'. */
  live?:      LiveIgniteConfig;
}

/**
 * Choose an Ignite client implementation. Defaults to `mock` so a
 * misconfigured deployment falls back to safe canned data rather than
 * pointing at the half-built live endpoints. To go live in production,
 * pass `{ kind: 'live' }` *after* the spec is confirmed.
 */
export function createIgniteClient(config: CreateIgniteClientConfig = {}): IgniteClient {
  if (config.kind === 'live') return new LiveIgniteClient(config.live);
  return new MockIgniteClient(config.mock);
}
