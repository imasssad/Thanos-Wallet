'use client';
/**
 * Bitcoin wallet integration.
 *
 * Thin web-app facade over sdk-core's BitcoinClient. Uses BIP84 native
 * segwit (m/84'/0'/0'/0/0 → bc1q… address) for sane fees and broad
 * support. UTXOs + fee rate + broadcast all go through mempool.space.
 *
 * Public surface:
 *   - getBitcoinAddress(mnemonic) → derived bc1q… address
 *   - getBitcoinBalance(address)  → BTC balance as human-readable string
 *   - sendBitcoin({ mnemonic, recipient, amount }) → broadcast tx hash
 *   - isValidBitcoinAddress(input) → boolean (legacy / segwit / bech32 / taproot)
 *
 * Like Solana, Bitcoin sends still consume the mnemonic on the main
 * thread today — the EVM-only signing worker (commit 334a7b0) doesn't
 * cover them yet. Worker integration for BTC is a follow-up.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient, BITCOIN_MAINNET } from '@thanos/sdk-core';

const client = new BitcoinClient();
const BTC_NETWORK = bitcoin.networks.bitcoin;
const MEMPOOL_BASE = BITCOIN_MAINNET.rpcUrls[0];

/* ─── Validation ─────────────────────────────────────────────────────── */

/** Accept legacy (1…), p2sh (3…), bech32 (bc1q… / bc1p…). */
export function isValidBitcoinAddress(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  try {
    bitcoin.address.toOutputScript(trimmed, BTC_NETWORK);
    return true;
  } catch {
    return false;
  }
}

/* ─── Derivation ─────────────────────────────────────────────────────── */

export function getBitcoinAddress(mnemonic: string): string {
  return client.deriveAccount(mnemonic, 0, 'bitcoin-mainnet').address;
}

/* ─── Balance ────────────────────────────────────────────────────────── */

interface MempoolAddress {
  chain_stats:   { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

/** Confirmed + mempool BTC balance, as a human-readable string ("0.00123456"). */
export async function getBitcoinBalance(address: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`mempool ${res.status}`);
  const data = await res.json() as MempoolAddress;
  const confirmed = data.chain_stats.funded_txo_sum   - data.chain_stats.spent_txo_sum;
  const pending   = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  const sats = confirmed + pending;
  return (sats / 1e8).toFixed(8);
}

/* ─── Send ───────────────────────────────────────────────────────────── */

export class BitcoinSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BitcoinSendError';
  }
}

/** Native BTC transfer. Amount is human-readable BTC (e.g. "0.001"). */
export async function sendBitcoin(input: {
  mnemonic:  string;
  recipient: string;
  amount:    string;  // BTC
  /** Optional fee-rate override in sat/vB. Defaults to mempool.space's "fastestFee". */
  feeRateSatPerVb?: number;
}): Promise<string> {
  if (!isValidBitcoinAddress(input.recipient)) {
    throw new BitcoinSendError('invalid_address', 'Recipient is not a valid Bitcoin address');
  }
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) {
    throw new BitcoinSendError('invalid_amount', 'Amount must be greater than zero');
  }
  // BitcoinSendRequest from sdk-core wants amountSats as integer.
  const amountSats = Math.round(btc * 1e8);

  try {
    return await client.send(input.mnemonic, {
      networkId:        'bitcoin-mainnet',
      to:               input.recipient.trim(),
      amountSats,
      feeRateSatPerVb:  input.feeRateSatPerVb,
    });
  } catch (e) {
    throw mapErr(e);
  }
}

function mapErr(e: unknown): BitcoinSendError {
  if (e instanceof BitcoinSendError) return e;
  const msg = (e as Error)?.message || 'Failed to send';
  if (/insufficient/i.test(msg)) return new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover amount + fees');
  if (/mempool|fetch|network/i.test(msg)) return new BitcoinSendError('rpc_error', 'Mempool.space request failed — try again in a moment');
  return new BitcoinSendError('unknown', msg);
}

/** Explorer URL for a BTC tx. */
export function bitcoinExplorerUrl(txid: string): string {
  return `${BITCOIN_MAINNET.blockExplorerUrl}/tx/${txid}`;
}
