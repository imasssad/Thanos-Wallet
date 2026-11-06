/**
 * Native Lithic reader — pinned to the golden vectors from Litho's native
 * Lithic handoff (fixtures/native-lithic-golden-vectors.json, unchanged:
 * sha256 d26feb45…954a). Covers the LVAL codec's rejection rules, the gateway
 * calldata for every getter and the six reviewed transfer calls, the ABI
 * `bytes` unwrap, and the read client: one block, read-only methods, and a
 * failed read never showing as a zero balance.
 */
import { describe, it, expect } from 'vitest';
import { AbiCoder, id } from 'ethers';
import {
  NATIVE_GATEWAY_ABI,
  NATIVE_LAX,
  NATIVE_LITHIC_GATEWAY,
  decodeGatewayResult,
  decodeLval,
  encodeLval,
  encodeNativeCall,
  formatNativeAmount,
  readNativeLaxBalance,
  type LvalInput,
  type NativeFetch,
} from '../clients/native-lithic.js';
import vectors from './fixtures/native-lithic-golden-vectors.json';

const HOLDER = '0x5AaC0cf0AcF5927C8Bd4D18400350e020DE55F00';
const RPC = 'https://rpc.litho.ai';
const coder = AbiCoder.defaultAbiCoder();

describe('LVAL v1', () => {
  it('round-trips every type, and an empty list', () => {
    const input = [
      { type: 'u64', value: 18446744073709551615n },
      { type: 'u256', value: (1n << 256n) - 1n },
      { type: 'bool', value: true },
      { type: 'address', value: HOLDER },
      { type: 'bytes32', value: '0x' + 'ab'.repeat(32) },
      { type: 'string', value: 'Lithic €' },
    ] as const;
    expect(decodeLval(encodeLval(input))).toEqual(input);
    expect(decodeLval(encodeLval([]))).toEqual([]);
  });

  const rejects: Array<[string, () => unknown]> = [
    ['u64 overflow', () => encodeLval([{ type: 'u64', value: 1n << 64n }])],
    ['negative unsigned', () => encodeLval([{ type: 'u256', value: '-1' }])],
    ['a JS number amount', () => encodeLval([{ type: 'u256', value: 1e27 } as unknown as LvalInput])],
    ['a numeric bool', () => encodeLval([{ type: 'bool', value: 1 } as unknown as LvalInput])],
    ['a string over 4096 bytes', () => encodeLval([{ type: 'string', value: 'x'.repeat(4097) }])],
    ['65 values', () => encodeLval(Array(65).fill({ type: 'u64', value: '0' }))],
    ['an inherited key as a type', () => encodeLval([{ type: 'toString', value: '0' } as unknown as LvalInput])],
    ['an unknown tag', () => decodeLval('0x4c56414c01000107')],
    ['wrong magic', () => decodeLval('0x4c56414c020000')],
    ['a truncated word', () => decodeLval('0x4c56414c01000102ff')],
    ['trailing bytes', () => decodeLval('0x4c56414c01000000')],
    ['bad UTF-8', () => decodeLval('0x4c56414c010001060001ff')],
    ['overlong UTF-8', () => decodeLval('0x4c56414c010001060002c0af')],
    ['a UTF-16 surrogate', () => decodeLval('0x4c56414c010001060003eda080')],
    ['bool padding', () => decodeLval('0x4c56414c01000103' + '00'.repeat(31) + '02')],
    ['address padding', () => decodeLval('0x4c56414c01000104' + '01'.repeat(32))],
    ['u64 padding', () => decodeLval('0x4c56414c01000101' + '01' + '00'.repeat(31))],
  ];
  for (const [name, fn] of rejects) it(`rejects ${name}`, () => expect(fn).toThrow());
});

