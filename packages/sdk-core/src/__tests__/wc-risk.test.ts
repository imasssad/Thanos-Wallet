import { describe, it, expect } from 'vitest';
import { Interface, MaxUint256 } from 'ethers';
import { scoreWcRequest, applyWcVerifyContext, wcDisplayOrigin } from '../security/wc-risk';

const ME = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x2222222222222222222222222222222222222222';

describe('scoreWcRequest (delegates the decoding to reviewSigningRequest)', () => {
  it('scores an unlimited approve as review and a plain login message as safe', () => {
    const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [SPENDER, MaxUint256]);
    expect(scoreWcRequest({ method: 'eth_sendTransaction', params: [{ from: ME, to: SPENDER, data }], chainId: 1 }).verdict).toBe('review');
    expect(scoreWcRequest({ method: 'personal_sign', params: ['0x68656c6c6f', ME], chainId: 1 }).verdict).toBe('safe');
  });

  it('blocks a signature for another chain and still weighs the origin', () => {
    // A real, derivable struct (THN-01: an empty/absent `types` map can no longer reach a
    // field-by-field review at all — the reviewer blocks on an undeterminable struct first).
    const typed = JSON.stringify({ domain: { name: 'X', chainId: 137 }, types: { Mail: [{ name: 'contents', type: 'string' }] }, primaryType: 'Mail', message: { contents: 'hi' } });
    const r = scoreWcRequest({ method: 'eth_signTypedData_v4', params: [ME, typed], chainId: 1 });
    expect(r.verdict).toBe('block');
    expect(r.reasons[0]).toMatch(/chain 137/);
    const phishy = scoreWcRequest({ method: 'personal_sign', params: ['0x68656c6c6f', ME], origin: 'https://uniswap-claim-airdrop.xyz' });
    expect(phishy.score).toBeGreaterThan(0);
  });

  it('THN-03: a dApp-declared origin cannot hide behind an unverified metadata.url', () => {
    // The dApp claims a clean URL, but WalletConnect's own Verify API says
    // the real origin is the known phishing domain — scoring (and any
    // display) must use the VERIFIED origin, never the self-declared one.
    const r = scoreWcRequest({
      method: 'personal_sign',
      params: ['0x68656c6c6f', ME],
      origin: 'https://totally-legit-dapp.io',
      verifyContext: { verified: { origin: 'https://uniswap-claim-airdrop.xyz', validation: 'VALID' } },
    });
    expect(r.scoredOrigin).toBe('https://uniswap-claim-airdrop.xyz');
    expect(r.score).toBeGreaterThan(0);
  });

  it('THN-03: isScam blocks outright regardless of what is being signed', () => {
    const r = scoreWcRequest({
      method: 'personal_sign',
      params: ['0x68656c6c6f', ME],
      verifyContext: { verified: { origin: 'https://evil.example', validation: 'VALID', isScam: true } },
    });
    expect(r.verdict).toBe('block');
    expect(r.reasons[0]).toMatch(/known malicious/);
  });

  it('THN-03: INVALID escalates at least to review; UNKNOWN at least to caution', () => {
    const invalid = scoreWcRequest({
      method: 'personal_sign',
      params: ['0x68656c6c6f', ME],
      verifyContext: { verified: { origin: 'https://dapp.example', validation: 'INVALID' } },
    });
    expect(invalid.verdict).not.toBe('safe');
    expect(invalid.score).toBeGreaterThanOrEqual(50);

    const unknown = scoreWcRequest({
      method: 'personal_sign',
      params: ['0x68656c6c6f', ME],
      verifyContext: { verified: { origin: 'https://dapp.example', validation: 'UNKNOWN' } },
    });
    expect(unknown.verdict).not.toBe('safe');
    expect(unknown.score).toBeLessThan(invalid.score);
  });
});

describe('applyWcVerifyContext', () => {
  const safeReview = { risk: 'safe' as const, warnings: [] as string[], blockReason: null as string | null };

  it('is a no-op without a verifyContext, and never downgrades an existing verdict', () => {
    expect(applyWcVerifyContext(safeReview, undefined)).toEqual(safeReview);
    const blocked = { risk: 'block' as const, warnings: ['already blocked'], blockReason: 'already blocked' };
    expect(applyWcVerifyContext(blocked, { verified: { origin: 'https://x.example', validation: 'VALID' } })).toEqual(blocked);
  });

  it('escalates to block on isScam, review on INVALID, caution on UNKNOWN', () => {
    expect(applyWcVerifyContext(safeReview, { verified: { isScam: true } }).risk).toBe('block');
    expect(applyWcVerifyContext(safeReview, { verified: { validation: 'INVALID' } }).risk).toBe('review');
    expect(applyWcVerifyContext(safeReview, { verified: { validation: 'UNKNOWN' } }).risk).toBe('caution');
    expect(applyWcVerifyContext(safeReview, { verified: { validation: 'VALID' } }).risk).toBe('safe');
  });
});

describe('wcDisplayOrigin', () => {
  it('prefers the verified origin over a declared one, and falls back when there is none', () => {
    expect(wcDisplayOrigin({ verified: { origin: 'https://verified.example' } }, 'https://declared.example').origin).toBe('https://verified.example');
    expect(wcDisplayOrigin(undefined, 'https://declared.example').origin).toBe('https://declared.example');
  });
});
