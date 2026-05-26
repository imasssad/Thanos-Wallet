/**
 * DnnsService unit tests — pin the resolver contract.
 *
 * DNNS is the Lithosphere name service running on Kamet. The service
 * proxies `lithic_resolveDnns` via LithicClient and projects the raw
 * response into a typed DnnsRecord. These tests inject a mock
 * LithicClient and assert:
 *   - happy-path resolution returns the address from the RPC
 *   - failed resolves degrade to the zero address (don't throw)
 *   - register() builds the right contract call
 */
import { describe, it, expect, vi } from 'vitest';
import { DnnsService } from '../dnns/service.js';
import { LithicClient } from '../clients/lithic-client.js';

const KAMET = 900523;
const ZERO  = '0x0000000000000000000000000000000000000000';

function mockLithic(behaviour: {
  resolve?: (name: string) => unknown;
  callContract?: (req: { chainId: number; contract: string; method: string; args: unknown[] }) => unknown;
} = {}) {
  return {
    resolveDnns: vi.fn(async (_chainId: number, name: string) => {
      const r = behaviour.resolve;
      if (!r) return ZERO;
      return r(name);
    }),
    callContract: vi.fn(async (req: { chainId: number; contract: string; method: string; args: unknown[] }) => {
      const c = behaviour.callContract;
      return c ? c(req) : '0xfeedface';
    }),
  } as unknown as LithicClient;
}

describe('DnnsService.resolve', () => {
  it('returns the address resolved by the lithic RPC', async () => {
    const lithic = mockLithic({
      resolve: () => '0x1111111111111111111111111111111111111111',
    });
    const svc = new DnnsService(lithic);
    const r = await svc.resolve(KAMET, 'sora.litho');
    expect(r.name).toBe('sora.litho');
    expect(r.address).toBe('0x1111111111111111111111111111111111111111');
    expect(r.chainId).toBe(KAMET);
    expect(r.resolver).toBe('thanos-default-resolver');
  });

  it('degrades to the zero address when the RPC throws', async () => {
    const lithic = {
      resolveDnns: vi.fn().mockRejectedValue(new Error('rpc down')),
    } as unknown as LithicClient;
    const svc = new DnnsService(lithic);
    const r = await svc.resolve(KAMET, 'missing.litho');
    expect(r.address).toBe(ZERO);
    expect(r.name).toBe('missing.litho');
  });

  it('degrades to zero address when the RPC returns a non-string', async () => {
    const lithic = mockLithic({ resolve: () => null });
    const svc = new DnnsService(lithic);
    const r = await svc.resolve(KAMET, 'weird.litho');
    expect(r.address).toBe(ZERO);
  });
});

describe('DnnsService.reverseResolve', () => {
  it('returns null for an invalid address shape', async () => {
    const svc = new DnnsService(mockLithic());
    expect(await svc.reverseResolve(KAMET, 'not-an-address')).toBeNull();
    expect(await svc.reverseResolve(KAMET, '0x123')).toBeNull();
    expect(await svc.reverseResolve(KAMET, '')).toBeNull();
  });

  it('returns null when no verified reverse record exists (RPC unavailable in tests)', async () => {
    // In the unit-test environment no Kamet RPC is reachable, so the
    // on-chain registry.resolver() call throws → reverseResolve returns
    // null. This pins the "graceful degradation" contract.
    const svc = new DnnsService(mockLithic());
    const r = await svc.reverseResolve(KAMET, '0x' + 'a'.repeat(40));
    expect(r).toBeNull();
  });

  it('accepts a provider override + returns null when registry has no resolver', async () => {
    // Inject a stub provider so we can drive registry.resolver() to
    // return the zero address — that's an unset record, not a failure.
    const stubProvider = {
      // ethers Contract uses call() for view methods
      call: vi.fn().mockResolvedValue('0x' + '0'.repeat(64)),
      getNetwork: vi.fn().mockResolvedValue({ chainId: KAMET, name: 'kamet' }),
      _isProvider: true,
      // ethers v6 Contract.call() path
      send: vi.fn().mockResolvedValue('0x' + '0'.repeat(64)),
    } as unknown as import('ethers').Provider;
    const svc = new DnnsService({ provider: stubProvider, lithic: mockLithic() });
    const r = await svc.reverseResolve(KAMET, '0x' + 'b'.repeat(40));
    // No resolver registered → null (verified by graceful-degradation path).
    expect(r).toBeNull();
  });
});

describe('DnnsService.register', () => {
  it('builds register(name, owner, years) on the dnns-registry contract', async () => {
    let captured: { chainId: number; contract: string; method: string; args: unknown[] } | null = null;
    const lithic = mockLithic({
      callContract: (req) => { captured = req; return '0xdeadbeef'; },
    });
    const svc = new DnnsService(lithic);
    const r = await svc.register({
      chainId: KAMET,
      name:    'sora.litho',
      owner:   '0xa11ce000000000000000000000000000000000a1',
      years:   3,
    });
    expect(r.submitted).toBe(true);
    expect(r.txHash).toBe('0xdeadbeef');
    expect(captured).toMatchObject({
      chainId: KAMET,
      contract: 'dnns-registry',
      method:   'register',
      args:     ['sora.litho', '0xa11ce000000000000000000000000000000000a1', 3],
    });
  });

  it('defaults to 1 year when not specified', async () => {
    // Wrap in a ref object — TS's strict flow analysis on a `let` binding
    // assigned inside a callback narrows the type to `never` after the
    // callback returns. A property assignment on a typed ref dodges that.
    const ref: { call: { args?: unknown[] } | null } = { call: null };
    const lithic = mockLithic({
      callContract: (req) => { ref.call = req; return '0xabc'; },
    });
    const svc = new DnnsService(lithic);
    await svc.register({ chainId: KAMET, name: 'a.litho', owner: '0x' + 'b'.repeat(40) });
    expect(ref.call).not.toBeNull();
    expect(ref.call?.args?.[2]).toBe(1);
  });
});
