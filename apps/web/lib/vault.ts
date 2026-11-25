/**
 * Encrypted mnemonic vault.
 *
 * On disk (localStorage):
 *   thanos.vault    — JSON: { v, kdf params, salt, iv, ciphertext }
 *   thanos.has_vault — quick existence flag (mirrors the legacy key)
 *
 * Per tab (sessionStorage):
 *   thanos.session_key — 32-byte AES key (hex). Lets a page refresh decrypt
 *   without prompting for the password again; a new tab or browser needs
 *   it. Cleared on lock (auto-lock included) and when the tab closes — but
 *   browsers may write session storage to disk for session restore
 *   (SECURITY.md, "Known limits").
 *
 * Crypto:
 *   - Key derivation:   PBKDF2-SHA256, 600,000 iterations for new vaults;
 *                       older vaults keep the Argon2id parameters stored
 *                       with them (t=3, m=64MB, p=4)
 *   - Encryption:       AES-256-GCM (12-byte random IV)    — authenticated
 *   - Wrong password:   GCM tag mismatch -> decrypt throws -> we return null
 *
 * Storage size: vault is ~280 bytes encoded per wallet. The plaintext is
 * one wallet, or a set of several — see "Several wallets in one vault".
 */

import { serializeSource, deserializeSource, type WalletSource } from './wallet-source';

// hash-wasm's Argon2 is now lazy-loaded (only to open a LEGACY argon2id
// vault) — new installs never pull the WASM module. New vaults derive their
// AES key with native WebCrypto PBKDF2 (see deriveKeyPbkdf2 below).

/* ─── On-disk format ─────────────────────────────────────────────────────── */
export type VaultKdf =
  | { type: 'pbkdf2';   c: number; hash: 'sha256' }
  | { type: 'argon2id'; t: number; m: number; p: number };

export interface EncryptedVault {
  v: 1;
  /** KDF that derived the AES key — stored so the vault always opens with the
   *  exact KDF it was created with. New vaults: pbkdf2. Legacy: argon2id. */
  kdf: VaultKdf;
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

/* New vaults derive the AES key with PBKDF2-HMAC-SHA256 via native WebCrypto
   (crypto.subtle) — ~50-100ms (native C++), no WASM module to load, and the
   same KDF family the mobile client uses. 600k iterations = OWASP 2023.
   Sound here: the vault is device-local AND already wrapped in browser
   storage, so the password KDF is a second layer. Legacy argon2id vaults
   still open via the lazy hash-wasm path below. */
const PBKDF2_ITERS = 600_000;
const KEY_BITS = 256; // AES-256

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
/** New vaults: native PBKDF2-HMAC-SHA256 via WebCrypto. */
async function deriveKeyPbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base, KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Legacy vaults only: Argon2id via hash-wasm, lazy-imported so new installs
 *  never load the WASM. Uses the vault's own stored params. */
async function deriveKeyArgon2(password: string, salt: Uint8Array, params: { t: number; m: number; p: number }): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm');
  const hashHex = await argon2id({
    password, salt,
    parallelism: params.p, iterations: params.t, memorySize: params.m,
    hashLength: 32, outputType: 'hex',
  });
  return hexToBytes(hashHex);
}

