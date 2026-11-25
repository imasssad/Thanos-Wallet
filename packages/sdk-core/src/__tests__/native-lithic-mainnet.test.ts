/**
 * Native Lithic on LITHO mainnet (chain 9005): the token entry, reading a
 * transaction to the gateway back into words for the signing screen, the send
 * builder and its gate, and confirming a transfer from the gateway's log.
 *
 * Expected values come from KaJ Labs' mainnet integration docs (2026-11-21) —
 * the worked `balance_of` calldata and the documented `transfer` selector —
 * not from running this code.
 */
import { describe, it, expect } from 'vitest';
import { id } from 'ethers';
import {
  LITHO_MAINNET_CHAIN_ID,
  NATIVE_LAX,
  NATIVE_LAX_MAINNET,
  NATIVE_LITHIC_GATEWAY,
  confirmsNativeTransfer,
  decodeNativeCall,
  describeNativeCall,
  encodeLval,
  encodeNativeCall,
  encodeNativeTransfer,
  nativeLithicTokensFor,
  type NativeLithicToken,
} from '../clients/native-lithic.js';

const HOLDER = '0xc2C32EB0601E01BD3C9573bf2f865aeEcb38C73b';
const RECIPIENT = '0x5AaC0cf0AcF5927C8Bd4D18400350e020DE55F00';
const LAX = NATIVE_LAX_MAINNET.nativeTarget;

function gatewayLog(events: { contract: string; name: string; values: string }[]) {
  const json = JSON.stringify({ Events: events.map((e) => ({ contract: e.contract.toLowerCase(), name: e.name, values: e.values })) });
  let data = '0x';
  for (const byte of new TextEncoder().encode(json)) data += byte.toString(16).padStart(2, '0');
  return { address: NATIVE_LITHIC_GATEWAY, topics: [id('LithoNativeLab(bytes)')], data };
}

const transferValues = (from: string, to: string, amount: bigint) =>
  encodeLval([
    { type: 'address', value: from },
    { type: 'address', value: to },
    { type: 'u256', value: amount },
  ]);

describe('mainnet native LAX', () => {
  it('is a separate asset from Makalu native LAX, keyed by chain and target', () => {
    expect(NATIVE_LAX_MAINNET.chainId).toBe(9005);
    expect(NATIVE_LAX_MAINNET.nativeTarget).not.toBe(NATIVE_LAX.nativeTarget);
    expect(nativeLithicTokensFor(LITHO_MAINNET_CHAIN_ID)).toEqual([NATIVE_LAX_MAINNET]);
    expect(nativeLithicTokensFor(700777)).toEqual([NATIVE_LAX]);
    expect(nativeLithicTokensFor(1)).toEqual([]);
  });

  it('builds the mainnet balance_of calldata the vendor documents', () => {
    // 01_PROTOCOL_REFERENCE §2, the worked mainnet example.
    const data = encodeNativeCall(LAX, 'balance_of(address)', [{ type: 'address', value: HOLDER }]);
    expect(data.toLowerCase()).toBe(
      ('0xcf511cf7' +
        '00000000000000000000000029147bebb1c49c3a54aa464137611fe708886df3' +
        'b144adfb505c053e0d50877cc29fb830ff028d3498efa8f33757758d63bec35d' +
        '0000000000000000000000000000000000000000000000000000000000000060' +
        '0000000000000000000000000000000000000000000000000000000000000028' +
        '4c56414c01000104000000000000000000000000c2c32eb0601e01bd3c9573bf2f865aeecb38c73b' +
        '000000000000000000000000000000000000000000000000').toLowerCase(),
    );
  });
});

