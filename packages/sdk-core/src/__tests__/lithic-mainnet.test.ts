/**
 * Lithic on LITHO mainnet — the parts added when Lithic went live on chain
 * 9005 (Litho integration docs, 2026-11-21).
 *
 * The vectors below are the documents' own: the LVAL spec vector, the two
 * 32-byte selectors they print, the worked `balance_of` calldata, the gateway
 * log topic and the LAX address. Anything this file asserts about the wire
 * can be checked against that handoff by eye.
 *
 * The LVAL encoder itself predates mainnet (it was written for Makalu) and is
 * covered by native-lithic.test.ts; that it still reproduces the mainnet
 * vectors byte for byte is the first thing checked here, because that is what
 * made the mainnet work an extension rather than a rewrite.
 */
import { describe, expect, it } from 'vitest';
import { id } from 'ethers';
import {
  estimateLithicTransferGas,
  fetchLithicTransfers,
  reviewSigningRequest,
  LITHIC_FT_SIGNATURES,
  LITHIC_LOG_TOPIC,
  LITHO_MAINNET_CHAIN_ID,
  MAINNET_LAX,
  NATIVE_LAX,
  NATIVE_LITHIC_GATEWAY,
  decodeLithicCall,
  describeLithicTransfer,
  encodeLval,
  encodeNativeCall,
  findLithicToken,
  knownLithicTokens,
  lithicGasLimit,
  lithicTransferCall,
  parseLithicLogs,
  receiptHasLithicTransfer,
} from '../index';

const HOLDER = '0xc2C32EB0601E01BD3C9573bf2f865aeEcb38C73b';
const RECIPIENT = '0xbAa8C1f2f0E9b1ac4a0dc1e9a9B0C9D8e7F60293';

describe('the documents’ wire vectors', () => {
  it('reproduces the LVAL spec vector', () => {
    // Docs 01 §2: ["Aé", ""] → 4c56414c01000206000341c3a9060000
    expect(encodeLval([{ type: 'string', value: 'Aé' }, { type: 'string', value: '' }]).toLowerCase())
      .toBe('0x4c56414c01000206000341c3a9060000');
  });

  it('uses full 32-byte selectors, not 4-byte ones', () => {
    expect(id(LITHIC_FT_SIGNATURES.transfer))
      .toBe('0xf61367304e4e32065cad538b10a44bb599f78e0771530108572d225c74122c1f');
    expect(id(LITHIC_FT_SIGNATURES.balanceOf))
      .toBe('0xb144adfb505c053e0d50877cc29fb830ff028d3498efa8f33757758d63bec35d');
  });

  it('builds the worked balance_of calldata', () => {
    const data = encodeNativeCall(MAINNET_LAX.nativeTarget, LITHIC_FT_SIGNATURES.balanceOf, [
      { type: 'address', value: HOLDER },
    ]).toLowerCase();
    expect(data.startsWith('0xcf511cf7')).toBe(true);                       // call(address,bytes32,bytes)
    expect(data).toContain('29147bebb1c49c3a54aa464137611fe708886df3');     // the LAX target
    expect(data).toContain('b144adfb505c053e0d50877cc29fb830ff028d3498efa8f33757758d63bec35d');
    expect(data).toContain('4c56414c01000104');                             // LVAL v1, 1 value, address tag
  });

  it('pins the single gateway log topic', () => {
    expect(LITHIC_LOG_TOPIC).toBe(id('LithoNativeLab(bytes)'));
  });
});

describe('known tokens', () => {
  it('ships mainnet LAX at the documented address, and keeps Makalu separate', () => {
    expect(MAINNET_LAX.nativeTarget).toBe('0x29147bEbb1C49C3a54aA464137611FE708886df3');
    expect(MAINNET_LAX.chainId).toBe(LITHO_MAINNET_CHAIN_ID);
    expect(MAINNET_LAX.decimals).toBe(18);
    // Same symbol, different asset, different chain — never keyed by symbol.
    expect(NATIVE_LAX.nativeTarget.toLowerCase()).not.toBe(MAINNET_LAX.nativeTarget.toLowerCase());
    expect(knownLithicTokens(LITHO_MAINNET_CHAIN_ID)).toEqual([MAINNET_LAX]);
    expect(findLithicToken(LITHO_MAINNET_CHAIN_ID, MAINNET_LAX.nativeTarget.toLowerCase())).toBe(MAINNET_LAX);
    expect(findLithicToken(LITHO_MAINNET_CHAIN_ID, NATIVE_LAX.nativeTarget)).toBeNull();
  });
});

