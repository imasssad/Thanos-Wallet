/**
 * Ignite DEX client — desktop renderer.
 * Mirrors apps/web/lib/ignite.ts.
 */

const DEFAULT_BASE = 'https://ignite.litho.ai';
function baseUrl(): string {
  const e = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (e?.VITE_IGNITE_API_URL || DEFAULT_BASE).replace(/\/$/, '');
}

export interface IgniteQuote {
  quoteId: string; from: string; to: string;
  fromAmount: string; toAmount: string;
  rate: number; feeFrom: string; expiresAt: number; priceImpact?: number;
}
export interface IgniteExecution {
  executionId: string; sourceHash: string | null;
  state: 'pending' | 'completed' | 'failed';
}
export interface IgniteStatus {
  executionId: string;
  state: 'pending' | 'completed' | 'failed';
  sourceHash: string | null; settledAt: number | null; error?: string;
}
export class IgniteUnavailable extends Error {
  constructor(message = 'Ignite DEX is unavailable') {
    super(message); this.name = 'IgniteUnavailable';
  }
}

async function json<T>(method: string, path: string, body?: unknown, timeoutMs = 8_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl() + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) throw new IgniteUnavailable(`ignite ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new IgniteUnavailable('ignite timed out');
    if (e instanceof IgniteUnavailable) throw e;
    throw new IgniteUnavailable((e as Error).message || 'ignite error');
  } finally { clearTimeout(t); }
}

export async function getQuote(from: string, to: string, fromAmount: string): Promise<IgniteQuote> {
  return json<IgniteQuote>('POST', '/api/quote', { tokenIn: from, tokenOut: to, amountIn: fromAmount });
}
export async function execute(quoteId: string, signedTx: string): Promise<IgniteExecution> {
  return json<IgniteExecution>('POST', '/api/swap', { quoteId, signedTx });
}
export async function getStatus(id: string): Promise<IgniteStatus> {
  return json<IgniteStatus>('GET', `/api/status/${encodeURIComponent(id)}`);
}
