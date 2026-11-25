/**
 * Encrypted mnemonic vault.
 *
 * On disk (localStorage, mirrored to the OS keychain — see DURABLE_KEYS):
 *   thanos.vault    — JSON: { v, kdf params, salt, iv, ciphertext }
 *   thanos.has_vault — quick existence flag (mirrors the legacy key)
 *
 * The plaintext is one secret (a phrase or a 0x key) or a set of several
 * wallets — the phone's and the extension's format, see "Several wallets in
 * one vault" below. Per-wallet settings: the first wallet under the keys
 * below, the others under `<key>@<walletId>`.
 *
 * In memory (sessionStorage):
 *   thanos.session_key — 32-byte AES key (hex). Lets a renderer reload
 *   decrypt without prompting for the password again; cleared on lock
 *   (auto-lock included), and Electron keeps no session storage across
 *   restarts, so launching the app REQUIRES the password.
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

/* ─── Storage keys ──────────────────────────────────────────────────────── */
const STORAGE_KEY_ACTIVE_IDX  = 'thanos.active_account_idx';
const STORAGE_KEY_ACCT_COUNT  = 'thanos.account_count';
const STORAGE_KEY_ACCT_NAMES  = 'thanos.account_names';
const STORAGE_KEY_ACCT_HIDDEN = 'thanos.account_hidden';
/** Which wallet of the vault is open — an id, never a secret. Absent while
 *  the first wallet is the open one, so a single-wallet install never gains it. */
const STORAGE_KEY_ACTIVE_WALLET = 'thanos.active_wallet';
/** Public per-wallet metadata — never a secret: how the wallet came in
 *  (created here / imported) and its accounts' derived 0x addresses, so the
 *  wallets panel can list every wallet's accounts without decrypting and
 *  re-deriving each one. { [walletId]: { origin?, addrs?: { [idx]: '0x…' } } }
 *  Same key and shape as apps/mobile/lib/accounts.ts. */
const STORAGE_KEY_WALLET_META = 'thanos.wallet_meta';

/** Settings each wallet keeps its own copy of: the first wallet under these
 *  keys (so existing installs keep theirs), every wallet added after it under
 *  `<key>@<walletId>` — the phone's and the extension's scheme. */
const PER_WALLET_KEYS: readonly string[] = [
  STORAGE_KEYS.seedBackedUp,
  STORAGE_KEY_ACTIVE_IDX,
  STORAGE_KEY_ACCT_COUNT,
  STORAGE_KEY_ACCT_NAMES,
  STORAGE_KEY_ACCT_HIDDEN,
];

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

/** Write a durable setting: the localStorage cache, mirrored to the keychain. */
function store(key: string, value: string): void {
  localStorage.setItem(key, value);
  mirrorToKeychain(key, value);
}
function unstore(key: string): void {
  localStorage.removeItem(key);
  removeFromKeychain(key);
}

/* ─── Private-key wallets ────────────────────────────────────────────
 * A wallet imported from a raw key stores the 0x-hex string where a
 * mnemonic wallet stores space-separated words. `seed` in the renderer
 * is always string[]: [word, word, …] for HD, ['0x…64'] for a PK wallet.
 * A PK wallet is EVM-only (a bare secp256k1 key can't derive BTC/SOL/
 * Cosmos) and has exactly one account. */
export function isPrivateKeyString(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}
export function isPrivateKeyWallet(seed: string[]): boolean {
  return seed.length === 1 && isPrivateKeyString(seed[0] ?? '');
}

/** A wallet secret as the renderer's `seed` array. */
export function seedWords(secret: string): string[] {
  return secret.trim().split(/\s+/).filter(Boolean);
}

/* ─── Several wallets in one vault ───────────────────────────────────────
 * Same model and plaintext format as the phone (apps/mobile/lib/vault.ts)
 * and the extension (apps/extension/src/lib/vault.ts). The encrypted
 * plaintext is either one secret — a phrase or a 0x key: every vault made
 * before multi-wallet, and any vault that has only ever held one wallet — or
 * a wallet set: JSON { format: 'thanos.wallets/1', wallets: [{ id, name,
 * secret }] }. One password and one AES key cover them all: adding, renaming
 * or removing a wallet re-encrypts under the session key (same KDF and salt,
 * fresh IV), so the password keeps working.
 *
 * The first wallet is 'w0'. A set holding only w0 is written as its bare
 * secret, so an existing install's vault is never rewritten until a second
 * wallet is added, and a single-wallet vault stays exactly what earlier app
 * versions open. Each wallet's settings (accounts, names, hidden accounts,
 * backup flag) live under the original keys for w0 and `<key>@<walletId>` for
 * the others. Which wallet is open is remembered in thanos.active_wallet, and
 * each wallet's public metadata in thanos.wallet_meta. */
