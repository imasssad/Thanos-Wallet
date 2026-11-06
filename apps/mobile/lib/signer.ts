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

/* ─── Solana / Cosmos ──────────────────────────────────────────────────
 * O-01 (H-1 residual): mnemonic-only — no private-key import exists for
 * either chain. The derivation logic below is copied from
 * lib/solana.ts / lib/cosmos.ts (not imported — this module must stay
 * the only place _seed is ever read) and must stay in lock-step with
 * them if either changes. */

const SOL_PATH = "m/44'/501'/0'/0'";

/** Minimal SLIP-0010 ed25519 derivation — see lib/solana.ts's own copy
 *  of this function for the Metro package-exports note on why the
 *  `.js` extensions below are required. */
function ed25519HD(masterSeed: Uint8Array, path: string): Uint8Array {
  const hmacSha512 = require('@noble/hashes/hmac.js').hmac;
  const { sha512 } = require('@noble/hashes/sha2.js');
  const utf8 = (s: string) => new TextEncoder().encode(s);
  let I = hmacSha512(sha512, utf8('ed25519 seed'), masterSeed);
  let key = I.slice(0, 32);
  let chain = I.slice(32, 64);
  for (const p of path.replace(/^m\//, '').split('/')) {
    const hardened = p.endsWith("'");
    const idx = (parseInt(hardened ? p.slice(0, -1) : p, 10) | (hardened ? 0x80000000 : 0)) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (idx >>> 24) & 0xff;
    data[34] = (idx >>> 16) & 0xff;
    data[35] = (idx >>> 8)  & 0xff;
    data[36] =  idx         & 0xff;
    I = hmacSha512(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32, 64);
  }
  return key;
}

async function solanaKeypair() {
  if (!_seed) throw new Error('Wallet is locked');
  if (PRIVATE_KEY_RE.test(_seed)) throw new Error('sol_requires_mnemonic');
  const { mnemonicToSeedSync } = await import('@scure/bip39');
  const { Keypair } = await import('@solana/web3.js');
  const seed = mnemonicToSeedSync(_seed);
  return Keypair.fromSeed(ed25519HD(seed, SOL_PATH));
}

export async function sendSolana(args: {
  recipient: string; amount: string; mintAddress?: string; decimals?: number;
}): Promise<string> {
  const {
    Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
  } = await import('@solana/web3.js');
  const signer = await solanaKeypair();
  // Matches lib/solana.ts's RPC_URLS[0] / packages/sdk-core's SOLANA_MAINNET.
  const connection = new Connection('https://solana-rpc.publicnode.com', 'confirmed');

  if (!args.mintAddress) {
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey:   new PublicKey(args.recipient.trim()),
      lamports:   Math.round(parseFloat(args.amount) * LAMPORTS_PER_SOL),
    }));
    return sendAndConfirmTransaction(connection, tx, [signer]);
  }

  const { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } =
    await import('@solana/spl-token');
  const mint = new PublicKey(args.mintAddress);
  const decimals = args.decimals ?? 6;
  const toOwner = new PublicKey(args.recipient.trim());
  const [fromAta, toAta] = await Promise.all([
    getAssociatedTokenAddress(mint, signer.publicKey),
    getAssociatedTokenAddress(mint, toOwner),
  ]);
  const accountInfo = await connection.getAccountInfo(toAta);
  const amount = BigInt(Math.round(parseFloat(args.amount) * 10 ** decimals));
  const tx = new Transaction();
  if (!accountInfo) tx.add(createAssociatedTokenAccountInstruction(signer.publicKey, toAta, toOwner, mint));
  tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, signer.publicKey, amount, decimals, [], TOKEN_PROGRAM_ID));
  return sendAndConfirmTransaction(connection, tx, [signer]);
}

export async function sendCosmosTx(args: {
  recipient: string; amount: string; memo?: string;
}): Promise<string> {
  if (!_seed) throw new Error('Wallet is locked');
  if (PRIVATE_KEY_RE.test(_seed)) throw new Error('cosmos_requires_mnemonic');
  const amt = parseFloat(args.amount);
  if (!amt || amt <= 0) throw new Error('invalid_amount');
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const { SigningStargateClient, GasPrice } = await import('@cosmjs/stargate');
  const { stringToPath } = await import('@cosmjs/crypto');
  // Matches lib/cosmos.ts's own defaults exactly.
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(_seed, {
    prefix: 'cosmos', hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
  });
  const [acc] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(
    'https://cosmos-rpc.publicnode.com', wallet, { gasPrice: GasPrice.fromString('0.025uatom') },
  );
  try {
    const amountMicro = Math.round(amt * 1e6).toString();
    const result = await client.sendTokens(
      acc.address, args.recipient.trim(), [{ denom: 'uatom', amount: amountMicro }], 'auto', args.memo ?? '',
    );
    if (result.code !== 0) throw new Error(result.rawLog || `cosmos_tx_failed_code_${result.code}`);
    return result.transactionHash;
  } finally { client.disconnect(); }
}

// O-01 (H-1 residual, non-signing): balance/receive displays used to call
// getSolanaAddress(mnemonic) / getCosmosAddress(mnemonic) with the
// mnemonic read out of component state. These derive the same address
// from this module's cache instead, so the mnemonic never has to leave
// it just to show a balance or receive address.

export async function solanaAddress(): Promise<string> {
  const signer = await solanaKeypair();
  return signer.publicKey.toBase58();
}

export async function cosmosAddress(): Promise<string> {
  if (!_seed) throw new Error('Wallet is locked');
  if (PRIVATE_KEY_RE.test(_seed)) throw new Error('cosmos_requires_mnemonic');
  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const { stringToPath } = await import('@cosmjs/crypto');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(_seed, {
    prefix: 'cosmos', hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
  });
  const [acc] = await wallet.getAccounts();
  return acc.address;
}
