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
// argon2idAsync is lazy-imported inside deriveKey (legacy branch only) so the
// Blake2b/Argon2 core isn't parsed at cold start — new vaults are all PBKDF2.
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  FIRST_WALLET_ID, walletKey, currentWalletId, loadAccountsFromStorage,
  forgetWalletSettings, forgetAddedWallets, setWalletOrigin, readWalletAccounts,
  getAccountCount, setAccountCount, setActiveAccountIndex, getVisibleAccountIndices,
  MAX_ACCOUNTS, type WalletOrigin,
} from './accounts';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const VAULT_KEY      = 'thanos_vault_v1';   // SecureStore key (no dots — SecureStore disallows them)
const LEGACY_HAS     = 'thanos.has_vault';  // AsyncStorage (legacy)
const LEGACY_MNEM    = 'thanos.mnemonic';
const LEGACY_PWD     = 'thanos.password';
const LEGACY_UNLOCK  = 'thanos.unlocked';
const SEED_BACKED_UP = 'thanos.seed_backed_up'; // AsyncStorage flag

// KDF for NEW vaults: PBKDF2-HMAC-SHA256 with a per-DEVICE auto-calibrated
// iteration count.
//
// React Native (Hermes) has NO native WebCrypto, so the KDF runs in pure JS,
// and Hermes speed varies ~100x between phones. A FIXED count is therefore
// either insecure (low) or unusable (high): a fixed 600k took 2-4 MINUTES on a
// low-end phone (real device report) and got the app killed, yet is sub-second
// on a fast one. So at wallet creation we benchmark the device and pick a count
// targeting ~1s, floored at the NIST minimum and capped so fast phones don't
// over-spin. The chosen count is stored in the vault's kdf block, so unlock
// reproduces the same key. The vault is also wrapped in the OS hardware keystore
// (expo-secure-store: Secure Enclave / Android Keystore), so the password KDF is
// a second layer over hardware-backed storage. (A native-crypto module would
// derive in ~100ms like web/extension but needs a native rebuild + a new dep;
// this pure-JS adaptive path is reliable with no new module.) Legacy Argon2id /
// fixed-600k vaults still decrypt via their own stored kdf block.
const PBKDF2_TARGET_MS = 900;      // aim derivation at ~0.9s on the creating device (hardware keystore backstops; NIST floor still applies)
// Hardening-audit M-1: THN-R1 M-06 raised the old 10,000 floor 5x to
// 50,000 but flagged that OWASP's current PBKDF2-HMAC-SHA256
// recommendation is 210,000+, and that this file had no real low-end-phone
// measurement to say how far the calibrated budget could be pushed. Per
// the audit's own fix note ("floor of at least 210k ... Restore from the
// recovery phrase"), the floor is raised to meet that line: a device too
// slow to clear it in the ~0.9s target still gets 210k (just a slower
// unlock) rather than a weaker vault, and anyone who can't live with that
// unlock time still has the recovery phrase to fall back to, same as any
// other vault-loss path this app already supports.
const PBKDF2_MIN_ITERS = 210_000;
const PBKDF2_MAX_ITERS = 600_000;  // OWASP target ceiling
const KEY_BYTES = 32;              // AES-256

/* ─── On-disk format ────────────────────────────────────────────────────── */
export type VaultKdf =
  | { type: 'argon2id'; t: number; m: number; p: number }
  | { type: 'pbkdf2'; c: number; hash: 'sha256' };

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
  // Lazy-imported so it stays off the cold-start eval graph.
  const { argon2idAsync } = await import('@noble/hashes/argon2.js');
  return argon2idAsync(utf8ToBytes(password), salt, {
    t: kdf.t, m: kdf.m, p: kdf.p, dkLen: KEY_BYTES,
  });
}

/** Benchmark this device and pick a PBKDF2 iteration count targeting
 *  ~PBKDF2_TARGET_MS, clamped to [MIN, MAX]. Run once at vault creation; the
 *  count is stored in the vault so unlock reproduces the key. A small probe
 *  measures throughput, then we extrapolate (PBKDF2 is linear in iterations). */