export interface StoredWallet { id: string; name: string; secret: string }
export interface WalletSet { wallets: StoredWallet[] }
export interface WalletInfo { id: string; name: string; kind: 'phrase' | 'key' }
export type WalletOrigin = 'created' | 'imported';

const WALLET_SET_FORMAT = 'thanos.wallets/1';
/** The wallet every vault starts with — and the only one any vault held
 *  before multi-wallet. Its settings keep the un-suffixed keys. */
export const FIRST_WALLET_ID = 'w0';
export const MAX_WALLETS = 10;
export const MAX_WALLET_NAME_LEN = 24;
const LOCKED_ERR = 'The wallet is locked — unlock it and try again.';
const SAVE_ERR = 'Couldn’t save to the system keychain — nothing was changed. Try again.';

/** The wallet whose settings the account functions read and write. Set when
 *  a wallet is opened (selectWallet); every unlock opens one. */
let _walletId = FIRST_WALLET_ID;
export function currentWalletId(): string { return _walletId; }

/** localStorage key for a wallet's copy of a per-wallet setting. */
export function walletKey(base: string, walletId = _walletId): string {
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
 *  the first. The account functions follow it, and the choice is remembered
 *  for the next unlock. */
export function selectWallet(set: WalletSet, id?: string): StoredWallet {
  const want = id ?? (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_ACTIVE_WALLET) : null) ?? undefined;
  const w = set.wallets.find(x => x.id === want) ?? set.wallets[0];
  _walletId = w.id;
  if (typeof window !== 'undefined') {
    // The first wallet is the default when nothing is stored, so a
    // single-wallet install never gains the key.
    if (w.id !== FIRST_WALLET_ID) {
      if (localStorage.getItem(STORAGE_KEY_ACTIVE_WALLET) !== w.id) store(STORAGE_KEY_ACTIVE_WALLET, w.id);
    } else if (localStorage.getItem(STORAGE_KEY_ACTIVE_WALLET) !== null) {
      unstore(STORAGE_KEY_ACTIVE_WALLET);
    }
  }
  return w;
}

/** Unlocked vault plaintext → the wallet to open (see selectWallet). Every
 *  wallet's settings are restored from the keychain first. */
export async function openWallet(plaintext: string): Promise<StoredWallet> {
  const set = parseWalletSet(plaintext);
  await hydrateWalletSettings(set.wallets.map(w => w.id));
  return selectWallet(set);
}

interface OpenSet { vault: EncryptedVault; key: CryptoKey; set: WalletSet }
async function openSet(): Promise<OpenSet | null> {
  const key = await getSessionKey();
  const vault = key ? loadVault() : null;
  if (!key || !vault) return null;
  const pt = await openVaultWithKey(vault, key);
  return pt === null ? null : { vault, key, set: parseWalletSet(pt) };
}

/** Re-encrypt new plaintext under the same password-derived key — same KDF
 *  and salt, fresh IV. `key` is already the non-extractable CryptoKey the
 *  session cache hands back — no need to round-trip it through raw bytes. */
async function sealWithKey(vault: EncryptedVault, key: CryptoKey, plaintext: string): Promise<EncryptedVault> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { ...vault, iv: bytesToHex(iv), ciphertext: bytesToHex(new Uint8Array(ct)) };
}

/** Write new plaintext and read it back — from localStorage and from the
 *  keychain (the copy the next launch opens). Unless both decrypt to exactly
 *  that plaintext, the previous vault is put back and false returned. */
