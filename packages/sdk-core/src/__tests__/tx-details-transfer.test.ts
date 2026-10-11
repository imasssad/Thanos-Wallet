import { describe, it, expect } from 'vitest';
import { Interface } from 'ethers';
import { decodeErc20Transfer } from '../portfolio/tx-details';

const ERC20 = new Interface(['function transfer(address to, uint256 amount)', 'function approve(address spender, uint256 amount)']);
const TOKEN = '0x1111111111111111111111111111111111111111';
const TO = '0x5ffb000000000000000000000000000000c053b7';

describe('decodeErc20Transfer', () => {
  it('reads the recipient and amount of a token send', () => {
    const input = ERC20.encodeFunctionData('transfer', [TO, 11_337_868_480_000_000_000n]);
    expect(decodeErc20Transfer(input, TOKEN)).toEqual({ recipient: TO.toLowerCase(), contract: TOKEN, amountRaw: '11337868480000000000' });
  });

  it('is null for a native send, another call, or malformed calldata', () => {
    expect(decodeErc20Transfer('0x', TO)).toBeNull();
    expect(decodeErc20Transfer(undefined, TO)).toBeNull();
    expect(decodeErc20Transfer(ERC20.encodeFunctionData('approve', [TO, 1n]), TOKEN)).toBeNull();
    expect(decodeErc20Transfer('0xa9059cbb1234', TOKEN)).toBeNull();
    expect(decodeErc20Transfer(ERC20.encodeFunctionData('transfer', [TO, 1n]), null)).toBeNull();
    // A first word with high bits set isn't an address.
    expect(decodeErc20Transfer(`0xa9059cbb${'f'.repeat(64)}${'0'.repeat(63)}1`, TOKEN)).toBeNull();
  });
});