async function calibratePbkdf2Iters(): Promise<number> {
  const PROBE = 3000;
  const t0 = Date.now();
  await pbkdf2Async(sha256, utf8ToBytes('thanos-kdf-calibration'), new Uint8Array(16), { c: PROBE, dkLen: KEY_BYTES });
  const dt = Math.max(1, Date.now() - t0);
  const target = Math.round((PROBE / dt) * PBKDF2_TARGET_MS);
  return Math.min(PBKDF2_MAX_ITERS, Math.max(PBKDF2_MIN_ITERS, target));
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/** Encrypt + write the vault to expo-secure-store. */
export async function createVault(mnemonic: string, password: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv   = randomBytes(12);
  // Tune the iteration count to THIS device (~1s), then store it in the vault.
  const kdf: VaultKdf = { type: 'pbkdf2', c: await calibratePbkdf2Iters(), hash: 'sha256' };
  const key  = await deriveKey(password, salt, kdf);
  const ct   = gcm(key, iv).encrypt(utf8ToBytes(mnemonic));
  const vault: EncryptedVault = {
    v: 1,
    kdf,
    salt:       bytesToHex(salt),
    iv:         bytesToHex(iv),
    ciphertext: bytesToHex(ct),
  };
  await saveVault(vault);
  // Cache the freshly derived key so the caller can skip a second derivation.
  cacheSessionKey(key);
  return vault;
}

async function saveVault(vault: EncryptedVault): Promise<void> {
  // keychainAccessible AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (hardening-audit
  // M-1): the vault must still survive a device REBOOT and be readable at
  // app launch, so AFTER_FIRST_UNLOCK stays — but the *_THIS_DEVICE_ONLY
  // variant additionally keeps the wrapping key out of iCloud/Android
  // encrypted-backup restores to a DIFFERENT device. That used to let a
  // stolen/cloned backup carry the blob off-device, where it was only as
  // strong as the password-derived KDF (M-1's other half, above). Losing
  // this device no longer means losing the wallet either way: the same
  // recovery phrase this app already asks every wallet to back up restores
  // it on a new install, same as it would after any other vault loss.
  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(vault), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
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

/** Wipe the vault + session key + any leftover legacy plaintext — every
 *  wallet in it, and the settings of the wallets added after the first. */
export async function clearVault(): Promise<void> {
  clearSessionKey();
  try { await SecureStore.deleteItemAsync(VAULT_KEY); } catch {}
  await AsyncStorage.multiRemove([LEGACY_HAS, LEGACY_MNEM, LEGACY_PWD, LEGACY_UNLOCK, SEED_BACKED_UP]);
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove([ACTIVE_WALLET, ...keys.filter((k) => k.startsWith(`${SEED_BACKED_UP}@`))]);
  } catch { /* best-effort */ }
  await forgetAddedWallets();
}

/* ─── Recovery-phrase backup flag ───────────────────────────────────────── */
/** True once the user has recorded their recovery phrase on this device.
 *  Set after the create-flow verification step / on import; absent for
 *  legacy/migrated vaults (which then get a backup nudge). Per wallet — the
 *  open one unless `walletId` names another. */
export async function isSeedBackedUp(walletId?: string): Promise<boolean> {
  return (await AsyncStorage.getItem(walletKey(SEED_BACKED_UP, walletId ?? currentWalletId()))) === '1';
}
export async function setSeedBackedUp(backedUp: boolean): Promise<void> {
  const key = walletKey(SEED_BACKED_UP, currentWalletId());
  if (backedUp) await AsyncStorage.setItem(key, '1');
  else          await AsyncStorage.removeItem(key);
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

/* ─── Legacy heavy-KDF migration (Argon2id → calibrated PBKDF2) ──────────── */

/** True if this vault uses pure-JS Argon2id (t=3, m=64MB) — which blocks the
 *  Hermes JS thread for many seconds to MINUTES on real devices (the "app shows
 *  blank for 2-4 min on open" report). Such vaults should be re-encrypted to a
 *  device-calibrated PBKDF2 vault after a successful unlock. */
export function isHeavyLegacyKdf(vault: EncryptedVault): boolean {
  return vault.kdf.type === 'argon2id';
}

/** After a successful unlock, transparently re-encrypt the vault as a freshly
 *  device-calibrated PBKDF2 vault (~0.6s unlock) using the plaintext mnemonic +
 *  password already in hand — so the NEXT unlock is fast instead of minutes.
 *  Best-effort: any failure leaves the original (still-working) vault intact.
 *  `mnemonic` is the vault's whole plaintext (every wallet); if a wallet was
 *  added since the unlock, the newer plaintext is the one re-encrypted. */
export async function upgradeVaultKdf(mnemonic: string, password: string): Promise<void> {
  await serial(async () => {
    try {
      const key = sessionKey;
      const vault = key ? await loadVault() : null;
      const latest = key && vault ? await openVaultWithKey(vault, key) : null;
      await createVault(latest ?? mnemonic, password);
    } catch { /* keep the existing vault */ }
  });
}

/* ─── Several wallets in one vault ───────────────────────────────────────
 * Same model and plaintext format as the extension (apps/extension/src/lib/
 * vault.ts). The encrypted plaintext is either one secret — a phrase or a 0x
 * key: every vault made before multi-wallet, and any vault that has only
 * ever held one wallet — or a wallet set: JSON { format: 'thanos.wallets/1',
 * wallets: [{ id, name, secret }] }. One password and one AES key cover them
 * all: adding, renaming or removing a wallet re-encrypts under the session
 * key (same KDF and salt, fresh IV), so the password — and the key stashed
 * for biometric unlock — keep working.
 *
 * The first wallet is 'w0'. A set holding only w0 is written as its bare
 * secret, so an existing install's vault is never rewritten until a second
 * wallet is added, and a single-wallet vault stays exactly what earlier app
 * versions open. Each wallet's settings (accounts, names, backup flag) live
 * in AsyncStorage under the original keys for w0 and `<key>@<walletId>` for
 * the others (lib/accounts.ts walletKey). Which wallet is open is remembered
 * in thanos.active_wallet — an id, not a secret — and each wallet's public
 * metadata (created / imported, its accounts' addresses) in thanos.wallet_meta. */
export interface StoredWallet { id: string; name: string; secret: string }
export interface WalletSet { wallets: StoredWallet[] }
export interface WalletInfo { id: string; name: string; kind: 'phrase' | 'key' }

const WALLET_SET_FORMAT = 'thanos.wallets/1';
const ACTIVE_WALLET = 'thanos.active_wallet'; // AsyncStorage
export const MAX_WALLETS = 10;
export const MAX_WALLET_NAME_LEN = 24;
const LOCKED_ERR = 'The wallet is locked — unlock it and try again.';
const SAVE_ERR = 'Couldn’t save to secure storage — nothing was changed. Try again.';

/* Wallet-set writes run one at a time: each re-reads the vault, so two
   overlapping changes (or the post-unlock KDF upgrade) can't drop a wallet. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function isPrivateKeyString(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}

export function parseWalletSet(plaintext: string): WalletSet {
  const t = plaintext.trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as { format?: unknown; wallets?: unknown };
      if (o.format === WALLET_SET_FORMAT && Array.isArray(o.wallets)) {
        const wallets = o.wallets.filter((w): w is StoredWallet =>
          !!w && typeof (w as StoredWallet).id === 'string' && typeof (w as StoredWallet).secret === 'string'
          && (w as StoredWallet).secret.trim() !== '',
        ).map(w => ({ id: w.id, name: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'Wallet', secret: w.secret.trim() }));
        if (wallets.length) return { wallets };
      }
    } catch { /* not a wallet set — a plain secret */ }
  }
  // A plain secret: the vault's one wallet, exactly as stored.
  return { wallets: [{ id: FIRST_WALLET_ID, name: 'Wallet 1', secret: plaintext }] };
}

