/**
 * Main-process signer for the desktop wallet.
 *
 * Architecture: the renderer holds the unlocked seed only during the
 * short window between `signer:set-seed` (called at unlock) and the
 * eventual `signer:clear-seed` (called at lock). Between those calls,
 * the renderer can request signatures via IPC without ever holding the
 * derived private key.
 *
 * Why this matters: Electron renderers are full-power browser contexts
 * with DevTools, an open IPC bridge, and any vulnerability in the
 * shipped JS becomes seed-exfiltration potential. Moving the actual
 * `wallet.signTransaction()` + `wallet.sendTransaction()` calls into
 * the main process — which has no remote content loaded and no DevTools
 * surface in production builds — drops one rung of attack surface.
 *
 * The seed itself still has to cross IPC once, at unlock. The main
 * process holds it in a closure-scoped variable that gets cleared on
 * lock, on window close, or on app quit.
 */
import { HDNodeWallet, Mnemonic, Contract, JsonRpcProvider, FallbackProvider } from 'ethers';

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

export function setSeed(seed: string): void {
  if (!seed || typeof seed !== 'string') throw new Error('signer:set-seed expects a non-empty string');
  _seed = seed;
}

export function clearSeed(): void {
  _seed = null;
}

export function hasSeed(): boolean {
  return _seed !== null;
}

function unlockedWallet(hdPath: string): HDNodeWallet {
  if (!_seed) throw new Error('Wallet is locked — call signer:set-seed first');
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(_seed), hdPath);
}

export interface TxRequest {
  to?:    string;
  value?: string;
  data?:  string;
  gas?:   string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
}

function normaliseTx(tx: TxRequest): import('ethers').TransactionRequest {
  const out: import('ethers').TransactionRequest = {};
  if (tx.to)    out.to    = tx.to;
  if (tx.data)  out.data  = tx.data;
  if (tx.value) out.value = BigInt(tx.value);
  if (tx.gas)   out.gasLimit = BigInt(tx.gas);
  if (tx.gasPrice) out.gasPrice = BigInt(tx.gasPrice);
  if (tx.maxFeePerGas)         out.maxFeePerGas         = BigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas) out.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  if (typeof tx.nonce === 'number') out.nonce = tx.nonce;
  return out;
}

export async function signAndBroadcast(hdPath: string, tx: TxRequest): Promise<string> {
  const w = unlockedWallet(hdPath).connect(provider());
  const sent = await w.sendTransaction(normaliseTx(tx));
  return sent.hash;
}

export async function signTransaction(hdPath: string, tx: TxRequest): Promise<string> {
  const w = unlockedWallet(hdPath);
  return w.signTransaction(normaliseTx(tx));
}

export async function signPersonalMessage(hdPath: string, message: string | Uint8Array): Promise<string> {
  const w = unlockedWallet(hdPath);
  return w.signMessage(message);
}

export async function signTypedData(hdPath: string, payload: {
  domain: import('ethers').TypedDataDomain;
  types:  Record<string, Array<import('ethers').TypedDataField>>;
  value:  Record<string, unknown>;
}): Promise<string> {
  const w = unlockedWallet(hdPath);
  const cleaned = { ...payload.types };
  delete (cleaned as { EIP712Domain?: unknown }).EIP712Domain;
  return w.signTypedData(payload.domain, cleaned, payload.value);
}

export async function transferErc20(hdPath: string, args: {
  tokenAddress: string; to: string; amount: string;
}): Promise<string> {
  const w = unlockedWallet(hdPath).connect(provider());
  const c = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, w);
  const sent = await c.transfer(args.to, BigInt(args.amount));
  return sent.hash as string;
}

/** Returns the EVM address derived at `hdPath` for the cached seed,
 *  without exposing the key material to the renderer. */
export function deriveAddress(hdPath: string): string {
  return unlockedWallet(hdPath).address;
}