describe('sending', () => {
  it('addresses the gateway, never the token, and carries no value', () => {
    const tx = lithicTransferCall(MAINNET_LAX, RECIPIENT, 25_000000000000000000n);
    // The token address has no EVM code; sending there would be a transfer to
    // an address that cannot receive, and value must be 0 or the call burns
    // all gas (docs 01 §1, 02 §3).
    expect(tx.to).toBe(NATIVE_LITHIC_GATEWAY);
    expect(tx.value).toBe('0x0');
    expect(tx.chainId).toBe(LITHO_MAINNET_CHAIN_ID);
    expect(tx.data.toLowerCase()).toContain('29147bebb1c49c3a54aa464137611fe708886df3');
  });

  it('refuses a send the chain would reject anyway', () => {
    expect(() => lithicTransferCall(MAINNET_LAX, RECIPIENT, 0n)).toThrow(/above zero/);
    // A zero recipient is one of LAX's documented revert causes.
    expect(() => lithicTransferCall(MAINNET_LAX, `0x${'0'.repeat(40)}`, 1n)).toThrow(/zero recipient/);
    // Makalu never had an authorised execution path.
    expect(() => lithicTransferCall(NATIVE_LAX, RECIPIENT, 1n)).toThrow(/not enabled/);
  });

  it('adds a margin to the estimate rather than a round number', () => {
    // The chain charges for at least half the gas limit, so an inflated limit
    // is paid for (docs 01 §7).
    expect(lithicGasLimit(326_600n)).toBe(391_920n);
    expect(lithicGasLimit(326_600n, 0)).toBe(326_600n);
    expect(() => lithicGasLimit(0n)).toThrow();
  });
});

describe('showing a transaction to the user', () => {
  it('turns gateway calldata back into "send 25 LAX to …"', () => {
    const { data } = lithicTransferCall(MAINNET_LAX, RECIPIENT, 25_000000000000000000n);
    const call = decodeLithicCall(data);
    expect(call?.target).toBe(MAINNET_LAX.nativeTarget);
    expect(call?.signature).toBe(LITHIC_FT_SIGNATURES.transfer);

    const described = describeLithicTransfer(data, LITHO_MAINNET_CHAIN_ID);
    expect(described).toMatchObject({ token: MAINNET_LAX, to: RECIPIENT, amountBaseUnits: 25_000000000000000000n });
  });

  it('names the contract even when the selector is not one we know', () => {
    const data = encodeNativeCall(MAINNET_LAX.nativeTarget, 'something_else(u256)', [{ type: 'u256', value: 1n }]);
    const call = decodeLithicCall(data);
    expect(call?.target).toBe(MAINNET_LAX.nativeTarget);
    expect(call?.signature).toBeNull();            // a selector cannot be reversed
    expect(call?.args).toEqual([{ type: 'u256', value: 1n }]);
    expect(describeLithicTransfer(data, LITHO_MAINNET_CHAIN_ID)).toBeNull();
  });

  it('returns null for calldata that is not a gateway call', () => {
    expect(decodeLithicCall('0x')).toBeNull();
    expect(decodeLithicCall('0xa9059cbb')).toBeNull();                       // an ERC-20 transfer
    expect(describeLithicTransfer('0xdeadbeef', LITHO_MAINNET_CHAIN_ID)).toBeNull();
  });
});

