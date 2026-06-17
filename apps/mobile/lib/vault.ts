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
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const VAULT_KEY      = 'thanos_vault_v1';   // SecureStore key (no dots — SecureStore disallows them)
const LEGACY_HAS     = 'thanos.has_vault';  // AsyncStorage (legacy)
const LEGACY_MNEM    = 'thanos.mnemonic';
const LEGACY_PWD     = 'thanos.password';
const LEGACY_UNLOCK  = 'thanos.unlocked';
const SEED_BACKED_UP = 'thanos.seed_backed_up'; // AsyncStorage flag

// KDF for NEW vaults: PBKDF2-HMAC-SHA256, 600k iterations (OWASP 2023).
//
// Why not Argon2id? @noble/hashes' Argon2 is PURE JS and Argon2 is memory-hard
// — under Hermes on low-end phones it took 5-10 MINUTES (real device report),
// which reads as "stuck on Encrypting…". Even the OWASP mobile floor (19 MiB)
// was unusable. PBKDF2 is iteration-only (not memory-hard) and finishes in
// ~1-3s on any phone, deterministically.
//
// This is a sound KDF here: the vault is device-local (never synced) AND the
// encrypted blob is itself wrapped in the OS hardware keystore via
// expo-secure-store (Secure Enclave / Android Keystore). The password KDF is a
// second layer over hardware-backed storage, so PBKDF2-600k is appropriate.
// Older Argon2id vaults still decrypt — openVault reads each vault's own kdf
// block (which carries its t/m/p), so no legacy constants are needed here.
const PBKDF2_ITERS = 600_000;
const KEY_BYTES = 32;          // AES-256

/* ─── On-disk format ────────────────────────────────────────────────────── */
export type VaultKdf =
  | { type: 'argon2id'; t: number; m: number; p: number }
  | { type: 'pbkdf2'; c: number; hash: 'sha256' };

/** KDF block written into every new vault. */
const NEW_KDF: VaultKdf = { type: 'pbkdf2', c: PBKDF2_ITERS, hash: 'sha256' };

export interface EncryptedVault {
  v: 1;
  kdf: VaultKdf;
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

/** Derive the 32-byte AES key from the password + salt using the vault's KDF.
 *  PBKDF2 for new vaults; Argon2id only for legacy vaults that stored it. */
async function deriveKey(password: string, salt: Uint8Array, kdf: VaultKdf): Promise<Uint8Array> {
  if (kdf.type === 'pbkdf2') {
    return pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: kdf.c, dkLen: KEY_BYTES });
  }
  // Legacy Argon2id path — only hit by vaults predating the PBKDF2 switch.
  return argon2idAsync(utf8ToBytes(password), salt, {
    t: kdf.t, m: kdf.m, p: kdf.p, dkLen: KEY_BYTES,
  });
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/** Encrypt + write the vault to expo-secure-store. */
export async function createVault(mnemonic: string, password: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv   = randomBytes(12);
  const key  = await deriveKey(password, salt, NEW_KDF);
  const ct   = gcm(key, iv).encrypt(utf8ToBytes(mnemonic));
  const vault: EncryptedVault = {
    v: 1,
    kdf: NEW_KDF,
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
    // Use the vault's OWN kdf params so it always decrypts with what it was
    // created with (vaults predating the mobile param change still unlock).
    const key  = await deriveKey(password, salt, vault.kdf);
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
  await AsyncStorage.multiRemove([LEGACY_HAS, LEGACY_MNEM, LEGACY_PWD, LEGACY_UNLOCK, SEED_BACKED_UP]);
}

/* ─── Recovery-phrase backup flag ───────────────────────────────────────── */
/** True once the user has recorded their recovery phrase on this device.
 *  Set after the create-flow verification step / on import; absent for
 *  legacy/migrated vaults (which then get a backup nudge). */
export async function isSeedBackedUp(): Promise<boolean> {
  return (await AsyncStorage.getItem(SEED_BACKED_UP)) === '1';
}
export async function setSeedBackedUp(backedUp: boolean): Promise<void> {
  if (backedUp) await AsyncStorage.setItem(SEED_BACKED_UP, '1');
  else          await AsyncStorage.removeItem(SEED_BACKED_UP);
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
