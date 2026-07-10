/**
 * TransactionSimulator tests — pin the issue codes the approval UI
 * keys off of (RECIPIENT_IS_CONTRACT, INSUFFICIENT_BALANCE, etc.).
 */
import { describe, it, expect, vi } from 'vitest';
import { TransactionSimulator } from '../security/simulator.js';
import { EvmClient }    from '../clients/evm-client.js';
import { LithicClient } from '../clients/lithic-client.js';

function mockEvm(overrides: {
  code?:         string;
  balance?:      bigint;
  feeData?:      { maxFeePerGas?: bigint };
  /** eth_call result for the ERC-20 balanceOf read (32-byte hex). */
  tokenBalance?: bigint;
  gas?:          bigint;
} = {}): EvmClient {
  const provider = {
    getCode:     vi.fn().mockResolvedValue(overrides.code    ?? '0x'),
    getBalance:  vi.fn().mockResolvedValue(overrides.balance ?? 1_000_000_000_000_000_000n /* 1 ETH */),
    getFeeData:  vi.fn().mockResolvedValue(overrides.feeData ?? { maxFeePerGas: 20_000_000_000n /* 20 gwei */ }),
    call:        overrides.tokenBalance !== undefined
      ? vi.fn().mockResolvedValue('0x' + overrides.tokenBalance.toString(16).padStart(64, '0'))
      : vi.fn().mockRejectedValue(new Error('no token read')),
    estimateGas: overrides.gas !== undefined
      ? vi.fn().mockResolvedValue(overrides.gas)
      : vi.fn().mockRejectedValue(new Error('estimate revert')),
  };
  return { getProvider: () => provider } as unknown as EvmClient;
}

const baseReq = {
  chainId: 1,                       // ethereum mainnet — kind: 'evm'
  to:      '0x1111111111111111111111111111111111111111',
  amount:  '0.5',                   // human-readable native amount
  from:    '0x00000000000000000000000000000000000a11ce', // valid 40-hex — the ERC-20 calldata encoder rejects malformed addresses
};

