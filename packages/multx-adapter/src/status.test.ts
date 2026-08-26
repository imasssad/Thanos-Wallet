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
});