async function writePlaintext(o: OpenSet, plaintext: string): Promise<boolean> {
  const oldJson = JSON.stringify(o.vault);
  const kc = keychain();
  try {
    const next = await sealWithKey(o.vault, o.key, plaintext);
    const json = JSON.stringify(next);
    // '' = the keychain holds a vault it can't read back whole.
    const before = kc ? await kcVault(() => kcReadVault(kc)).catch(() => '') : null;
    localStorage.setItem(STORAGE_KEYS.vault, json);
    if (kc) await kcVault(() => kcWriteVault(kc, json));
    const back = loadVault();
    const local = back ? await openVaultWithKey(back, o.key) : null;
    // No bridge (dev in a browser) or no keytar in the main process: the
    // keychain holds nothing, before or after — localStorage is the store.
    const durable = kc ? await kcVault(() => kcReadVault(kc)) : null;
    const durableOk = durable === null
      ? before === null
      : (await openVaultWithKey(JSON.parse(durable) as EncryptedVault, o.key)) === plaintext;
    if (local === plaintext && durableOk) return true;
  } catch { /* restore below */ }
  localStorage.setItem(STORAGE_KEYS.vault, oldJson);
  if (kc) await kcVault(() => kcWriteVault(kc, oldJson)).catch(() => { /* the keychain refused both writes */ });
  return false;
}

export async function listWallets(): Promise<{ wallets: WalletInfo[]; activeId: string } | null> {
  const o = await openSet();
  if (!o) return null;
  const active = o.set.wallets.find(w => w.id === _walletId) ?? o.set.wallets[0];
  return { wallets: o.set.wallets.map(walletInfo), activeId: active.id };
}

/** Add another wallet (a new or imported phrase, or a private key) to the
 *  vault and open it on its first account. The user holds its secret — it
 *  was just created and verified, or imported — so it counts as backed up.
 *  `origin` labels it in the wallets panel (a private key is always imported). */
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
    // A fresh id: never inherit stale settings (local only — a keychain
    // delete racing the writes below could drop the new backup flag).
    for (const base of PER_WALLET_KEYS) localStorage.removeItem(walletKey(base, id));
    hydrated.add(id);
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
  if (id !== _walletId) selectWallet(o.set, id);
  if (!isPrivateKeyString(w.secret) && getVisibleAccountIndices().includes(idx)) setActiveAccountIndex(idx);
  return w;
}

/** Add the next derived account to a recovery-phrase wallet — any wallet in
 *  the vault, not only the open one — and open the wallet on it. Indices are
 *  never reused (a removed account stays hidden at its index). */
export async function addAccountToWallet(id: string): Promise<{ wallet: StoredWallet; idx: number } | { error: string }> {
  const o = await openSet();
  const w = o?.set.wallets.find(x => x.id === id);
  if (!o) return { error: LOCKED_ERR };
  if (!w) return { error: 'That wallet is not in Thanos.' };
  if (isPrivateKeyString(w.secret)) return { error: 'This wallet was imported from a private key, so it has just the one account.' };
  if (readWalletAccounts(id).count >= MAX_ACCOUNTS) return { error: `A wallet holds up to ${MAX_ACCOUNTS} accounts.` };
  if (id !== _walletId) selectWallet(o.set, id);
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
    if (_walletId === id) selectWallet(set, set.wallets[0].id);
    forgetWalletSettings(id);
    const next = set.wallets.find(w => w.id === _walletId) ?? set.wallets[0];
    return { next };
  });
}

/** One wallet's secret, for deriving its addresses and the remove-wallet
 *  balance check (null when the vault is locked or the id unknown). */
export async function readWalletSecret(id: string): Promise<string | null> {
  const o = await openSet();
  return o?.set.wallets.find(w => w.id === id)?.secret ?? null;
}

/* ─── Recovery-phrase backup flag ───────────────────────────────────────── */
/** True once the user has recorded the recovery phrase on this device. Set
 *  after the create-flow verification step / on import; absent for legacy/
 *  migrated vaults (which then get a backup nudge). Per wallet — the open
 *  one unless `walletId` names another. */
export function isSeedBackedUp(walletId?: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(walletKey(STORAGE_KEYS.seedBackedUp, walletId ?? _walletId)) === '1';
}
export function setSeedBackedUp(backedUp: boolean): void {
  if (typeof window === 'undefined') return;
  const key = walletKey(STORAGE_KEYS.seedBackedUp);
  if (backedUp) store(key, '1');
  else          unstore(key);
}

/* ─── Multi-account derivation index ─────────────────────────────────
   A wallet's accounts are HD-path indices of its phrase, m/44'/60'/0'/0/{idx}.
   Each wallet keeps its own copy of these settings (walletKey above); the
   functions below act on the open wallet. */
export const MAX_ACCOUNTS = 10;
export const MAX_ACCOUNT_NAME_LEN = 24;