/** Derive the AES key for a vault's stored KDF block. */
async function deriveForKdf(password: string, salt: Uint8Array, kdf: VaultKdf): Promise<Uint8Array> {
  return kdf.type === 'pbkdf2'
    ? deriveKeyPbkdf2(password, salt, kdf.c)
    : deriveKeyArgon2(password, salt, kdf);
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
  const keyBytes = await deriveKeyPbkdf2(password, salt, PBKDF2_ITERS);
  const aes = await importAesKey(keyBytes);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aes,
    new TextEncoder().encode(mnemonic) as BufferSource,
  );
  return {
    v: 1,
    kdf: { type: 'pbkdf2', c: PBKDF2_ITERS, hash: 'sha256' },
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
  // Derive with the vault's OWN stored KDF (pbkdf2 for new vaults, argon2id
  // for legacy ones) so every vault unlocks with exactly what it was made with.
  const keyBytes = await deriveForKdf(password, salt, vault.kdf);
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

/** Decrypt with a session-cached key (refresh case) — either the raw bytes
 *  openVault() just derived, or the non-extractable CryptoKey getSessionKey()
 *  hands back (hardening-audit H-2: the session cache no longer holds raw
 *  bytes at all, see "Session key cache" below). */
export async function openVaultWithKey(
  vault: EncryptedVault,
  key: Uint8Array | CryptoKey,
): Promise<string | null> {
  try {
    const aes = key instanceof Uint8Array ? await importAesKey(key) : key;
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

/** Wipe the vault — every wallet in it — with the session key, the added
 *  wallets' settings, the wallet metadata and any leftover legacy plaintext.
 *  The first wallet's own account keys are left as they always were. */
export function clearVault(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.vault);
  localStorage.removeItem(STORAGE_KEYS.hasVault);
  localStorage.removeItem(STORAGE_KEYS.seedBackedUp);
  localStorage.removeItem(STORAGE_KEYS.legacyMnemonic);
  localStorage.removeItem(STORAGE_KEYS.legacyPassword);
  localStorage.removeItem(STORAGE_KEYS.legacyUnlocked);
  forgetAddedWallets();
  // The sessionStorage marker is dropped synchronously (before this async
  // call's first await runs); the IndexedDB delete behind it is best-effort
  // cleanup that doesn't need to block callers of this (sync) function.
  void clearSessionKey().catch(() => {});
}

/* ─── Several wallets in one vault ───────────────────────────────────────
 * Same model and wallet-set format as the phone app (apps/mobile/lib/
 * vault.ts) and the extension (apps/extension/src/lib/vault.ts). The
 * encrypted plaintext is either ONE wallet — what every web vault made
 * before multi-wallet holds: a WalletSource JSON ({ kind: 'mnemonic' |
 * 'privateKey', … }, lib/wallet-source.ts) or, for the very first vaults, a
 * bare phrase — or a wallet set: JSON { format: 'thanos.wallets/1',
 * wallets: [{ id, name, secret }] }, where each secret is the bare phrase or
 * 0x key, exactly as the phone and extension store it.
 *
 * One password and one AES key cover every wallet: adding, renaming or
 * removing one re-encrypts under the session key (same KDF and salt, fresh
 * IV), so the password keeps working. Every write is read back and must
 * decrypt to exactly what was written, or the previous vault is put back.
 *
 * The first wallet is 'w0'. A set holding only w0 is written in the web's
 * own single-wallet form (the WalletSource JSON), so an existing install's
 * vault is never rewritten until a second wallet is added, and a
 * single-wallet vault stays what every earlier web version opens.
 *
 * Each wallet's settings (active account, account count, names, hidden
 * accounts, backup flag) live in localStorage under the original keys for
 * w0 and `<key>@<walletId>` for the others (walletKey). Which wallet is open
 * is remembered in thanos.active_wallet — an id, never a secret — and each
 * wallet's public metadata (created / imported, its accounts' 0x addresses)
 * in thanos.wallet_meta. */
export interface StoredWallet { id: string; name: string; secret: string }
export interface WalletSet { wallets: StoredWallet[] }
export interface WalletInfo { id: string; name: string; kind: 'phrase' | 'key' }
export type WalletOrigin = 'created' | 'imported';

const WALLET_SET_FORMAT = 'thanos.wallets/1';
/** The wallet every vault starts with — and the only one any vault held
 *  before multi-wallet. Its settings keep the un-suffixed keys. */
export const FIRST_WALLET_ID = 'w0';
const STORAGE_KEY_ACTIVE_WALLET = 'thanos.active_wallet';
/** Public per-wallet metadata — never a secret. Same key and shape as the
 *  phone: { [walletId]: { origin?: 'created' | 'imported', addrs?: { [idx]: '0x…' } } } */
const STORAGE_KEY_WALLET_META = 'thanos.wallet_meta';
export const MAX_WALLETS = 10;
export const MAX_WALLET_NAME_LEN = 24;
const LOCKED_ERR = 'The wallet is locked — unlock it and try again.';
const SAVE_ERR = 'Couldn’t save to this browser’s storage — nothing was changed. Try again.';

/* The open wallet. Read lazily (never at import: the module also loads on
   the server, and before a test stubs localStorage). */
let openWalletId: string | null = null;
function storedActiveWalletId(): string {
  if (typeof window === 'undefined') return FIRST_WALLET_ID;
  try { return localStorage.getItem(STORAGE_KEY_ACTIVE_WALLET) || FIRST_WALLET_ID; } catch { return FIRST_WALLET_ID; }
}
/** The wallet whose settings the account functions read and write. */
export function currentWalletId(): string {
  if (openWalletId !== null) return openWalletId;
  if (typeof window === 'undefined') return FIRST_WALLET_ID;
  openWalletId = storedActiveWalletId();
  return openWalletId;
}

/** localStorage key for a wallet's copy of a per-wallet setting. */
export function walletKey(base: string, walletId: string = currentWalletId()): string {
  return walletId === FIRST_WALLET_ID ? base : `${base}@${walletId}`;
}

/* Wallet-set writes run one at a time: each re-reads the vault, so two
   overlapping changes can't drop a wallet. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/* ─── Private-key wallets ────────────────────────────────────────────
 * A wallet imported from a raw key holds the 0x-hex string where a phrase
 * wallet holds space-separated words. It is EVM-only and has exactly one
 * account. */
export function isPrivateKeyString(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}

/** The secret a wallet is opened with, as the signer takes it. */
export function walletSourceOf(secret: string): WalletSource {
  return isPrivateKeyString(secret)
    ? { kind: 'privateKey', privateKey: secret.trim() }
    : { kind: 'mnemonic', mnemonic: secret };
}

/** The one wallet of a single-wallet plaintext: a WalletSource JSON, a bare
 *  phrase (the first web vaults) or a bare 0x key. */
function secretOfPlaintext(plaintext: string): string {
  if (isPrivateKeyString(plaintext)) return plaintext.trim();
  const source = deserializeSource(plaintext);
  return source.kind === 'privateKey' ? source.privateKey : source.mnemonic;
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
    } catch { /* not a wallet set — one wallet */ }
  }
  // One wallet: the vault's first, exactly as stored.
  return { wallets: [{ id: FIRST_WALLET_ID, name: 'Wallet 1', secret: secretOfPlaintext(plaintext) }] };
}

