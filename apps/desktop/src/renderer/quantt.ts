/**
 * Quantt integration for the desktop renderer.
 *
 * Wraps the shared @thanos/sdk-core QuanttClient with a sessionStorage session
 * store and an inline EIP-712 signer — the SAME `walletFromSeed(...).signTypedData`
 * path the renderer already uses for dApp `eth_signTypedData_v4` (see
 * wc-signer.ts). "Connect with Thanos" runs the wallet login; keys are derived
 * only to sign, and Quantt only ever sees a signature. The challenge is
 * validated before signing (sdk-core quantt/challenge.ts).
 *
 * SESSION LIFETIME: the bearer + refresh tokens live in sessionStorage (gone
 * when the app quits) and forgetQuanttSession() drops them when the wallet
 * locks or is reset. Older builds kept them in localStorage; that copy is
 * purged on load.
 */
import { HDNodeWallet, Mnemonic } from 'ethers';
import { QuanttClient, type QuanttSession, type Eip712TypedData } from '@thanos/sdk-core';
import { getActiveAccountIndex } from './vault';

const STORE_KEY = 'quantt_session';

const store = {
  get(): QuanttSession | null {
    try {
      const r = sessionStorage.getItem(STORE_KEY);
      return r ? (JSON.parse(r) as QuanttSession) : null;
    } catch {
      return null;
    }
  },
  set(s: QuanttSession | null): void {
    try {
      if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

// One-time cleanup of the long-lived copy older builds kept in localStorage.
try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }

export const quantt = new QuanttClient({ store });

/** Drop the Quantt session — the stored copy at once, then the client's own
 *  state and a best-effort server logout. Called on wallet lock / reset. */
export function forgetQuanttSession(): Promise<void> {
  // signOut() reads the session (this store is synchronous) before its first
  // await, so the server logout still gets the token after the clear below.
  const done = quantt.signOut();
  store.set(null);
  return done;
}

function hdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

/** Sign in to Quantt with the unlocked wallet seed (inline EIP-712). */
export async function quanttSignIn(seed: string[]): Promise<QuanttSession> {
  if (!seed?.length) throw new Error('Wallet is locked');
  const wallet = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), hdPath());
  const sign = (typed: Eip712TypedData): Promise<string> => {
    // ethers wants types without the EIP712Domain entry (derived from domain).
    const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
    void _omit;
    return wallet.signTypedData(
      typed.domain,
      types as Record<string, Array<{ name: string; type: string }>>,
      typed.message,
    );
  };
  return quantt.signIn(wallet.address, sign);
}
