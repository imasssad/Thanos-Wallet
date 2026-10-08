import { describe, it, expect, vi } from 'vitest';
import { pollAndReconcile } from './status.js';

const BASE = {
  apiUrl: 'https://bridge.litho.ai',
  sourceTxHash: '0xsource',
  destinationChainId: 900523,
  destinationTokenAddress: '0xdest-token',
  expectedRecipient: '0xuser',
  expectedAmountBaseUnits: 100n,
};

function fetchSequence(responses: Array<{ ok: boolean; status?: number; json?: unknown }>): typeof fetch {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.ok, status: r.status ?? 200, json: async () => r.json };
  }) as unknown as typeof fetch;
}

describe('pollAndReconcile', () => {
  it('reports RELEASED only when the bridge says completed AND independent verification passes', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'completed', destinationTxHash: '0xdest' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result.status).toBe('RELEASED');
    expect(verify).toHaveBeenCalledOnce();
  });

  it('never reports RELEASED when independent verification fails, even though the bridge said completed', async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'completed', destinationTxHash: '0xdest' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result.status).toBe('REVIEW');
  });

  it('goes to REVIEW (not RELEASED) if completed has no destination tx hash to verify', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'completed' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result.status).toBe('REVIEW');
    expect(verify).not.toHaveBeenCalled();
  });

  it('reports FAILED on a failed bridge status without calling verification', async () => {
    const verify = vi.fn();
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'failed', failureReason: 'validators rejected' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('validators rejected');
    expect(verify).not.toHaveBeenCalled();
  });

  it('treats an exception from verifyDestinationReceipt as a failed verification, not a crash', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('rpc down'));
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'completed', destinationTxHash: '0xdest' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result.status).toBe('REVIEW');
  });

  it('verifies the releaseTxHash bridge.litho.ai reports', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const result = await pollAndReconcile({
      ...BASE,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'completed', releaseTxHash: '0xrelease' } }]),
      verifyDestinationReceipt: verify,
    });
    expect(result).toEqual({ status: 'RELEASED', destinationTxHash: '0xrelease' });
    expect(verify).toHaveBeenCalledWith({
      destinationChainId: 900523, destinationTxHash: '0xrelease', expectedRecipient: '0xuser',
      expectedAmountBaseUnits: 100n, expectedTokenAddress: '0xdest-token',
    });
  });

  it('keeps polling through 404s until the bridge has indexed the lock', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const steps: string[] = [];
    const fetchImpl = fetchSequence([
      { ok: false, status: 404 },
      { ok: false, status: 404 },
      { ok: true, json: { status: 'signing' } },
      { ok: true, json: { status: 'completed', releaseTxHash: '0xrelease' } },
    ]);
    const result = await pollAndReconcile({
      ...BASE, fetchImpl, sleep, onStep: (s) => steps.push(s),
      verifyDestinationReceipt: vi.fn().mockResolvedValue(true),
    });
    expect(result.status).toBe('RELEASED');
    expect(steps).toEqual(['pending', 'pending', 'signing', 'completed']);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('retries a network error and a 5xx, but stops on any other 4xx', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let i = 0;
    const flaky = vi.fn().mockImplementation(async () => {
      i += 1;
      if (i === 1) throw new TypeError('fetch failed');
      if (i === 2) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ status: 'failed' }) };
    }) as unknown as typeof fetch;
    await expect(pollAndReconcile({ ...BASE, fetchImpl: flaky, sleep, verifyDestinationReceipt: vi.fn() }))
      .resolves.toMatchObject({ status: 'FAILED' });

    await expect(pollAndReconcile({
      ...BASE, sleep, fetchImpl: fetchSequence([{ ok: false, status: 403 }]), verifyDestinationReceipt: vi.fn(),
    })).rejects.toMatchObject({ code: 'MANIFEST_UNREACHABLE' });
  });

  it('asks the status API by source hash, whatever trailing slash the manifest gives', async () => {
    const fetchImpl = fetchSequence([{ ok: true, json: { status: 'failed' } }]);
    await pollAndReconcile({ ...BASE, apiUrl: 'https://bridge.litho.ai//', fetchImpl, verifyDestinationReceipt: vi.fn() });
    expect(fetchImpl).toHaveBeenCalledWith('https://bridge.litho.ai/bridge/status/0xsource');
  });

  it('hands over to REVIEW after the last attempt instead of polling forever', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await pollAndReconcile({
      ...BASE, maxAttempts: 3, sleep,
      fetchImpl: fetchSequence([{ ok: true, json: { status: 'signing' } }]),
      verifyDestinationReceipt: vi.fn(),
    });
    expect(result.status).toBe('REVIEW');
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5_000, 6_000, 7_000]);
  });
});
