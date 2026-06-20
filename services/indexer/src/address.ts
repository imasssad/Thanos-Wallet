/**
 * Address normalisation for the portfolio/activity routes.
 *
 * Defence-in-depth: the native-balance path feeds the raw URL param straight to
 * provider.getBalance, and the /portfolio handler masks any throw as native
 * '0'. So a non-0x address (e.g. a litho1 bech32 form, which a future client
 * could send) would silently render as a zero balance — a phantom "deposit not
 * showing". Normalise every inbound address to a checksummed 0x EVM string, and
 * REJECT anything unrecognised with a 400 instead of returning a fake zero.
 */
import { getAddress } from 'ethers';

const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** Decode a bech32 (litho1…) address to 0x hex, or null if malformed. */
function bech32ToHex(addr: string): string | null {
  const pos = addr.lastIndexOf('1');
  if (pos < 1) return null;
  const data = addr.slice(pos + 1);
  const vals: number[] = [];
  for (const c of data) {
    const v = BECH32_CHARS.indexOf(c);
    if (v < 0) return null;
    vals.push(v);
  }
  const payload = vals.slice(0, -6); // strip the 6-char checksum
  let acc = 0, bits = 0;
  const out: number[] = [];
  for (const v of payload) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (out.length !== 20) return null;
  return '0x' + out.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalise any supported address form (0x or litho1 bech32) to a checksummed
 * 0x EVM address. Throws on an unrecognised/invalid address so the caller can
 * return a 400 rather than a phantom zero balance.
 */
export function resolveToEvm(addr: string): string {
  const a = (addr || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return getAddress(a);
  if (/^litho1[0-9a-z]+$/i.test(a)) {
    const hex = bech32ToHex(a.toLowerCase());
    if (hex) return getAddress(hex);
  }
  throw new Error(`Unrecognised address: ${addr}`);
}
