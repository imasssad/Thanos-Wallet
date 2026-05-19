/**
 * Recipient address resolution for the mobile wallet.
 *
 * Resolves the three accepted recipient forms to a canonical 0x EVM
 * address for signing:
 *   - 0x…        → EIP-55 checksummed as-is
 *   - litho1…    → bech32-decoded to 0x (Lithosphere dual-address)
 *   - name.litho → resolved via the DNNS API
 *
 * A litho1 address is plain bech32 (BIP-173) of the same 20-byte hash
 * as the 0x address — identical to @thanos/sdk-core's litho-address.ts.
 * The inline decoder below was round-trip verified against the canonical
 * `bech32` npm package (the one sdk-core uses).
 */
import { getAddress } from 'ethers';

const API_BASE = String(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_API_URL) ||
    'https://devapp.thanos.fi/api',
).replace(/\/$/, '');

/* ─── bech32 (BIP-173) decode ────────────────────────────────────────── */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** Decode a bech32 string into its human-readable prefix and 5-bit words. */
function bech32Decode(str: string): { hrp: string; words: number[] } {
  if (str.length < 8) throw new Error('Address too short');
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) {
    throw new Error('Mixed-case address');
  }
  const s = str.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Error('Malformed address');
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (const ch of s.slice(pos + 1)) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid address character');
    data.push(idx);
  }
  if (bech32Polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Error('Address checksum failed');
  }
  return { hrp, words: data.slice(0, -6) };
}

/** Convert 5-bit bech32 words to 8-bit bytes (strict — rejects bad padding). */
function wordsToBytes(words: number[]): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff)) throw new Error('Bad address padding');
  return Uint8Array.from(out);
}

/** Convert a litho1… bech32 address to a checksummed 0x EVM address. */
export function lithoToEvm(litho: string): string {
  const { hrp, words } = bech32Decode(litho);
  if (hrp !== 'litho') throw new Error('Not a litho1 address');
  const bytes = wordsToBytes(words);
  if (bytes.length !== 20) throw new Error(`Expected a 20-byte address, got ${bytes.length}`);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return getAddress(`0x${hex}`);
}

/* ─── DNNS name resolution ───────────────────────────────────────────── */

/** Resolve a `name.litho` DNNS name to its 0x address via the API. */
export async function resolveDnnsName(name: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/dnns/resolve?name=${encodeURIComponent(name.toLowerCase())}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`DNNS lookup failed (${res.status})`);
  const json = (await res.json()) as { record?: { address?: string | null } };
  const addr = json.record?.address;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`"${name}" is not registered`);
  }
  return getAddress(addr);
}

/* ─── Public resolver ────────────────────────────────────────────────── */

/**
 * Resolve any accepted recipient form (0x / litho1 / name.litho) to a
 * canonical, checksummed 0x address. Throws a user-readable error on a
 * malformed or unresolvable input.
 */
export async function resolveRecipient(input: string): Promise<string> {
  const s = (input || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return getAddress(s);
  if (/^litho1[0-9a-z]+$/i.test(s)) return lithoToEvm(s);
  if (/^[a-z0-9-]+\.litho$/i.test(s)) return resolveDnnsName(s);
  throw new Error('Enter a 0x…, litho1…, or name.litho address');
}
