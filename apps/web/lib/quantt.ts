'use client';
/**
 * Quantt integration for the web wallet.
 *
 * Wraps the shared @thanos/sdk-core QuanttClient with a localStorage session
 * store and the web signing worker — "Connect with Thanos" runs the EIP-712
 * wallet login through `signerSignTypedData` (the mnemonic stays in the worker,
 * never on the main thread). Quantt only ever sees a signature.
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
      const r = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
      return r ? (JSON.parse(r) as QuanttSession) : null;
    } catch {
      return null;
    }
  },
  set(s: QuanttSession | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const quantt = new QuanttClient({ store });

/** Sign in to Quantt using the unlocked web wallet (worker-signed). */
export async function quanttSignIn(): Promise<QuanttSession> {
  const { address } = await getSignerAddress();
  if (!address) throw new Error('Wallet is locked');
  const sign = async (typed: Eip712TypedData): Promise<string> => {
    // The worker's ethers signer wants types without the EIP712Domain entry.
    const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
    void _omit;
    const { signature } = await signerSignTypedData({
      domain: typed.domain,
      types: types as Record<string, Array<{ name: string; type: string }>>,
      message: typed.message,
    });
    return signature;
  };
  return quantt.signIn(address, sign);
}