describe('gateway logs', () => {
  const transferValues = encodeLval([
    { type: 'address', value: HOLDER },
    { type: 'address', value: RECIPIENT },
    { type: 'u256', value: 25_000000000000000000n },
  ]);
  const payload = JSON.stringify({
    Deployments: [],
    Events: [{ contract: MAINNET_LAX.nativeTarget.toLowerCase(), name: 'Transfer', values: transferValues }],
  });
  const utf8Hex = `0x${Buffer.from(payload, 'utf8').toString('hex')}`;
  const log = { address: NATIVE_LITHIC_GATEWAY, topics: [LITHIC_LOG_TOPIC], data: utf8Hex };

  it('decodes the raw-JSON payload and its LVAL values', () => {
    const [entry] = parseLithicLogs([log]);
    expect(entry.events).toHaveLength(1);
    expect(entry.events[0]).toMatchObject({ contract: MAINNET_LAX.nativeTarget, name: 'Transfer' });
    expect(entry.events[0].values[2]).toEqual({ type: 'u256', value: 25_000000000000000000n });
  });

  it('confirms a transfer involving the holder', () => {
    expect(receiptHasLithicTransfer([log], MAINNET_LAX, HOLDER)).toBe(true);
    expect(receiptHasLithicTransfer([log], MAINNET_LAX, '0x1111111111111111111111111111111111111111')).toBe(false);
    expect(receiptHasLithicTransfer([log], NATIVE_LAX, HOLDER)).toBe(false);  // other chain's LAX
  });

  it('ignores logs that are not the gateway’s, and survives a malformed one', () => {
    expect(parseLithicLogs([{ ...log, address: MAINNET_LAX.nativeTarget }])).toEqual([]);
    expect(parseLithicLogs([{ ...log, topics: [id('Transfer(address,address,uint256)')] }])).toEqual([]);
    // One unreadable entry must not take a whole receipt down.
    const broken = { ...log, data: `0x${Buffer.from('{not json', 'utf8').toString('hex')}` };
    expect(parseLithicLogs([broken, log])).toHaveLength(1);
  });
});

/* ── The signing sheet ───────────────────────────────────────────────── */

describe('reviewing a transaction to the gateway', () => {
  const review = (data: string, value = '0x0') => reviewSigningRequest({
    method: 'eth_sendTransaction',
    params: [{ from: HOLDER, to: NATIVE_LITHIC_GATEWAY, data, value, chainId: `0x${LITHO_MAINNET_CHAIN_ID.toString(16)}` }],
    activeChainId: LITHO_MAINNET_CHAIN_ID,
    account: HOLDER,
  });

  it('reads a Lithic transfer as a send, not an unrecognised call', () => {
    const { data } = lithicTransferCall(MAINNET_LAX, RECIPIENT, 25_000000000000000000n);
    const r = review(data);
    expect(r.title).toContain('Send 25.0 LAX');
    expect(r.rows.find((x) => x.label === 'Amount')?.value).toBe('25.0 LAX');
    expect(r.rows.some((x) => x.value.includes('LithoVM gateway'))).toBe(true);
    // The gateway is the intended target of every Lithic call and must not be
    // blocked for looking like a precompile.
    expect(r.risk).not.toBe('block');
    expect(r.warnings.join(' ')).not.toMatch(/can.t decode/);
  });

  it('warns that an approval hands over spending power', () => {
    const data = encodeNativeCall(MAINNET_LAX.nativeTarget, LITHIC_FT_SIGNATURES.approve, [
      { type: 'address', value: RECIPIENT }, { type: 'u256', value: 5_000000000000000000n },
    ]);
    const r = review(data);
    // The shared allowance wording and risk, not a hand-rolled one: the
    // ERC-20 and Lithic paths must read identically, because the risk level
    // is what the clients turn into a red, deliberate confirmation.
    expect(r.title).toBe(`Approve ${RECIPIENT} to spend 5.0 LAX`);
    expect(r.rows.find((x) => x.label === 'Amount')?.value).toBe('5.0 LAX');
    expect(r.risk).toBe('caution');
    expect(r.warnings.join(' ')).toMatch(/without asking again/);
  });

  it('flags a call that carries coin value, which the chain burns gas for', () => {
    const { data } = lithicTransferCall(MAINNET_LAX, RECIPIENT, 1n);
    const r = review(data, '0x1');
    expect(r.warnings.join(' ')).toMatch(/must send 0/);
  });

  it('says what it does and does not know for an unknown Lithic function', () => {
    const data = encodeNativeCall(MAINNET_LAX.nativeTarget, 'mystery(u256)', [{ type: 'u256', value: 1n }]);
    const r = review(data);
    expect(r.title).toBe('Lithic contract call');
    expect(r.rows.find((x) => x.label === 'Function')?.value).toMatch(/unrecognised/);
    expect(r.warnings.join(' ')).toMatch(/can.t decode/);
  });

  it('shows base units rather than a wrong number for an unknown token', () => {
    const other = '0x1111111111111111111111111111111111111111';
    const data = encodeNativeCall(other, LITHIC_FT_SIGNATURES.transfer, [
      { type: 'address', value: RECIPIENT }, { type: 'u256', value: 25_000000000000000000n },
    ]);
    // Decimals come from the wallet's token record, never from calldata.
    // Grouped the same way the ERC-20 path groups base units.
    expect(review(data).rows.find((x) => x.label === 'Amount')?.value).toBe('25,000,000,000,000,000,000 (base units)');
  });
});

