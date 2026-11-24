/**
 * Quantt on mobile: the platform wiring around lib/quantt-client.ts.
 *
 * The client itself is the dependency-free twin of
 * packages/sdk-core/src/quantt/client.ts and is tested against it from
 * sdk-core's suite — see that file's header. Everything that needs expo,
 * react-native or ethers lives HERE: the expo-secure-store session, the
 * expo/fetch streaming transport (RN's own fetch can't stream), the wallet
 * that signs the EIP-712 challenge, and the session-owner bookkeeping.
 *
 * Re-exports the whole client surface, so `import … from './lib/quantt'`
 * keeps working everywhere in the app.
 */
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { HDNodeWallet, Wallet } from 'ethers';
import {
  QuanttClient,
  type Eip712TypedData, type QuanttSession, type SessionStore, type StreamFetch,
} from './quantt-client';

export * from './quantt-client';

/* ── mobile wiring ──────────────────────────────────────────────────── */

const STORE_KEY = 'quantt_session';

const store: SessionStore = {
  async get(): Promise<QuanttSession | null> {
    try {
      const r = await SecureStore.getItemAsync(STORE_KEY);
      return r ? (JSON.parse(r) as QuanttSession) : null;
    } catch {
      return null;
    }
  },
  async set(s: QuanttSession | null): Promise<void> {
    try {
      if (s) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
      else await SecureStore.deleteItemAsync(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const quantt = new QuanttClient({ store, streamFetch: expoFetch as unknown as StreamFetch });

/** The wallet address the saved Quantt sign-in belongs to. The session stays
 *  in the keychain across app restarts and locks (client 2026-10-08: no
 *  reconnecting after every app close), so the app drops it when the active
 *  account is a different one. */
const OWNER_KEY = 'quantt_session_addr';
export async function quanttSessionOwner(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(OWNER_KEY); } catch { return null; }
}

/** Drop the Quantt session (stored copy first, then a best-effort server
 *  logout). Called when the wallet is wiped or the account changes. */
export async function forgetQuanttSession(): Promise<void> {
  try { await SecureStore.deleteItemAsync(OWNER_KEY); } catch { /* nothing stored */ }
  return quantt.signOut();
}

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** The active account's signer: a wallet imported by private key is that one
 *  key (the seed is ['0x…']); otherwise the seed's key at the active index. */
function quanttWallet(seed: string[], accountIdx: number): Wallet | HDNodeWallet {
  if (!seed?.length) throw new Error('Wallet is locked');
  if (seed.length === 1 && PRIVATE_KEY_RE.test(seed[0].trim())) return new Wallet(seed[0].trim());
  return HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${accountIdx}`);
}

/** Sign in to Quantt with the unlocked wallet seed (inline EIP-712). */
export async function quanttSignIn(seed: string[], accountIdx: number): Promise<QuanttSession> {
  const wallet = quanttWallet(seed, accountIdx);
  const sign = (typed: Eip712TypedData): Promise<string> => {
    const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
    void _omit;
    return wallet.signTypedData(
      typed.domain,
      types as Record<string, Array<{ name: string; type: string }>>,
      typed.message,
    );
  };
  const session = await quantt.signIn(wallet.address, sign);
  try { await SecureStore.setItemAsync(OWNER_KEY, wallet.address); } catch { /* the session still works */ }
  return session;
}

/** Bind (or re-verify) the address withdrawals pay out to, signed inline
 *  with the unlocked wallet seed — same challenge → sign → submit shape as
 *  quanttSignIn above. Withdrawals only ever go to this verified address,
 *  never an arbitrary one passed at withdraw time. */
export async function quanttBindWithdrawalAddress(seed: string[], accountIdx: number, address: string): Promise<unknown> {
  const wallet = quanttWallet(seed, accountIdx);
  const typed = await quantt.withdrawalAddressChallenge(address);
  const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
  void _omit;
  const signature = await wallet.signTypedData(
    typed.domain,
    types as Record<string, Array<{ name: string; type: string }>>,
    typed.message,
  );
  return quantt.bindWithdrawalAddress({ address, signature });
}