/** A set holding only the first wallet is written as its bare secret, the
 *  format every earlier version of the app can still open. */
export function serializeWalletSet(set: WalletSet): string {
  if (set.wallets.length === 1 && set.wallets[0].id === FIRST_WALLET_ID) return set.wallets[0].secret;
  return JSON.stringify({ format: WALLET_SET_FORMAT, wallets: set.wallets });
}

export const walletInfo = (w: StoredWallet): WalletInfo => ({
  id: w.id, name: w.name, kind: isPrivateKeyString(w.secret) ? 'key' : 'phrase',
});

/** Normalise a secret so the same wallet imported twice compares equal. */
export function normaliseSecret(raw: string): string {
  const s = raw.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return (s.startsWith('0x') ? s : `0x${s}`).toLowerCase();
  return s.toLowerCase().split(/\s+/).join(' ');
}

/** Open a wallet of an unlocked set — `id`, else the remembered one, else
 *  the first. Its settings are loaded into lib/accounts before this
 *  resolves, and the choice is remembered for the next unlock. */
export async function selectWallet(set: WalletSet, id?: string): Promise<StoredWallet> {
  let want = id;
  if (want === undefined) {
    try { want = (await AsyncStorage.getItem(ACTIVE_WALLET)) ?? undefined; } catch { /* first wallet */ }
  }
  const w = set.wallets.find(x => x.id === want) ?? set.wallets[0];
  try {
    // The first wallet is the default when nothing is stored, so a
    // single-wallet install never gains the key.
    if (w.id === FIRST_WALLET_ID) await AsyncStorage.removeItem(ACTIVE_WALLET);
    else await AsyncStorage.setItem(ACTIVE_WALLET, w.id);
  } catch { /* opens the first wallet next time */ }
  await loadAccountsFromStorage(w.id);
  return w;
}

