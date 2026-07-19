/**
 * Multi-account derivation index — mobile.
 *
 * AsyncStorage is async by API, but the signer (wc-signer.ts) needs to
 * read the active index *synchronously* at sign time. We solve this
 * with an in-memory cache that hydrates from AsyncStorage on app start
 * via `loadAccountsFromStorage()`, then every subsequent get/set is
 * sync against the cache; writes are mirrored to AsyncStorage as
 * fire-and-forget so a fresh launch sees the last persisted value.
 *
 * Same surface as web/desktop/extension vault.ts so consumers don't
 * branch on platform.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_ACTIVE_IDX = 'thanos.active_account_idx';
const KEY_ACCT_COUNT = 'thanos.account_count';
const KEY_ACCT_NAMES = 'thanos.account_names';
const KEY_ACCT_HIDDEN = 'thanos.account_hidden';
export const MAX_ACCOUNTS = 10;
export const MAX_ACCOUNT_NAME_LEN = 24;

// In-memory cache. Sentinel until hydrated; UI handles the "0/1 by default" case.
let _activeIdx    = 0;
let _accountCount = 1;
let _names: Record<number, string> = {};
let _hidden: number[] = [];
let _hydrated     = false;

/** Hydrate from AsyncStorage. Call once at app start; safe to re-call. */
export async function loadAccountsFromStorage(): Promise<void> {
  try {
    const [[, idxRaw], [, countRaw], [, namesRaw], [, hiddenRaw]] = await AsyncStorage.multiGet([KEY_ACTIVE_IDX, KEY_ACCT_COUNT, KEY_ACCT_NAMES, KEY_ACCT_HIDDEN]);
    if (hiddenRaw) {
      try {
        const arr = JSON.parse(hiddenRaw) as unknown[];
        _hidden = arr.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < MAX_ACCOUNTS);
      } catch { /* keep default */ }
    }
    const idx   = Number.parseInt(idxRaw   ?? '0', 10);
    const count = Number.parseInt(countRaw ?? '1', 10);
    if (Number.isFinite(idx)   && idx   >= 0 && idx   < MAX_ACCOUNTS)        _activeIdx    = idx;
    if (Number.isFinite(count) && count >= 1 && count <= MAX_ACCOUNTS)       _accountCount = count;
    if (namesRaw) {
      const parsed = JSON.parse(namesRaw) as Record<string, unknown>;
      const clean: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const i = Number.parseInt(k, 10);
        if (Number.isInteger(i) && i >= 0 && i < MAX_ACCOUNTS && typeof v === 'string' && v.trim()) {
          clean[i] = v.trim().slice(0, MAX_ACCOUNT_NAME_LEN);
        }
      }
      _names = clean;
    }
  } catch { /* keep defaults */ }
  _hydrated = true;
}

export function getActiveAccountIndex(): number { return _activeIdx; }
export function getAccountCount(): number       { return _accountCount; }
export function isAccountsHydrated(): boolean   { return _hydrated; }

export function setActiveAccountIndex(idx: number): void {
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  _activeIdx = idx;
  AsyncStorage.setItem(KEY_ACTIVE_IDX, String(idx)).catch(() => {});
}

export function setAccountCount(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > MAX_ACCOUNTS) return;
  _accountCount = n;
  AsyncStorage.setItem(KEY_ACCT_COUNT, String(n)).catch(() => {});
}

/** Display name for an account — the user's custom name, else "Account N". */
export function getAccountName(idx: number): string {
  const custom = _names[idx]?.trim();
  return custom || `Account ${idx + 1}`;
}

/** The custom name only (null when the account uses the default). */
export function getCustomAccountName(idx: number): string | null {
  return _names[idx] ?? null;
}

/** Set (or clear, with an empty string) an account's custom name. */
export function setAccountName(idx: number, name: string): void {
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return;
  const trimmed = name.trim().slice(0, MAX_ACCOUNT_NAME_LEN);
  if (trimmed) _names[idx] = trimmed;
  else delete _names[idx];
  AsyncStorage.setItem(KEY_ACCT_NAMES, JSON.stringify(_names)).catch(() => {});
}

/* ─── Account removal ────────────────────────────────────────────────────
   Accounts are HD-path indices, so an account CANNOT be spliced out: removing
   index 1 of 0..2 would slide index 2 down and silently change that account's
   address — funds would look like they vanished. A removed account is instead
   recorded in a HIDDEN set; every index keeps deriving the same address
   forever and the account simply stops being listed. Mirrors web/desktop/
   extension vault.ts (same storage key). */

export function getHiddenAccounts(): number[] { return [..._hidden]; }
export function isAccountHidden(idx: number): boolean { return _hidden.includes(idx); }

/** Indices the UI should list. Never empty — a wallet always keeps one. */
export function getVisibleAccountIndices(): number[] {
  const out: number[] = [];
  for (let i = 0; i < _accountCount; i++) if (!_hidden.includes(i)) out.push(i);
  return out.length ? out : [0];
}

/** Hide (delete) an account. Refuses the last visible one — a wallet must
 *  always keep at least one. Balance checks live in the UI, the only layer
 *  that can price what the account holds. */
export function hideAccount(idx: number): boolean {
  if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_ACCOUNTS) return false;
  const visible = getVisibleAccountIndices();
  if (visible.length <= 1 || !visible.includes(idx)) return false;
  if (!_hidden.includes(idx)) _hidden.push(idx);
  AsyncStorage.setItem(KEY_ACCT_HIDDEN, JSON.stringify(_hidden)).catch(() => {});
  // Never leave the wallet pointing at a removed account.
  if (_activeIdx === idx) setActiveAccountIndex(getVisibleAccountIndices()[0] ?? 0);
  return true;
}
