/**
 * MultXClient tests — locks the URL construction + auth posture (none)
 * + the GET/POST verbs against the documented bridge.litho.ai endpoints.
 * Mocks fetch so it runs offline + deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultXClient } from '../swaps/multx.js';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

function jsonResp(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('MultXClient', () => {
  it('defaults to https://bridge.litho.ai', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'completed' }));
    await new MultXClient().status('0xabc');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://bridge.litho.ai/bridge/status/0xabc',
      expect.any(Object),
    );
  });

  it('strips a trailing slash from a custom baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'completed' }));
    await new MultXClient({ baseUrl: 'https://staging.bridge.example/' }).status('0xabc');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://staging.bridge.example/bridge/status/0xabc',
      expect.any(Object),
    );
  });

  it('NEVER sends an Authorization / api-key header (the bridge is keyless)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'completed' }));
    await new MultXClient().status('0xabc');
    const headers = (fetchSpy.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-api-key');
  });

  it('encodes the txHash in the path', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ status: 'pending' }));
    await new MultXClient().status('0x ab/cd?x');
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://bridge.litho.ai/bridge/status/0x%20ab%2Fcd%3Fx',
    );
  });

  it('status() returns the JSON body unchanged', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ txHash: '0xabc', status: 'completed', signaturesCollected: 3, signaturesRequired: 3 }));
    const out = await new MultXClient().status('0xabc');
    expect(out).toEqual({ txHash: '0xabc', status: 'completed', signaturesCollected: 3, signaturesRequired: 3 });
  });

  it('throws on non-ok HTTP', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({}, 503));
    await expect(new MultXClient().status('0xabc')).rejects.toThrow(/503/);
  });

  it('chains() unwraps the { chains } envelope', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ chains: [
      { chainId: 700777, name: 'Makalu', symbol: 'LITHO', bridge: '0x1' },
      { chainId: 1,      name: 'Ethereum', symbol: 'ETH', bridge: '0x2' },
    ] }));
    const out = await new MultXClient().chains();
    expect(out.length).toBe(2);
    expect(out[0].chainId).toBe(700777);
  });

  it('isHealthy() returns true on 2xx and false on transport failure', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ ok: true }));
    expect(await new MultXClient().isHealthy()).toBe(true);

    fetchSpy.mockResolvedValueOnce(jsonResp({}, 500));
    expect(await new MultXClient().isHealthy()).toBe(false);
  });

  it('quote() POSTs to /bridge/quote with a JSON body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResp({ provider: 'multx', quoteId: 'q1', amountIn: '1', amountOut: '1', route: [] }));
    await new MultXClient().quote({
      fromChainId: 700777, toChainId: 1,
      fromToken: 'LITHO', toToken: 'ETH',
      amount: '1', walletAddress: '0xabc',
    });
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as { method: string; body: string; headers: Record<string,string> };
    expect(call[0]).toBe('https://bridge.litho.ai/bridge/quote');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.fromChainId).toBe(700777);
    expect(body.walletAddress).toBe('0xabc');
  });
});