/** Unlocked vault plaintext → the wallet to open (see selectWallet). */
export async function openWallet(plaintext: string): Promise<StoredWallet> {
  return selectWallet(parseWalletSet(plaintext));
}

interface OpenSet { vault: EncryptedVault; key: Uint8Array; set: WalletSet }
async function openSet(): Promise<OpenSet | null> {
  const key = sessionKey;
  const vault = key ? await loadVault() : null;
  if (!key || !vault) return null;
  const pt = await openVaultWithKey(vault, key);
  return pt === null ? null : { vault, key, set: parseWalletSet(pt) };
}

/** Re-encrypt new plaintext under the same password-derived key (same KDF and
 *  salt, fresh IV), then read it back: unless the stored vault decrypts to
 *  exactly that plaintext, the previous vault is put back and false returned. */
async function writePlaintext(o: OpenSet, plaintext: string): Promise<boolean> {
  try {
    const iv = randomBytes(12);
    const ct = gcm(o.key, iv).encrypt(utf8ToBytes(plaintext));
    await saveVault({ ...o.vault, iv: bytesToHex(iv), ciphertext: bytesToHex(ct) });
    const back = await loadVault();
    if (back && (await openVaultWithKey(back, o.key)) === plaintext) return true;
  } catch { /* restore below */ }
  try { await saveVault(o.vault); } catch { /* the keystore refused both writes */ }
  return false;
}

export async function listWallets(): Promise<{ wallets: WalletInfo[]; activeId: string } | null> {
  const o = await openSet();
  if (!o) return null;
  const active = o.set.wallets.find(w => w.id === currentWalletId()) ?? o.set.wallets[0];
  return { wallets: o.set.wallets.map(walletInfo), activeId: active.id };
}

/** Add another wallet (a new or imported phrase, or a private key) to the
 *  vault and open it on its first account. The user holds its secret — it
 *  was just created and verified, or imported — so it counts as backed up.
 *  `origin` labels it in the account sheet (a private key is always imported). */
export async function addWallet(rawSecret: string, name?: string, origin: WalletOrigin = 'imported'): Promise<{ wallet: StoredWallet } | { error: string }> {
  return serial(async () => {
    const o = await openSet();
    if (!o) return { error: LOCKED_ERR };
    const secret = normaliseSecret(rawSecret);
    const existing = o.set.wallets.find(w => normaliseSecret(w.secret) === secret);
    if (existing) return { error: `This wallet is already in Thanos (“${existing.name}”).` };
    if (o.set.wallets.length >= MAX_WALLETS) return { error: `Thanos holds up to ${MAX_WALLETS} wallets.` };
    const taken = new Set(o.set.wallets.map(w => w.name));
    let n = o.set.wallets.length + 1;
    while (taken.has(`Wallet ${n}`)) n++;
    let id = `w${bytesToHex(randomBytes(4))}`;
    while (id === FIRST_WALLET_ID || o.set.wallets.some(w => w.id === id)) id = `w${bytesToHex(randomBytes(4))}`;
    const wallet: StoredWallet = { id, name: name?.trim().slice(0, MAX_WALLET_NAME_LEN) || `Wallet ${n}`, secret };
    const set: WalletSet = { wallets: [...o.set.wallets, wallet] };
    if (!(await writePlaintext(o, serializeWalletSet(set)))) return { error: SAVE_ERR };
    await forgetWalletSettings(id); // nothing should be there — never inherit stale settings
    setWalletOrigin(id, isPrivateKeyString(secret) ? 'imported' : origin);
    await selectWallet(set, id);
    await setSeedBackedUp(true);
    return { wallet };
  });
}

