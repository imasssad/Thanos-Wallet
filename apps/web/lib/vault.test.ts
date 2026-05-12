/**
 * Vault round-trip tests.
 *
 * The vault layer is the single most safety-critical module in the wallet:
 * a regression here locks every user out of their funds. These tests cover
 * the cases I'd want to catch BEFORE the user opens an issue, not after.
 *
 * Run with: pnpm --filter @thanos/web test
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';

// Polyfill localStorage / sessionStorage for the Node test env, since vault.ts
// reaches for them in saveVault/loadVault/cacheSessionKey paths.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string)   { return this.m.get(k) ?? null; }
  key(i: number)       { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string){ this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

beforeAll(() => {
  // Stub window + storages so vault.ts's `typeof window === 'undefined'` guards
  // think we're in a real browser.
  vi.stubGlobal('window',         {});
  vi.stubGlobal('localStorage',   new MemStorage());
  vi.stubGlobal('sessionStorage', new MemStorage());
});

import {
  createVault,
  openVault,
  openVaultWithKey,
  saveVault,
  loadVault,
  clearVault,
  cacheSessionKey,
  getSessionKey,
  clearSessionKey,
  migrateLegacyPlaintext,
  hasLegacyPlaintext,
  VAULT_STORAGE_KEYS,
  type EncryptedVault,
} from './vault';

// Argon2id with t=3 m=64MB p=4 takes ~500-800ms on most machines, so each
// test that calls createVault or openVault is paying that cost. Bump the
// per-test timeout to give it room.
const SLOW = { timeout: 20_000 };

const MNEMONIC = 'test test test test test test test test test test test junk';
const PASSWORD = 'correct horse battery staple';

describe('vault — encrypt/decrypt round-trip', () => {
  it('decrypts what was encrypted with the same password', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    const opened = await openVault(vault, PASSWORD);
    expect(opened).not.toBeNull();
    expect(opened!.mnemonic).toBe(MNEMONIC);
    // Key is 32 bytes (AES-256 key length)
    expect(opened!.key).toBeInstanceOf(Uint8Array);
    expect(opened!.key.length).toBe(32);
  }, SLOW);

  it('produces a different ciphertext every time (random salt + iv)', async () => {
    const a = await createVault(MNEMONIC, PASSWORD);
    const b = await createVault(MNEMONIC, PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  }, SLOW);

  it('rejects the wrong password by returning null (auth tag fails)', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    const opened = await openVault(vault, 'definitely wrong password');
    expect(opened).toBeNull();
  }, SLOW);

  it('rejects a tampered ciphertext', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    // Flip the last byte of ciphertext.
    const ct = vault.ciphertext;
    const lastByte = parseInt(ct.slice(-2), 16);
    const flipped = ct.slice(0, -2) + ((lastByte ^ 0xff).toString(16).padStart(2, '0'));
    const tampered: EncryptedVault = { ...vault, ciphertext: flipped };

    const opened = await openVault(tampered, PASSWORD);
    expect(opened).toBeNull();
  }, SLOW);

  it('rejects a tampered IV', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    // Flip a byte of the IV; AES-GCM detects this as auth-tag mismatch.
    const tampered: EncryptedVault = {
      ...vault,
      iv: vault.iv.slice(0, -2) + '00',
    };
    const opened = await openVault(tampered, PASSWORD);
    expect(opened).toBeNull();
  }, SLOW);

  it('refuses an unsupported vault version', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    const wrongVersion = { ...vault, v: 2 } as unknown as EncryptedVault;
    await expect(openVault(wrongVersion, PASSWORD)).rejects.toThrow(/unsupported version/);
  }, SLOW);
});

describe('vault — session-key fast path', () => {
  it('openVaultWithKey decrypts with the raw key from openVault', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    const opened = await openVault(vault, PASSWORD);
    expect(opened).not.toBeNull();

    const fastOpen = await openVaultWithKey(vault, opened!.key);
    expect(fastOpen).toBe(MNEMONIC);
  }, SLOW);

  it('openVaultWithKey returns null for a wrong key', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    const wrongKey = new Uint8Array(32); // all zeros
    const result = await openVaultWithKey(vault, wrongKey);
    expect(result).toBeNull();
  }, SLOW);
});

describe('vault — storage layer', () => {
  it('saveVault / loadVault round-trips through localStorage', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    saveVault(vault);
    const loaded = loadVault();
    expect(loaded).toEqual(vault);
    // has_vault flag set
    expect(localStorage.getItem(VAULT_STORAGE_KEYS.hasVault)).toBe('1');
  }, SLOW);

  it('clearVault removes vault + legacy keys + session', async () => {
    const vault = await createVault(MNEMONIC, PASSWORD);
    saveVault(vault);
    localStorage.setItem(VAULT_STORAGE_KEYS.legacyMnemonic, 'old');
    localStorage.setItem(VAULT_STORAGE_KEYS.legacyPassword, 'old');
    sessionStorage.setItem(VAULT_STORAGE_KEYS.sessionKey, 'abcdef');

    clearVault();
    expect(loadVault()).toBeNull();
    expect(localStorage.getItem(VAULT_STORAGE_KEYS.legacyMnemonic)).toBeNull();
    expect(localStorage.getItem(VAULT_STORAGE_KEYS.legacyPassword)).toBeNull();
    expect(sessionStorage.getItem(VAULT_STORAGE_KEYS.sessionKey)).toBeNull();
  }, SLOW);

  it('cacheSessionKey / getSessionKey / clearSessionKey round-trip', () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    cacheSessionKey(key);
    const got = getSessionKey();
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(key));
    clearSessionKey();
    expect(getSessionKey()).toBeNull();
  });
});

describe('vault — legacy plaintext migration', () => {
  it('migrates plaintext mnemonic+password to an encrypted vault and wipes the plaintext', async () => {
    localStorage.clear();
    localStorage.setItem(VAULT_STORAGE_KEYS.legacyMnemonic, MNEMONIC);
    localStorage.setItem(VAULT_STORAGE_KEYS.legacyPassword, PASSWORD);
    expect(hasLegacyPlaintext()).toBe(true);

    const result = await migrateLegacyPlaintext();
    expect(result.ok).toBe(true);
    expect(result.key).toBeInstanceOf(Uint8Array);

    // Vault now exists and decrypts.
    const v = loadVault();
    expect(v).not.toBeNull();
    const opened = await openVault(v!, PASSWORD);
    expect(opened?.mnemonic).toBe(MNEMONIC);

    // Plaintext is gone.
    expect(localStorage.getItem(VAULT_STORAGE_KEYS.legacyMnemonic)).toBeNull();
    expect(localStorage.getItem(VAULT_STORAGE_KEYS.legacyPassword)).toBeNull();
    expect(hasLegacyPlaintext()).toBe(false);
  }, SLOW);

  it('returns ok:false when no plaintext is present', async () => {
    localStorage.clear();
    const result = await migrateLegacyPlaintext();
    expect(result.ok).toBe(false);
  });
});