/* ── Gas and history, over a stubbed RPC ─────────────────────────────── */

function fakeRpc(handler: (method: string, params: unknown[]) => unknown) {
  return async (_url: string, init: { body: string }) => {
    const { id, method, params } = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id, result: handler(method, params) }) };
  };
}
const CHAIN_HEX = `0x${LITHO_MAINNET_CHAIN_ID.toString(16)}`;

describe('gas', () => {
  it('estimates with the real sender and returns the limit to send', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const limit = await estimateLithicTransferGas(HOLDER, MAINNET_LAX, RECIPIENT, 1n, {
      rpcUrl: 'https://rpc.example',
      fetchImpl: fakeRpc((method, params) => {
        if (method === 'eth_chainId') return CHAIN_HEX;
        seen.push(params[0] as Record<string, unknown>);
        return '0x4fbc8';                       // 326,600
      }) as never,
    });
    // Without a non-zero `from` the node refuses the estimate outright.
    expect(seen[0].from).toBe(HOLDER);
    expect(seen[0].value).toBe('0x0');
    expect(seen[0].to).toBe(NATIVE_LITHIC_GATEWAY);
    expect(limit).toBe(391_920n);               // estimate + 20%
  });
});

describe('history', () => {
  const values = encodeLval([
    { type: 'address', value: HOLDER },
    { type: 'address', value: RECIPIENT },
    { type: 'u256', value: 2_000000000000000000n },
  ]);
  const logFor = (contract: string) => ({
    address: NATIVE_LITHIC_GATEWAY,
    topics: [LITHIC_LOG_TOPIC],
    data: `0x${Buffer.from(JSON.stringify({ Events: [{ contract, name: 'Transfer', values }] }), 'utf8').toString('hex')}`,
    transactionHash: `0x${'ab'.repeat(32)}`,
    blockNumber: '0xe4e4e4',
    logIndex: '0x0',
  });

  it('keeps only this token’s transfers involving the holder', async () => {
    const filters: Array<Record<string, unknown>> = [];
    const rows = await fetchLithicTransfers(HOLDER, MAINNET_LAX, {
      rpcUrl: 'https://rpc.example',
      maxWindows: 1,
      fetchImpl: fakeRpc((method, params) => {
        if (method === 'eth_chainId') return CHAIN_HEX;
        if (method === 'eth_blockNumber') return '0xe4e4e4';
        filters.push(params[0] as Record<string, unknown>);
        // A transfer of OUR token, and one of another Lithic contract.
        return [logFor(MAINNET_LAX.nativeTarget.toLowerCase()), logFor('0x1111111111111111111111111111111111111111')];
      }) as never,
    });
    // The node can only filter on the gateway plus the single topic; the rest
    // is ours to do.
    expect(filters[0]).toMatchObject({ address: NATIVE_LITHIC_GATEWAY, topics: [LITHIC_LOG_TOPIC] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'out', counterparty: RECIPIENT, amount: '2.0', symbol: 'LAX' });
  });

  it('skips a window the node refuses instead of losing the rest', async () => {
    let call = 0;
    const rows = await fetchLithicTransfers(HOLDER, MAINNET_LAX, {
      rpcUrl: 'https://rpc.example',
      maxWindows: 2,
      windowSize: 10,
      fetchImpl: fakeRpc((method) => {
        if (method === 'eth_chainId') return CHAIN_HEX;
        if (method === 'eth_blockNumber') return '0xe4e4e4';
        if (++call === 1) throw new Error('range too wide');
        return [logFor(MAINNET_LAX.nativeTarget.toLowerCase())];
      }) as never,
    });
    expect(rows).toHaveLength(1);
  });
});