/** A set holding only the first wallet is written in the web's single-wallet
 *  form, the format every earlier version of the website can still open. */
export function serializeWalletSet(set: WalletSet): string {
  if (set.wallets.length === 1 && set.wallets[0].id === FIRST_WALLET_ID) {
    return serializeSource(walletSourceOf(set.wallets[0].secret));
  }
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
 *  the first — and remember the choice for the next unlock. The account
 *  functions below follow it straight away. */
export function selectWallet(set: WalletSet, id?: string): StoredWallet {
  const want = id ?? storedActiveWalletId();
  const w = set.wallets.find(x => x.id === want) ?? set.wallets[0];
  openWalletId = w.id;
  if (typeof window !== 'undefined') {
    try {
      // The first wallet is the default when nothing is stored, so a
      // single-wallet install never gains the key.
      if (w.id === FIRST_WALLET_ID) localStorage.removeItem(STORAGE_KEY_ACTIVE_WALLET);
      else localStorage.setItem(STORAGE_KEY_ACTIVE_WALLET, w.id);
    } catch { /* opens the first wallet next time */ }
  }
  return w;
}

/** Unlocked vault plaintext → the wallet to open (see selectWallet). */
export function openWallet(plaintext: string): StoredWallet {
  return selectWallet(parseWalletSet(plaintext));
}

interface OpenSet { vault: EncryptedVault; key: CryptoKey; set: WalletSet }
async function openSet(): Promise<OpenSet | null> {
  const key = await getSessionKey();
  const vault = key ? loadVault() : null;
  if (!key || !vault) return null;
  const pt = await openVaultWithKey(vault, key);
  return pt === null ? null : { vault, key, set: parseWalletSet(pt) };
}

/** Re-encrypt new plaintext under the same password-derived key (same KDF
 *  and salt, fresh IV), then read it back: unless the stored vault decrypts
 *  to exactly that plaintext, the previous vault is put back and false is
 *  returned. */
async function writePlaintext(o: OpenSet, plaintext: string): Promise<boolean> {
  try {
    const iv = randomBytes(12);
    // o.key is already the non-extractable CryptoKey from the session cache
    // — no need to round-trip it through raw bytes to use it.
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource }, o.key, new TextEncoder().encode(plaintext) as BufferSource,
    );
    saveVault({ ...o.vault, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ct)) });
    const back = loadVault();
    if (back && (await openVaultWithKey(back, o.key)) === plaintext) return true;
  } catch { /* restore below */ }
  try { saveVault(o.vault); } catch { /* storage refused both writes */ }
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
 *  `origin` labels it in the wallet list (a private key is always imported). */
