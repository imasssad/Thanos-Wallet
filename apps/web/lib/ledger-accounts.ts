'use client';
/**
 * Per-coin Ledger active-account store.
 *
 * The wallet remembers ONE chosen Ledger account per coin in localStorage:
 *   thanos.ledger_account    — EVM (legacy key, kept for back-compat)
 *   thanos.ledger.btc        — Bitcoin (BIP84 path)
 *   thanos.ledger.sol        — Solana (Phantom-style path)
 *
 * The Send modal calls `getActive…` before submitting to decide whether
 * to route through the in-vault key or through Ledger.
 */
import type { LedgerBtcAccount } from './ledger-btc';
import type { LedgerSolAccount } from './ledger-sol';

const BTC_KEY = 'thanos.ledger.btc';
const SOL_KEY = 'thanos.ledger.sol';

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function writeJson(key: string, value: unknown | null): void {
  if (typeof window === 'undefined') return;
  if (value === null) localStorage.removeItem(key);
  else                localStorage.setItem(key, JSON.stringify(value));
}

/* ─── Bitcoin ────────────────────────────────────────────────── */

export function getActiveLedgerBtcAccount(): LedgerBtcAccount | null {
  return readJson<LedgerBtcAccount>(BTC_KEY);
}
export function setActiveLedgerBtcAccount(acc: LedgerBtcAccount | null): void {
  writeJson(BTC_KEY, acc);
}

/* ─── Solana ─────────────────────────────────────────────────── */

export function getActiveLedgerSolAccount(): LedgerSolAccount | null {
  return readJson<LedgerSolAccount>(SOL_KEY);
}
export function setActiveLedgerSolAccount(acc: LedgerSolAccount | null): void {
  writeJson(SOL_KEY, acc);
}
