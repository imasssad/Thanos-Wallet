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
import { getEvmChain, getEvmProvider } from './evm-chains';
import { TOKEN_BY_SYM, type Token } from './tokens';
import { resolveToEvm } from './address';

/* ─── Constants ────────────────────────────────────────────────────────── */

import { getMakaluProvider, getKametProvider, MAKALU_CHAIN_ID as _CHAIN_ID, KAMET_CHAIN_ID } from './rpc';
import { getActiveAccountIndex } from './vault';

export const MAKALU_CHAIN_ID = _CHAIN_ID;

/** HD path for the active EVM account. Read at sign time so a switch in
 *  the TopNav takes effect on the very next transaction. */
function hdPath(idx: number = getActiveAccountIndex()): string {
  return `m/44'/60'/0'/0/${idx}`;
}

/* Minimal ABI — transfer() for send, approve() for spend allowance management,
   balanceOf() for refresh. */
const LEP100_TRANSFER_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
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
export function walletFromSeed(seed: string[], provider?: Provider, accountIdx?: number): HDNodeWallet {
  const phrase = seed.join(' ');
  const mnemonic = Mnemonic.fromPhrase(phrase);
  const hd = HDNodeWallet.fromMnemonic(mnemonic, hdPath(accountIdx));
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

export function walletFromInput(input: WalletInput, provider?: Provider, accountIdx?: number): HDNodeWallet | Wallet {
  if ('privateKey' in input) {
    const w = new Wallet(input.privateKey);
    return provider ? (w.connect(provider) as Wallet) : w;
  }
  return walletFromSeed(input.seed, provider, accountIdx);
}

/* ─── Chain-aware native EVM send ─────────────────────────────────────
   `sendTokens` above is hard-wired to Makalu (LITHO + LEP100 tokens).
   For other EVM chains (Ethereum, BNB, Polygon, Base, Arbitrum, Linea,
   Optimism, Avalanche) we use the same keypair but route through that
   chain's RPC via getEvmProvider.

   This path only supports native gas-coin transfers today
   (ETH / BNB / POL / AVAX). ERC-20 catalogs per chain land in a
   follow-up commit. */

export interface NativeSendInput {
  chainId:   number;
  recipient: string;        // 0x… address; bech32 only valid on Makalu
  amount:    string;        // human-readable, parsed against 18 decimals
  accountIdx?: number;      // HD account to sign from (default 0)
}

export async function sendNativeEvm(walletInput: WalletInput, input: NativeSendInput): Promise<SendResult> {
  const chain = getEvmChain(input.chainId);
  if (!chain) throw new SendError('invalid_chain', `Unsupported chain: ${input.chainId}`);

  const to = input.recipient.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new SendError('invalid_address', `${chain.name} requires a 0x EVM address`);
  }

  let weiAmount: bigint;
  try { weiAmount = parseUnits(input.amount, chain.decimals); }
  catch { throw new SendError('invalid_amount', 'Enter a valid amount'); }
  if (weiAmount <= 0n) throw new SendError('invalid_amount', 'Amount must be greater than zero');

  const provider = getEvmProvider(input.chainId);
  const wallet   = walletFromInput(walletInput, provider, input.accountIdx);

  let tx: TransactionResponse;
  try {
    tx = await wallet.sendTransaction({ to, value: weiAmount });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/insufficient funds/i.test(msg))  throw new SendError('insufficient', `Insufficient ${chain.nativeSymbol} for amount + gas`);
    if (/user rejected/i.test(msg))       throw new SendError('rejected', 'You cancelled the transaction');
    throw new SendError('rpc_error', msg || 'Network error while broadcasting');
  }

  return {
    hash:   tx.hash,
    symbol: chain.nativeSymbol,
    to,
    value:  weiAmount,
    kind:   'native',
    wait:   async () => {
      const r = await tx.wait();
      if (!r) throw new SendError('rpc_error', 'Receipt unavailable');
      return { blockNumber: r.blockNumber, status: Number(r.status ?? 0) };
    },
  };
}

export interface EvmTokenSendInput {
  chainId:      number;
  tokenAddress: string;
  decimals:     number;
  symbol:       string;     // for error messages + the SendResult
  recipient:    string;     // 0x… address
  amount:       string;     // human-readable, parsed against the token decimals
  accountIdx?:  number;     // HD account to sign from (default 0)
}

