import { describe, it, expect, vi } from 'vitest';
import {
  QuanttClient, QuanttError, SseParser, toAgentConfig, validateAgentUpdate, diffAgentConfig,
  type QuanttSession, type QuanttStreamEvent, type QuanttStreamStatus,
} from '../index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function signedIn(fetchImpl: typeof fetch, session: QuanttSession = { accessToken: 'at', refreshToken: 'rt' }) {
  let s: QuanttSession | null = session;
  return new QuanttClient({ fetchImpl, store: { get: () => s, set: (n) => { s = n; } } });
}

/** The documented Agent record (GET /v1/agents/{id}). */
const AGENT = {
  id: 'ag_1', userId: 'u_1', name: 'Momentum ETH', strategy: 'momentum', strategyPrompt: null,
  chains: ['arbitrum'], tokens: ['ETH'], dexPreference: 'kamet', walletAddress: '0xabc', walletDerivationIndex: 3,
  custodyModel: 'derived', capitalUsd: 500, maxPositionPct: 25, stopLoss: 5, takeProfit: 10, maxDailyLoss: 3.5,
  status: 'paused', autopilot: true, timeframe: '1h', quoteAsset: 'USDC',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
};

describe('SseParser', () => {
  it('parses events split at arbitrary chunk boundaries', () => {
    const p = new SseParser();
    const text = 'event: decision\ndata: {"id":"d1"}\n\n: keep-alive comment\nevent: risk_rejected\ndata: {"id":"d2"}\n\n';
    const events = [...text].flatMap((ch) => p.push(ch));
    expect(events).toEqual([
      { event: 'decision', data: '{"id":"d1"}', id: undefined },
      { event: 'risk_rejected', data: '{"id":"d2"}', id: undefined },
    ]);
  });

  it('handles CRLF split across chunks, multi-line data and the default type', () => {
    const p = new SseParser();
    expect(p.push('id: 7\r')).toEqual([]);
    expect(p.push('\ndata:line1\r\ndata: line2\r\n')).toEqual([]);
    expect(p.push('\r\n')).toEqual([{ event: 'message', data: 'line1\nline2', id: '7' }]);
  });

  it('dispatches nothing for a block without data', () => {
    const p = new SseParser();
    expect(p.push('event: ping\n\n')).toEqual([]);
    expect(p.push('data: x\n\n')).toEqual([{ event: 'message', data: 'x', id: undefined }]);
  });
});

describe('agent config', () => {
  it('extracts the editable config from a documented agent record', () => {
    const cfg = toAgentConfig(AGENT);
    expect(cfg).toMatchObject({ name: 'Momentum ETH', stopLoss: 5, timeframe: '1h', autopilot: true, chains: ['arbitrum'] });
    expect(toAgentConfig({ agent: AGENT })).toEqual(cfg);
  });

  it('refuses records missing documented fields', () => {
    expect(toAgentConfig({ ...AGENT, stopLoss: undefined })).toBeNull();
    expect(toAgentConfig({ ...AGENT, timeframe: '2h' })).toBeNull();
    expect(toAgentConfig(null)).toBeNull();
  });

  it('validates against the PATCH schema ranges', () => {
    expect(validateAgentUpdate({ stopLoss: 5, takeProfit: 500, maxPositionPct: 100, maxDailyLoss: 0 })).toEqual([]);
    expect(validateAgentUpdate({ takeProfit: 501 })).toHaveLength(1);
    expect(validateAgentUpdate({ maxPositionPct: 0 })).toHaveLength(1); // exclusive minimum
    expect(validateAgentUpdate({ stopLoss: -1, name: 'x', timeframe: '2h' as never })).toHaveLength(3);
    expect(validateAgentUpdate({ strategyPrompt: null })).toEqual([]);
    expect(validateAgentUpdate({ strategyPrompt: 'y'.repeat(2001) })).toHaveLength(1);
    expect(validateAgentUpdate({ capitalUsd: 0 })).toHaveLength(1);
    expect(validateAgentUpdate({ walletAddress: '0x1' } as never)).toEqual(['Unknown setting "walletAddress".']);
  });

  it('diffs only the changed fields', () => {
    const cfg = toAgentConfig(AGENT)!;
    expect(diffAgentConfig(cfg, { ...cfg })).toEqual({});
    expect(diffAgentConfig(cfg, { ...cfg, name: '  Momentum ETH  ', chains: ['arbitrum'] })).toEqual({});
    expect(diffAgentConfig(cfg, { ...cfg, stopLoss: 7, autopilot: false, tokens: ['ETH', 'ARB'] }))
      .toEqual({ stopLoss: 7, autopilot: false, tokens: ['ETH', 'ARB'] });
  });
});

