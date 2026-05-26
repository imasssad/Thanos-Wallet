/**
 * MultX bridge client — mobile (React Native).
 * Mirrors apps/web/lib/multx.ts.
 */

const DEFAULT_BASE = 'https://bridge.litho.ai';

export interface Quote {
  quoteId: string; from: string; to: string;
  fromAmount: string; toAmount: string;
  rate: number; feeFrom: string; expiresAt: number;
  unsignedTx?: {
    to: string; value?: string; data?: string;
    gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
    chainId?: number;
  };
}
export interface Execution {
  executionId: string; sourceHash: string | null;
  state: 'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
}
export interface Status {
  executionId: string;
  state: 'pending' | 'bridging' | 'settling' | 'completed' | 'failed';
  sourceHash: string | null; destHash: string | null;
  settledAt: number | null; error?: string;
}
export class MultXUnavailable extends Error {
  constructor(message = 'Bridge is unavailable') { super(message); this.name = 'MultXUnavailable'; }
}

async function json<T>(method: string, path: string, body?: unknown, timeoutMs = 8_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DEFAULT_BASE + path, {
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
export async function getStatus(id: string): Promise<Status> {
  return json<Status>('GET', `/bridge/status/${encodeURIComponent(id)}`);
}