/** ERC-20 token transfer on any supported EVM chain (USDT/USDC/etc.). The
 *  chain-aware sibling of sendNativeEvm — sendTokens() is Makalu-only. */
export async function sendEvmToken(walletInput: WalletInput, input: EvmTokenSendInput): Promise<SendResult> {
  const chain = getEvmChain(input.chainId);
  if (!chain) throw new SendError('invalid_chain', `Unsupported chain: ${input.chainId}`);

  const to = input.recipient.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new SendError('invalid_address', `${chain.name} requires a 0x EVM address`);
  }

  let amount: bigint;
  try { amount = parseUnits(input.amount, input.decimals); }
  catch { throw new SendError('invalid_amount', 'Enter a valid amount'); }
  if (amount <= 0n) throw new SendError('invalid_amount', 'Amount must be greater than zero');

  const provider = getEvmProvider(input.chainId);
  const wallet   = walletFromInput(walletInput, provider, input.accountIdx);

  let tx: TransactionResponse;
  try {
    const contract = new Contract(input.tokenAddress, LEP100_TRANSFER_ABI, wallet);
    tx = await contract.transfer(to, amount);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/transfer amount exceeds balance/i.test(msg)) throw new SendError('insufficient', `Insufficient ${input.symbol} balance`);
    if (/insufficient funds/i.test(msg))              throw new SendError('insufficient', `Insufficient ${chain.nativeSymbol} for gas`);
    if (/user rejected/i.test(msg))                   throw new SendError('rejected', 'You cancelled the transaction');
    throw new SendError('rpc_error', msg || 'Network error while broadcasting');
  }

  return {
    hash:   tx.hash,
    symbol: input.symbol,
    to,
    value:  amount,
    kind:   'erc20',
    wait:   async () => {
      const r = await tx.wait();
      if (!r) throw new SendError('rpc_error', 'Receipt unavailable');
      return { blockNumber: r.blockNumber, status: Number(r.status ?? 0) };
    },
  };
}

/**
 * Native LITHO transfer on a chosen Lithosphere chain — Makalu (700777) or
 * Kamet (900523). Makalu keyring sends normally go through the signer worker;
 * this is the chain-aware main-thread path that makes Kamet sends work (the
 * worker doesn't thread a chainId yet). Recipient may be 0x or litho1.
 */
export async function sendLithoNative(
  walletInput: WalletInput,
  input: { chainId: number; recipient: string; amount: string; accountIdx?: number },
): Promise<SendResult> {
  const provider = input.chainId === KAMET_CHAIN_ID ? getKametProvider() : getMakaluProvider();
  const to = resolveToEvm(input.recipient.trim());
  if (!to) throw new SendError('invalid_address', 'Recipient is not a valid 0x or litho1 address');

  let weiAmount: bigint;
  try { weiAmount = parseUnits(input.amount, 18); }
  catch { throw new SendError('invalid_amount', 'Enter a valid amount'); }
  if (weiAmount <= 0n) throw new SendError('invalid_amount', 'Amount must be greater than zero');

  // Sign from the ACTIVE account.
  const wallet = walletFromInput(walletInput, provider, input.accountIdx);

  let tx: TransactionResponse;
  try {
    tx = await wallet.sendTransaction({ to, value: weiAmount });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/insufficient funds/i.test(msg)) throw new SendError('insufficient', 'Insufficient LITHO for amount + gas');
    if (/user rejected/i.test(msg))      throw new SendError('rejected', 'You cancelled the transaction');
    throw new SendError('rpc_error', msg || 'Network error while broadcasting');
  }

  return {
    hash:   tx.hash,
    symbol: 'LITHO',
    to,
    value:  weiAmount,
    kind:   'native',
    wait:   async () => {
      const r = await tx.wait();
      if (!r) throw new SendError('rpc_error', 'Receipt unavailable');
      return { blockNumber: r.blockNumber, status: Number(r.status ?? 0) };
    },
  };
}

/** Cheap gas estimate for a native send on the given EVM chain. Same
 *  shape FeeEstimate as the Makalu path so the SendModal can render it
 *  with the same UI. */
