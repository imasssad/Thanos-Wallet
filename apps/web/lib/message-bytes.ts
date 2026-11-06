/**
 * The bytes a personal_sign / eth_sign request actually signs.
 *
 * Autha THN-R1 O-05. The signing worker used to hand-roll this decode
 * (`message.slice(2).match(/.{1,2}/g)`), which disagreed with the approval
 * sheet on every malformed input: '0xabc' was signed as [0xab, 0x0c] and
 * '0xzz' as [0x00] — byte strings the reviewer never displayed — while a bare
 * '0x' threw a TypeError on a null match.
 *
 * The reviewer (@thanos/sdk-core security/sign-review.ts, reviewMessage)
 * splits hex from text with ethers' `isHexString`. This makes the same call
 * with the same primitives, so the branch the user saw is the branch that gets
 * signed:
 *
 *   - well-formed hex (0x, even length, hex digits) → exactly those bytes.
 *     The sheet showed either the decoded text or, for binary/hashes, the hex
 *     itself flagged as an unreadable value.
 *   - not hex at all ('0xzz', 'Hello') → the literal string's UTF-8 bytes,
 *     which is the text the sheet displayed verbatim.
 *   - hex digits but an odd length ('0xabc') → `getBytes` throws, so the
 *     request fails closed rather than signing bytes nobody reviewed. ethers
 *     can't turn it into bytes either, which is why the reviewer marks the
 *     same input opaque.
 */
import { getBytes, isHexString, toUtf8Bytes } from 'ethers';

export function messageBytesFor(message: string): Uint8Array {
  return isHexString(message) ? getBytes(message) : toUtf8Bytes(message);
}