function parseIntIn(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function parseNames(raw: string | null): Record<number, string> {
  if (!raw) return {};
  try {
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
function parseHidden(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return arr.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_ACCOUNTS);
  } catch { return []; }
}
function visibleOf(count: number, hidden: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!hidden.includes(i)) out.push(i);
  return out.length ? out : [0];
}
const read = (base: string, walletId = _walletId): string | null =>
  (typeof window === 'undefined' ? null : localStorage.getItem(walletKey(base, walletId)));

export function getActiveAccountIndex(): number {
  return parseIntIn(read(STORAGE_KEY_ACTIVE_IDX), 0, 0, MAX_ACCOUNTS - 1);
}
export function setActiveAccountIndex(idx: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  store(walletKey(STORAGE_KEY_ACTIVE_IDX), String(idx));
}
export function getAccountCount(): number {
  return parseIntIn(read(STORAGE_KEY_ACCT_COUNT), 1, 1, MAX_ACCOUNTS);
}
export function setAccountCount(n: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) return;
  store(walletKey(STORAGE_KEY_ACCT_COUNT), String(n));
}

/* ─── Account names (rename) ─────────────────────────────────────────────
   Same storage key + 24-char cap as mobile/web/extension so a name set on one
   client reads identically on another. Mirrored to the keychain like the rest
   of the desktop account state. */

/** Display name — the user's custom name, else "Account N". */
export function getAccountName(idx: number): string {
  return parseNames(read(STORAGE_KEY_ACCT_NAMES))[idx]?.trim() || `Account ${idx + 1}`;
}

/** The custom name only (null when the account uses the default). */
export function getCustomAccountName(idx: number): string | null {
  return parseNames(read(STORAGE_KEY_ACCT_NAMES))[idx] ?? null;
}

/** Set (or clear, with an empty string) an account's custom name. */
export function setAccountName(idx: number, name: string): void {
  if (typeof window === 'undefined') return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  const names = parseNames(read(STORAGE_KEY_ACCT_NAMES));
  const trimmed = name.trim().slice(0, MAX_ACCOUNT_NAME_LEN);
  if (trimmed) names[idx] = trimmed;
  else delete names[idx];
  store(walletKey(STORAGE_KEY_ACCT_NAMES), JSON.stringify(names));
}

/* ─── Account removal ────────────────────────────────────────────────────
   Accounts are HD-path indices, so an account CANNOT be spliced out: removing
   index 1 of 0..2 would slide index 2 down and silently change that account's
   address — funds would look like they vanished. A removed account is instead
   recorded in a HIDDEN set; every index keeps deriving the same address
   forever and the account simply stops being listed. */

export function getHiddenAccounts(): number[] {
  return parseHidden(read(STORAGE_KEY_ACCT_HIDDEN));
}

export function isAccountHidden(idx: number): boolean {
  return getHiddenAccounts().includes(idx);
}

/** Indices the UI should list. Never empty — a wallet always keeps one. */
export function getVisibleAccountIndices(): number[] {
  return visibleOf(getAccountCount(), getHiddenAccounts());
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
  store(walletKey(STORAGE_KEY_ACCT_HIDDEN), JSON.stringify(hidden));
  if (getActiveAccountIndex() === idx) {
    setActiveAccountIndex(getVisibleAccountIndices()[0] ?? 0);
  }
  return true;
}

/** A wallet's accounts as the wallets panel lists them. */
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

/** Any wallet's accounts — open or not. */
export function readWalletAccounts(walletId: string): WalletAccounts {
  const count = parseIntIn(read(STORAGE_KEY_ACCT_COUNT, walletId), 1, 1, MAX_ACCOUNTS);
  const visible = visibleOf(count, parseHidden(read(STORAGE_KEY_ACCT_HIDDEN, walletId)));
  const idx = parseIntIn(read(STORAGE_KEY_ACTIVE_IDX, walletId), 0, 0, MAX_ACCOUNTS - 1);
  return { active: visible.includes(idx) ? idx : visible[0], visible, count, names: parseNames(read(STORAGE_KEY_ACCT_NAMES, walletId)) };
}

/* ─── Public per-wallet metadata (STORAGE_KEY_WALLET_META) ──────────────── */
interface WalletMeta { origin?: WalletOrigin; addrs?: Record<number, string> }
const isAddr = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v);

