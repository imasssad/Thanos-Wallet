/**
 * Ignite DEX client — talks to https://ignite.litho.ai.
 *
 * Ignite is the Lithosphere-ecosystem **same-chain** DEX (an AMM), as
 * opposed to MultX which bridges *across* chains. The SwapModal quotes
 * both and routes through whichever returns the better output — that's
 * the "route optimisation" the scope calls for.
 *
 * Same graceful-fallback contract as lib/multx.ts: on any failure the
 * caller gets an IgniteUnavailable error and the UI falls back to the
 * indicative price-table rate. The Quote / Execution / Status shapes
 * are intentionally field-compatible with MultX's so the SwapModal can
 * hold either in one state slot.
 *
 * Expected endpoints (provisional — confirm when the Ignite API docs
 * land, mirrors how multx.ts was built ahead of the bridge spec):
 *   POST /api/quote       — { tokenIn, tokenOut, amountIn }  -> Quote
 *   POST /api/swap        — { quoteId, signedTx }            -> Execution
 *   GET  /api/status/:id  —                                  -> Status
 *   GET  /api/health      —                                  -> { ok }
 */

const DEFAULT_BASE = 'https://ignite.litho.ai';

function baseUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  return (env.NEXT_PUBLIC_IGNITE_API_URL || env.IGNITE_API_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/* ─── Types — field-compatible with lib/multx.ts ──────────────────────── */

export interface IgniteQuote {
  quoteId:    string;
  from:       string;
  to:         string;
  fromAmount: string;
  toAmount:   string;
  /** 1 from = N to. */
  rate:       number;
  /** Swap fee, in the source token (human-readable). */
  feeFrom:    string;
  /** Unix ms; DEX quotes expire fast (price moves). */
  expiresAt:  number;
  /** Price impact of this trade as a percentage, when the DEX reports it. */
  priceImpact?: number;
  /** Optional: unsigned router call the wallet should sign + broadcast.
   *  Present when Ignite operates in "wallet broadcasts" mode (the
   *  canonical Uniswap-style flow). When absent, the wallet calls
   *  /api/swap with the quoteId and Ignite handles execution
   *  server-side. */
  unsignedTx?: {
    to:                   string;
    value?:               string;
    data?:                string;
    gas?:                 string;
    maxFeePerGas?:        string;
    maxPriorityFeePerGas?: string;
    chainId?:             number;
  };
}

export interface IgniteExecution {
  executionId: string;
  /** On-chain swap tx hash once submitted. */
  sourceHash:  string | null;
  /** A same-chain DEX swap is one tx — no bridging/settling tiers. */
  state:       'pending' | 'completed' | 'failed';
}

export interface IgniteStatus {
  executionId: string;
  state:       'pending' | 'completed' | 'failed';
  sourceHash:  string | null;
  settledAt:   number | null;
  error?:      string;
}

export class IgniteUnavailable extends Error {
  constructor(message = 'Ignite DEX is unavailable') {
    super(message);
    this.name = 'IgniteUnavailable';
  }
}

/* ─── Wrapped fetch with timeout + graceful fallback ──────────────────── */

async function json<T>(method: string, path: string, body?: unknown, timeoutMs = 8_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl() + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body:    body === undefined ? undefined : JSON.stringify(body),
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new IgniteUnavailable(`ignite ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new IgniteUnavailable('ignite timed out');
    if (e instanceof IgniteUnavailable) throw e;
    throw new IgniteUnavailable((e as Error).message || 'ignite error');
  } finally {
    clearTimeout(t);
  }
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/** Quote a same-chain swap. `tokenIn`/`tokenOut` are ticker symbols. */
export async function getQuote(from: string, to: string, fromAmount: string): Promise<IgniteQuote> {
  return json<IgniteQuote>('POST', '/api/quote', { tokenIn: from, tokenOut: to, amountIn: fromAmount });
}

export async function execute(quoteId: string, signedTx: string): Promise<IgniteExecution> {
  return json<IgniteExecution>('POST', '/api/swap', { quoteId, signedTx });
}

export async function getStatus(executionId: string): Promise<IgniteStatus> {
  return json<IgniteStatus>('GET', `/api/status/${encodeURIComponent(executionId)}`);
}

export async function isHealthy(): Promise<boolean> {
  try {
    await json<{ ok: boolean }>('GET', '/api/health', undefined, 3_000);
    return true;
  } catch {
    return false;
  }
}
