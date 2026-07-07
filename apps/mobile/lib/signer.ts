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
  Contract, HDNodeWallet, Wallet, JsonRpcProvider, Mnemonic, FallbackProvider,
  type BaseWallet, type TransactionRequest, type TypedDataDomain, type TypedDataField,
} from 'ethers';

// A raw private-key wallet (imported via the onboarding "private key" path)
// is carried through the same `_seed` string as a single 0x-prefixed key.
// HD-path derivation doesn't apply — a private key IS one account — so
// walletFor() returns a flat Wallet and ignores the requested path.
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

let _seed: string | null = null;
let _provider: JsonRpcProvider | FallbackProvider | null = null;

const MAKALU_RPC_URLS = [
  'https://rpc.litho.ai',
  'https://rpc-2.litho.ai',
];

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

function provider(): JsonRpcProvider | FallbackProvider {
  if (_provider) return _provider;
  const providers = MAKALU_RPC_URLS.map((url, i) => ({
    provider: new JsonRpcProvider(url, undefined, { staticNetwork: true }),
    priority: i + 1,
    stallTimeout: 2_000,
    weight: 1,
  }));
  _provider = providers.length > 1
    ? new FallbackProvider(providers, undefined, { quorum: 1 })
    : providers[0].provider;
  return _provider;
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
  hdPath: string, tx: TransactionRequest,
): Promise<string> {
  const w = walletFor(hdPath).connect(provider());
  const sent = await w.sendTransaction(tx);
  return sent.hash;
}

/** Read-only: wait for a Makalu tx receipt so callers can fire a
 *  "confirmed / failed" notification. Returns {ok} on a mined receipt,
 *  or null on timeout/error (never throws — pure best-effort). */
export async function waitForReceipt(hash: string): Promise<{ ok: boolean } | null> {
  try {
    const r = await provider().waitForTransaction(hash, 1, 90_000); // 1 conf, 90s cap
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
  hdPath: string, args: { tokenAddress: string; to: string; amount: bigint },
): Promise<string> {
  const w = walletFor(hdPath).connect(provider());
  const c = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, w);
  const sent = await c.transfer(args.to, args.amount);
  return sent.hash as string;
}
