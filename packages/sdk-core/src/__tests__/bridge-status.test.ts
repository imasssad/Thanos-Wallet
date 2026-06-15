/**
 * BridgeTracker tests — the live MultX poller that powers every client's
 * "Bridging…" banner. Mocks fetch so the suite runs offline. Locks the
 * status mapping (the same mapping the worker uses) and the 404
 * in-flight semantics.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BridgeTracker } from '../bridge/status.js';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

function jsonResp(body: unknown, status = 200) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => body,
  };
}

describe('BridgeTracker.createPending', () => {
  it('builds a submitted-state record with the right chain/token echo', () => {
    const tracker = new BridgeTracker('https://bridge.example.test');
    const pending = tracker.createPending({
      fromChainId: 700777, toChainId: 1, fromToken: 'LITHO', toToken: 'ETH',
      amount: '1', walletAddress: '0x',
    }, 'exec-abc');
    expect(pending.executionId).toBe('exec-abc');
    expect(pending.status).toBe('submitted');
    expect(pending.fromChainId).toBe(700777);
    expect(pending.toToken).toBe('ETH');
    expect(typeof pending.updatedAt).toBe('string');
  });
});

describe('BridgeTracker.poll', () => {
  it('treats a 404 as in-flight "bridging" (not an error)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({}, 404));
    const tracker = new BridgeTracker('https://bridge.example.test');
    const out = await tracker.poll('0xdeadbeef');
    expect(out.status).toBe('bridging');
    expect(out.sourceTxHash).toBe('0xdeadbeef');
  });

  it('maps MultX completed → completed', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({
      status: 'completed', fromChainId: 700777, toChainId: 1,
      fromToken: 'LITHO', toToken: 'ETH', sourceTxHash: '0xabc',
      destinationTxHash: '0xdef', explorerUrls: ['https://explorer-3.litho.ai'],
    }));
    const out = await new BridgeTracker('https://bridge.example.test').poll('0xabc');
    expect(out.status).toBe('completed');
    expect(out.destinationTxHash).toBe('0xdef');
    expect(out.explorerUrls).toEqual(['https://explorer-3.litho.ai']);
  });

  it('maps MultX failed → failed', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'failed' }));
    const out = await new BridgeTracker('https://bridge.example.test').poll('0xfff');
    expect(out.status).toBe('failed');
  });

  it('maps MultX signing → settling (matches the worker)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'signing' }));
    const out = await new BridgeTracker('https://bridge.example.test').poll('0x');
    expect(out.status).toBe('settling');
  });

  it('maps MultX pending (or anything unknown) → bridging', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'pending' }));
    const out = await new BridgeTracker('https://bridge.example.test').poll('0x');
    expect(out.status).toBe('bridging');

    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'unrecognised-state' }));
    const out2 = await new BridgeTracker('https://bridge.example.test').poll('0x');
    expect(out2.status).toBe('bridging');
  });

  it('throws on transport / non-404 non-ok so callers can retry', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({}, 503));
    await expect(new BridgeTracker('https://bridge.example.test').poll('0x')).rejects.toThrow(/503/);
  });

  it('strips a trailing slash from the base URL', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'completed' }));
    await new BridgeTracker('https://bridge.example.test/').poll('0xfoo');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bridge.example.test/bridge/status/0xfoo',
      expect.any(Object),
    );
  });
});