export async function addWallet(
  rawSecret: string, name?: string, origin: WalletOrigin = 'imported',
): Promise<{ wallet: StoredWallet } | { error: string }> {
  return serial(async () => {
    const o = await openSet();
    if (!o) return { error: LOCKED_ERR };
    const secret = normaliseSecret(rawSecret);
    if (!secret) return { error: 'There’s nothing to add.' };
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
    forgetWalletSettings(id); // nothing should be there — never inherit stale settings
    setWalletOrigin(id, isPrivateKeyString(secret) ? 'imported' : origin);
    selectWallet(set, id);
    setSeedBackedUp(true);
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
  if (id !== currentWalletId()) selectWallet(o.set, id);
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
  if (readWalletAccounts(id).count >= MAX_ACCOUNTS) return { error: `A wallet holds up to ${MAX_ACCOUNTS} accounts.` };
  if (id !== currentWalletId()) selectWallet(o.set, id);
  const idx = getAccountCount();
  setAccountCount(idx + 1);
  setActiveAccountIndex(idx);
  return { wallet: w, idx };
}

/** Rename a wallet. A lone first wallet is stored without a name, so it
 *  isn't renamed — names only tell several wallets apart. */
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
    if (currentWalletId() === id) selectWallet(set, set.wallets[0].id);
    forgetWalletSettings(id);
    const next = set.wallets.find(w => w.id === currentWalletId()) ?? set.wallets[0];
    return { next };
  });
}

/** One wallet's secret — for deriving its addresses and the remove-wallet
 *  balance check (null when the wallet is locked or the id unknown). */
export async function readWalletSecret(id: string): Promise<string | null> {
  const o = await openSet();
  return o?.set.wallets.find(w => w.id === id)?.secret ?? null;
}

/* ─── Recovery-phrase backup flag ───────────────────────────────────────── */
/** True once the user has recorded their recovery phrase on this device.
 *  Per wallet — the open one unless `walletId` names another. */
export function isSeedBackedUp(walletId?: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(walletKey(STORAGE_KEYS.seedBackedUp, walletId)) === '1';
}
export function setSeedBackedUp(backedUp: boolean): void {
  if (typeof window === 'undefined') return;
  const key = walletKey(STORAGE_KEYS.seedBackedUp);
  if (backedUp) localStorage.setItem(key, '1');
  else          localStorage.removeItem(key);
}

