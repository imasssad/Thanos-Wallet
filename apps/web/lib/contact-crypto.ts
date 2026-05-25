/**
 * Client-side encryption for contact `name` and `notes` fields before
 * they're synced to the backend.
 *
 * The backend already scopes the `contacts` table by `user_id` so no
 * other user can read your rows — but the DBA, a leaked dump, or an
 * accidental log line would still expose the plaintext names + notes.
 * Encrypting on the client closes that gap: the server only ever sees
 * the ciphertext blob.
 *
 * Address is intentionally NOT encrypted — the server enforces dedup
 * on `lower(address)` and that lookup needs the cleartext value.
 * Addresses are public on-chain anyway, so this isn't a leakage gain
 * over what the user's tx history already shows.
 *
 * Key:
 *   - Derived from the unlocked seed via HKDF-SHA256 with a fixed salt
 *     + info string. Same seed → same key on every device, so the
 *     contacts the user encrypts on their laptop decrypt cleanly on
 *     their phone after a fresh login.
 *   - Cached in module-local memory; cleared on lock.
 *
 * Format on the wire:  "v1:<iv_b64>:<ciphertext_b64>"
 * Anything that doesn't start with "v1:" is treated as legacy
 * plaintext (returned as-is on decrypt) — so existing contacts in the
 * DB don't break when this layer rolls out.
 */

const PREFIX = 'v1:';
const HKDF_SALT = new TextEncoder().encode('thanos.contacts.v1');
const HKDF_INFO = new TextEncoder().encode('contact-aes-key');

let _key: CryptoKey | null = null;

/** Derive + cache the contact-encryption key from the unlocked seed.
 *  Pass `null` on lock to wipe the cached key. */
export async function setContactEncryptionKey(seed: string[] | null): Promise<void> {
  if (!seed || seed.length === 0) {
    _key = null;
    return;
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    _key = null;
    return;
  }
  // The seed words joined form a stable ikm — HKDF derives a 256-bit
  // AES key that's deterministic across devices.
  const ikm = new TextEncoder().encode(seed.join(' '));
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  _key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    ikmKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** True when the encryption key is currently cached and crypto.subtle
 *  is available. Callers use this to decide whether to encrypt before
 *  POSTing or fall back to plaintext (when the wallet's still locked). */
export function hasContactEncryptionKey(): boolean {
  return _key !== null;
}

function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Encrypt a string field. Returns null when no key is available, so
 *  the caller can decide between "fall back to plaintext" and "refuse
 *  to write". */
export async function encryptField(plaintext: string | null | undefined): Promise<string | null> {
  if (plaintext == null || plaintext === '') return plaintext ?? null;
  if (!_key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    _key,
    new TextEncoder().encode(plaintext) as BufferSource,
  ));
  return `${PREFIX}${bytesToB64(iv)}:${bytesToB64(ct)}`;
}

/** Decrypt a stored field. Strings without the `v1:` prefix are treated
 *  as legacy plaintext and returned unchanged — so existing rows in the
 *  DB keep working after this layer ships. */
export async function decryptField(stored: string | null | undefined): Promise<string | null> {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  if (!_key) return stored;            // can't decrypt; show ciphertext rather than fail loudly
  const rest = stored.slice(PREFIX.length);
  const sep  = rest.indexOf(':');
  if (sep === -1) return stored;
  try {
    const iv = b64ToBytes(rest.slice(0, sep));
    const ct = b64ToBytes(rest.slice(sep + 1));
    // Cast to BufferSource — TS DOM lib added a SharedArrayBuffer-disallowed
    // generic that doesn't actually apply to a fresh Uint8Array.
    const pt = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      _key,
      ct as BufferSource,
    ));
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong key (seed mismatch) or tampered blob — fail safely.
    return stored;
  }
}