describe('TransactionSimulator.simulateSend', () => {
  it('returns an info-level NATIVE_TRANSFER for a normal EOA recipient with enough balance', async () => {
    const sim = new TransactionSimulator(mockEvm(), new LithicClient());
    const r = await sim.simulateSend(baseReq);
    expect(r.chainId).toBe(1);
    expect(r.summary).toMatch(/Send 0\.5 .* to 0x1111…1111/);
    expect(r.estimatedFee).toBeDefined();
    expect(r.issues.map(i => i.code)).toContain('NATIVE_TRANSFER');
    expect(r.issues.map(i => i.code)).not.toContain('RECIPIENT_IS_CONTRACT');
    expect(r.issues.map(i => i.code)).not.toContain('INSUFFICIENT_BALANCE');
  });

  it('emits RECIPIENT_IS_CONTRACT when getCode returns bytecode', async () => {
    const sim = new TransactionSimulator(mockEvm({ code: '0x6080604052' /* bytecode prefix */ }), new LithicClient());
    const r = await sim.simulateSend(baseReq);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('RECIPIENT_IS_CONTRACT');
    const contractIssue = r.issues.find(i => i.code === 'RECIPIENT_IS_CONTRACT');
    expect(contractIssue?.level).toBe('warning');
  });

  it('emits INSUFFICIENT_BALANCE (critical) when balance < amount and from is set', async () => {
    // 0.1 ETH balance, trying to send 0.5
    const sim = new TransactionSimulator(mockEvm({ balance: 100_000_000_000_000_000n }), new LithicClient());
    const r = await sim.simulateSend(baseReq);
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('INSUFFICIENT_BALANCE');
    const balIssue = r.issues.find(i => i.code === 'INSUFFICIENT_BALANCE');
    expect(balIssue?.level).toBe('critical');
  });

  it('skips the balance check when `from` is not provided (back-compat)', async () => {
    const sim = new TransactionSimulator(mockEvm({ balance: 0n }), new LithicClient());
    const { from: _omit, ...noFrom } = baseReq;
    const r = await sim.simulateSend(noFrom);
    expect(r.issues.map(i => i.code)).not.toContain('INSUFFICIENT_BALANCE');
  });

  it('never emits native INSUFFICIENT_BALANCE for token transfers (non-native)', async () => {
    const sim = new TransactionSimulator(mockEvm({ balance: 0n }), new LithicClient());
    const r = await sim.simulateSend({ ...baseReq, tokenAddress: '0xdeadbeef' });
    expect(r.issues.map(i => i.code)).not.toContain('INSUFFICIENT_BALANCE');
    expect(r.issues.map(i => i.code)).toContain('TOKEN_TRANSFER');
  });

  it('emits INSUFFICIENT_TOKEN_BALANCE naming the token when token balance < amount', async () => {
    // 2 USDT (18-dec BSC-peg) held, sending 5; plenty of native for gas.
    const sim = new TransactionSimulator(
      mockEvm({ tokenBalance: 2_000_000_000_000_000_000n, gas: 51_000n }),
      new LithicClient(),
    );
    const r = await sim.simulateSend({
      ...baseReq, amount: '5', tokenAddress: '0xdeadbeef', tokenSymbol: 'USDT', tokenDecimals: 18,
    });
    const issue = r.issues.find(i => i.code === 'INSUFFICIENT_TOKEN_BALANCE');
    expect(issue?.level).toBe('critical');
    expect(issue?.message).toContain('USDT');
    expect(issue?.message).toContain('2');
    expect(r.issues.map(i => i.code)).not.toContain('INSUFFICIENT_BALANCE');
  });

  it('emits INSUFFICIENT_GAS (not a token error) when the token balance covers the send but native is dust', async () => {
    // 10 USDT held, sending 5 — but native balance is 1 gwei, far below fee.
    const sim = new TransactionSimulator(
      mockEvm({ balance: 1_000_000_000n, tokenBalance: 10_000_000_000_000_000_000n, gas: 51_000n }),
      new LithicClient(),
    );
    const r = await sim.simulateSend({
      ...baseReq, amount: '5', tokenAddress: '0xdeadbeef', tokenSymbol: 'USDT', tokenDecimals: 18,
    });
    const codes = r.issues.map(i => i.code);
    expect(codes).toContain('INSUFFICIENT_GAS');
    expect(codes).not.toContain('INSUFFICIENT_TOKEN_BALANCE');
    expect(codes).not.toContain('INSUFFICIENT_BALANCE');
    const gasIssue = r.issues.find(i => i.code === 'INSUFFICIENT_GAS');
    expect(gasIssue?.level).toBe('critical');
    expect(gasIssue?.message).toMatch(/network fees/i);
  });

  it('sufficient token balance + sufficient native gas → no critical issues', async () => {
    const sim = new TransactionSimulator(
      mockEvm({ tokenBalance: 10_000_000_000_000_000_000n, gas: 51_000n }),
      new LithicClient(),
    );
    const r = await sim.simulateSend({
      ...baseReq, amount: '5', tokenAddress: '0xdeadbeef', tokenSymbol: 'USDT', tokenDecimals: 18,
    });
    expect(r.issues.filter(i => i.level === 'critical')).toEqual([]);
  });

  it('native send: INSUFFICIENT_BALANCE when balance covers the amount but not amount + fee', async () => {
    // Exactly 0.5 ETH held, sending 0.5 — fee pushes it over.
    const sim = new TransactionSimulator(
      mockEvm({ balance: 500_000_000_000_000_000n, gas: 21_000n }),
      new LithicClient(),
    );
    const r = await sim.simulateSend(baseReq);
    const issue = r.issues.find(i => i.code === 'INSUFFICIENT_BALANCE');
    expect(issue?.level).toBe('critical');
    expect(issue?.message).toMatch(/network fees/i);
  });

  it('does not throw when getFeeData/getCode/getBalance reject', async () => {
    const provider = {
      getCode:    vi.fn().mockRejectedValue(new Error('rpc dead')),
      getBalance: vi.fn().mockRejectedValue(new Error('rpc dead')),
      getFeeData: vi.fn().mockRejectedValue(new Error('rpc dead')),
    };
    const evm = { getProvider: () => provider } as unknown as EvmClient;
    const sim = new TransactionSimulator(evm, new LithicClient());
    const r = await sim.simulateSend(baseReq);
    // Falls through gracefully — estimatedFee absent, no recipient/balance issues.
    expect(r.estimatedFee).toBeUndefined();
    expect(r.issues.map(i => i.code)).not.toContain('RECIPIENT_IS_CONTRACT');
    expect(r.issues.map(i => i.code)).not.toContain('INSUFFICIENT_BALANCE');
  });

  it('uses tokenSymbol when provided in the summary line', async () => {
    const sim = new TransactionSimulator(mockEvm(), new LithicClient());
    const r = await sim.simulateSend({ ...baseReq, tokenSymbol: 'USDC' });
    expect(r.summary).toMatch(/Send 0\.5 USDC to 0x1111…1111/);
  });
});
