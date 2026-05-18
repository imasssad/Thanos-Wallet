'use client';
/**
 * Per-coin Trezor active-account store — parallel to ledger-accounts.ts.
 *
 *   thanos.trezor.evm  — EVM (chain-agnostic, used for Makalu + all EVM chains)
 *   thanos.trezor.btc  — Bitcoin (BIP84)
 *   thanos.trezor.sol  — Solana
 *
 * The Send modal reads getActiveTrezor… before submitting to decide
 * whether to route the broadcast through the device.
 */
import type { TrezorAccount } from './trezor';

const EVM_KEY = 'thanos.trezor.evm';
const BTC_KEY = 'thanos.trezor.btc';
const SOL_KEY = 'thanos.trezor.sol';

function read(key: string): TrezorAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TrezorAccount) : null;
  } catch { return null; }
}
function write(key: string, value: TrezorAccount | null): void {
  if (typeof window === 'undefined') return;
  if (value === null) localStorage.removeItem(key);
  else                localStorage.setItem(key, JSON.stringify(value));
}

export function getActiveTrezorEvmAccount(): TrezorAccount | null { return read(EVM_KEY); }
export function setActiveTrezorEvmAccount(a: TrezorAccount | null): void { write(EVM_KEY, a); }

export function getActiveTrezorBtcAccount(): TrezorAccount | null { return read(BTC_KEY); }
export function setActiveTrezorBtcAccount(a: TrezorAccount | null): void { write(BTC_KEY, a); }

export function getActiveTrezorSolAccount(): TrezorAccount | null { return read(SOL_KEY); }
export function setActiveTrezorSolAccount(a: TrezorAccount | null): void { write(SOL_KEY, a); }
