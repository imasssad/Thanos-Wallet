/**
 * Encrypted mnemonic vault.
 *
 * On disk (localStorage):
 *   thanos.vault    — JSON: { v, kdf params, salt, iv, ciphertext }
 *   thanos.has_vault — quick existence flag (mirrors the legacy key)
 *
 * In memory only (sessionStorage):
 *   thanos.session_key — 32-byte AES key (hex). Cleared on tab close.
 *   Lets a page refresh decrypt without prompting for the password again,
 *   but a cold-open browser/tab REQUIRES the password.
 *
 * Crypto:
 *   - Key derivation:   Argon2id (t=3, m=64MB, p=4)        — matches services/api
 *   - Encryption:       AES-256-GCM (12-byte random IV)    — authenticated
 *   - Wrong password:   GCM tag mismatch -> decrypt throws -> we return null
 *
 * Storage size: vault is ~280 bytes encoded.
 */

import { argon2id } from 'hash-wasm';

/* ─── On-disk format ─────────────────────────────────────────────────────── */
export interface EncryptedVault {
  v: 1;
  /** Argon2id params (so we can change them later without breaking old vaults) */
  kdf: { type: 'argon2id'; t: number; m: number; p: number };
  /** All bytes hex-encoded so localStorage can JSON-serialise cleanly. */
  salt:       string;
  iv:         string;
  ciphertext: string;
}

const STORAGE_KEYS = {
  vault:      'thanos.vault',
  hasVault:   'thanos.has_vault',
  sessionKey: 'thanos.session_key',
  /* Set once the user has provably recorded their recovery phrase: after
     the create-flow verification step, or on import (they already hold
     it). Absent for legacy/migrated vaults, which then get a backup nudge. */
  seedBackedUp: 'thanos.seed_backed_up',
  /* Legacy keys we migrate from on first load (then clear). */
  legacyMnemonic: 'thanos.mnemonic',
  legacyPassword: 'thanos.password',
  legacyUnlocked: 'thanos.unlocked',
} as const;

/* Argon2id params — LOCAL device vault. Lowered from 64 MiB / t=3 / p=4 —
   which matched the API's server-side password hash but made wallet create/
   unlock take several seconds — to the OWASP mobile baseline. hash-wasm's
   Argon2 at these params is sub-second. Sound here: a second layer over
   browser storage. Old vaults still decrypt — openVault derives with each
   vault's OWN stored kdf params, so this only affects NEW vaults. */
const ARGON2_T = 2;          // iterations
const ARGON2_M_KB = 19456;   // 19 MiB
const ARGON2_P = 1;          // parallel lanes

/* ─── Hex helpers (avoids Buffer in browser bundle) ─────────────────────── */
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error('vault: odd-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/* ─── Argon2id derivation ───────────────────────────────────────────────── */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  params: { t: number; m: number; p: number } = { t: ARGON2_T, m: ARGON2_M_KB, p: ARGON2_P },
): Promise<Uint8Array> {
  const hashHex = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations:  params.t,
    memorySize:  params.m,
    hashLength:  32,
    outputType:  'hex',
  });
  return hexToBytes(hashHex);
}

/* ─── AES-256-GCM encrypt / decrypt ─────────────────────────────────────── */
async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/** Encrypt a mnemonic string with the user's password. */
export async function createVault(mnemonic: string, password: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv   = randomBytes(12);
  const keyBytes = await deriveKey(password, salt);
  const aes = await importAesKey(keyBytes);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aes,
    new TextEncoder().encode(mnemonic) as BufferSource,
  );
  return {
    v: 1,
    kdf: { type: 'argon2id', t: ARGON2_T, m: ARGON2_M_KB, p: ARGON2_P },
    salt:       bytesToHex(salt),
    iv:         bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ct)),
  };
}

/**
 * Decrypt with the user's password. Returns the mnemonic, or null if the
 * password is wrong (AES-GCM auth-tag mismatch).
 *
 * Also returns the raw AES key bytes so the caller can session-cache them
 * for the "refresh doesn't re-prompt" UX.
 */
export async function openVault(
  vault: EncryptedVault,
  password: string,
): Promise<{ mnemonic: string; key: Uint8Array } | null> {
  if (vault.v !== 1) throw new Error(`vault: unsupported version ${vault.v}`);
  const salt = hexToBytes(vault.salt);
  // Derive with the vault's OWN kdf params so a vault made at the old 64 MiB
  // cost still unlocks; only NEW vaults use the lighter params above.
  const keyBytes = await deriveKey(password, salt, vault.kdf);
  try {
    const aes = await importAesKey(keyBytes);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(vault.iv) as BufferSource },
      aes,
      hexToBytes(vault.ciphertext) as BufferSource,
    );
    return { mnemonic: new TextDecoder().decode(pt), key: keyBytes };
  } catch {
    return null; // wrong password / tampered vault
  }
}

