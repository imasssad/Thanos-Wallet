/**
 * Real signing + broadcast for the EVM wallet flows.
 *
 * Takes the unlocked BIP39 mnemonic, derives an ethers Wallet at
 * m/44'/60'/0'/0/0, attaches a JsonRpcProvider for Makalu (chain 700777),
 * and exposes send paths for both the native LITHO coin and any LEP100
 * (standard ERC-20) token.
 *
 * Nothing in this module is cached — callers should construct a fresh
 * signer per operation and discard it. That way the private key only
 * lives in memory for the lifetime of a single transaction.
 */
import {
  Contract, HDNodeWallet, Mnemonic, Wallet,
  formatEther, parseUnits,
  type Provider, type TransactionRequest, type TransactionResponse,
} from 'ethers';
import { estimateMakaluGas } from './gas';
import { TOKEN_BY_SYM, type Token } from './tokens';
import { resolveToEvm } from './address';

/* ─── Constants ────────────────────────────────────────────────────────── */

import { getMakaluProvider, MAKALU_CHAIN_ID as _CHAIN_ID } from './rpc';

export const MAKALU_CHAIN_ID = _CHAIN_ID;

const HD_PATH = "m/44'/60'/0'/0/0";

/* Minimal ABI — just transfer() for send, balanceOf() for refresh. */
const LEP100_TRANSFER_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/* ─── Signer construction ─────────────────────────────────────────────── */

export function makeProvider() {
  return getMakaluProvider();
}

/**
 * Derive an ethers Wallet from the unlocked BIP39 phrase.
 * Throws if the phrase is invalid (shouldn't happen — the gate already
 * decrypted it from a vault we created).
 */
export function walletFromSeed(seed: string[], provider?: Provider): HDNodeWallet {
  const phrase = seed.join(' ');
  const mnemonic = Mnemonic.fromPhrase(phrase);
  const hd = HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
  return provider ? (hd.connect(provider) as HDNodeWallet) : hd;
}

/**
 * Unified input shape for the send/estimate paths. A wallet is built either
 * from a 12/24-word seed (HD path) or from a raw 0x-prefixed private key
 * (single account). Helper resolves to an ethers Wallet for signing.
 */
export type WalletInput =
  | { seed: string[] }
  | { privateKey: string };

export function walletFromInput(input: WalletInput, provider?: Provider): HDNodeWallet | Wallet {
  if ('privateKey' in input) {
    const w = new Wallet(input.privateKey);
    return provider ? (w.connect(provider) as Wallet) : w;
  }
  return walletFromSeed(input.seed, provider);
}

/* ─── Send flows ───────────────────────────────────────────────────────── */

export type SendInput = {
  /** Token symbol — must exist in lib/tokens.ts TOKEN_BY_SYM. */
  symbol:    string;
  /** Recipient — may be 0x… or litho1…; we normalise internally. */
  recipient: string;
  /** Human-readable amount, e.g. "1.5" — converted to wei using token decimals. */
  amount:    string;
};

export type SendResult = {
  hash:   string;
  symbol: string;
  /** Resolved EVM recipient (post-bech32 conversion). */
  to:     string;
  /** Wei amount sent. */
  value:  bigint;
  /** Whether this was a native LITHO send vs an ERC-20 transfer. */
  kind:   'native' | 'erc20';
  /** Promise that resolves to the receipt when the tx is mined. */
  wait:   () => Promise<{ blockNumber: number; status: number }>;
};

export class SendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SendError';
  }
}

/**
 * Sign + broadcast the send. Returns the tx hash immediately and a `wait()`
 * function for the caller to poll for confirmation.
 *
 * Errors are thrown as SendError with a code so the UI can branch:
 *   - 'invalid_token'   — unknown symbol
 *   - 'invalid_address' — recipient didn't parse as 0x or litho1
 *   - 'invalid_amount'  — non-positive amount
 *   - 'insufficient'    — balance too low (ethers-detected pre-broadcast)
 *   - 'rpc_error'       — network / node failure
 *   - 'rejected'        — user-side cancel (only meaningful with HW wallets)
 */
