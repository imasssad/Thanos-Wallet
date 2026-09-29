/**
 * Real signing + broadcast for the EVM wallet flows.
 *
 * Takes the unlocked BIP39 mnemonic (or a raw key), derives an ethers Wallet
 * at the active account's path, attaches the provider of the chain being
 * sent on — Lithosphere Mainnet, an external EVM chain, a custom network or
 * Kamet — and exposes native-coin and ERC-20/LEP100 send paths. There is no
 * default network: every send names its chain.
 *
 * Nothing in this module is cached — callers should construct a fresh
 * signer per operation and discard it. That way the private key only
 * lives in memory for the lifetime of a single transaction.
 */
import {
  Contract, HDNodeWallet, Mnemonic, Wallet,
  parseUnits,
  type Provider, type TransactionResponse,
} from 'ethers';
import { estimateMakaluGas } from './gas';
import { getEvmProvider } from './evm-chains';
import { getEvmChainMerged } from './custom-assets';
import { resolveToEvm } from './address';

/* ─── Constants ────────────────────────────────────────────────────────── */

import { getKametProvider, KAMET_CHAIN_ID } from './rpc';
import { getActiveAccountIndex } from './vault';

/** HD path for the active EVM account. Read at sign time so a switch in
 *  the TopNav takes effect on the very next transaction. */
function hdPath(idx: number = getActiveAccountIndex()): string {
  return `m/44'/60'/0'/0/${idx}`;
}

/* Minimal ABI — transfer() for token sends. */
const LEP100_TRANSFER_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

/* ─── Signer construction ─────────────────────────────────────────────── */

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
   Lithosphere Mainnet, Ethereum, BNB, Polygon, Base, Arbitrum, Linea,
   Optimism, Avalanche and custom networks: the same keypair, routed through
   that chain's own RPC via getEvmProvider (which checks the RPC serves that
   chain). The native gas coin here; ERC-20s in sendEvmToken below. */

export interface NativeSendInput {
  chainId:   number;
  recipient: string;        // 0x… address
  amount:    string;        // human-readable, parsed against 18 decimals
  accountIdx?: number;      // HD account to sign from (default 0)
}

export async function sendNativeEvm(walletInput: WalletInput, input: NativeSendInput): Promise<SendResult> {
  const chain = getEvmChainMerged(input.chainId);
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

/** ERC-20 token transfer on any supported EVM chain (USDT/USDC/etc.) — the
 *  token sibling of sendNativeEvm. */
export async function sendEvmToken(walletInput: WalletInput, input: EvmTokenSendInput): Promise<SendResult> {
  const chain = getEvmChainMerged(input.chainId);
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

/** Provider for a Lithosphere chain with its own send branch — Kamet
 *  (900523). Lithosphere Mainnet sends go through sendNativeEvm (it's an
 *  EVM chain in the registry). Anything else throws: no fallback network. */
function lithoProviderFor(chainId: number): Provider {
  if (chainId === KAMET_CHAIN_ID) return getKametProvider();
  throw new SendError('invalid_chain', `Unsupported Lithosphere chain: ${chainId}`);
}

/**
 * Native LITHO transfer on Kamet (900523) — the chain-aware main-thread path.
 * Recipient may be 0x or litho1.
 */
export async function sendLithoNative(
  walletInput: WalletInput,
  input: { chainId: number; recipient: string; amount: string; accountIdx?: number },
): Promise<SendResult> {
  const provider = lithoProviderFor(input.chainId);
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
 *  FeeEstimate shape as the Kamet path so the SendModal can render it with
 *  the same UI. */
export async function estimateNativeEvmFee(walletInput: WalletInput, input: NativeSendInput): Promise<FeeEstimate | null> {
  const chain = getEvmChainMerged(input.chainId);
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
      // formatUnits for the chain's native — same call signature as Kamet.
      totalLitho:   est.totalLitho,
    };
  } catch {
    return null;
  }
}

/** Gas estimate for a native LITHO send on Kamet, on Kamet's own provider
 *  (it used to be estimated on Makalu). */
export async function estimateLithoNativeFee(
  walletInput: WalletInput,
  input: { chainId: number; recipient: string; amount: string },
): Promise<FeeEstimate | null> {
  const to = resolveToEvm(input.recipient.trim());
  if (!to) return null;
  let weiAmount: bigint;
  try { weiAmount = parseUnits(input.amount || '0', 18); }
  catch { return null; }
  if (weiAmount <= 0n) return null;
  try {
    const provider = lithoProviderFor(input.chainId);
    const wallet   = walletFromInput(walletInput, provider);
    const est = await estimateMakaluGas({ tx: { from: wallet.address, to, value: weiAmount }, provider });
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

/* ─── Send results ─────────────────────────────────────────────────────── */

export type SendResult = {
  hash:   string;
  symbol: string;
  /** Resolved EVM recipient (post-bech32 conversion). */
  to:     string;
  /** Wei amount sent. */
  value:  bigint;
  /** Whether this was a native-coin send vs an ERC-20 transfer. */
  kind:   'native' | 'erc20';
  /** Promise that resolves to the receipt when the tx is mined. */
  wait:   () => Promise<{ blockNumber: number; status: number }>;
};

/**
 * Errors are thrown as SendError with a code so the UI can branch:
 *   - 'invalid_chain'   — a chain the wallet can't send on
 *   - 'invalid_address' — recipient didn't parse
 *   - 'invalid_amount'  — non-positive amount
 *   - 'insufficient'    — balance too low (ethers-detected pre-broadcast)
 *   - 'rpc_error'       — network / node failure
 *   - 'rejected'        — user-side cancel (only meaningful with HW wallets)
 */
export class SendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SendError';
  }
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