export async function estimateNativeEvmFee(walletInput: WalletInput, input: NativeSendInput): Promise<FeeEstimate | null> {
  const chain = getEvmChain(input.chainId);
  if (!chain) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.recipient.trim())) return null;
  let weiAmount: bigint;
  try { weiAmount = parseUnits(input.amount || '0', chain.decimals); }
  catch { return null; }
  if (weiAmount <= 0n) return null;

  const provider = getEvmProvider(input.chainId);
  const wallet   = walletFromInput(walletInput, provider);

  try {
    const est = await estimateMakaluGas({
      tx: { from: wallet.address, to: input.recipient.trim(), value: weiAmount },
      provider,
    });
    return {
      gasLimit:     est.gasLimit,
      maxFeePerGas: est.maxFeePerGas,
      totalWei:     est.totalWei,
      // formatUnits for the chain's native — same call signature as Makalu.
      totalLitho:   est.totalLitho,
    };
  } catch {
    return null;
  }
}

/* ─── Send flows ───────────────────────────────────────────────────────── */

export type SendInput = {
  /** Token symbol — must exist in lib/tokens.ts TOKEN_BY_SYM. */
  symbol:    string;
  /** Recipient — may be 0x… or litho1…; we normalise internally. */
  recipient: string;
  /** Human-readable amount, e.g. "1.5" — converted to wei using token decimals. */
  amount:    string;
  /** HD account to sign from (default 0). */
  accountIdx?: number;
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
  const wallet = walletFromInput(walletInput, provider, input.accountIdx);

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

/* ─── Allowance management (approve / revoke) ─────────────────────────── */

export interface ApproveInput {
  /** ERC-20 / LEP-100 contract address. */
  tokenAddress: string;
  /** Spender to approve. */
  spender:      string;
  /** Raw amount (smallest unit). Pass 0n to revoke. */
  amountRaw:    bigint;
}

/**
 * Set the allowance the wallet grants `spender` for `tokenAddress` on
 * Makalu. Pass `amountRaw = 0n` to revoke. Returns a hash + wait()
 * matching the SendResult shape so the UI can reuse pending-confirmed
 * states.
 *
 * Common pitfall: some legacy ERC-20s reject `approve(spender, X)` when
 * the current allowance is non-zero and `X != 0`. The recommended
 * pattern there is approve(0) then approve(X). LEP-100 doesn't have
 * that limitation, so we don't double-tx here — single approve is fine.
 */
export async function setAllowance(walletInput: WalletInput, input: ApproveInput): Promise<SendResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.tokenAddress.trim())) {
    throw new SendError('invalid_token', 'Token address must be a 0x address');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.spender.trim())) {
    throw new SendError('invalid_address', 'Spender must be a 0x address');
  }
  if (input.amountRaw < 0n) {
    throw new SendError('invalid_amount', 'Allowance amount must be ≥ 0');
  }

  const provider = makeProvider();
  const wallet   = walletFromInput(walletInput, provider);
  const contract = new Contract(input.tokenAddress, LEP100_TRANSFER_ABI, wallet);

  let tx: TransactionResponse;
  try {
    tx = await contract.approve(input.spender, input.amountRaw);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/insufficient funds/i.test(msg)) throw new SendError('insufficient', 'Not enough LITHO for gas');
    if (/user rejected/i.test(msg))      throw new SendError('rejected', 'You cancelled the transaction');
    throw new SendError('rpc_error', msg || 'Network error while broadcasting');
  }

  return {
    hash:   tx.hash,
    symbol: '',                  // not a token-symbol-aware tx
    to:     input.spender,
    value:  input.amountRaw,
    kind:   'erc20',
    wait:   async () => {
      const receipt = await tx.wait();
      if (!receipt) throw new SendError('rpc_error', 'Receipt unavailable');
      return { blockNumber: receipt.blockNumber, status: Number(receipt.status ?? 0) };
    },
  };
}

/** Convenience: revoke = approve to zero. */
export function revokeAllowance(walletInput: WalletInput, args: { tokenAddress: string; spender: string; }): Promise<SendResult> {
  return setAllowance(walletInput, { ...args, amountRaw: 0n });
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
