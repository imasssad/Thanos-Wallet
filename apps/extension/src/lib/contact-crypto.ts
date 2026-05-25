/**
 * Client-side encryption for contact `name` + `notes` fields before they
 * sync to the backend. Same primitives as apps/web/lib/contact-crypto.ts
 * — HKDF-SHA256(seed) → AES-256-GCM, per-device-deterministic so a
 * contact added in the popup decrypts cleanly on web + mobile + desktop
 * for the same seed.
 *
 * Address is left plaintext (server dedup needs it; addresses are public
 * on-chain anyway). Anything not prefixed with `v1:` is treated as
 * legacy plaintext on decrypt — keeps older rows usable.
 */

const PREFIX = 'v1:';
const HKDF_SALT = new TextEncoder().encode('thanos.contacts.v1');
const HKDF_INFO = new TextEncoder().encode('contact-aes-key');

let _key: CryptoKey | null = null;

export async function setContactEncryptionKey(seed: string[] | null): Promise<void> {
  if (!seed || seed.length === 0) { _key = null; return; }
  if (typeof crypto === 'undefined' || !crypto.subtle) { _key = null; return; }
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

export function hasContactEncryptionKey(): boolean { return _key !== null; }

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

export async function decryptField(stored: string | null | undefined): Promise<string | null> {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  if (!_key) return stored;
  const rest = stored.slice(PREFIX.length);
  const sep  = rest.indexOf(':');
  if (sep === -1) return stored;
  try {
    const iv = b64ToBytes(rest.slice(0, sep));
    const ct = b64ToBytes(rest.slice(sep + 1));
    const pt = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      _key,
      ct as BufferSource,
    ));
    return new TextDecoder().decode(pt);
  } catch {
    return stored;
  }
}
