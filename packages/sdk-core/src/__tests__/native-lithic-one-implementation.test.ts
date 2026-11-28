import { describe, it, expect } from 'vitest';
import {
  MAINNET_LAX, NATIVE_LAX_MAINNET, NATIVE_LITHIC_TOKENS, KNOWN_LITHIC_TOKENS,
  encodeNativeTransfer, lithicTransferCall, decodeNativeCall, describeNativeCall,
  canSendLithic, reviewSigningRequest, encodeNativeCall,
} from '../index';
import { MaxUint256 } from 'ethers';

const ME = '0x1111111111111111111111111111111111111111';
const BAD = '0x2222222222222222222222222222222222222222';

/**
 * Two implementations of Lithic mainnet were written in parallel: the
 * `lithic*` names and the `native*` names PR #71 shipped to main. They were
 * merged into one, with the `native*` names kept as adapters over it.
 *
 * This suite is what stops them becoming two again. If someone reimplements
 * one side rather than calling through, the bytes or the captions drift and
 * these fail — which is the whole reason the merge was done this way.
 */
describe('the two Lithic APIs are one implementation', () => {
  it('both names are the same token and the same bytes', () => {
    expect(NATIVE_LAX_MAINNET).toBe(MAINNET_LAX);
    expect(NATIVE_LITHIC_TOKENS).toBe(KNOWN_LITHIC_TOKENS);
    const a = encodeNativeTransfer(MAINNET_LAX, BAD, 25n * 10n ** 18n);
    const b = lithicTransferCall(MAINNET_LAX, BAD, 25n * 10n ** 18n);
    expect(a.data).toBe(b.data);
    expect(a.to.toLowerCase()).toBe(b.to.toLowerCase());
  });

  it("main's caption and the signing sheet read the same calldata", () => {
    const { data } = lithicTransferCall(MAINNET_LAX, BAD, 25n * 10n ** 18n);
    expect(describeNativeCall(data, MAINNET_LAX.chainId)).toBe(`Send 25 LAX to ${BAD}`);
    expect(decodeNativeCall(data, MAINNET_LAX.chainId)?.token).toBe(MAINNET_LAX);

    // …and the approval screen, which main had no Lithic handling for at all.
    const sheet = reviewSigningRequest({
      method: 'eth_sendTransaction', account: ME, activeChainId: MAINNET_LAX.chainId,
      params: [{ from: ME, to: '0x000000000000000000000000000000000000f000', value: '0x0', data }],
    });
    expect(sheet.title).toBe(`Send 25.0 LAX to ${BAD}`);
    expect(sheet.risk).toBe('caution');
  });

  it('an unlimited allowance still escalates after the merge', () => {
    const sheet = reviewSigningRequest({
      method: 'eth_sendTransaction', account: ME, activeChainId: MAINNET_LAX.chainId,
      params: [{
        from: ME, to: '0x000000000000000000000000000000000000f000', value: '0x0',
        data: encodeNativeCall(
          MAINNET_LAX.nativeTarget, 'approve(address,u256)',
          [{ type: 'address', value: BAD }, { type: 'u256', value: MaxUint256.toString() }],
        ),
      }],
    });
    expect(sheet.risk).toBe('review');
    expect(sheet.rows.find((r) => r.label === 'Amount')?.value).toBe('Unlimited');
  });

  it('sends are on by default now, and the kill switch still works', () => {
    expect(canSendLithic(MAINNET_LAX, undefined)).toBe(true);
    expect(canSendLithic(MAINNET_LAX, '0')).toBe(false);
  });
});
