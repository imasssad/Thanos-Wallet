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
  IgniteNotImplemented,
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
    const c = new MockIgniteClient({ latencyMs: 5 });
    const start = Date.now();
    await c.isHealthy();
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it('healthy flag flips isHealthy() result', async () => {
    expect(await new MockIgniteClient({ healthy: true  }).isHealthy()).toBe(true);
    expect(await new MockIgniteClient({ healthy: false }).isHealthy()).toBe(false);
  });
});

describe('LiveIgniteClient', () => {
  it('throws IgniteNotImplemented for quote/execute/getStatus until the spec lands', async () => {
    const c = new LiveIgniteClient();
    await expect(c.quote(baseReq)).rejects.toBeInstanceOf(IgniteNotImplemented);
    await expect(c.execute('q', '0xabc')).rejects.toBeInstanceOf(IgniteNotImplemented);
    await expect(c.getStatus('e')).rejects.toBeInstanceOf(IgniteNotImplemented);
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
