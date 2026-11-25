/**
 * Autha THN-R1 O-05 — the signer must sign the bytes the reviewer displayed.
 *
 * These cases are the ones the old hand-rolled decode got wrong. Each asserts
 * the signer's branch against what @thanos/sdk-core's reviewMessage shows the
 * user for the same input, so the two can't drift apart again.
 */
import { describe, expect, it } from 'vitest';
import { toUtf8Bytes, verifyMessage, Wallet } from 'ethers';
import { reviewSigningRequest } from '@thanos/sdk-core';
import { messageBytesFor } from './message-bytes';

// Public Hardhat account #0 test vector — never funded.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new Wallet(KEY);

const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

/** What the approval sheet renders in its "Message" row for this input. */
function reviewedMessage(message: string): string {
  const r = reviewSigningRequest({
    method: 'personal_sign',
    params: [message, wallet.address],
    activeChainId: 1,
    account: wallet.address,
  });
  return String(r.rows.find((row) => row.label === 'Message')?.value ?? '');
}

describe('messageBytesFor — signer/reviewer agreement (O-05)', () => {
  it('well-formed hex signs those exact bytes', () => {
    expect(hex(messageBytesFor('0xdeadbeef'))).toBe('0xdeadbeef');
  });

  it('a bare 0x is empty, not a TypeError', () => {
    // The old decode did '0x'.slice(2).match(/.{1,2}/g)! === null!.map(…).
    expect(() => messageBytesFor('0x')).not.toThrow();
    expect(messageBytesFor('0x')).toHaveLength(0);
  });

  it('non-hex characters sign the literal text the sheet displayed', () => {
    // Old decode: parseInt('zz', 16) === NaN → signed [0x00].
    expect(hex(messageBytesFor('0xzz'))).not.toBe('0x00');
    expect(messageBytesFor('0xzz')).toEqual(toUtf8Bytes('0xzz'));
    // And that literal string is exactly what the reviewer shows.
    expect(reviewedMessage('0xzz')).toBe('0xzz');
  });

  it('odd-length hex fails closed instead of signing unreviewed bytes', () => {
    // Old decode silently signed [0xab, 0x0c] — a value nobody reviewed.
    expect(() => messageBytesFor('0xabc')).toThrow();
  });

  it('plain text signs its UTF-8 bytes and matches what was reviewed', () => {
    const msg = 'Sign in to Thanos';
    expect(messageBytesFor(msg)).toEqual(toUtf8Bytes(msg));
    expect(reviewedMessage(msg)).toBe(msg);
  });

  it('the signature recovers to the signer for every decodable case', async () => {
    for (const msg of ['0xdeadbeef', '0x', '0xzz', 'Sign in to Thanos']) {
      const bytes = messageBytesFor(msg);
      const sig = await wallet.signMessage(bytes);
      expect(verifyMessage(bytes, sig)).toBe(wallet.address);
    }
  });
});
