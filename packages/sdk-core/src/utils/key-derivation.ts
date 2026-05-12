/**
 * Key derivation for wallet encryption.
 *
 * SECURITY: Never pass a hardcoded string as the `password` argument.
 * The password must come from the user's passphrase/PIN at unlock time.
 * Each vault generates a unique random salt stored alongside the ciphertext.
 *
 * Uses WebCrypto PBKDF2 (SHA-256, 600 000 iterations) which is available
 * in browsers, React Native (via expo-crypto polyfill), Node 18+, and Electron.
 *
 * For server-side Node environments that need Argon2, swap deriveKeyMaterial
 * for the argon2 npm package and keep the AES-GCM layer unchanged.
 */

const ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA-256
const KEY_LEN = 256;
const SALT_BYTES = 32;
const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKeyMaterial(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedVault {
  /** Base64-encoded random salt (32 bytes) */
  salt: string;
  /** Base64-encoded random IV (12 bytes) */
  iv: string;
  /** Base64-encoded AES-GCM ciphertext */
  payload: string;
  /** Iteration count — stored so we can increase it later without breaking existing vaults */
  iterations: number;
}

/**
 * Encrypt a plaintext string with a user-supplied password.
 * A fresh random salt and IV are generated on every call.
 */
export async function encryptWithPassword(password: string, plaintext: string): Promise<EncryptedVault> {
  if (!password || password.length < 1) throw new Error('Password must not be empty');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKeyMaterial(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    payload: toB64(new Uint8Array(ciphertext)),
    iterations: ITERATIONS
  };
}

/**
 * Decrypt a vault produced by encryptWithPassword.
 * Throws if the password is wrong (AES-GCM authentication tag mismatch).
 */
export async function decryptWithPassword(password: string, vault: EncryptedVault): Promise<string> {
  const salt = fromB64(vault.salt);
  const iv = fromB64(vault.iv);
  const iterations = vault.iterations ?? ITERATIONS;
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: KEY_LEN },
    false,
    ['decrypt']
  );
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, fromB64(vault.payload) as BufferSource);
    return dec.decode(plaintext);
  } catch {
    throw new Error('Decryption failed — incorrect password or corrupted vault');
  }
}

/**
 * Verify a password without exposing the plaintext.
 * Returns true if decryption succeeds, false if the password is wrong.
 */
export async function verifyPassword(password: string, vault: EncryptedVault): Promise<boolean> {
  try {
    await decryptWithPassword(password, vault);
    return true;
  } catch {
    return false;
  }
}