describe('gateway calls (golden vectors)', () => {
  it('uses the reviewed gateway selector', () => {
    expect(NATIVE_GATEWAY_ABI.getFunction('call')!.selector).toBe(vectors.gatewayCallSelector);
  });

  for (const g of vectors.getters) {
    it(`${g.signature}: full 32-byte selector, LVAL arguments, calldata`, () => {
      const args = g.args as LvalInput[];
      expect(id(g.signature)).toBe(g.selector);
      expect(encodeLval(args)).toBe(g.lvalArguments);
      expect(encodeNativeCall(NATIVE_LAX.nativeTarget, g.signature, args)).toBe(g.gatewayCalldata);
      expect(decodeGatewayResult(g.exampleGatewayResult)).toEqual(decodeLval(g.exampleLvalResult));
    });
  }

  it('decodes the example results', () => {
    const result = (sig: string) => decodeGatewayResult(vectors.getters.find((g) => g.signature === sig)!.exampleGatewayResult);
    expect(result('name()')).toEqual([{ type: 'string', value: 'Lithosphere Algorithmic' }]);
    expect(result('symbol()')).toEqual([{ type: 'string', value: 'LAX' }]);
    expect(result('decimals()')).toEqual([{ type: 'u64', value: 18n }]);
    expect(result('balance_of(address)')).toEqual([{ type: 'u256', value: 10_000_000_000n * 10n ** 18n }]);
  });

  for (const t of vectors.transfers) {
    it(`reproduces reviewed transfer call ${t.step} byte for byte`, () => {
      const args = t.args as LvalInput[];
      expect(encodeLval(args)).toBe(t.lvalArguments);
      expect(encodeNativeCall(NATIVE_LAX.nativeTarget, t.signature, args)).toBe(t.gatewayCalldata);
    });
  }

  it('takes the exact native signature, not the ERC-20 one', () => {
    const data = encodeNativeCall(NATIVE_LAX.nativeTarget, 'balance_of(address)', [{ type: 'address', value: HOLDER }]);
    const [, selector] = NATIVE_GATEWAY_ABI.decodeFunctionData('call', data);
    expect(selector).toBe(id('balance_of(address)'));
    expect(selector).not.toBe(id('balanceOf(address)'));
    expect(() => encodeNativeCall(NATIVE_LAX.nativeTarget, 'transfer(address,uint256)', [
      { type: 'address', value: HOLDER }, { type: 'u256', value: '1' },
    ])).toThrow();
    expect(() => encodeNativeCall(NATIVE_LAX.nativeTarget, 'balance_of(address)', [])).toThrow();
  });

  it('unwraps the ABI bytes before LVAL, and rejects anything else', () => {
    const lval = encodeLval([{ type: 'string', value: 'LAX' }]);
    const raw = coder.encode(['bytes'], [lval]);
    expect(decodeGatewayResult(raw)).toEqual([{ type: 'string', value: 'LAX' }]);
    expect(() => decodeGatewayResult(lval)).toThrow();
    expect(() => decodeGatewayResult(raw + '00')).toThrow();
  });
});

/** A Makalu RPC that answers like the live gateway, recording every request. */
function fakeRpc(opts: { chainId?: string; balance?: bigint; symbol?: string } = {}) {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const values: Record<string, LvalInput> = {
    'name()': { type: 'string', value: NATIVE_LAX.name },
    'symbol()': { type: 'string', value: opts.symbol ?? 'LAX' },
    'decimals()': { type: 'u64', value: '18' },
    'balance_of(address)': { type: 'u256', value: opts.balance ?? 0n },
  };
  const fetchImpl: NativeFetch = async (_url, init) => {
    const req = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
    calls.push(req);
    let result: string;
    if (req.method === 'eth_chainId') result = opts.chainId ?? '0xab169';
    else if (req.method === 'eth_blockNumber') result = '0x1190000';
    else {
      const [call] = req.params as Array<{ to: string; data: string }>;
      expect(call.to).toBe(NATIVE_LITHIC_GATEWAY);
      const [, selector] = NATIVE_GATEWAY_ABI.decodeFunctionData('call', call.data);
      const sig = Object.keys(values).find((k) => id(k) === selector)!;
      result = coder.encode(['bytes'], [encodeLval([values[sig]])]);
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: req.id, result }) };
  };
  return { calls, fetchImpl };
}

