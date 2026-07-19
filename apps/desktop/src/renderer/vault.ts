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
  /* Set once the user has provably recorded their recovery phrase (after
     the create-flow verification step, or on import). Absent for legacy/
     migrated vaults, which then get a backup nudge. */
  seedBackedUp: 'thanos.seed_backed_up',
  /* Legacy keys we migrate from on first load (then clear). */
  legacyMnemonic: 'thanos.mnemonic',
  legacyPassword: 'thanos.password',
  legacyUnlocked: 'thanos.unlocked',
} as const;

/* Argon2id params — match services/api/src/routes/auth.ts so the cost is
   identical to backend password verification. Tune here if mobile/web feel
   too slow on cold start. */
const ARGON2_T = 3;          // iterations
const ARGON2_M_KB = 64 * 1024; // 64 MiB
const ARGON2_P = 4;          // parallel lanes

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
async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const hashHex = await argon2id({
    password,
    salt,
    parallelism: ARGON2_P,
    iterations:  ARGON2_T,
    memorySize:  ARGON2_M_KB,
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
  const keyBytes = await deriveKey(password, salt);
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
  const json = JSON.stringify(vault);
  localStorage.setItem(STORAGE_KEYS.vault, json);
  localStorage.setItem(STORAGE_KEYS.hasVault, '1');
  // Durable backing: localStorage on the packaged file:// origin is NOT
  // persisted across app restarts, so the vault must also live in the OS
  // keychain (keytar). localStorage stays the fast synchronous read cache;
  // hydrateVaultFromKeychain() repopulates it from the keychain at boot.
  mirrorToKeychain(STORAGE_KEYS.vault, json);
  mirrorToKeychain(STORAGE_KEYS.hasVault, '1');
}

export function loadVault(): EncryptedVault | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEYS.vault);
  if (!raw) return null;
  try { return JSON.parse(raw) as EncryptedVault; } catch { return null; }
}

export function isSeedBackedUp(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEYS.seedBackedUp) === '1';
}
export function setSeedBackedUp(backedUp: boolean): void {
  if (typeof window === 'undefined') return;
  if (backedUp) { localStorage.setItem(STORAGE_KEYS.seedBackedUp, '1'); mirrorToKeychain(STORAGE_KEYS.seedBackedUp, '1'); }
  else          { localStorage.removeItem(STORAGE_KEYS.seedBackedUp); removeFromKeychain(STORAGE_KEYS.seedBackedUp); }
}

/* ─── Multi-account derivation index ─────────────────────────────── */
const STORAGE_KEY_ACTIVE_IDX = 'thanos.active_account_idx';
const STORAGE_KEY_ACCT_COUNT = 'thanos.account_count';
export const MAX_ACCOUNTS = 10;

export function getActiveAccountIndex(): number {
  if (typeof window === 'undefined') return 0;
  const n = Number.parseInt(localStorage.getItem(STORAGE_KEY_ACTIVE_IDX) ?? '0', 10);
  return Number.isFinite(n) && n >= 0 && n < MAX_ACCOUNTS ? n : 0;
}
export function setActiveAccountIndex(idx: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  localStorage.setItem(STORAGE_KEY_ACTIVE_IDX, String(idx));
  mirrorToKeychain(STORAGE_KEY_ACTIVE_IDX, String(idx));
}
export function getAccountCount(): number {
  if (typeof window === 'undefined') return 1;
  const n = Number.parseInt(localStorage.getItem(STORAGE_KEY_ACCT_COUNT) ?? '1', 10);
  return Number.isFinite(n) && n >= 1 && n <= MAX_ACCOUNTS ? n : 1;
}
export function setAccountCount(n: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) return;
  localStorage.setItem(STORAGE_KEY_ACCT_COUNT, String(n));
  mirrorToKeychain(STORAGE_KEY_ACCT_COUNT, String(n));
}

/* ─── Account names (rename) ─────────────────────────────────────────────
   Same storage key + 24-char cap as mobile/web/extension so a name set on one
   client reads identically on another. Mirrored to the keychain like the rest
   of the desktop account state. */
const STORAGE_KEY_ACCT_NAMES = 'thanos.account_names';
export const MAX_ACCOUNT_NAME_LEN = 24;

function readNames(): Record<number, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCT_NAMES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const i = Number.parseInt(k, 10);
      if (Number.isInteger(i) && i >= 0 && i < MAX_ACCOUNTS && typeof v === 'string' && v.trim()) {
        clean[i] = v.trim().slice(0, MAX_ACCOUNT_NAME_LEN);
      }
    }
    return clean;
  } catch { return {}; }
}

/** Display name — the user's custom name, else "Account N". */
export function getAccountName(idx: number): string {
  return readNames()[idx]?.trim() || `Account ${idx + 1}`;
}

/** The custom name only (null when the account uses the default). */
export function getCustomAccountName(idx: number): string | null {
  return readNames()[idx] ?? null;
}

/** Set (or clear, with an empty string) an account's custom name. */
export function setAccountName(idx: number, name: string): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  const names = readNames();
  const trimmed = name.trim().slice(0, MAX_ACCOUNT_NAME_LEN);
  if (trimmed) names[idx] = trimmed;
  else delete names[idx];
  const json = JSON.stringify(names);
  localStorage.setItem(STORAGE_KEY_ACCT_NAMES, json);
  mirrorToKeychain(STORAGE_KEY_ACCT_NAMES, json);
}

