/**
 * Module-isolated EVM signer for mobile.
 *
 * React Native has no Web Worker primitive (no DOM, Hermes runs in its
 * own JS thread but exposes one shared global scope to the bundle), so
 * worker-based key isolation isn't an option. The next best thing:
 *
 *   - Seed lives in a module-scope `let`, not in any React component
 *     state. React DevTools can inspect props + state of every mounted
 *     component, but it has no visibility into module-scoped variables.
 *   - Every signing operation goes through this module's exported
 *     functions. No caller ever holds a derived private key — only the
 *     final signed payload (which is what they'd transmit anyway).
 *   - `clearSeed()` runs on lock, on background → foreground after the
 *     auto-lock timeout, and on app teardown.
 *
 * This is *partial* isolation. A JS-level attacker with code execution
 * in the same bundle can still call `setSeed` / `signAndBroadcast` /
 * etc. directly. The win is against accidental exposure: crash logs
 * never include seeds, Sentry breadcrumbs never include seeds, and
 * React Native Inspector / Flipper can't surface them via component
 * tree dumps.
 */
import {
  Contract, HDNodeWallet, Wallet, JsonRpcProvider, Mnemonic,
  type BaseWallet, type TransactionRequest, type TypedDataDomain, type TypedDataField,
} from 'ethers';

// A raw private-key wallet (imported via the onboarding "private key" path)
// is carried through the same `_seed` string as a single 0x-prefixed key.
// HD-path derivation doesn't apply — a private key IS one account — so
// walletFor() returns a flat Wallet and ignores the requested path.
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

let _seed: string | null = null;

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

/** The chain a transfer was approved on — every broadcast names it. */
export interface SignChain { chainId: number; rpcUrl: string }

/** Provider for exactly that chain. There is no default network: a send
 *  without a chain is refused, so a Mainnet balance can never be spent on
 *  some other chain (this module used to broadcast everything on Makalu). */
function chainProvider(chain: SignChain | undefined): JsonRpcProvider {
  const chainId = chain && Number.isSafeInteger(chain.chainId) && chain.chainId > 0 ? chain.chainId : 0;
  const rpcUrl  = chain && typeof chain.rpcUrl === 'string' && /^https?:\/\//i.test(chain.rpcUrl) ? chain.rpcUrl : '';
  if (!chainId || !rpcUrl) throw new Error('No network selected for this transaction');
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
}

export function setSeed(seed: string | string[]): void {
  const phrase = Array.isArray(seed) ? seed.join(' ') : seed;
  if (!phrase) throw new Error('signer.setSeed needs a non-empty phrase');
  _seed = phrase;
}

export function clearSeed(): void {
  _seed = null;
}

export function hasSeed(): boolean {
  return _seed !== null;
}

function walletFor(hdPath: string): BaseWallet {
  if (!_seed) throw new Error('Wallet is locked');
  if (PRIVATE_KEY_RE.test(_seed)) return new Wallet(_seed); // PK wallet — single account
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(_seed), hdPath);
}

export function deriveAddress(hdPath = "m/44'/60'/0'/0/0"): string {
  return walletFor(hdPath).address;
}

export async function signAndBroadcast(
  hdPath: string, tx: TransactionRequest, chain: SignChain,
): Promise<string> {
  const w = walletFor(hdPath).connect(chainProvider(chain));
  // Pin the chain into the signature itself, not just the RPC we send to.
  const sent = await w.sendTransaction({ ...tx, chainId: BigInt(chain.chainId) });
  return sent.hash;
}

/** Read-only: wait for a tx receipt on its chain so callers can fire a
 *  "confirmed / failed" notification. Returns {ok} on a mined receipt,
 *  or null on timeout/error (never throws — pure best-effort). */
export async function waitForReceipt(hash: string, chain: SignChain): Promise<{ ok: boolean } | null> {
  try {
    const r = await chainProvider(chain).waitForTransaction(hash, 1, 90_000); // 1 conf, 90s cap
    return r ? { ok: r.status === 1 } : null;
  } catch { return null; }
}

export async function signTransaction(
  hdPath: string, tx: TransactionRequest,
): Promise<string> {
  return walletFor(hdPath).signTransaction(tx);
}

export async function signPersonalMessage(
  hdPath: string, message: string | Uint8Array,
): Promise<string> {
  return walletFor(hdPath).signMessage(message);
}

export async function signTypedData(
  hdPath: string,
  payload: {
    domain: TypedDataDomain;
    types:  Record<string, Array<TypedDataField>>;
    value:  Record<string, unknown>;
  },
): Promise<string> {
  const cleaned = { ...payload.types };
  delete (cleaned as { EIP712Domain?: unknown }).EIP712Domain;
  return walletFor(hdPath).signTypedData(payload.domain, cleaned, payload.value);
}

export async function transferErc20(
  hdPath: string, args: { tokenAddress: string; to: string; amount: bigint }, chain: SignChain,
): Promise<string> {
  const w = walletFor(hdPath).connect(chainProvider(chain));
  const c = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, w);
  const sent = await c.transfer(args.to, args.amount);
  return sent.hash as string;
}
