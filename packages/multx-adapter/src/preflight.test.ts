import { describe, it, expect } from 'vitest';
import { resolveRoute, preflightNetwork, validateAmount } from './preflight.js';
import { MultXAdapterError } from './errors.js';
import type { MultXManifest, MultXSigner } from './types.js';

const MANIFEST: MultXManifest = {
  tag: 't', commit: 'a'.repeat(40), disabled: false, apiUrl: 'https://bridge.litho.ai',
  routes: [
    {
      sourceChainId: 700777, sourceBridge: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
      destinationChainId: 900523, destinationBridge: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',
      tokens: [{ symbol: 'wLITHO', sourceAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', destinationAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', decimals: 18 }],
      maxAmountBaseUnits: '1000000000000000000000', // 1000 tokens
    },
  ],
};

describe('resolveRoute', () => {
  it('resolves an approved route + token', () => {
    const { route, token } = resolveRoute(MANIFEST, { sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'wlitho' });
    expect(route.destinationChainId).toBe(900523);
    expect(token.symbol).toBe('wLITHO');
  });

  it('fails closed on an unlisted route', () => {
    expect(() => resolveRoute(MANIFEST, { sourceChainId: 1, destinationChainId: 900523, tokenSymbol: 'wLITHO' }))
      .toThrow(MultXAdapterError);
  });

  it('fails closed on an unlisted token', () => {
    expect(() => resolveRoute(MANIFEST, { sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'USDC' }))
      .toThrow(MultXAdapterError);
  });
});

describe('preflightNetwork', () => {
  const signerOn = (chainId: number): MultXSigner => ({
    getAddress: async () => '0xabc',
    provider: { getNetwork: async () => ({ chainId: BigInt(chainId) }) },
  });

  it('passes when the signer is on the expected chain', async () => {
    await expect(preflightNetwork(signerOn(700777), 700777)).resolves.toBeUndefined();
  });

  it('fails closed on a wrong-network signer', async () => {
    await expect(preflightNetwork(signerOn(1), 700777)).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
  });
});

describe('validateAmount', () => {
  it('accepts a positive integer under the cap', () => {
    expect(validateAmount('500000000000000000000', MANIFEST.routes[0])).toBe(500000000000000000000n);
  });

  it('rejects zero', () => {
    expect(() => validateAmount('0', MANIFEST.routes[0])).toThrow(MultXAdapterError);
  });

  it('rejects a non-integer string', () => {
    expect(() => validateAmount('1.5', MANIFEST.routes[0])).toThrow(MultXAdapterError);
  });

  it('rejects an amount over the route cap', () => {
    expect(() => validateAmount('2000000000000000000000', MANIFEST.routes[0]))
      .toThrow(expect.objectContaining({ code: 'CAP_EXCEEDED' }));
  });
});
