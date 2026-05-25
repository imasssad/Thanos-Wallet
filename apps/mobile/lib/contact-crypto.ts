/**
 * Mobile contact-encryption — same wire format as apps/web/lib/contact-crypto.ts
 * and the extension's, so a contact created on the laptop decrypts cleanly on
 * the phone after sync.
 *
 * React Native has no `crypto.subtle`, so we use the pure-JS @noble/ciphers
 * (AES-GCM) + @noble/hashes (HKDF-SHA256) that the rest of the wallet already
 * depends on for the vault layer.
 *
 * Format on the wire:  "v1:<iv_b64>:<ciphertext_b64>"
 * Anything without the v1: prefix is treated as legacy plaintext.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

const PREFIX = 'v1:';
const HKDF_SALT = utf8ToBytes('thanos.contacts.v1');
const HKDF_INFO = utf8ToBytes('contact-aes-key');

let _key: Uint8Array | null = null;

/** Derive + cache the contact-encryption key from the unlocked seed.
 *  Pass `null` on lock to wipe the cached key. */
export async function setContactEncryptionKey(seed: string[] | null): Promise<void> {
  if (!seed || seed.length === 0) { _key = null; return; }
  const ikm = utf8ToBytes(seed.join(' '));
  _key = hkdf(sha256, ikm, HKDF_SALT, HKDF_INFO, 32);
}

export function hasContactEncryptionKey(): boolean {
  return _key !== null;
}

function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  // RN supports global.btoa via react-native-url-polyfill / base-64 polyfill;
  // fall back to a manual encoder when not available.
  if (typeof btoa === 'function') return btoa(s);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i),
          c = i + 1 < s.length ? s.charCodeAt(i + 1) : -1,
          d = i + 2 < s.length ? s.charCodeAt(i + 2) : -1;
    out += alpha[a >> 2];
    out += alpha[((a & 3) << 4) | (c < 0 ? 0 : c >> 4)];
    out += c < 0 ? '=' : alpha[((c & 15) << 2) | (d < 0 ? 0 : d >> 6)];
    out += d < 0 ? '=' : alpha[d & 63];
  }
  return out;
}

function b64ToBytes(s: string): Uint8Array {
  const raw = typeof atob === 'function'
    ? atob(s)
    : (() => {
        const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let buf = 0, bits = 0, out = '';
        for (const ch of s) {
          if (ch === '=') break;
          const v = alpha.indexOf(ch);
          if (v < 0) continue;
          buf = (buf << 6) | v; bits += 6;
          if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 0xff); }
        }
        return out;
      })();
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function encryptField(plaintext: string | null | undefined): Promise<string | null> {
  if (plaintext == null || plaintext === '') return plaintext ?? null;
  if (!_key) return null;
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = gcm(_key, iv).encrypt(utf8ToBytes(plaintext));
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
    const pt = gcm(_key, iv).decrypt(ct);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(pt);
    let out = '';
    for (let i = 0; i < pt.length; i++) out += String.fromCharCode(pt[i]);
    return out;
  } catch {
    return stored;
  }
}
