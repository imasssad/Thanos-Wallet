/**
 * The discovery overlay every client lays over its own token list.
 *
 * What matters here is what it REFUSES to do: blank good rows after a failed
 * read, carry one account's tokens onto another, re-read on every paint, or
 * announce a change that didn't happen. Each of those would show the user
 * either the wrong assets or none.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDiscoveryOverlay } from '../portfolio/discovered-tokens';
import type { DiscoveredToken, DiscoveryResult } from '../portfolio/token-discovery';

const ME    = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TSYN  = '0xef22613e7cec1c3ce4f8af98594045c664dfb312';

const token = (address: string, symbol: string, over: Partial<DiscoveredToken> = {}): DiscoveredToken => ({
  key: `9005:${address}`, chain: 'evm', chainId: 9005, network: 'lithosphere', networkName: 'Lithosphere',
  address, symbol, name: symbol, decimals: 18, balance: '1', rawBalance: '1' + '0'.repeat(18),
  source: 'lithoscan', priced: false, known: false, wellKnown: true, ...over,
});
const result = (tokens: DiscoveredToken[], read = ['lithosphere'], failed: string[] = []): DiscoveryResult =>
  ({ tokens, read, failed });

describe('createDiscoveryOverlay', () => {
  it('turns a read into token-list rows for the chain that was read', async () => {
    const o = createDiscoveryOverlay({ chainIds: [9005], discover: async () => result([token(TSYN, 'TSYN')]) });
    await o.refresh(ME);
    expect(o.tokensForChain(9005)).toEqual([
      { chainId: 9005, symbol: 'TSYN', name: 'TSYN', address: TSYN, decimals: 18, discovered: true },
    ]);
    expect(o.tokensForChain(1)).toEqual([]);
    expect(o.address()).toBe(ME);
  });

  it('leaves out what the user should not see unasked', async () => {
    const o = createDiscoveryOverlay({ discover: async () => result([
      token(TSYN, 'TSYN'),
      token('0xaaa', 'JUNK', { wellKnown: false }),                       // less known: hidden
      { ...token('0xsol', 'SPL'), chain: 'solana', chainId: undefined },  // not an EVM token list
    ]) });
    await o.refresh(ME);
    expect(o.tokens().map((r) => r.symbol)).toEqual(['TSYN']);
  });

  it('keeps the rows it has when a read fails or reaches nothing', async () => {
    let mode: 'ok' | 'throw' | 'nothing' = 'ok';
    const o = createDiscoveryOverlay({
      everyMs: 0,
      discover: async () => {
        if (mode === 'throw') throw new Error('LithoScan down');
        if (mode === 'nothing') return result([], [], ['lithosphere']);
        return result([token(TSYN, 'TSYN')]);
      },
    });
    await o.refresh(ME);
    expect(o.tokens().length).toBe(1);
    mode = 'throw';
    await o.refresh(ME);                     // must not reject, must not blank
    expect(o.tokens().length).toBe(1);
    mode = 'nothing';
    await o.refresh(ME);
    expect(o.tokens().length).toBe(1);
  });

  it('reads once per interval, and again when forced', async () => {
    const discover = vi.fn(async () => result([token(TSYN, 'TSYN')]));
    const o = createDiscoveryOverlay({ everyMs: 60_000, discover });
    await o.refresh(ME);
    await o.refresh(ME);
    await o.refresh(ME);
    expect(discover).toHaveBeenCalledTimes(1);
    await o.refresh(ME, [], true);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight read between callers', async () => {
    let release = (_: DiscoveryResult) => {};
    const discover = vi.fn(() => new Promise<DiscoveryResult>((res) => { release = res; }));
    const o = createDiscoveryOverlay({ everyMs: 0, discover });
    const a = o.refresh(ME);
    const b = o.refresh(ME);
    expect(discover).toHaveBeenCalledTimes(1);
    release(result([token(TSYN, 'TSYN')]));
    await Promise.all([a, b]);
    expect(o.tokens().length).toBe(1);
  });

  it('never carries one account’s tokens onto another', async () => {
    const seen: string[] = [];
    const o = createDiscoveryOverlay({
      everyMs: 60_000,
      discover: async (addrs) => { seen.push(addrs.evm!); return result([token(TSYN, 'TSYN')]); },
    });
    await o.refresh(ME);
    expect(o.tokens().length).toBe(1);
    const second = o.refresh(OTHER);         // switched account
    expect(o.tokens()).toEqual([]);          // cleared at once, before the read
    await second;
    expect(seen).toEqual([ME, OTHER]);       // the interval doesn't carry over
    expect(o.address()).toBe(OTHER);
  });

  it('drops a read that lands after the account changed', async () => {
    let release = (_: DiscoveryResult) => {};
    const o = createDiscoveryOverlay({
      everyMs: 0,
      discover: (addrs) => addrs.evm === ME
        ? new Promise<DiscoveryResult>((res) => { release = res; })
        : Promise.resolve(result([])),
    });
    const slow = o.refresh(ME);
    await o.refresh(OTHER);
    release(result([token(TSYN, 'TSYN')]));  // ME's answer, arriving late
    await slow;
    expect(o.tokens()).toEqual([]);
  });

  it('announces a change only when the rows differ', async () => {
    const onChange = vi.fn();
    let tokens = [token(TSYN, 'TSYN')];
    const o = createDiscoveryOverlay({ everyMs: 0, onChange, discover: async () => result(tokens) });
    await o.refresh(ME);
    expect(onChange).toHaveBeenCalledTimes(1);
    await o.refresh(ME);                     // same rows
    expect(onChange).toHaveBeenCalledTimes(1);
    tokens = [token(TSYN, 'TSYN'), token('0xbeef', 'LRC')];
    await o.refresh(ME);
    expect(onChange).toHaveBeenCalledTimes(2);
    o.clear();
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(o.tokens()).toEqual([]);
  });

  it('reads nothing for a missing or malformed address', async () => {
    const discover = vi.fn(async () => result([]));
    const o = createDiscoveryOverlay({ everyMs: 0, discover });
    await o.refresh('');
    await o.refresh('nonsense');
    expect(discover).not.toHaveBeenCalled();
  });

  it('passes the wallet’s own tokens through, so they class as listed', async () => {
    let known: unknown;
    const o = createDiscoveryOverlay({
      chainIds: [9005],
      discover: async (_a, opts) => { known = opts?.knownTokens; return result([]); },
    });
    await o.refresh(ME, [{ chainId: 9005, address: TSYN, symbol: 'TSYN' }, { chainId: 1, address: '0xaaa' }]);
    expect(known).toEqual([{ chainId: 9005, address: TSYN, symbol: 'TSYN' }, { chainId: 1, address: '0xaaa' }]);
  });
});
