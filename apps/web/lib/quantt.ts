'use client';
/**
 * Quantt integration for the web wallet.
 *
 * Wraps the shared @thanos/sdk-core QuanttClient with a sessionStorage session
 * store and the web signing worker — "Connect with Thanos" runs the EIP-712
 * wallet login through `signerSignTypedData` (the mnemonic stays in the worker,
 * never on the main thread). Quantt only ever sees a signature.
 *
 * SESSION LIFETIME: the bearer + refresh tokens live in sessionStorage — they
 * die with the tab — and forgetQuanttSession() drops them when the wallet
 * locks or is deleted, so a locked (or shared) browser never holds a live
 * Quantt login. Older builds kept them in localStorage; that copy is purged
 * on load.
 *
 * CORS: api.quantts.ai returns `access-control-allow-origin: https://thanos.fi`,
 * so the browser can call it directly; the host is added to the CSP connect-src
 * in next.config.js.
 */
import { QuanttClient, type QuanttSession, type Eip712TypedData } from '@thanos/sdk-core';
import { getSignerAddress, signerSignTypedData } from './signer-client';

const STORE_KEY = 'quantt_session';

const store = {
  get(): QuanttSession | null {
    try {
      const r = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORE_KEY) : null;
      return r ? (JSON.parse(r) as QuanttSession) : null;
    } catch {
      return null;
    }
  },
  set(s: QuanttSession | null): void {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

// One-time cleanup of the long-lived copy older builds kept in localStorage.
try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }

export const quantt = new QuanttClient({ store });

/** Drop the Quantt session — the stored copy synchronously (so it can't
 *  survive a reload that follows immediately, e.g. "Delete wallet"), then the
 *  client's own state and a best-effort server logout. Called when the wallet
 *  locks or is deleted. */
export function forgetQuanttSession(): Promise<void> {
  // signOut() reads the session (this store is synchronous) before its first
  // await, so the server logout still gets the token after the clear below.
  const done = quantt.signOut();
  store.set(null);
  return done;
}

/** Strips the EIP712Domain entry (ethers derives it from `domain`) and runs
 *  the wallet-signing worker — shared by sign-in and withdrawal-address
 *  binding, which both walk the same challenge/sign/verify shape. */
async function signQuanttTypedData(typed: Eip712TypedData): Promise<string> {
  const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
  void _omit;
  const { signature } = await signerSignTypedData({
    domain: typed.domain,
    types: types as Record<string, Array<{ name: string; type: string }>>,
    message: typed.message,
  });
  return signature;
}

/** Sign in to Quantt using the unlocked web wallet (worker-signed). */
export async function quanttSignIn(): Promise<QuanttSession> {
  const { address } = await getSignerAddress();
  if (!address) throw new Error('Wallet is locked');
  return quantt.signIn(address, signQuanttTypedData);
}

/** Bind this wallet's own address as the verified withdrawal target
 *  (POST /v1/user/withdrawal-address/challenge → sign → POST
 *  /v1/user/withdrawal-address). Same EIP-712-challenge shape as sign-in.
 *  Withdrawals only ever pay out to whatever address is bound here — never
 *  an arbitrary one entered at withdraw time. */
export async function quanttBindWithdrawalAddress(): Promise<unknown> {
  const { address } = await getSignerAddress();
  if (!address) throw new Error('Wallet is locked');
  const typed = await quantt.withdrawalAddressChallenge(address);
  const signature = await signQuanttTypedData(typed);
  return quantt.bindWithdrawalAddress({ address, signature });
}
