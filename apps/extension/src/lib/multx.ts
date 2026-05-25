/**
 * MultX bridge client — extension.
 * Mirrors apps/web/lib/multx.ts.
 */

const DEFAULT_BASE = 'https://bridge.litho.ai';

function baseUrl(): string {
  const e = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (e?.VITE_MULTX_API_URL || DEFAULT_BASE).replace(/\/$/, '');
}

export interface Quote {
  quoteId:    string;
  from:       string;
  to:         string;
  fromAmount: string;
  toAmount:   string;
  rate:       number;
  feeFrom:    string;
  expiresAt:  number;
}

export interface Execution {
  executionId: string;
  sourceHash:  string | null;
  state:       'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
}

export interface Status {
  executionId: string;
  state:       'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
  sourceHash:  string | null;
  destHash:    string | null;
  settledAt:   number | null;
  error?:      string;
}

export class MultXUnavailable extends Error {
  constructor(message = 'Bridge is unavailable') {
    super(message); this.name = 'MultXUnavailable';
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
    if (!res.ok) throw new MultXUnavailable(`bridge ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new MultXUnavailable('bridge timed out');
    if (e instanceof MultXUnavailable) throw e;
    throw new MultXUnavailable((e as Error).message || 'bridge error');
  } finally { clearTimeout(t); }
}

export async function getQuote(from: string, to: string, fromAmount: string): Promise<Quote> {
  return json<Quote>('POST', '/bridge/quote', { from, to, fromAmount });
}
export async function execute(quoteId: string, signedTx: string): Promise<Execution> {
  return json<Execution>('POST', '/bridge/execute', { quoteId, signedTx });
}
export async function getStatus(txHashOrId: string): Promise<Status> {
  return json<Status>('GET', `/bridge/status/${encodeURIComponent(txHashOrId)}`);
}
export async function isHealthy(): Promise<boolean> {
  try { await json<{ ok: boolean }>('GET', '/health', undefined, 3_000); return true; }
  catch { return false; }
}