/* ─── Account removal ────────────────────────────────────────────────────
   Accounts are HD-path indices, so an account CANNOT be spliced out: removing
   index 1 of 0..2 would slide index 2 down and silently change that account's
   address — funds would look like they vanished. A removed account is instead
   recorded in a HIDDEN set; every index keeps deriving the same address
   forever and the account simply stops being listed. */
const STORAGE_KEY_ACCT_HIDDEN = 'thanos.account_hidden';

export function getHiddenAccounts(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCT_HIDDEN);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    return arr.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_ACCOUNTS);
  } catch { return []; }
}

export function isAccountHidden(idx: number): boolean {
  return getHiddenAccounts().includes(idx);
}

/** Indices the UI should list. Never empty — a wallet always keeps one. */
export function getVisibleAccountIndices(): number[] {
  const hidden = new Set(getHiddenAccounts());
  const out: number[] = [];
  for (let i = 0; i < getAccountCount(); i++) if (!hidden.has(i)) out.push(i);
  return out.length ? out : [0];
}

/** Hide (delete) an account. Refuses the last visible one. Balance checks
 *  live in the UI, the only layer that can price what the account holds. */
export function hideAccount(idx: number): boolean {
  if (typeof window === 'undefined') return false;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return false;
  const visible = getVisibleAccountIndices();
  if (visible.length <= 1 || !visible.includes(idx)) return false;
  const hidden = getHiddenAccounts();
  if (!hidden.includes(idx)) hidden.push(idx);
  const json = JSON.stringify(hidden);
  localStorage.setItem(STORAGE_KEY_ACCT_HIDDEN, json);
  mirrorToKeychain(STORAGE_KEY_ACCT_HIDDEN, json);
  if (getActiveAccountIndex() === idx) {
    setActiveAccountIndex(getVisibleAccountIndices()[0] ?? 0);
  }
  return true;
}

export function clearVault(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.vault);
  localStorage.removeItem(STORAGE_KEYS.hasVault);
  localStorage.removeItem(STORAGE_KEYS.seedBackedUp);
  localStorage.removeItem(STORAGE_KEYS.legacyMnemonic);
  localStorage.removeItem(STORAGE_KEYS.legacyPassword);
  localStorage.removeItem(STORAGE_KEYS.legacyUnlocked);
  localStorage.removeItem(STORAGE_KEY_ACTIVE_IDX);
  localStorage.removeItem(STORAGE_KEY_ACCT_COUNT);
  // Wipe the durable keychain copies too, or a "Reset wallet" would leave the
  // old vault behind and it would resurrect on the next launch's hydration.
  for (const key of DURABLE_KEYS) removeFromKeychain(key);
  clearSessionKey();
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

/* ─── Durable keychain backing (keytar via the preload bridge) ───────────────
 *
 * WHY: in the packaged desktop app the renderer loads from a file:// origin,
 * where Chromium does NOT persist localStorage across restarts — so the vault
 * (localStorage-only) vanished on every relaunch and the app fell back to the
 * onboarding screen ("create a new wallet every restart"). The OS keychain
 * (macOS Keychain / Windows Credential Vault via keytar) is the durable store;
 * the main process exposes it as vaultGet/vaultSet/vaultRemove on the preload
 * bridge. We keep localStorage as a synchronous read cache (so loadVault() et
 * al. stay sync and no call site changes) and mirror every durable write into
 * the keychain, then rehydrate localStorage FROM the keychain once at boot.
 */
const DURABLE_KEYS: readonly string[] = [
  STORAGE_KEYS.vault,
  STORAGE_KEYS.hasVault,
  STORAGE_KEYS.seedBackedUp,
  STORAGE_KEY_ACTIVE_IDX,
  STORAGE_KEY_ACCT_COUNT,
];

interface VaultBridge {
  vaultGet(key: string): Promise<string | null>;
  vaultSet(key: string, value: string): Promise<void>;
  vaultRemove(key: string): Promise<void>;
}
function keychain(): VaultBridge | null {
  if (typeof window === 'undefined') return null;
  const b = window.thanosDesktop;
  return b && typeof b.vaultGet === 'function' ? (b as VaultBridge) : null;
}

/** Fire-and-forget durable write. Never throws — the localStorage cache write
 *  has already happened, and keytar being briefly unavailable must not break
 *  the UI (it just costs durability until the next successful write). */
function mirrorToKeychain(key: string, value: string): void {
  keychain()?.vaultSet(key, value).catch(() => { /* durability best-effort */ });
}
function removeFromKeychain(key: string): void {
  keychain()?.vaultRemove(key).catch(() => { /* best-effort */ });
}

/**
 * Rehydrate localStorage from the OS keychain. MUST be awaited once at startup
 * BEFORE React mounts, so the synchronous loadVault()/hasVault reads in the
 * boot flow see the persisted vault. Also seeds the keychain from any existing
 * localStorage values (one-time upgrade for wallets created before this fix,
 * or in dev where localStorage did persist).
 */
export async function hydrateVaultFromKeychain(): Promise<void> {
  const kc = keychain();
  if (!kc || typeof window === 'undefined') return;
  await Promise.all(DURABLE_KEYS.map(async (key) => {
    try {
      const fromKeychain = await kc.vaultGet(key);
      if (fromKeychain != null) {
        localStorage.setItem(key, fromKeychain);        // keychain is source of truth
      } else {
        const fromLocal = localStorage.getItem(key);    // upgrade path: push local → keychain
        if (fromLocal != null) await kc.vaultSet(key, fromLocal).catch(() => {});
      }
    } catch { /* leave localStorage as-is for this key */ }
  }));
}