/** Open another wallet already in the vault. */
export async function switchWallet(id: string): Promise<StoredWallet | null> {
  const o = await openSet();
  if (!o || !o.set.wallets.some(w => w.id === id)) return null;
  return selectWallet(o.set, id);
}

/** Open one account of any wallet in one step: that wallet (if it isn't the
 *  open one) and its account `idx` (if listed — else the wallet's own). */
export async function openAccount(id: string, idx: number): Promise<StoredWallet | null> {
  const o = await openSet();
  const w = o?.set.wallets.find(x => x.id === id);
  if (!o || !w) return null;
  if (id !== currentWalletId()) await selectWallet(o.set, id);
  if (!isPrivateKeyString(w.secret) && getVisibleAccountIndices().includes(idx)) setActiveAccountIndex(idx);
  return w;
}

/** Add the next derived account to a recovery-phrase wallet — any wallet in
 *  the vault, not only the open one — and open the wallet on it. Indices
 *  are never reused (a removed account stays hidden at its index). */
export async function addAccountToWallet(id: string): Promise<{ wallet: StoredWallet; idx: number } | { error: string }> {
  const o = await openSet();
  const w = o?.set.wallets.find(x => x.id === id);
  if (!o) return { error: LOCKED_ERR };
  if (!w) return { error: 'That wallet is not in Thanos.' };
  if (isPrivateKeyString(w.secret)) return { error: 'This wallet was imported from a private key, so it has just the one account.' };
  if ((await readWalletAccounts(id)).count >= MAX_ACCOUNTS) return { error: `A wallet holds up to ${MAX_ACCOUNTS} accounts.` };
  if (id !== currentWalletId()) await selectWallet(o.set, id);
  const idx = getAccountCount();
  setAccountCount(idx + 1);
  setActiveAccountIndex(idx);
  return { wallet: w, idx };
}

/** Rename a wallet. A lone first wallet is stored as its bare secret (no
 *  name), so it isn't renamed — names only tell several wallets apart. */
export async function renameWallet(id: string, name: string): Promise<boolean> {
  return serial(async () => {
    const o = await openSet();
    const trimmed = name.trim().slice(0, MAX_WALLET_NAME_LEN);
    if (!o || !trimmed || !o.set.wallets.some(w => w.id === id)) return false;
    const set: WalletSet = { wallets: o.set.wallets.map(w => (w.id === id ? { ...w, name: trimmed } : w)) };
    if (set.wallets.length === 1 && set.wallets[0].id === FIRST_WALLET_ID) return false;
    return writePlaintext(o, serializeWalletSet(set));
  });
}

/** Remove one wallet — never the last (deleting that is clearVault) — with
 *  its settings, and open the first remaining one if it was open. */
export async function removeWallet(id: string): Promise<{ next: StoredWallet } | { error: string }> {
  return serial(async () => {
    const o = await openSet();
    if (!o) return { error: LOCKED_ERR };
    if (o.set.wallets.length <= 1) return { error: 'This is the only wallet.' };
    const set: WalletSet = { wallets: o.set.wallets.filter(w => w.id !== id) };
    if (set.wallets.length === o.set.wallets.length) return { error: 'That wallet is not in Thanos.' };
    if (!(await writePlaintext(o, serializeWalletSet(set)))) return { error: SAVE_ERR };
    const wasOpen = currentWalletId() === id;
    if (wasOpen) await selectWallet(set, set.wallets[0].id);
    await AsyncStorage.removeItem(walletKey(SEED_BACKED_UP, id)).catch(() => {});
    await forgetWalletSettings(id);
    const next = set.wallets.find(w => w.id === currentWalletId()) ?? set.wallets[0];
    return { next };
  });
}

/** One wallet's secret, for the remove-wallet balance check (null when the
 *  wallet is locked or the id unknown). */
export async function readWalletSecret(id: string): Promise<string | null> {
  const o = await openSet();
  return o?.set.wallets.find(w => w.id === id)?.secret ?? null;
}