/* ─── Multi-account derivation index ────────────────────────────────
   A wallet's accounts share its seed — different "accounts" are different
   HD-path indices: m/44'/60'/0'/0/{idx}. Tracks the *active* index (the one
   the wallet derives + signs from) and the user's accountCount, per wallet
   (walletKey). Defaults to 0 / 1 on a fresh install. */
const STORAGE_KEY_ACTIVE_IDX = 'thanos.active_account_idx';
const STORAGE_KEY_ACCT_COUNT = 'thanos.account_count';
export const MAX_ACCOUNTS = 10;

function readIntIn(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback;
  const n = Number.parseInt(localStorage.getItem(key) ?? String(fallback), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function getActiveAccountIndex(): number {
  return readIntIn(walletKey(STORAGE_KEY_ACTIVE_IDX), 0, 0, MAX_ACCOUNTS - 1);
}
export function setActiveAccountIndex(idx: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  localStorage.setItem(walletKey(STORAGE_KEY_ACTIVE_IDX), String(idx));
}
export function getAccountCount(): number {
  return readIntIn(walletKey(STORAGE_KEY_ACCT_COUNT), 1, 1, MAX_ACCOUNTS);
}
export function setAccountCount(n: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) return;
  localStorage.setItem(walletKey(STORAGE_KEY_ACCT_COUNT), String(n));
}

/* ─── Account names (rename) ─────────────────────────────────────────────
   Same storage key + semantics as apps/mobile/lib/accounts.ts so a name set
   on one client reads identically on another. */
const STORAGE_KEY_ACCT_NAMES = 'thanos.account_names';
export const MAX_ACCOUNT_NAME_LEN = 24;

function readNames(walletId?: string): Record<number, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(walletKey(STORAGE_KEY_ACCT_NAMES, walletId));
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
  localStorage.setItem(walletKey(STORAGE_KEY_ACCT_NAMES), JSON.stringify(names));
}

/* ─── Account removal ────────────────────────────────────────────────────
   Accounts are HD-path indices, so an account CANNOT be spliced out: removing
   index 1 of 0..2 would slide index 2 down and silently change that account's
   address — funds would look like they vanished. Instead a removed account is
   recorded in a HIDDEN set; every index keeps deriving the same address
   forever, and the account simply stops being listed. Re-addable later. */
const STORAGE_KEY_ACCT_HIDDEN = 'thanos.account_hidden';

function readHidden(walletId?: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(walletKey(STORAGE_KEY_ACCT_HIDDEN, walletId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    return arr.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_ACCOUNTS);
  } catch { return []; }
}

export function getHiddenAccounts(): number[] {
  return readHidden();
}

export function isAccountHidden(idx: number): boolean {
  return getHiddenAccounts().includes(idx);
}

function visibleOf(count: number, hidden: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!hidden.includes(i)) out.push(i);
  return out.length ? out : [0];
}

/** Indices the UI should list, in order. Never empty — a wallet always
 *  keeps one account. */
export function getVisibleAccountIndices(): number[] {
  return visibleOf(getAccountCount(), getHiddenAccounts());
}

/** Hide (delete) an account. Refuses to remove the last visible one — a
 *  wallet must always have at least one account. Balance checks live in the
 *  UI, which is the only layer that can look up what the account holds. */
export function hideAccount(idx: number): boolean {
  if (typeof window === 'undefined') return false;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return false;
  const visible = getVisibleAccountIndices();
  if (visible.length <= 1 || !visible.includes(idx)) return false;
  const hidden = getHiddenAccounts();
  if (!hidden.includes(idx)) hidden.push(idx);
  localStorage.setItem(walletKey(STORAGE_KEY_ACCT_HIDDEN), JSON.stringify(hidden));
  // Never leave the wallet pointing at a removed account.
  if (getActiveAccountIndex() === idx) {
    const next = getVisibleAccountIndices()[0] ?? 0;
    setActiveAccountIndex(next);
  }
  return true;
}

/* ─── Every wallet's accounts (the wallet list) ──────────────────────── */