describe('readNativeLaxBalance', () => {
  it('reads metadata and the balance at one block, read-only methods only', async () => {
    const rpc = fakeRpc({ balance: 10_000_000_000n * 10n ** 18n });
    const out = await readNativeLaxBalance(HOLDER.toLowerCase(), { rpcUrl: RPC, fetchImpl: rpc.fetchImpl });
    expect(out).toMatchObject({
      chainId: 700777, nativeTarget: NATIVE_LAX.nativeTarget, owner: HOLDER, blockHeight: String(0x1190000),
      symbol: 'LAX', decimals: 18, balanceBaseUnits: '10000000000000000000000000000',
      balanceFormatted: '10000000000.0', canonicalProofVerified: false,
    });
    const ethCalls = rpc.calls.filter((c) => c.method === 'eth_call');
    expect(ethCalls).toHaveLength(4);
    for (const c of ethCalls) {
      expect(c.params[1]).toBe('0x1190000');
      expect(c.params[0]).toMatchObject({ from: HOLDER, to: NATIVE_LITHIC_GATEWAY, value: '0x0' });
    }
    expect(new Set(rpc.calls.map((c) => c.method))).toEqual(new Set(['eth_chainId', 'eth_blockNumber', 'eth_call']));
  });

  it('a genuine zero balance reads as zero', async () => {
    const out = await readNativeLaxBalance(HOLDER, { rpcUrl: RPC, fetchImpl: fakeRpc().fetchImpl });
    expect(out.balanceBaseUnits).toBe('0');
  });

  it('refuses an RPC that is not Makalu before calling the gateway', async () => {
    const rpc = fakeRpc({ chainId: '0x232d' });
    await expect(readNativeLaxBalance(HOLDER, { rpcUrl: RPC, fetchImpl: rpc.fetchImpl })).rejects.toThrow(/Makalu/);
    expect(rpc.calls.map((c) => c.method)).toEqual(['eth_chainId']);
  });

  it('refuses a token whose metadata is not native LAX', async () => {
    const rpc = fakeRpc({ symbol: 'XAL' });
    await expect(readNativeLaxBalance(HOLDER, { rpcUrl: RPC, fetchImpl: rpc.fetchImpl })).rejects.toThrow(/metadata/);
  });

  it('RPC errors, wrong ids and HTTP failures throw instead of reading as zero', async () => {
    const answers: Array<{ ok: boolean; status: number; body: unknown }> = [
      { ok: true, status: 200, body: { jsonrpc: '2.0', id: 999, result: '0xab169' } },
      { ok: true, status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'missing' } } },
      { ok: false, status: 502, body: {} },
    ];
    for (const a of answers) {
      const fetchImpl: NativeFetch = async () => ({ ok: a.ok, status: a.status, json: async () => a.body });
      await expect(readNativeLaxBalance(HOLDER, { rpcUrl: RPC, fetchImpl })).rejects.toThrow();
    }
  });

  it('rejects the zero address and credentials in the RPC URL', async () => {
    const { fetchImpl } = fakeRpc();
    await expect(readNativeLaxBalance('0x' + '0'.repeat(40), { rpcUrl: RPC, fetchImpl })).rejects.toThrow();
    await expect(readNativeLaxBalance(HOLDER, { rpcUrl: 'https://u:p@rpc.litho.ai', fetchImpl })).rejects.toThrow();
  });
});

describe('formatNativeAmount', () => {
  it('formats exact base units without rounding up', () => {
    expect(formatNativeAmount('10000000000000000000000000000', 18)).toBe('10,000,000,000');
    expect(formatNativeAmount('1234567890000000000', 18)).toBe('1.2345');
    expect(formatNativeAmount('999999999999999999', 18)).toBe('0.9999');
    expect(formatNativeAmount('50000000000000', 18)).toBe('< 0.0001');
    expect(formatNativeAmount('0', 18)).toBe('0');
  });
});
