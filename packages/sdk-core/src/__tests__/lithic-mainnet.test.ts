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