function parseMeta(raw: string | null): Record<string, WalletMeta> {
  if (!raw) return {};
  try {
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
function readMeta(): Record<string, WalletMeta> {
  return typeof window === 'undefined' ? {} : parseMeta(localStorage.getItem(STORAGE_KEY_WALLET_META));
}
/** The keychain keeps only the origins: the address cache can grow past what
 *  Windows' credential store holds per entry, and is re-derived when missing. */
function originsOnly(meta: Record<string, WalletMeta>): string {
  const out: Record<string, WalletMeta> = {};
  for (const [id, m] of Object.entries(meta)) out[id] = m.origin ? { origin: m.origin } : {};
  return JSON.stringify(out);
}
function writeMeta(meta: Record<string, WalletMeta>, originsChanged: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_WALLET_META, JSON.stringify(meta));
  if (originsChanged) mirrorToKeychain(STORAGE_KEY_WALLET_META, originsOnly(meta));
}

/** Created in Thanos or imported — unknown for wallets from before this was recorded. */
export function getWalletOrigin(walletId: string): WalletOrigin | undefined { return readMeta()[walletId]?.origin; }

export function setWalletOrigin(walletId: string, origin: WalletOrigin): void {
  const meta = readMeta();
  if (meta[walletId]?.origin === origin) return;
  writeMeta({ ...meta, [walletId]: { ...meta[walletId], origin } }, true);
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
  writeMeta({ ...meta, [walletId]: { ...meta[walletId], addrs: next } }, false);
}

/** Drop a removed wallet's settings and metadata (local + keychain). */
function forgetWalletSettings(walletId: string): void {
  if (typeof window === 'undefined') return;
  const meta = readMeta();
  if (walletId in meta) {
    const rest = { ...meta };
    delete rest[walletId];
    writeMeta(rest, true);
  }
  for (const base of PER_WALLET_KEYS) {
    const k = walletKey(base, walletId);
    if (localStorage.getItem(k) !== null) unstore(k);
    else removeFromKeychain(k);
  }
}

export function clearVault(): void {
  if (typeof window === 'undefined') return;
  // Every added wallet's settings — whichever ids this device has seen.
  const added = new Set<string>([...Object.keys(readMeta()), ...hydrated]);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) ?? '';
    const at = k.lastIndexOf('@');
    if (at > 0 && PER_WALLET_KEYS.includes(k.slice(0, at))) added.add(k.slice(at + 1));
  }
  added.delete(FIRST_WALLET_ID);
  for (const id of added) for (const base of PER_WALLET_KEYS) unstore(`${base}@${id}`);
  localStorage.removeItem(STORAGE_KEYS.vault);
  localStorage.removeItem(STORAGE_KEYS.hasVault);
  localStorage.removeItem(STORAGE_KEYS.seedBackedUp);
  localStorage.removeItem(STORAGE_KEYS.legacyMnemonic);
  localStorage.removeItem(STORAGE_KEYS.legacyPassword);
  localStorage.removeItem(STORAGE_KEYS.legacyUnlocked);
  localStorage.removeItem(STORAGE_KEY_ACTIVE_IDX);
  localStorage.removeItem(STORAGE_KEY_ACCT_COUNT);
  localStorage.removeItem(STORAGE_KEY_ACCT_NAMES);
  localStorage.removeItem(STORAGE_KEY_ACCT_HIDDEN);
  localStorage.removeItem(STORAGE_KEY_ACTIVE_WALLET);
  localStorage.removeItem(STORAGE_KEY_WALLET_META);
  // Wipe the durable keychain copies too, or a "Reset wallet" would leave the
  // old vault behind and it would resurrect on the next launch's hydration.
  const kc = keychain();
  if (kc) void kcVault(() => kcRemoveVault(kc)).catch(() => { /* best-effort */ });
  for (const key of DURABLE_KEYS) if (key !== STORAGE_KEYS.vault) removeFromKeychain(key);
  _walletId = FIRST_WALLET_ID;
  hydrated.clear();
  // The sessionStorage marker is dropped synchronously (before this async
  // call's first await runs); the IndexedDB delete behind it is best-effort
  // cleanup that doesn't need to block callers of this (sync) function.
  void clearSessionKey().catch(() => {});
}