/** Decrypt with a session-cached raw AES key (refresh case). */
export async function openVaultWithKey(
  vault: EncryptedVault,
  keyBytes: Uint8Array,
): Promise<string | null> {
  try {
    const aes = await importAesKey(keyBytes);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(vault.iv) as BufferSource },
      aes,
      hexToBytes(vault.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/* ─── Storage layer ─────────────────────────────────────────────────────── */
export function saveVault(vault: EncryptedVault): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(vault));
  localStorage.setItem(STORAGE_KEYS.hasVault, '1');
}

export function loadVault(): EncryptedVault | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEYS.vault);
  if (!raw) return null;
  try { return JSON.parse(raw) as EncryptedVault; } catch { return null; }
}

export function clearVault(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.vault);
  localStorage.removeItem(STORAGE_KEYS.hasVault);
  localStorage.removeItem(STORAGE_KEYS.seedBackedUp);
  localStorage.removeItem(STORAGE_KEYS.legacyMnemonic);
  localStorage.removeItem(STORAGE_KEYS.legacyPassword);
  localStorage.removeItem(STORAGE_KEYS.legacyUnlocked);
  clearSessionKey();
}

/* ─── Recovery-phrase backup flag ───────────────────────────────────────── */
/** True once the user has recorded their recovery phrase on this device. */
export function isSeedBackedUp(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEYS.seedBackedUp) === '1';
}
export function setSeedBackedUp(backedUp: boolean): void {
  if (typeof window === 'undefined') return;
  if (backedUp) localStorage.setItem(STORAGE_KEYS.seedBackedUp, '1');
  else          localStorage.removeItem(STORAGE_KEYS.seedBackedUp);
}

/* ─── Multi-account derivation index ────────────────────────────────
   All accounts share the same vault (one seed); different "accounts"
   are different HD-path indices: m/44'/60'/0'/0/{idx}. Tracks the
   *active* index (the one the wallet derives + signs from) and the
   user's accountCount. Defaults to 0 / 1 on a fresh install. */
const STORAGE_KEY_ACTIVE_IDX = 'thanos.active_account_idx';
const STORAGE_KEY_ACCT_COUNT = 'thanos.account_count';
export const MAX_ACCOUNTS = 10;

export function getActiveAccountIndex(): number {
  if (typeof window === 'undefined') return 0;
  const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_IDX);
  const n = Number.parseInt(raw ?? '0', 10);
  if (!Number.isFinite(n) || n < 0 || n >= MAX_ACCOUNTS) return 0;
  return n;
}
export function setActiveAccountIndex(idx: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  localStorage.setItem(STORAGE_KEY_ACTIVE_IDX, String(idx));
}
export function getAccountCount(): number {
  if (typeof window === 'undefined') return 1;
  const raw = localStorage.getItem(STORAGE_KEY_ACCT_COUNT);
  const n = Number.parseInt(raw ?? '1', 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_ACCOUNTS) return 1;
  return n;
}
export function setAccountCount(n: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) return;
  localStorage.setItem(STORAGE_KEY_ACCT_COUNT, String(n));
}

/* ─── Session key cache (refresh persistence, NOT cold-open) ────────────── */
export function cacheSessionKey(key: Uint8Array): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEYS.sessionKey, bytesToHex(key));
}
export function getSessionKey(): Uint8Array | null {
  if (typeof window === 'undefined') return null;
  const hex = sessionStorage.getItem(STORAGE_KEYS.sessionKey);
  if (!hex) return null;
  try { return hexToBytes(hex); } catch { return null; }
}
export function clearSessionKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEYS.sessionKey);
}

/* ─── Migration from plaintext (legacy) ─────────────────────────────────── */

/** Returns true if the legacy plaintext keys are still present. */
export function hasLegacyPlaintext(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEYS.legacyMnemonic) !== null
      && localStorage.getItem(STORAGE_KEYS.legacyPassword) !== null;
}

/**
 * One-shot upgrade from the old plaintext storage scheme to an encrypted vault.
 * No prompt required — the password was already in localStorage. Once the
 * vault exists, the plaintext keys are wiped.
 */
export async function migrateLegacyPlaintext(): Promise<{ ok: boolean; key?: Uint8Array }> {
  if (typeof window === 'undefined') return { ok: false };
  const mnemonic = localStorage.getItem(STORAGE_KEYS.legacyMnemonic);
  const password = localStorage.getItem(STORAGE_KEYS.legacyPassword);
  if (!mnemonic || !password) return { ok: false };

  const vault = await createVault(mnemonic, password);
  saveVault(vault);

  // Derive the key once more so the caller can session-cache it (matches the
  // previous "auto-unlocked on refresh" behaviour for users mid-migration).
  const opened = await openVault(vault, password);

  // Wipe plaintext.
  localStorage.removeItem(STORAGE_KEYS.legacyMnemonic);
  localStorage.removeItem(STORAGE_KEYS.legacyPassword);
  localStorage.removeItem(STORAGE_KEYS.legacyUnlocked);

  return { ok: true, key: opened?.key };
}

/** Exported for tests / outside callers. */
export const VAULT_STORAGE_KEYS = STORAGE_KEYS;