const PER_WALLET_KEYS = [
  STORAGE_KEY_ACTIVE_IDX, STORAGE_KEY_ACCT_COUNT, STORAGE_KEY_ACCT_NAMES, STORAGE_KEY_ACCT_HIDDEN,
  STORAGE_KEYS.seedBackedUp,
];

/** A wallet's accounts as the wallet list shows them. */
export interface WalletAccounts {
  /** Its active account (the one it opens on). */
  active: number;
  /** Listed (not hidden) indices, ascending. */
  visible: number[];
  /** How many indices have been provisioned (hidden ones included). */
  count: number;
  /** Custom names; the rest are "Account N". */
  names: Record<number, string>;
}

/** Any wallet's accounts, read from its own settings. */
export function readWalletAccounts(walletId: string): WalletAccounts {
  const count = readIntIn(walletKey(STORAGE_KEY_ACCT_COUNT, walletId), 1, 1, MAX_ACCOUNTS);
  const visible = visibleOf(count, readHidden(walletId));
  const idx = readIntIn(walletKey(STORAGE_KEY_ACTIVE_IDX, walletId), 0, 0, MAX_ACCOUNTS - 1);
  return { active: visible.includes(idx) ? idx : visible[0], visible, count, names: readNames(walletId) };
}

/* ─── Public per-wallet metadata (thanos.wallet_meta) ────────────────── */
interface WalletMeta { origin?: WalletOrigin; addrs?: Record<number, string> }

const isAddr = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v);

function readMeta(): Record<string, WalletMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WALLET_META);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { origin?: unknown; addrs?: Record<string, unknown> }>;
    const out: Record<string, WalletMeta> = {};
    for (const [id, m] of Object.entries(parsed)) {
      if (!m || typeof m !== 'object') continue;
      const meta: WalletMeta = {};
      if (m.origin === 'created' || m.origin === 'imported') meta.origin = m.origin;
      if (m.addrs && typeof m.addrs === 'object') {
        const addrs: Record<number, string> = {};
        for (const [k, v] of Object.entries(m.addrs)) {
          const i = Number.parseInt(k, 10);
          if (Number.isInteger(i) && i >= 0 && i < MAX_ACCOUNTS && isAddr(v)) addrs[i] = v;
        }
        meta.addrs = addrs;
      }
      out[id] = meta;
    }
    return out;
  } catch { return {}; }
}
function writeMeta(meta: Record<string, WalletMeta>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY_WALLET_META, JSON.stringify(meta)); } catch { /* best-effort cache */ }
}

/** Created in Thanos or imported — unknown for wallets from before this was recorded. */
export function getWalletOrigin(walletId: string): WalletOrigin | undefined {
  return readMeta()[walletId]?.origin;
}
export function setWalletOrigin(walletId: string, origin: WalletOrigin): void {
  const meta = readMeta();
  if (meta[walletId]?.origin === origin) return;
  meta[walletId] = { ...meta[walletId], origin };
  writeMeta(meta);
}

/** A wallet's known account addresses (0x) by HD index. */
export function getWalletAddresses(walletId: string): Record<number, string> {
  return { ...readMeta()[walletId]?.addrs };
}

/** Record derived account addresses (merged into what's known; public data). */
export function setWalletAddresses(walletId: string, addrs: Record<number, string>): void {
  const meta = readMeta();
  const known = meta[walletId]?.addrs ?? {};
  const next = { ...known };
  let changed = false;
  for (const [k, v] of Object.entries(addrs)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < MAX_ACCOUNTS && isAddr(v) && known[i] !== v) { next[i] = v; changed = true; }
  }
  if (!changed) return;
  meta[walletId] = { ...meta[walletId], addrs: next };
  writeMeta(meta);
}

/** Drop a removed wallet's settings and metadata. */
export function forgetWalletSettings(walletId: string): void {
  if (typeof window === 'undefined') return;
  const meta = readMeta();
  if (walletId in meta) {
    delete meta[walletId];
    writeMeta(meta);
  }
  for (const base of PER_WALLET_KEYS) localStorage.removeItem(walletKey(base, walletId));
}