/* ─── Session key cache (refresh persistence, NOT cold-open) ─────────────
 * Hardening-audit H-2: this used to hex-encode the raw AES key into
 * sessionStorage, so any main-thread script could read the key with one
 * synchronous `sessionStorage.getItem`. A non-extractable CryptoKey closes
 * that: its structured clone carries no exportable key material, so
 * IndexedDB — the one storage API that can hold a CryptoKey at all — is
 * what we cache it in now; a script that reaches in gets an opaque key it
 * can only USE through our own decrypt calls, never read bytes out of.
 *
 * sessionStorage still has a role: a bare marker (no secret) under the same
 * key this used to hold the hex key. IndexedDB (unlike sessionStorage)
 * survives a renderer reload the same session-storage-clearing event
 * wouldn't, so without the marker a reload could resurrect a key this was
 * never meant to outlive; getSessionKey() treats a missing marker as "no
 * cache", same as the original "Electron keeps no session storage across
 * restarts" guarantee in the header comment above.
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
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
      tx.oncomplete = () => resolve(req.result);
    });
  } finally {
    db.close();
  }
}

/** Cache the AES key for the rest of this session. Takes the raw bytes
 *  openVault()/createVault() just derived — they're imported into a
 *  non-extractable CryptoKey here and only the CryptoKey is ever stored. */
export async function cacheSessionKey(rawKey: Uint8Array): Promise<void> {
  if (!hasIndexedDb()) return;
  const key = await importAesKey(rawKey);
  sessionStorage.setItem(STORAGE_KEYS.sessionKey, '1'); // session-lifetime marker, not a secret
  await withSessionStore('readwrite', (store) => store.put(key, SESSION_DB_ENTRY));
}

/** The cached key, or null if this is a cold open (no cache), a reload that
 *  inherited a previous session's IndexedDB entry (no sessionStorage marker
 *  — treated the same as no cache and swept away), or IndexedDB is
 *  unavailable. */
export async function getSessionKey(): Promise<CryptoKey | null> {
  if (!hasIndexedDb()) return null;
  if (!sessionStorage.getItem(STORAGE_KEYS.sessionKey)) {
    await clearSessionKey(); // best-effort: drop any stale entry from a previous session
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
  // Mirrored on every write, so they must be restored at boot and wiped with
  // the vault too — otherwise renamed / hidden accounts reverted after a
  // restart, and a deleted wallet's account names stayed in the keychain.
  STORAGE_KEY_ACCT_NAMES,
  STORAGE_KEY_ACCT_HIDDEN,
  // Several wallets: which one is open, and their origins (wallet_meta's
  // keychain copy holds no addresses — see originsOnly). The wallets added
  // after the first keep their settings under `<key>@<id>`, restored when
  // the vault is unlocked and their ids are known (hydrateWalletSettings).
  STORAGE_KEY_ACTIVE_WALLET,
  STORAGE_KEY_WALLET_META,
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
  const kc = keychain();
  if (!kc) return;
  if (key === STORAGE_KEYS.vault) { void kcVault(() => kcWriteVault(kc, value)).catch(() => { /* durability best-effort */ }); return; }
  kc.vaultSet(key, value).catch(() => { /* durability best-effort */ });
}
function removeFromKeychain(key: string): void {
  keychain()?.vaultRemove(key).catch(() => { /* best-effort */ });
}

/* The vault's keychain entry. Windows' Credential Manager holds at most 2560
   bytes per secret, and a vault of several wallets outgrows that. A vault up
   to KC_PART chars — every single-wallet vault (~0.5 KB) — is stored exactly
   as before, in one entry. A larger one is split into parts under
   `thanos.vault#<gen>.<i>`, written first, and `thanos.vault` then holds only
   { thanosVaultParts, gen }: a new generation's parts never overwrite the
   ones the current header points to, so an interrupted write leaves the
   previous vault readable. Vault keychain operations run one at a time. */
const KC_PART = 2000;
interface KcVaultHeader { thanosVaultParts: number; gen: string }
let kcQueue: Promise<unknown> = Promise.resolve();
function kcVault<T>(fn: () => Promise<T>): Promise<T> {
  const run = kcQueue.then(fn, fn);
  kcQueue = run.catch(() => {});
  return run;
}
function kcPartKey(gen: string, i: number): string { return `${STORAGE_KEYS.vault}#${gen}.${i}`; }
function kcHeader(raw: string | null): KcVaultHeader | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<KcVaultHeader>;
    return typeof h.thanosVaultParts === 'number' && Number.isInteger(h.thanosVaultParts)
      && h.thanosVaultParts > 0 && h.thanosVaultParts <= 64
      && typeof h.gen === 'string' && /^[0-9a-f]{8}$/.test(h.gen)
      ? { thanosVaultParts: h.thanosVaultParts, gen: h.gen } : null;
  } catch { return null; }
}
/** The keychain's vault JSON (parts joined), or null if it holds none.
 *  Throws if a part is missing — never mistake half a vault for none. */
