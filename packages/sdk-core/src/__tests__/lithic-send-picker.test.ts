import { describe, it, expect } from 'vitest';
import {
  MAINNET_LAX, NATIVE_LAX, lithicCoinId, lithicCoinLabel, lithicTokenForCoinId,
  sendableLithicTokens, isLithicCoinId,
} from '../clients/native-lithic';

/**
 * Every client's Send screen picks its asset by symbol, and a Lithic token is
 * in no token catalog. These helpers are the only place the picker's id shape
 * is defined, so all four screens agree on what the user chose — picking the
 * wrong "LAX" would send real money to a different asset.
 */
describe('choosing a Lithic asset in a send picker', () => {
  it('offers mainnet LAX and withholds the testnet token that cannot send', () => {
    const main = sendableLithicTokens(MAINNET_LAX.chainId);
    expect(main.map((t) => t.symbol)).toEqual(['LAX']);
    expect(main[0].nativeTarget).toBe(MAINNET_LAX.nativeTarget);
    // Makalu's LAX is transferEnabled: false — it must never be offered.
    expect(sendableLithicTokens(NATIVE_LAX.chainId)).toEqual([]);
    // Nor anything on a chain with no Lithic token at all.
    expect(sendableLithicTokens(1)).toEqual([]);
  });

  it('round-trips the id and resolves it back to the one right token', () => {
    const id = lithicCoinId('LAX');
    expect(isLithicCoinId(id)).toBe(true);
    expect(lithicTokenForCoinId(MAINNET_LAX.chainId, id)).toBe(MAINNET_LAX);
    expect(lithicCoinLabel(id)).toBe('LAX · Lithic');
  });

  it('never mistakes a plain symbol for the Lithic asset', () => {
    // This is the point of the prefix: a user-added custom token called LAX
    // is a different asset, and must not resolve to the gateway one.
    expect(isLithicCoinId('LAX')).toBe(false);
    expect(lithicTokenForCoinId(MAINNET_LAX.chainId, 'LAX')).toBeNull();
    expect(lithicCoinLabel('LAX')).toBe('LAX');
    // …and the Lithic id must not resolve on a chain that lacks the token.
    expect(lithicTokenForCoinId(NATIVE_LAX.chainId, lithicCoinId('LAX'))).toBeNull();
    expect(lithicTokenForCoinId(MAINNET_LAX.chainId, lithicCoinId('NOPE'))).toBeNull();
  });

  it('the kill switch empties the picker rather than failing at signing time', () => {
    expect(sendableLithicTokens(MAINNET_LAX.chainId, '0')).toEqual([]);
    expect(lithicTokenForCoinId(MAINNET_LAX.chainId, lithicCoinId('LAX'), 'false')).toBeNull();
    // Unset means on, which is what every client ships today.
    expect(sendableLithicTokens(MAINNET_LAX.chainId, undefined)).toHaveLength(1);
  });
});