/** Every wallet deleted from the device (clearVault): drop the added
 *  wallets' settings and all wallet metadata, and point back at the first
 *  wallet, whose own keys are left exactly as they always were. */
function forgetAddedWallets(): void {
  const added: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && PER_WALLET_KEYS.some(base => k.startsWith(`${base}@`))) added.push(k);
  }
  for (const k of added) localStorage.removeItem(k);
  localStorage.removeItem(STORAGE_KEY_WALLET_META);
  localStorage.removeItem(STORAGE_KEY_ACTIVE_WALLET);
  openWalletId = FIRST_WALLET_ID;
}

/* ─── Session key cache (refresh persistence, NOT cold-open) ─────────────
 * Hardening-audit H-2: this used to hex-encode the raw AES key into
 * sessionStorage, so any main-thread script (an HTML-injection bug slipping
 * past the CSP, say) could read the key with one synchronous
 * `sessionStorage.getItem`. A non-extractable CryptoKey closes that: its
 * structured clone carries no exportable key material, so IndexedDB — the
 * one storage API that can hold a CryptoKey at all — is what we cache it
 * in now; a script that reaches in gets an opaque key it can only USE
 * through our own decrypt calls, never read bytes out of.
 *
 * sessionStorage still has a role: a bare marker (no secret) under the same
 * key this used to hold the hex key. IndexedDB (unlike sessionStorage)
 * survives a tab close, so without it we'd leak the cached key past the
 * point this was ever meant to last; the marker reproduces the original
 * "gone when the tab closes" lifetime by telling getSessionKey() a fresh
 * tab has no business reading what's left in IndexedDB from a previous one.
 */
const SESSION_DB_NAME  = 'thanos-vault-session';
const SESSION_DB_STORE = 'keys';
const SESSION_DB_ENTRY = 'aes';

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SESSION_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(SESSION_DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function withSessionStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openSessionDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SESSION_DB_STORE, mode);
      const req = fn(tx.objectStore(SESSION_DB_STORE));
      tx.onerror     = () => reject(tx.error);
      tx.onabort     = () => reject(tx.error);
      tx.oncomplete  = () => resolve(req.result);
    });
  } finally {
    db.close();
  }
}

/** Cache the AES key for the rest of this tab's life. Takes the raw bytes
 *  openVault()/createVault() just derived — they're imported into a
 *  non-extractable CryptoKey here and only the CryptoKey is ever stored. */
export async function cacheSessionKey(rawKey: Uint8Array): Promise<void> {
  if (!hasIndexedDb()) return;
  const key = await importAesKey(rawKey);
  sessionStorage.setItem(STORAGE_KEYS.sessionKey, '1'); // tab-lifetime marker, not a secret
  await withSessionStore('readwrite', (store) => store.put(key, SESSION_DB_ENTRY));
}

/** The cached key, or null if this is a cold open (no cache), a fresh tab
 *  that inherited a previous tab's IndexedDB entry (no sessionStorage
 *  marker — treated the same as no cache and swept away), or IndexedDB is
 *  unavailable. */
export async function getSessionKey(): Promise<CryptoKey | null> {
  if (!hasIndexedDb()) return null;
  if (!sessionStorage.getItem(STORAGE_KEYS.sessionKey)) {
    await clearSessionKey(); // best-effort: drop any stale entry from a closed tab
    return null;
  }
  const key = await withSessionStore('readonly', (store) => store.get(SESSION_DB_ENTRY));
  return (key as CryptoKey | undefined) ?? null;
}

export async function clearSessionKey(): Promise<void> {
  sessionStorage.removeItem(STORAGE_KEYS.sessionKey);
  if (!hasIndexedDb()) return;
  await withSessionStore('readwrite', (store) => store.delete(SESSION_DB_ENTRY));
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
