/**
 * Gas-estimation tests for chains/gas.ts.
 *
 * Pins the math + the oracle-vs-RPC fallback. We mock a Provider so the
 * tests don't hit a live RPC; the oracle fetch is mocked via global
 * `fetch` so we can exercise both code paths without a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeeData, Provider, TransactionRequest } from 'ethers';
import { estimateMakaluGas, setGasOracleUrl } from '../chains/gas.js';

function mockProvider(over: {
  feeData?: Partial<FeeData>;
  estimateGas?: bigint;
  estimateGasThrows?: boolean;
} = {}): Provider {
  // Build feeData so explicit `null` in over.feeData wins over the default
  // (using `??` would coerce null back to the default and break the
  // legacy-gasPrice fallback test).
  const fd: FeeData = {
    maxFeePerGas:         'maxFeePerGas'         in (over.feeData ?? {}) ? (over.feeData!.maxFeePerGas         ?? null) : 20_000_000_000n,
    maxPriorityFeePerGas: 'maxPriorityFeePerGas' in (over.feeData ?? {}) ? (over.feeData!.maxPriorityFeePerGas ?? null) : 1_500_000_000n,
    gasPrice:             'gasPrice'             in (over.feeData ?? {}) ? (over.feeData!.gasPrice             ?? null) : null,
    toJSON: () => ({}),
  } as unknown as FeeData;
  return {
    getFeeData: vi.fn(async (): Promise<FeeData> => fd),
    estimateGas: vi.fn(async (_tx: TransactionRequest): Promise<bigint> => {
      if (over.estimateGasThrows) throw new Error('rpc dead');
      return over.estimateGas ?? 21_000n;
    }),
  } as unknown as Provider;
}

const SAMPLE_TX: TransactionRequest = {
  from:  '0xa11ce00000000000000000000000000000000a11',
  to:    '0xb0b0000000000000000000000000000000000b0b',
  value: 1_000_000_000_000_000_000n, // 1 LITHO
};

beforeEach(() => setGasOracleUrl(''));   // reset between tests
afterEach(() => { vi.restoreAllMocks(); });

describe('estimateMakaluGas', () => {
  it('returns gasLimit × maxFeePerGas as totalWei + LITHO-formatted total', async () => {
    const provider = mockProvider();
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    expect(r.gasLimit).toBe(21_000n);
    expect(r.maxFeePerGas).toBe(20_000_000_000n);
    expect(r.totalWei).toBe(21_000n * 20_000_000_000n);  // 420_000_000_000_000 wei
    // 4.2e14 wei = 0.00042 LITHO.
    expect(r.totalLitho).toBe('0.00042');
    expect(r.source).toBe('rpc');
  });

  it('uses 21_000 as the default gasLimit when no tx is supplied', async () => {
    const provider = mockProvider({ estimateGas: 99_999n });    // would-be value if estimate ran
    const r = await estimateMakaluGas({ provider });
    expect(r.gasLimit).toBe(21_000n);
  });

  it('falls back to gasPrice when EIP-1559 maxFeePerGas is null', async () => {
    const provider = mockProvider({
      feeData: { maxFeePerGas: null, gasPrice: 10_000_000_000n },  // 10 gwei legacy
    });
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    expect(r.maxFeePerGas).toBe(10_000_000_000n);
  });

  it('uses the explorer oracle standard tier when an oracle is configured', async () => {
    setGasOracleUrl('https://example.invalid/gas');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      result: { FastGasPrice: '50', ProposeGasPrice: '30', SafeGasPrice: '15' },
    }), { headers: { 'content-type': 'application/json' } }));

    const provider = mockProvider();
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    // standard tier from the oracle wins over the head-of-chain 20 gwei.
    expect(r.maxFeePerGas).toBe(30_000_000_000n);
    expect(r.source).toBe('explorer');
    expect(r.tiers).toBeDefined();
    expect(r.tiers?.fast.maxFeePerGas).toBe(50_000_000_000n);
    expect(r.tiers?.slow.maxFeePerGas).toBe(15_000_000_000n);
  });

  it('falls back to RPC fees when the oracle 4xx-es', async () => {
    setGasOracleUrl('https://example.invalid/gas');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const provider = mockProvider();
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    expect(r.source).toBe('rpc');
    expect(r.maxFeePerGas).toBe(20_000_000_000n);
  });

  it('throws when the provider.estimateGas itself fails', async () => {
    const provider = mockProvider({ estimateGasThrows: true });
    await expect(estimateMakaluGas({ provider, tx: SAMPLE_TX })).rejects.toThrow(/rpc dead/);
  });

  it('preserves a non-trivial priority tip from the provider', async () => {
    const provider = mockProvider({
      feeData: { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n },
    });
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    expect(r.maxPriorityFeePerGas).toBe(2_000_000_000n);
  });

  it('defaults the priority tip to 1.5 gwei when the provider returns null', async () => {
    const provider = mockProvider({
      feeData: { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: null },
    });
    const r = await estimateMakaluGas({ provider, tx: SAMPLE_TX });
    expect(r.maxPriorityFeePerGas).toBe(1_500_000_000n);
  });
});
