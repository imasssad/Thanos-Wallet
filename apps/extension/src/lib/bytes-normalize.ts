/**
 * Bytes-like → 0x-hex normalization for sign-request params.
 *
 * WHY: dApps may pass personal_sign / eth_sign message params as a
 * Uint8Array (makalu.litho.ai/signin does). window.postMessage preserves
 * it (structured clone), but chrome.runtime.sendMessage serializes as
 * JSON — a Uint8Array arrives as a numeric-keyed object {0:105, 1:103, …}
 * and ethers getBytes() later throws "invalid BytesLike value", hanging
 * the dApp on "Signing in…". MetaMask normalizes at the provider
 * boundary; so do we. Dependency-free on purpose: this is bundled into
 * the page-world injected script.
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
    // JSON-mangled Uint8Array: {"0":105,"1":103,…} — every key a base-10
    // index, every value a byte. Rebuild in index order.
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
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

/** For sign methods, replace a bytes-like message param with its 0x hex
 *  form so it survives every JSON boundary. Non-sign methods and already-
 *  string params pass through untouched. personal_sign carries the message
 *  at params[0]; eth_sign at params[1]. */
export function normalizeSignParams(method: string, params: unknown[]): unknown[] {
  const idx = method === 'personal_sign' ? 0 : method === 'eth_sign' ? 1 : -1;
  if (idx < 0 || !Array.isArray(params) || params.length <= idx) return params;
  const hex = bytesLikeToHex(params[idx]);
  if (hex == null) return params;
  const out = params.slice();
  out[idx] = hex;
  return out;
}
