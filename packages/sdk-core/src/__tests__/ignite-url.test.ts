/**
 * Ignite DEX URL builder — small, but it's the only thing routing
 * users to the Ignite swap UI, so pin the query-string contract.
 */
import { describe, it, expect } from 'vitest';
import { getIgniteDexUrl } from '../dex/ignite.js';

describe('getIgniteDexUrl', () => {
  it('returns the bare home URL with no params', () => {
    expect(getIgniteDexUrl()).toBe('https://ignite.litho.ai/');
    expect(getIgniteDexUrl({})).toBe('https://ignite.litho.ai/');
  });

  it('adds symbol + chain query params when given', () => {
    const u = getIgniteDexUrl({ symbol: 'LITHO', chain: 'makalu' });
    const parsed = new URL(u);
    expect(parsed.searchParams.get('symbol')).toBe('LITHO');
    expect(parsed.searchParams.get('chain')).toBe('makalu');
  });

  it('omits each param independently when undefined', () => {
    const onlySym = new URL(getIgniteDexUrl({ symbol: 'LITHO' }));
    expect(onlySym.searchParams.get('symbol')).toBe('LITHO');
    expect(onlySym.searchParams.has('chain')).toBe(false);

    const onlyChain = new URL(getIgniteDexUrl({ chain: 'makalu' }));
    expect(onlyChain.searchParams.has('symbol')).toBe(false);
    expect(onlyChain.searchParams.get('chain')).toBe('makalu');
  });

  it('URL-encodes special characters', () => {
    const u = new URL(getIgniteDexUrl({ symbol: 'L THO/USD', chain: 'mak alu' }));
    expect(u.searchParams.get('symbol')).toBe('L THO/USD');
    expect(u.searchParams.get('chain')).toBe('mak alu');
    // Raw string should have URL-encoded the space.
    expect(u.toString()).toContain('symbol=L+THO');
  });
});
