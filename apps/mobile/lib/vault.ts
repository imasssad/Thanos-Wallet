/**
 * Mobile mnemonic vault.
 *
 * Threat model: a mobile device is more likely to be physically lost/stolen
 * than a desktop. Two layers of protection:
 *
 *   1. Software encryption — Argon2id (t=3, m=64MB, p=4) derives a 32-byte
 *      AES-256-GCM key from the user password + a per-vault random salt.
 *      The mnemonic is encrypted with AES-256-GCM (authenticated, so a
 *      wrong password = decryption throws = we return null). Argon2id is
 *      the same KDF the web vault uses; provided by @noble/hashes in pure
 *      JS, no WASM needed, works fine on Hermes.
 *
 *   2. Hardware-backed storage — expo-secure-store wraps the encrypted
 *      vault blob in the OS keystore (Secure Enclave on iOS, Android
 *      KeyStore + EncryptedSharedPreferences on Android). Even root access
 *      to the file system returns ciphertext, and the wrapping key never
 *      leaves secure hardware.
 *
 * Session-cached key (refresh persistence):
 *   The 32-byte derived key is kept in module memory after unlock so the
 *   wallet stays usable across the SettingsScreen / SendScreen navigations
 *   without re-running Argon2id (which takes ~1-2s on a phone). On app
 *   close (process death), the module unloads and the key is gone — cold
 *   start re-prompts for the password.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const VAULT_KEY      = 'thanos_vault_v1';   // SecureStore key (no dots — SecureStore disallows them)
const LEGACY_HAS     = 'thanos.has_vault';  // AsyncStorage (legacy)
const LEGACY_MNEM    = 'thanos.mnemonic';
const LEGACY_PWD     = 'thanos.password';
const LEGACY_UNLOCK  = 'thanos.unlocked';

// Argon2id params — match services/api + apps/web vault.ts.
const ARGON2_T = 3;            // iterations
const ARGON2_M = 64 * 1024;    // 64 MiB (m param, in KiB)
const ARGON2_P = 4;            // parallel lanes
const KEY_BYTES = 32;          // AES-256

/* ─── On-disk format ────────────────────────────────────────────────────── */
export interface EncryptedVault {
  v: 1;
  kdf: { type: 'argon2id'; t: number; m: number; p: number };
  salt:       string; // hex
  iv:         string; // hex (12 bytes)
  ciphertext: string; // hex (includes the GCM auth tag at the end)
}

/* ─── In-memory session cache ───────────────────────────────────────────── */
let sessionKey: Uint8Array | null = null;
export function cacheSessionKey(key: Uint8Array): void { sessionKey = key; }
export function getSessionKey(): Uint8Array | null      { return sessionKey; }
export function clearSessionKey(): void                  { sessionKey = null; }

/* ─── Crypto helpers ────────────────────────────────────────────────────── */
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  // react-native-get-random-values polyfills global crypto.getRandomValues
  // when imported at app entry (see App.tsx imports).
  globalThis.crypto.getRandomValues(a);
  return a;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2idAsync(utf8ToBytes(password), salt, {
    t:      ARGON2_T,
    m:      ARGON2_M,
    p:      ARGON2_P,
    dkLen:  KEY_BYTES,
  });
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/** Encrypt + write the vault to expo-secure-store. */
export async function createVault(mnemonic: string, password: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv   = randomBytes(12);
  const key  = await deriveKey(password, salt);
  const ct   = gcm(key, iv).encrypt(utf8ToBytes(mnemonic));
  const vault: EncryptedVault = {
    v: 1,
    kdf: { type: 'argon2id', t: ARGON2_T, m: ARGON2_M, p: ARGON2_P },
    salt:       bytesToHex(salt),
    iv:         bytesToHex(iv),
    ciphertext: bytesToHex(ct),
  };
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault));
  // Cache the freshly derived key so the caller can skip a second derivation.
  cacheSessionKey(key);
  return vault;
}

/** Read the vault from secure store. Returns null if no wallet exists. */
export async function loadVault(): Promise<EncryptedVault | null> {
  const raw = await SecureStore.getItemAsync(VAULT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as EncryptedVault; } catch { return null; }
}

/** Decrypt with the user's password. Returns null on wrong password. */
export async function openVault(
  vault: EncryptedVault,
  password: string,
): Promise<{ mnemonic: string; key: Uint8Array } | null> {
  if (vault.v !== 1) return null;
  try {
    const salt = hexToBytes(vault.salt);
    const iv   = hexToBytes(vault.iv);
    const ct   = hexToBytes(vault.ciphertext);
    const key  = await deriveKey(password, salt);
    const pt   = gcm(key, iv).decrypt(ct);
    return { mnemonic: new TextDecoder().decode(pt), key };
  } catch {
    return null; // GCM auth-tag failure = wrong password / tampered vault
  }
}

/** Decrypt with a previously-derived key (session cache hit). */
export async function openVaultWithKey(
  vault: EncryptedVault,
  key: Uint8Array,
): Promise<string | null> {
  try {
    const iv = hexToBytes(vault.iv);
    const ct = hexToBytes(vault.ciphertext);
    const pt = gcm(key, iv).decrypt(ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** Wipe the vault + session key + any leftover legacy plaintext. */
export async function clearVault(): Promise<void> {
  clearSessionKey();
  try { await SecureStore.deleteItemAsync(VAULT_KEY); } catch {}
  await AsyncStorage.multiRemove([LEGACY_HAS, LEGACY_MNEM, LEGACY_PWD, LEGACY_UNLOCK]);
}

/* ─── Quick existence check ─────────────────────────────────────────────── */
export async function hasVault(): Promise<boolean> {
  return (await SecureStore.getItemAsync(VAULT_KEY)) !== null;
}

/* ─── Legacy plaintext migration ───────────────────────────────────────── */

export async function hasLegacyPlaintext(): Promise<boolean> {
  const [mnem, pwd] = await Promise.all([
    AsyncStorage.getItem(LEGACY_MNEM),
    AsyncStorage.getItem(LEGACY_PWD),
  ]);
  return mnem !== null && pwd !== null;
}

/**
 * One-shot migration from the old AsyncStorage plaintext keys to an
 * encrypted vault in SecureStore. Wipes the plaintext afterwards.
 */
export async function migrateLegacyPlaintext(): Promise<{ ok: boolean; key?: Uint8Array }> {
  const [mnem, pwd] = await Promise.all([
    AsyncStorage.getItem(LEGACY_MNEM),
    AsyncStorage.getItem(LEGACY_PWD),
  ]);
  if (!mnem || !pwd) return { ok: false };

  await createVault(mnem, pwd);          // also session-caches the key
  await AsyncStorage.multiRemove([LEGACY_HAS, LEGACY_MNEM, LEGACY_PWD, LEGACY_UNLOCK]);
  return { ok: true, key: sessionKey ?? undefined };
}
