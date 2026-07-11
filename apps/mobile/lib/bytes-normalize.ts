/**
 * Bytes-like → 0x-hex normalization for sign-request params.
 *
 * Port of apps/extension/src/lib/bytes-normalize.ts for the mobile
 * in-app dApp browser. dApps may pass personal_sign / eth_sign message
 * params as a Uint8Array (makalu.litho.ai/signin does). The WebView
 * bridge is JSON.stringify-based (lib/dapp-provider.ts), so a Uint8Array
 * arrives in RN as a numeric-keyed object {0:105, 1:103, …}; the signer's
 * old `toUtf8Bytes(String(raw))` fallback would then silently sign the
 * literal string "[object Object]" — an invalid signature the dApp can't
 * explain. Normalize at the page boundary AND heal here, mirroring the
 * extension fix. Dependency-free on purpose.
 */

/** Convert any bytes-like value (Uint8Array, ArrayBuffer, number[], or a
 *  JSON-mangled numeric-keyed object) to a 0x hex string. Returns null
 *  when the value isn't bytes-like — caller leaves it untouched. */
export function bytesLikeToHex(v: unknown): string | null {
  let bytes: ArrayLike<number> | null = null;
  if (v instanceof Uint8Array) bytes = v;
  else if (v instanceof ArrayBuffer) bytes = new Uint8Array(v);
  else if (Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number')) bytes = v as number[];
  else if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length > 0 && keys.every(k => /^[0-9]+$/.test(k))) {
      const rec = v as Record<string, unknown>;
      const arr = keys.map(Number).sort((a, b) => a - b).map(k => rec[String(k)]);
      if (arr.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) {
        bytes = arr as number[];
      }
    }
  }
  if (!bytes) return null;
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return hex;
}
