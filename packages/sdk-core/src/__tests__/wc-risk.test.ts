import { describe, it, expect } from 'vitest';
import { Interface, MaxUint256 } from 'ethers';
import { scoreWcRequest } from '../security/wc-risk';

const ME = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x2222222222222222222222222222222222222222';

describe('scoreWcRequest (delegates the decoding to reviewSigningRequest)', () => {
  it('scores an unlimited approve as review and a plain login message as safe', () => {
    const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [SPENDER, MaxUint256]);
    expect(scoreWcRequest({ method: 'eth_sendTransaction', params: [{ from: ME, to: SPENDER, data }], chainId: 1 }).verdict).toBe('review');
    expect(scoreWcRequest({ method: 'personal_sign', params: ['0x68656c6c6f', ME], chainId: 1 }).verdict).toBe('safe');
  });

  it('blocks a signature for another chain and still weighs the origin', () => {
    const typed = JSON.stringify({ domain: { name: 'X', chainId: 137 }, types: {}, primaryType: 'Mail', message: {} });
    const r = scoreWcRequest({ method: 'eth_signTypedData_v4', params: [ME, typed], chainId: 1 });
    expect(r.verdict).toBe('block');
    expect(r.reasons[0]).toMatch(/chain 137/);
    const phishy = scoreWcRequest({ method: 'personal_sign', params: ['0x68656c6c6f', ME], origin: 'https://uniswap-claim-airdrop.xyz' });
    expect(phishy.score).toBeGreaterThan(0);
  });
});
