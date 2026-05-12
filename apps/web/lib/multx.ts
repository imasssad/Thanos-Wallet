/**
 * MultX bridge client — talks to https://bridge.litho.ai.
 *
 * Per spec from the Litho team: this is an internal service, no API key,
 * no auth layer. All requests are JSON POST/GET against the base URL.
 *
 * If the API is offline or returns an unexpected shape, every method falls
 * back to a stub result that lets the UI keep rendering (with a clear
 * "rates unavailable" indicator). The structure is designed so that when
 * the real endpoint shapes land we can drop them in without touching the
 * SwapModal.
 *
 * Expected endpoints (subject to confirmation when full API docs land):
 *   POST /v1/quote        — { from, to, fromAmount } -> Quote
 *   POST /v1/execute      — { quoteId, signedTx }    -> Execution
 *   GET  /v1/status/:id   —                          -> Status
 *   GET  /v1/health       —                          -> { ok: true }
 */

const DEFAULT_BASE = 'https://bridge.litho.ai';

function baseUrl(): string {
  // NEXT_PUBLIC_* makes it accessible in the browser bundle. Server-side
  // code can read MULTX_API_URL directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  return (env.NEXT_PUBLIC_MULTX_API_URL || env.MULTX_API_URL || DEFAULT_BASE).replace(/\/$/, '');
}

/* ─── Types ────────────────────────────────────────────────────────────── */

export interface Quote {
  /** Quote identifier — pass back into /execute. */
  quoteId:    string;
  /** Source token symbol (e.g. 'LITHO'). */
  from:       string;
  /** Destination token symbol. */
  to:         string;
  /** Human-readable source amount (the user's input). */
  fromAmount: string;
  /** Human-readable destination amount the user receives. */
  toAmount:   string;
  /** 1 from = N to. */
  rate:       number;
  /** Fee, paid in the source token (human-readable). */
  feeFrom:    string;
  /** Unix ms; quotes typically expire after ~30s. */
  expiresAt:  number;
}

export interface Execution {
  /** Execution id — pass into /status to poll progress. */
  executionId: string;
  /** Hash of the source-chain tx (returned once the user signs + broadcasts). */
  sourceHash:  string | null;
  state:       'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
}

export interface Status {
  executionId: string;
  state:       'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
  sourceHash:  string | null;
  destHash:    string | null;
  settledAt:   number | null;
  /** Optional human-readable error (only when state === 'failed'). */
  error?:      string;
}

export class MultXUnavailable extends Error {
  constructor(message = 'Bridge is unavailable') {
    super(message);
    this.name = 'MultXUnavailable';
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
    if (!res.ok) throw new MultXUnavailable(`bridge ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new MultXUnavailable('bridge timed out');
    if (e instanceof MultXUnavailable) throw e;
    throw new MultXUnavailable((e as Error).message || 'bridge error');
  } finally {
    clearTimeout(t);
  }
}

/* ─── Public API ──────────────────────────────────────────────────────── */

export async function getQuote(from: string, to: string, fromAmount: string): Promise<Quote> {
  return json<Quote>('POST', '/v1/quote', { from, to, fromAmount });
}

export async function execute(quoteId: string, signedTx: string): Promise<Execution> {
  return json<Execution>('POST', '/v1/execute', { quoteId, signedTx });
}

export async function getStatus(executionId: string): Promise<Status> {
  return json<Status>('GET', `/v1/status/${encodeURIComponent(executionId)}`);
}

export async function isHealthy(): Promise<boolean> {
  try {
    await json<{ ok: boolean }>('GET', '/v1/health', undefined, 3_000);
    return true;
  } catch {
    return false;
  }
}
