/**
 * BrowserSecureStore — password-gated encrypted storage for web and extension.
 *
 * SECURITY FIX: Previous implementation used a hardcoded string
 * ('thanos-browser-secret') as the encryption key, meaning every user's
 * mnemonic was protected by the same secret. This version derives a unique
 * AES-256-GCM key per-vault from the user's password via PBKDF2 (600k iters).
 *
 * USAGE:
 *   const store = new BrowserSecureStore();
 *   await store.unlock('user-entered-password');
 *   await store.set('mnemonic', phrase);
 *   const phrase = await store.get('mnemonic');
 *   store.lock(); // wipes in-memory password
 */

import type { SecureStore } from './memory-store';
import { decryptWithPassword, encryptWithPassword, type EncryptedVault } from '../utils/key-derivation';

const VAULT_VERSION = 1;

interface StoredEntry {
  version: number;
  vault: EncryptedVault;
}

export class BrowserSecureStore implements SecureStore {
  private password: string | null = null;

  constructor(private readonly namespace = 'thanos-v2') {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Unlock the store with the user's password.
   * Must be called before get/set/remove.
   */
  unlock(password: string): void {
    if (!password || password.length < 1) throw new Error('Password must not be empty');
    this.password = password;
  }

  /**
   * Lock the store — wipes the in-memory password.
   * Subsequent get/set calls will throw until unlock() is called again.
   */
  lock(): void {
    this.password = null;
  }

  get isUnlocked(): boolean {
    return this.password !== null;
  }

  // ─── SecureStore interface ─────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.assertUnlocked();
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(this.storageKey(key));
    if (!raw) return null;
    try {
      const entry: StoredEntry = JSON.parse(raw);
      return decryptWithPassword(this.password!, entry.vault);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.assertUnlocked();
    if (typeof window === 'undefined') return;
    const vault = await encryptWithPassword(this.password!, value);
    const entry: StoredEntry = { version: VAULT_VERSION, vault };
    window.localStorage.setItem(this.storageKey(key), JSON.stringify(entry));
  }

  async remove(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(this.storageKey(key));
  }

  // ─── Password change ───────────────────────────────────────────────────────

  /**
   * Re-encrypt all stored keys with a new password.
   * Call this when the user changes their passphrase.
   */
  async changePassword(oldPassword: string, newPassword: string, keys: string[]): Promise<void> {
    if (!newPassword || newPassword.length < 1) throw new Error('New password must not be empty');
    const old = this.password;
    this.password = oldPassword;
    const values: Record<string, string | null> = {};
    for (const key of keys) {
      values[key] = await this.get(key);
    }
    this.password = newPassword;
    for (const key of keys) {
      if (values[key] !== null) await this.set(key, values[key]!);
    }
    this.password = old;
  }

  /**
   * Returns true if any vault entry exists for this namespace.
   * Useful to detect first-run vs returning user.
   */
  hasVault(): boolean {
    if (typeof window === 'undefined') return false;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(`${this.namespace}:`)) return true;
    }
    return false;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private storageKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private assertUnlocked(): void {
    if (!this.password) {
      throw new Error('Wallet is locked. Call store.unlock(password) first.');
    }
  }
}
