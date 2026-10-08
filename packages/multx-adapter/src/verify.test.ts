import { describe, it, expect, vi } from 'vitest';
import { verifyErc20ReleaseViaRpc } from './verify.js';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOKEN = '0x1111111111111111111111111111111111111111';
const USER = '0x2222222222222222222222222222222222222222';
const BRIDGE = '0x3333333333333333333333333333333333333333';
const RELEASE = '0x' + 'ab'.repeat(32);
const pad = (addr: string) => '0x' + addr.slice(2).toLowerCase().padStart(64, '0');

const transferLog = (over: Partial<{ address: string; to: string; amount: bigint; topic0: string }> = {}) => ({
  address: over.address ?? TOKEN,
  topics: [over.topic0 ?? TRANSFER, pad(BRIDGE), pad(over.to ?? USER)],
  data: '0x' + (over.amount ?? 100n).toString(16).padStart(64, '0'),
});

function rpcReturning(result: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => ({ jsonrpc: '2.0', id: 1, result }) }) as unknown as typeof fetch;
}

const EXPECT = {
  destinationChainId: 9005, destinationTxHash: RELEASE, expectedRecipient: USER,
  expectedAmountBaseUnits: 100n, expectedTokenAddress: TOKEN,
};

const verifier = (fetchImpl: typeof fetch) =>
  verifyErc20ReleaseViaRpc({ rpcUrlFor: (id) => (id === 9005 ? 'https://rpc.example' : undefined), fetchImpl });

describe('verifyErc20ReleaseViaRpc', () => {
  it('passes a successful release that moved exactly the amount to the user', async () => {
    const fetchImpl = rpcReturning({ status: '0x1', logs: [transferLog()] });
    await expect(verifier(fetchImpl)(EXPECT)).resolves.toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://rpc.example');
    expect(JSON.parse(init.body)).toMatchObject({ method: 'eth_getTransactionReceipt', params: [RELEASE] });
  });

  it('matches addresses case-insensitively and finds the transfer among other logs', async () => {
    const other = { address: BRIDGE, topics: ['0x' + '00'.repeat(32)], data: '0x' };
    const fetchImpl = rpcReturning({ status: '0x1', logs: [other, transferLog({ address: TOKEN.toUpperCase().replace('0X', '0x') })] });
    await expect(verifier(fetchImpl)({ ...EXPECT, expectedRecipient: USER.toUpperCase().replace('0X', '0x') })).resolves.toBe(true);
  });

  it.each([
    ['a different recipient', { status: '0x1', logs: [transferLog({ to: BRIDGE })] }],
    ['a different token', { status: '0x1', logs: [transferLog({ address: BRIDGE })] }],
    ['a different amount', { status: '0x1', logs: [transferLog({ amount: 99n })] }],
    ['a log that is not a Transfer', { status: '0x1', logs: [transferLog({ topic0: '0x' + '11'.repeat(32) })] }],
    ['a reverted release', { status: '0x0', logs: [transferLog()] }],
    ['no logs', { status: '0x1', logs: [] }],
    ['no receipt yet', null],
  ])('refuses %s', async (_why, receipt) => {
    await expect(verifier(rpcReturning(receipt))(EXPECT)).resolves.toBe(false);
  });

  it('refuses when the chain has no RPC, the hash is malformed, or the RPC fails', async () => {
    const good = rpcReturning({ status: '0x1', logs: [transferLog()] });
    await expect(verifier(good)({ ...EXPECT, destinationChainId: 1 })).resolves.toBe(false);
    await expect(verifyErc20ReleaseViaRpc({ rpcUrlFor: () => '', fetchImpl: good })(EXPECT)).resolves.toBe(false);
    expect(good).not.toHaveBeenCalled();
    await expect(verifier(good)({ ...EXPECT, destinationTxHash: '0xdest' })).resolves.toBe(false);
    await expect(verifier(rpcReturning({ status: '0x1', logs: [transferLog()] }, false))(EXPECT)).resolves.toBe(false);
    const down = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    await expect(verifier(down)(EXPECT)).resolves.toBe(false);
  });
});
