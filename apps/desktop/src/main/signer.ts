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
 * `wallet.sendTransaction()` / signMessage / signTypedData calls into
 * the main process — which has no remote content loaded and no DevTools
 * surface in production builds — drops one rung of attack surface.
 *
 * The seed itself still has to cross IPC once, at unlock. The main
 * process holds it in a closure-scoped variable that gets cleared on
 * lock, on window close, or on app quit.
 */
import { HDNodeWallet, Mnemonic, Wallet, Contract, JsonRpcProvider } from 'ethers';

let _seed: string | null = null;

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

/** The chain a transfer was approved on — every send names it. */
export interface SignChain { chainId: number; rpcUrl: string }

/** Provider for exactly that chain. There is no default network: a send
 *  without a chain is refused, so a Mainnet balance can never be spent on
 *  some other chain (the extension once sent Mainnet LITHO on Makalu that
 *  way). http(s), like the custom-network form. */
function chainProvider(chain: SignChain | undefined): JsonRpcProvider {
  const chainId = chain && Number.isSafeInteger(chain.chainId) && chain.chainId > 0 ? chain.chainId : 0;
  const rpcUrl  = chain && typeof chain.rpcUrl === 'string' && /^https?:\/\//i.test(chain.rpcUrl) ? chain.rpcUrl : '';
  if (!chainId || !rpcUrl) throw new Error('No network selected for this transaction');
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
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

/** A wallet imported from a raw key stores the 0x-hex string in _seed
 *  instead of a mnemonic; it's a single EVM account, so hdPath is ignored. */
function isRawKey(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim());
}

function unlockedWallet(hdPath: string): HDNodeWallet | Wallet {
  if (!_seed) throw new Error('Wallet is locked — call signer:set-seed first');
  if (isRawKey(_seed)) return new Wallet(_seed.trim());
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

export async function signAndBroadcast(hdPath: string, tx: TxRequest, chain: SignChain): Promise<string> {
  const w = unlockedWallet(hdPath).connect(chainProvider(chain));
  // Pin the chain into the signature itself, not just the RPC we send to.
  const sent = await w.sendTransaction({ ...normaliseTx(tx), chainId: BigInt(chain.chainId) });
  return sent.hash;
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
}, chain: SignChain): Promise<string> {
  const w = unlockedWallet(hdPath).connect(chainProvider(chain));
  const c = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, w);
  const sent = await c.transfer(args.to, BigInt(args.amount));
  return sent.hash as string;
}

/** Returns the EVM address derived at `hdPath` for the cached seed,
 *  without exposing the key material to the renderer. */
export function deriveAddress(hdPath: string): string {
  return unlockedWallet(hdPath).address;
}
