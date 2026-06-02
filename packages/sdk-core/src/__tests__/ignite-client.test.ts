/**
 * Ignite client tests.
 *
 * These pin the integration *contract* — interface shape, mock determinism,
 * live-skeleton refusal — so that when the real Ignite API spec lands the
 * only thing that changes is the body of `LiveIgniteClient`, and these
 * tests still pass against the mock.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createIgniteClient,
  IgniteUnavailable,
  LiveIgniteClient,
  MockIgniteClient,
} from '../dex/ignite.js';

const baseReq = {
  fromChainId:   700777,
  toChainId:     700777,
  fromToken:     'LITHO',
  toToken:       'USDL',
  amount:        '100',
  walletAddress: '0x1111111111111111111111111111111111111111',
};

describe('MockIgniteClient', () => {
  it('returns a deterministic quote tagged with provider=ignite', async () => {
    const c = new MockIgniteClient();
    const q = await c.quote(baseReq);
    expect(q.provider).toBe('ignite');
    expect(q.quoteId).toMatch(/^mock-ignite-LITHO-USDL-/);
    expect(q.route).toEqual(['LITHO', 'USDL']);
    expect(Number(q.amountOut)).toBeGreaterThan(0);
    expect(q.priceImpactBps).toBeGreaterThan(0);
    expect(q.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it('honours the configurable fee', async () => {
    const noFee  = new MockIgniteClient({ feeBps: 0 });
    const bigFee = new MockIgniteClient({ feeBps: 500 });   // 5%

    const a = await noFee.quote(baseReq);
    const b = await bigFee.quote(baseReq);
    expect(Number(a.amountOut)).toBeGreaterThan(Number(b.amountOut));
  });

  it('throws IgniteUnavailable for an unknown token', async () => {
    const c = new MockIgniteClient();
    await expect(c.quote({ ...baseReq, fromToken: 'BOGUS' })).rejects.toBeInstanceOf(IgniteUnavailable);
  });

  it('throws IgniteUnavailable for a non-positive amount', async () => {
    const c = new MockIgniteClient();
    await expect(c.quote({ ...baseReq, amount: '0'   })).rejects.toBeInstanceOf(IgniteUnavailable);
    await expect(c.quote({ ...baseReq, amount: 'abc' })).rejects.toBeInstanceOf(IgniteUnavailable);
  });

  it('execute requires a known quoteId and wallet address', async () => {
    const c = new MockIgniteClient();
    await expect(c.execute('wrong-prefix-id', '0xabc')).rejects.toBeInstanceOf(IgniteUnavailable);

    const q = await c.quote(baseReq);
    await expect(c.execute(q.quoteId, '')).rejects.toBeInstanceOf(IgniteUnavailable);
  });

  it('execute → status round-trip stays provider=ignite throughout', async () => {
    const c   = new MockIgniteClient();
    const q   = await c.quote(baseReq);
    const ex  = await c.execute(q.quoteId, baseReq.walletAddress);
    const st  = await c.getStatus(ex.executionId);
    expect(ex.provider).toBe('ignite');
    expect(st.provider).toBe('ignite');
    expect(st.status).toBe('completed');
  });

  it('honours latencyMs without blocking forever', async () => {
    // 20ms target with a ~3ms grace window — node's setTimeout can fire
    // a few ms early under load (CI tickers are notoriously imprecise);
    // a tight `>= latencyMs` makes this flaky. The intent of the test
    // is "latency is roughly observed", not "millisecond-exact".
    const latencyMs = 20;
    const c = new MockIgniteClient({ latencyMs });
    const start = Date.now();
    await c.isHealthy();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(latencyMs - 5);
    expect(elapsed).toBeLessThan(latencyMs * 4); // sanity cap — should never block forever
  });

  it('healthy flag flips isHealthy() result', async () => {
    expect(await new MockIgniteClient({ healthy: true  }).isHealthy()).toBe(true);
    expect(await new MockIgniteClient({ healthy: false }).isHealthy()).toBe(false);
  });
});

describe('LiveIgniteClient', () => {
  // The live client now hits the real REST shape we expect Ignite to
  // confirm (see IGNITE_API_REQUEST.md). These tests mock `fetch` so
  // they pin the *contract* — request body shape + response handling +
  // graceful-failure semantics — without any live network call.

  it('quote() POSTs the expected body shape + maps the response onto SwapQuote', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      quoteId:         'ign-abc',
      amountOut:       '120.5',
      route:           ['LITHO', 'USDL'],
      priceImpactBps:  18,
      expiresAtMs:     1_900_000_000_000,
      feeUsd:          '0.42',
      estimatedSeconds: 8,
    }), { status: 200 }));
    try {
      const c = new LiveIgniteClient({ baseUrl: 'https://ignite.example' });
      const q = await c.quote(baseReq);
      expect(q.provider).toBe('ignite');
      expect(q.quoteId).toBe('ign-abc');
      expect(q.amountOut).toBe('120.5');
      expect(q.priceImpactBps).toBe(18);
      expect(q.estimatedSeconds).toBe(8);

      // Verify the request body matches the contract.
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://ignite.example/api/v1/quote');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        tokenIn:       'LITHO',
        tokenOut:      'USDL',
        amountIn:      '100',
        walletAddress: baseReq.walletAddress,
        chainId:       700777,
        slippageBps:   50,        // default
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('quote() throws IgniteUnavailable on a malformed response (missing quoteId)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      amountOut: '120.5',   // no quoteId
    }), { status: 200 }));
    try {
      const c = new LiveIgniteClient();
      await expect(c.quote(baseReq)).rejects.toBeInstanceOf(IgniteUnavailable);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('quote() throws IgniteUnavailable on a 5xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 502 }));
    try {
      const c = new LiveIgniteClient();
      await expect(c.quote(baseReq)).rejects.toBeInstanceOf(IgniteUnavailable);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('execute() POSTs {quoteId, walletAddress} and returns provider=ignite', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      executionId: 'exec-7f3a',
      status:      'submitted',
      txHash:      '0xdead',
    }), { status: 200 }));
    try {
      const c = new LiveIgniteClient({ baseUrl: 'https://ignite.example' });
      const r = await c.execute('ign-abc', '0xa11ce');
      expect(r.provider).toBe('ignite');
      expect(r.executionId).toBe('exec-7f3a');
      expect(r.status).toBe('submitted');
      expect(r.swapTxHash).toBe('0xdead');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init?.body))).toEqual({
        quoteId:       'ign-abc',
        walletAddress: '0xa11ce',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("getStatus() maps 'signing' → 'settling' and 'completed' → 'completed' onto BridgeStatus", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'signing',   txHash: '0xa' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', txHash: '0xb' }), { status: 200 }));
    try {
      const c = new LiveIgniteClient({ baseUrl: 'https://ignite.example' });
      const s1 = await c.getStatus('exec-1');
      expect(s1.status).toBe('settling');
      expect(s1.sourceTxHash).toBe('0xa');
      const s2 = await c.getStatus('exec-1');
      expect(s2.status).toBe('completed');

      // URL-encoded path
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://ignite.example/api/v1/status/exec-1');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('isHealthy() returns false when the host is unreachable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    try {
      const c = new LiveIgniteClient({ baseUrl: 'https://nope.invalid' });
      expect(await c.isHealthy()).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('isHealthy() returns true for a 200', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    try {
      const c = new LiveIgniteClient({ baseUrl: 'https://ignite.example' });
      expect(await c.isHealthy()).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://ignite.example/api/v1/health',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('strips a trailing slash from baseUrl', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    try {
      await new LiveIgniteClient({ baseUrl: 'https://ignite.example/' }).isHealthy();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://ignite.example/api/v1/health',
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('createIgniteClient', () => {
  it('defaults to the mock implementation', () => {
    expect(createIgniteClient()).toBeInstanceOf(MockIgniteClient);
    expect(createIgniteClient({ kind: 'mock' })).toBeInstanceOf(MockIgniteClient);
  });

  it('returns the live client when explicitly requested', () => {
    expect(createIgniteClient({ kind: 'live' })).toBeInstanceOf(LiveIgniteClient);
  });

  it('forwards mock config (custom prices)', async () => {
    const c = createIgniteClient({ kind: 'mock', mock: { prices: { FOO: 2, BAR: 1 } } });
    const q = await c.quote({ ...baseReq, fromToken: 'FOO', toToken: 'BAR', amount: '1' });
    // FOO is worth 2 USD, BAR is worth 1 USD → 1 FOO ≈ 2 BAR minus 0.3% fee minus 0.12% impact.
    expect(Number(q.amountOut)).toBeGreaterThan(1.9);
    expect(Number(q.amountOut)).toBeLessThanOrEqual(2);
  });
});
