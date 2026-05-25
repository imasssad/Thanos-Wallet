/**
 * LEP100 client tests — pin the LithicClient method dispatch.
 *
 * Every method routes through LithicClient.callReadonly / callContract
 * with a specific (chainId, contract, method, args) tuple. These tests
 * inject a fake LithicClient that records the call and assert the
 * client builds the right request envelope. Catches regressions like a
 * renamed LEP100 method name or a reordered argument list.
 */
import { describe, it, expect, vi } from 'vitest';
import { Lep100Client } from '../clients/lep100-client.js';
import { LithicClient } from '../clients/lithic-client.js';

function mockLithic() {
  const readonlyCalls: Array<{ method: string; args: unknown[]; contract: string; chainId: number }> = [];
  const writeCalls:    Array<{ method: string; args: unknown[]; contract: string; chainId: number }> = [];
  const lithic = {
    callReadonly: vi.fn(async (req: { chainId: number; contract: string; method: string; args: unknown[] }) => {
      readonlyCalls.push(req);
      // Return shape-appropriate fixtures for each known method.
      switch (req.method) {
        case 'name':        return 'Test Token';
        case 'symbol':      return 'TST';
        case 'decimals':    return 18;
        case 'totalSupply': return '1000000000000000000000';   // 1000 TST
        case 'balanceOf':   return '42000000000000000000';     // 42 TST
        case 'allowance':   return '7000000000000000000';      // 7 TST
        case 'owner':       return '0x1111111111111111111111111111111111111111';
        default:            return null;
      }
    }),
    callContract: vi.fn(async (req: { chainId: number; contract: string; method: string; args: unknown[] }) => {
      writeCalls.push(req);
      return { txHash: '0xdead' };
    }),
  } as unknown as LithicClient;
  return { lithic, readonlyCalls, writeCalls };
}

const C = '0xc47e49259b8dda2c9d57941e1a52747e4c721cb9'; // a Kamet contract addr
const OWNER   = '0xa11ce00000000000000000000000000000000a11';
const SPENDER = '0xfeed000000000000000000000000000000000000';

describe('Lep100Client', () => {
  it('getMetadata fans out name+symbol+decimals+totalSupply in parallel', async () => {
    const { lithic, readonlyCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    const m = await c.getMetadata(700777, C);
    expect(m).toMatchObject({
      chainId:      700777,
      contractAddress: C,
      name:         'Test Token',
      symbol:       'TST',
      decimals:     18,
      totalSupply:  '1000000000000000000000',
      verified:     false,
    });
    const methods = readonlyCalls.map(r => r.method).sort();
    expect(methods).toEqual(['decimals', 'name', 'symbol', 'totalSupply']);
  });

  it('balanceOf passes [owner] and returns metadata bundle', async () => {
    const { lithic, readonlyCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    const r = await c.balanceOf({ chainId: 700777, contractAddress: C, owner: OWNER });
    expect(r.balance).toBe('42000000000000000000');
    expect(r.token.symbol).toBe('TST');
    const bal = readonlyCalls.find(x => x.method === 'balanceOf');
    expect(bal?.args).toEqual([OWNER]);
  });

  it('balanceOf throws when owner is missing', async () => {
    const c = new Lep100Client(mockLithic().lithic);
    // owner is typed `string | undefined` so this isn't a TS error,
    // just a runtime guard the client enforces.
    await expect(c.balanceOf({ chainId: 700777, contractAddress: C })).rejects.toThrow(/owner.*required/i);
  });

  it('allowance passes [owner, spender] in the correct order', async () => {
    const { lithic, readonlyCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    const r = await c.allowance({ chainId: 700777, contractAddress: C, owner: OWNER, spender: SPENDER });
    expect(r.allowance).toBe('7000000000000000000');
    const allow = readonlyCalls.find(x => x.method === 'allowance');
    expect(allow?.args).toEqual([OWNER, SPENDER]);
  });

  it('transfer dispatches transfer(to, amount) on callContract', async () => {
    const { lithic, writeCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    await c.transfer({ chainId: 700777, contractAddress: C, to: SPENDER, amount: '100' });
    const call = writeCalls[0];
    expect(call?.method).toBe('transfer');
    expect(call?.args).toEqual([SPENDER, '100']);
  });

  it('approve dispatches approve(spender, amount) — revoke is approve(spender, 0)', async () => {
    const { lithic, writeCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    await c.approve({ chainId: 700777, contractAddress: C, spender: SPENDER, amount: '0' });
    expect(writeCalls[0]?.method).toBe('approve');
    expect(writeCalls[0]?.args).toEqual([SPENDER, '0']);
  });

  it('burn dispatches burn(amount) with one arg', async () => {
    const { lithic, writeCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    await c.burn({ chainId: 700777, contractAddress: C, amount: '50' });
    expect(writeCalls[0]?.method).toBe('burn');
    expect(writeCalls[0]?.args).toEqual(['50']);
  });

  it('burnFrom dispatches burnFrom(account, amount)', async () => {
    const { lithic, writeCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    await c.burnFrom({ chainId: 700777, contractAddress: C, account: OWNER, amount: '25' });
    expect(writeCalls[0]?.method).toBe('burnFrom');
    expect(writeCalls[0]?.args).toEqual([OWNER, '25']);
  });

  it('getOwner returns the owner address from the readonly call', async () => {
    const c = new Lep100Client(mockLithic().lithic);
    const o = await c.getOwner(700777, C);
    expect(o).toBe('0x1111111111111111111111111111111111111111');
  });

  it('transferOwnership requires newOwner', async () => {
    const c = new Lep100Client(mockLithic().lithic);
    // newOwner is typed `string | undefined`; runtime guard, not TS error.
    await expect(c.transferOwnership({ chainId: 700777, contractAddress: C })).rejects.toThrow(/newOwner.*required/i);
  });

  it('renounceOwnership dispatches with no args', async () => {
    const { lithic, writeCalls } = mockLithic();
    const c = new Lep100Client(lithic);
    await c.renounceOwnership({ chainId: 700777, contractAddress: C });
    expect(writeCalls[0]?.method).toBe('renounceOwnership');
    expect(writeCalls[0]?.args).toEqual([]);
  });
});