describe('QuanttClient additions', () => {
  it('updateAgent refuses an invalid or empty body before any request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const c = signedIn(fetchImpl);
    await expect(c.updateAgent('ag_1', { takeProfit: 900 })).rejects.toBeInstanceOf(QuanttError);
    await expect(c.updateAgent('ag_1', {})).rejects.toThrow(/nothing to update/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('updateAgent PATCHes a valid body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...AGENT, stopLoss: 7 })) as unknown as typeof fetch;
    await signedIn(fetchImpl).updateAgent('ag 1', { stopLoss: 7 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.quantts.ai/v1/agents/ag%201');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ stopLoss: 7 });
    expect(init.headers).toMatchObject({ authorization: 'Bearer at', 'content-type': 'application/json' });
  });

  it('getKillSwitch normalises the documented shape and rejects others', async () => {
    const armed = { armed: true, armedBy: 'ops', reason: 'Exchange outage', armedAt: '2026-09-27T10:00:00Z' };
    expect(await signedIn(vi.fn(async () => jsonResponse(armed)) as unknown as typeof fetch).getKillSwitch())
      .toEqual({ armed: true, armedBy: 'ops', reason: 'Exchange outage', armedAt: '2026-09-27T10:00:00Z' });
    expect(await signedIn(vi.fn(async () => jsonResponse({ halted: 'yes' })) as unknown as typeof fetch).getKillSwitch())
      .toBeNull();
  });

  it('signOut clears the stored session before (and regardless of) the server logout', async () => {
    let stored: QuanttSession | null = { accessToken: 'at', refreshToken: 'rt' };
    let storedAtLogout: QuanttSession | null | undefined;
    const fetchImpl = vi.fn(async () => { storedAtLogout = stored; throw new Error('offline'); }) as unknown as typeof fetch;
    const c = new QuanttClient({ fetchImpl, store: { get: () => stored, set: (n) => { stored = n; } } });
    await c.signOut();
    expect(storedAtLogout).toBeNull();
    expect(stored).toBeNull();
    expect(await c.isSignedIn()).toBe(false);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.quantts.ai/v1/auth/logout');
    expect(init.headers).toEqual({ authorization: 'Bearer at' });
  });

  it('market routes carry their documented query parameters', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => { urls.push(u); return jsonResponse({}); }) as unknown as typeof fetch;
    const c = signedIn(fetchImpl);
    await c.getMarketSnapshot('ETH/USDC');
    await c.getMarketOhlcv('BTC', { interval: '1h', limit: 50 });
    await c.getMarketNews('LITHO', 5);
    await c.getTelemetry();
    expect(urls.map((u) => u.replace('https://api.quantts.ai', ''))).toEqual([
      '/v1/market/snapshot?symbol=ETH%2FUSDC',
      '/v1/market/ohlcv?symbol=BTC&interval=1h&limit=50',
      '/v1/market/news?symbol=LITHO&limit=5',
      '/v1/telemetry',
    ]);
  });
});

/** A streaming Response that emits `chunks`, then closes (or stays open). */
function sseResponse(chunks: string[], keepOpen = false): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      if (!keepOpen) ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('subscribeAgentDecisions', () => {
  it('delivers parsed decision events with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([
      'event: decision\ndata: {"id":"d1","symbol":"ETH"}\n\n',
      'event: risk_rejected\ndata: {"id":"d2","riskReason":"max daily loss"}\n\n',
    ], true)) as unknown as typeof fetch;
    const events: QuanttStreamEvent[] = [];
    const statuses: QuanttStreamStatus[] = [];
    const unsubscribe = signedIn(fetchImpl).subscribeAgentDecisions('ag_1', {
      onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s),
    });
    await waitFor(() => events.length === 2);
    unsubscribe();
    expect(events).toEqual([
      { type: 'decision', data: { id: 'd1', symbol: 'ETH' } },
      { type: 'risk_rejected', data: { id: 'd2', riskReason: 'max daily loss' } },
    ]);
    expect(statuses).toEqual(['connecting', 'live']);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.quantts.ai/v1/agents/ag_1/decisions/stream');
    expect(init.headers).toMatchObject({ authorization: 'Bearer at', accept: 'text/event-stream' });
  });

  it('refreshes once on 401, then reconnects with the new token', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/v1/auth/refresh')) return jsonResponse({ accessToken: 'at2', refreshToken: 'rt2' });
      seen.push((init.headers as Record<string, string>).authorization);
      return seen.length === 1 ? new Response('expired', { status: 401 }) : sseResponse(['data: {"id":"d3"}\n\n'], true);
    }) as unknown as typeof fetch;
    const events: QuanttStreamEvent[] = [];
    const unsubscribe = signedIn(fetchImpl).subscribeAgentDecisions('ag_1', { onEvent: (e) => events.push(e) });
    await waitFor(() => events.length === 1);
    unsubscribe();
    expect(seen).toEqual(['Bearer at', 'Bearer at2']);
    expect(events[0]).toEqual({ type: 'message', data: { id: 'd3' } });
  });

  it('stops for good on a 404 (agent deleted) without retrying', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const statuses: Array<[QuanttStreamStatus, string | undefined]> = [];
    signedIn(fetchImpl).subscribeAgentDecisions('gone', { onEvent: () => {}, onStatus: (s, d) => statuses.push([s, d]) });
    await waitFor(() => statuses.some(([s]) => s === 'stopped'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toEqual(['stopped', 'HTTP 404']);
  });

  it('reconnects after the server closes the stream, and unsubscribe ends the loop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetchImpl = vi.fn(async () => sseResponse(['data: {"n":1}\n\n'])) as unknown as typeof fetch; // closes
      const statuses: QuanttStreamStatus[] = [];
      const unsubscribe = signedIn(fetchImpl).subscribeAgentDecisions('ag_1', { onEvent: () => {}, onStatus: (s) => statuses.push(s) });
      await vi.waitFor(() => expect(statuses).toContain('retrying'));
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      unsubscribe();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