async function kcReadVault(kc: VaultBridge): Promise<string | null> {
  const raw = await kc.vaultGet(STORAGE_KEYS.vault);
  if (raw == null) return null;
  const h = kcHeader(raw);
  if (!h) return raw;
  const parts = await Promise.all(Array.from({ length: h.thanosVaultParts }, (_, i) => kc.vaultGet(kcPartKey(h.gen, i))));
  if (parts.some(p => p == null)) throw new Error('vault: keychain parts missing');
  return parts.join('');
}
async function kcWriteVault(kc: VaultBridge, json: string): Promise<void> {
  const prev = kcHeader(await kc.vaultGet(STORAGE_KEYS.vault).catch(() => null));
  if (json.length <= KC_PART) {
    await kc.vaultSet(STORAGE_KEYS.vault, json);
  } else {
    const gen = bytesToHex(randomBytes(4));
    const n = Math.ceil(json.length / KC_PART);
    for (let i = 0; i < n; i++) await kc.vaultSet(kcPartKey(gen, i), json.slice(i * KC_PART, (i + 1) * KC_PART));
    await kc.vaultSet(STORAGE_KEYS.vault, JSON.stringify({ thanosVaultParts: n, gen }));
  }
  if (prev) for (let i = 0; i < prev.thanosVaultParts; i++) await kc.vaultRemove(kcPartKey(prev.gen, i)).catch(() => {});
}
async function kcRemoveVault(kc: VaultBridge): Promise<void> {
  const prev = kcHeader(await kc.vaultGet(STORAGE_KEYS.vault).catch(() => null));
  await kc.vaultRemove(STORAGE_KEYS.vault);
  if (prev) for (let i = 0; i < prev.thanosVaultParts; i++) await kc.vaultRemove(kcPartKey(prev.gen, i)).catch(() => {});
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
      if (key === STORAGE_KEYS.vault) {
        const fromKeychain = await kcVault(() => kcReadVault(kc));
        if (fromKeychain != null) localStorage.setItem(key, fromKeychain);
        else {
          const fromLocal = localStorage.getItem(key);
          if (fromLocal != null) await kcVault(() => kcWriteVault(kc, fromLocal)).catch(() => {});
        }
        return;
      }
      if (key === STORAGE_KEY_WALLET_META) {
        // The keychain's origins win; addresses cached locally stay.
        const fromKeychain = await kc.vaultGet(key);
        const local = parseMeta(localStorage.getItem(key));
        if (fromKeychain != null) {
          const merged: Record<string, WalletMeta> = { ...local };
          for (const [id, m] of Object.entries(parseMeta(fromKeychain))) merged[id] = { ...local[id], ...(m.origin ? { origin: m.origin } : {}) };
          localStorage.setItem(key, JSON.stringify(merged));
        } else if (Object.keys(local).length) {
          await kc.vaultSet(key, originsOnly(local)).catch(() => {});
        }
        return;
      }
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

/** Wallets whose `<key>@<id>` settings have been restored this session. */
const hydrated = new Set<string>();

/** The settings of the wallets added after the first live under keys only
 *  the unlocked vault can name: restore them from the keychain (keychain
 *  wins, as at boot) once per launch, before the wallet is first read. */
async function hydrateWalletSettings(ids: string[]): Promise<void> {
  const kc = keychain();
  const todo = ids.filter(id => id !== FIRST_WALLET_ID && !hydrated.has(id));
  for (const id of todo) hydrated.add(id);
  if (!kc || typeof window === 'undefined' || !todo.length) return;
  await Promise.all(todo.flatMap(id => PER_WALLET_KEYS.map(async (base) => {
    const key = `${base}@${id}`;
    try {
      const fromKeychain = await kc.vaultGet(key);
      if (fromKeychain != null) localStorage.setItem(key, fromKeychain);
      else {
        const fromLocal = localStorage.getItem(key);
        if (fromLocal != null) await kc.vaultSet(key, fromLocal).catch(() => {});
      }
    } catch { /* leave localStorage as-is for this key */ }
  })));
}