export async function sendTokens(walletInput: WalletInput, input: SendInput): Promise<SendResult> {
  const token: Token | undefined = TOKEN_BY_SYM[input.symbol];
  if (!token) throw new SendError('invalid_token', `Unknown token: ${input.symbol}`);

  const to = resolveToEvm(input.recipient.trim());
  if (!to) throw new SendError('invalid_address', 'Recipient is not a valid 0x or litho1 address');

  let weiAmount: bigint;
  try {
    weiAmount = parseUnits(input.amount, token.decimals);
  } catch {
    throw new SendError('invalid_amount', 'Enter a valid amount');
  }
  if (weiAmount <= 0n) throw new SendError('invalid_amount', 'Amount must be greater than zero');

  const provider = makeProvider();
  const wallet = walletFromInput(walletInput, provider);

  let tx: TransactionResponse;
  try {
    if (token.address === null) {
      // Native LITHO transfer.
      tx = await wallet.sendTransaction({ to, value: weiAmount });
    } else {
      // LEP100 / ERC-20 transfer.
      const contract = new Contract(token.address, LEP100_TRANSFER_ABI, wallet);
      tx = await contract.transfer(to, weiAmount);
    }
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/insufficient funds/i.test(msg)) {
      throw new SendError('insufficient', 'Insufficient balance to cover amount + gas');
    }
    if (/user rejected/i.test(msg)) {
      throw new SendError('rejected', 'You cancelled the transaction');
    }
    throw new SendError('rpc_error', msg || 'Network error while broadcasting');
  }

  return {
    hash:   tx.hash,
    symbol: token.sym,
    to,
    value:  weiAmount,
    kind:   token.address === null ? 'native' : 'erc20',
    wait:   async () => {
      const receipt = await tx.wait();
      if (!receipt) throw new SendError('rpc_error', 'Receipt unavailable');
      return { blockNumber: receipt.blockNumber, status: Number(receipt.status ?? 0) };
    },
  };
}

/* ─── Fee estimate (cheap, doesn't broadcast) ──────────────────────────── */

export interface FeeEstimate {
  /** Maxed gas units the tx is expected to use. */
  gasLimit:  bigint;
  /** EIP-1559 maxFeePerGas (wei). */
  maxFeePerGas: bigint;
  /** Total fee ceiling in wei (gasLimit * maxFeePerGas). */
  totalWei:  bigint;
  /** Formatted total in native LITHO (just for display). */
  totalLitho: string;
}

export async function estimateSendFee(walletInput: WalletInput, input: SendInput): Promise<FeeEstimate | null> {
  const token = TOKEN_BY_SYM[input.symbol];
  if (!token) return null;
  const to = resolveToEvm(input.recipient.trim());
  if (!to) return null;

  let weiAmount: bigint;
  try { weiAmount = parseUnits(input.amount || '0', token.decimals); }
  catch { return null; }
  if (weiAmount <= 0n) return null;

  const provider = makeProvider();
  const wallet = walletFromInput(walletInput, provider);

  try {
    // Build the unsigned tx the same way the send path will so the gas
    // estimate matches the actual broadcast. estimateMakaluGas centralises
    // the maxFeePerGas read so any oracle upgrade flows here automatically.
    let tx: TransactionRequest;
    if (token.address === null) {
      tx = { from: wallet.address, to, value: weiAmount };
    } else {
      const contract = new Contract(token.address, LEP100_TRANSFER_ABI, wallet);
      // populateTransaction returns the calldata-encoded request without
      // signing or broadcasting — exactly what estimateGas needs.
      tx = await contract.transfer.populateTransaction(to, weiAmount);
      tx.from = wallet.address;
    }
    const est = await estimateMakaluGas({ tx, provider });
    return {
      gasLimit:     est.gasLimit,
      maxFeePerGas: est.maxFeePerGas,
      totalWei:     est.totalWei,
      totalLitho:   est.totalLitho,
    };
  } catch {
    return null;
  }
}

/* ─── Reading: live balance for a single token ─────────────────────────── */

export async function getTokenBalance(address: string, symbol: string): Promise<bigint> {
  const token = TOKEN_BY_SYM[symbol];
  if (!token) return 0n;
  const provider = makeProvider();
  if (token.address === null) {
    return provider.getBalance(address);
  }
  const contract = new Contract(token.address, LEP100_TRANSFER_ABI, provider);
  return contract.balanceOf(address) as Promise<bigint>;
}
