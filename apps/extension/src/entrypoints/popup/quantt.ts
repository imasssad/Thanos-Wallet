/**
 * Quantt integration for the extension popup.
 *
 * Wraps the shared @thanos/sdk-core QuanttClient with:
 *   • a chrome.storage.session-backed session store (bearer lives only for the
 *     browser session, like the rest of the wallet's unlocked state), and
 *   • a signTypedData bound to the offscreen signer — the SAME path the dApp
 *     `eth_signTypedData_v4` handler uses (see wc-signer.ts), so the popup
 *     process never holds a private key.
 *
 * "Connect with Thanos" runs the EIP-712 wallet login: Quantt issues a
 * self-contained SignIn challenge (domain Quantts.ai, chainId 700777), the
 * offscreen signer signs it, and Quantt returns a bearer session. Keys never
 * leave the wallet — Quantt only ever sees a signature.
 */
import { HDNodeWallet, Mnemonic } from 'ethers';
import { QuanttClient, type QuanttSession, type Eip712TypedData } from '@thanos/sdk-core';
import { getActiveAccountIndex } from '../../lib/vault';
import { signTypedData as offscreenSignTypedData } from './offscreen-sign';

const STORE_KEY = 'quantt_session';

/** Session token store — browser-session scoped (cleared on restart / by the
 *  wallet lock flow that clears session storage). */
const store = {
  async get(): Promise<QuanttSession | null> {
    try {
      const r = await browser.storage.session.get(STORE_KEY);
      return (r?.[STORE_KEY] as QuanttSession | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async set(s: QuanttSession | null): Promise<void> {
    try {
      if (s) await browser.storage.session.set({ [STORE_KEY]: s });
      else await browser.storage.session.remove(STORE_KEY);
    } catch {
      /* storage unavailable — in-memory session (client-side) still holds */
    }
  },
};

export const quantt = new QuanttClient({ store });

function hdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

/** The active account's EVM address (no private key materialised). */
export function quanttAddress(seed: string[]): string {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), hdPath()).address;
}

/** Sign in to Quantt with the unlocked wallet seed. Throws if locked. */
export async function quanttSignIn(seed: string[]): Promise<QuanttSession> {
  if (!seed?.length) throw new Error('Wallet is locked');
  const address = quanttAddress(seed);
  // Mirror wc-signer's eth_signTypedData_v4: pass types as-is (incl.
  // EIP712Domain) and map the challenge `message` → the signer's `value`.
  const sign = (typed: Eip712TypedData): Promise<string> =>
    offscreenSignTypedData({
      seed,
      hdPath: hdPath(),
      payload: { domain: typed.domain, types: typed.types, value: typed.message },
    });
  return quantt.signIn(address, sign);
}