describe('reading a gateway transaction for the signing screen', () => {
  it('names a transfer, its amount and its recipient', () => {
    const data = encodeNativeCall(LAX, 'transfer(address,u256)', [
      { type: 'address', value: RECIPIENT },
      { type: 'u256', value: 25n * 10n ** 18n },
    ]);
    const call = decodeNativeCall(data, LITHO_MAINNET_CHAIN_ID);
    expect(call).not.toBeNull();
    expect(call!.signature).toBe('transfer(address,u256)');
    expect(call!.selector).toBe(id('transfer(address,u256)'));
    expect(call!.amount).toBe(25n * 10n ** 18n);
    expect(call!.recipient).toBe(RECIPIENT);
    expect(call!.token?.symbol).toBe('LAX');
    // What the user must read instead of "Contract interaction".
    expect(describeNativeCall(data, LITHO_MAINNET_CHAIN_ID)).toBe(`Send 25 LAX to ${RECIPIENT}`);
  });

  it('calls an allowance what it is', () => {
    const data = encodeNativeCall(LAX, 'approve(address,u256)', [
      { type: 'address', value: RECIPIENT },
      { type: 'u256', value: 10n ** 18n },
    ]);
    expect(describeNativeCall(data, LITHO_MAINNET_CHAIN_ID)).toBe(`Allow ${RECIPIENT} to spend 1 LAX`);
  });

  it('refuses to name a selector it does not know, rather than guessing', () => {
    const data = encodeNativeCall(LAX, 'sweep_everything(address)', [{ type: 'address', value: RECIPIENT }]);
    const call = decodeNativeCall(data, LITHO_MAINNET_CHAIN_ID);
    expect(call!.signature).toBeNull();
    expect(call!.amount).toBeNull();
    // A native selector is the full keccak, so the name cannot be recovered from it.
    expect(describeNativeCall(data, LITHO_MAINNET_CHAIN_ID)).toMatch(/^Unknown Lithic function 0x[0-9a-f]{8}…/);
  });

  it('returns null for calldata that is not a canonical gateway call', () => {
    const good = encodeNativeCall(LAX, 'transfer(address,u256)', [
      { type: 'address', value: RECIPIENT },
      { type: 'u256', value: 1n },
    ]);
    expect(decodeNativeCall(good + 'ff', LITHO_MAINNET_CHAIN_ID)).toBeNull(); // trailing bytes
    expect(decodeNativeCall('0xa9059cbb' + '00'.repeat(64))).toBeNull(); // an ERC-20 transfer
    expect(decodeNativeCall('0x')).toBeNull();
    expect(describeNativeCall('0x1234')).toBeNull();
  });

  it('shows base units when the Lithic contract is not a token it knows', () => {
    const unknown = '0x0d3A04E3956D2d912E45AD701faFD4F735737E02';
    const data = encodeNativeCall(unknown, 'transfer(address,u256)', [
      { type: 'address', value: RECIPIENT },
      { type: 'u256', value: 7n },
    ]);
    const described = describeNativeCall(data, LITHO_MAINNET_CHAIN_ID);
    expect(described).toContain('7 base units');
    expect(described).toContain(unknown);
  });
});

describe('sending', () => {
  it('refuses while the token has sending disabled', () => {
    expect(NATIVE_LAX_MAINNET.transferEnabled).toBe(false);
    expect(() => encodeNativeTransfer(NATIVE_LAX_MAINNET, RECIPIENT, 1n)).toThrow(/not enabled/);
    expect(() => encodeNativeTransfer(NATIVE_LAX, RECIPIENT, 1n)).toThrow(/not enabled/);
  });

  it('builds a gateway transaction with value 0 once a token is enabled', () => {
    // A copy with sending on: a Lithic call carrying LITHO fails and burns all the gas.
    const enabled: NativeLithicToken = { ...NATIVE_LAX_MAINNET, transferEnabled: true };
    const tx = encodeNativeTransfer(enabled, RECIPIENT, 25n * 10n ** 18n);
    expect(tx.to).toBe(NATIVE_LITHIC_GATEWAY);
    expect(tx.value).toBe('0x0');
    expect(decodeNativeCall(tx.data, LITHO_MAINNET_CHAIN_ID)!.amount).toBe(25n * 10n ** 18n);
  });

  it('refuses the zero recipient, which the token rejects with no reason given', () => {
    const enabled: NativeLithicToken = { ...NATIVE_LAX_MAINNET, transferEnabled: true };
    expect(() => encodeNativeTransfer(enabled, '0x' + '00'.repeat(20), 1n)).toThrow(/Nonzero recipient/);
  });
});

describe('confirming a transfer from the gateway log', () => {
  it('finds the Transfer event for this token and this pair', () => {
    const logs = [gatewayLog([{ contract: LAX, name: 'Transfer', values: transferValues(HOLDER, RECIPIENT, 5n) }])];
    expect(confirmsNativeTransfer(logs, NATIVE_LAX_MAINNET, HOLDER, RECIPIENT)).toBe(true);
    expect(confirmsNativeTransfer(logs, NATIVE_LAX_MAINNET, RECIPIENT, HOLDER)).toBe(false);
    expect(confirmsNativeTransfer(logs, NATIVE_LAX, HOLDER, RECIPIENT)).toBe(false); // other chain's token
  });

  it('is false when the log says nothing about a transfer, since a failure emits no log at all', () => {
    expect(confirmsNativeTransfer([], NATIVE_LAX_MAINNET, HOLDER, RECIPIENT)).toBe(false);
    const other = [gatewayLog([{ contract: LAX, name: 'Approval', values: transferValues(HOLDER, RECIPIENT, 5n) }])];
    expect(confirmsNativeTransfer(other, NATIVE_LAX_MAINNET, HOLDER, RECIPIENT)).toBe(false);
  });

  it('ignores a log from anywhere but the gateway', () => {
    const forged = [{ ...gatewayLog([{ contract: LAX, name: 'Transfer', values: transferValues(HOLDER, RECIPIENT, 5n) }]), address: LAX }];
    expect(confirmsNativeTransfer(forged, NATIVE_LAX_MAINNET, HOLDER, RECIPIENT)).toBe(false);
  });
});
