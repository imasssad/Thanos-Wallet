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
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
import { BitcoinClient, BITCOIN_MAINNET } from '@thanos/sdk-core';
import type { WalletSource } from './wallet-source';

const client = new BitcoinClient();
const ECPair = ECPairFactory(ecc);
const BTC_NETWORK = bitcoin.networks.bitcoin;
const MEMPOOL_BASE = BITCOIN_MAINNET.rpcUrls[0];

/* ─── PK → keypair → bc1q… helpers ───────────────────────────────────── */

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Build a single P2WPKH keypair + bc1q… address from a raw 0x-prefixed
 *  32-byte hex secp256k1 private key. Used when the wallet was imported
 *  from a private key rather than a BIP39 phrase. */
function btcAccountFromPrivateKey(privateKey: string): {
  address: string;
  keyPair: ReturnType<typeof ECPair.fromPrivateKey>;
} {
  const priv = hexToBytes(privateKey);
  if (priv.length !== 32) throw new BitcoinSendError('invalid_key', 'Private key must be 32 bytes (64 hex chars)');
  const keyPair = ECPair.fromPrivateKey(Buffer.from(priv));
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: BTC_NETWORK,
  });
  if (!address) throw new BitcoinSendError('invalid_key', 'Unable to derive Bitcoin address from key');
  return { address, keyPair };
}

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

/** Mnemonic-flavoured BTC address (BIP84, m/84'/0'/0'/0/0). */
export function getBitcoinAddress(mnemonic: string): string {
  return client.deriveAccount(mnemonic, 0, 'bitcoin-mainnet').address;
}

/** WalletSource-aware BTC address — works for both mnemonic and
 *  private-key imports. Returns the empty string if the source can't
 *  produce a BTC address (currently never, but defensive). */
export function getBitcoinAddressFromSource(source: WalletSource): string {
  if (source.kind === 'mnemonic')   return getBitcoinAddress(source.mnemonic);
  if (source.kind === 'privateKey') return btcAccountFromPrivateKey(source.privateKey).address;
  return '';
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

/** Native BTC transfer. Amount is human-readable BTC (e.g. "0.001").
 *  `walletSource` can be either { kind: 'mnemonic' } or { kind: 'privateKey' }.
 *  Mnemonic wallets go through sdk-core's BitcoinClient (BIP84 derive +
 *  PSBT). PK wallets build the PSBT directly here from the single
 *  keypair derived from the raw key. */
export async function sendBitcoin(input: {
  source:    WalletSource;
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
  const amountSats = Math.round(btc * 1e8);

  try {
    if (input.source.kind === 'mnemonic') {
      return await client.send(input.source.mnemonic, {
        networkId:       'bitcoin-mainnet',
        to:              input.recipient.trim(),
        amountSats,
        feeRateSatPerVb: input.feeRateSatPerVb,
      });
    }
    // PK path: build, sign, and broadcast a PSBT from a single keypair.
    return await sendBitcoinFromPrivateKey({
      privateKey:      input.source.privateKey,
      recipient:       input.recipient.trim(),
      amountSats,
      feeRateSatPerVb: input.feeRateSatPerVb,
    });
  } catch (e) {
    throw mapErr(e);
  }
}

/* PK BTC send — replicates the UTXO-selection + PSBT flow from
   sdk-core's BitcoinClient.send for a single keypair (no HD derivation). */
async function sendBitcoinFromPrivateKey(input: {
  privateKey:       string;
  recipient:        string;
  amountSats:       number;
  feeRateSatPerVb?: number;
}): Promise<string> {
  const { address, keyPair } = btcAccountFromPrivateKey(input.privateKey);

  const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
  const utxos = await fetchUtxos(address);

  const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });
  let total = 0;
  for (const utxo of utxos) {
    total += utxo.value;
    psbt.addInput({
      hash:  utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network: BTC_NETWORK }).output!,
        value:  utxo.value,
      },
    });
    if (total >= input.amountSats + 1000) break;
  }
  // Same heuristic as sdk-core: 10 base + 68 per input + 31 per output (2 outputs typical).
  const estimatedVbytes = 10 + utxos.length * 68 + 2 * 31;
  const fee = estimatedVbytes * feeRate;
  const change = total - input.amountSats - fee;
  if (change < 0) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover amount + fees');

  psbt.addOutput({ address: input.recipient, value: input.amountSats });
  if (change > 546) psbt.addOutput({ address, value: change });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  psbt.signAllInputs(keyPair as any);
  psbt.finalizeAllInputs();
  const rawHex = psbt.extractTransaction().toHex();

  const res = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: rawHex });
  if (!res.ok) throw new BitcoinSendError('rpc_error', `Broadcast failed (${res.status})`);
  return await res.text();
}

/* ─── Live fee estimate ──────────────────────────────────────────────── */

/** Returns a sat fee estimate AND the assumed fee-rate. Doesn't sign
 *  anything — just fetches UTXOs and computes vsize-from-input-count. */
export async function estimateBitcoinFee(input: {
  source:    WalletSource;
  amount:    string;
  /** Optional fee-rate override. */
  feeRateSatPerVb?: number;
}): Promise<{ sats: number; btc: string; feeRate: number } | null> {
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) return null;
  const amountSats = Math.round(btc * 1e8);

  const address =
    input.source.kind === 'mnemonic'
      ? getBitcoinAddress(input.source.mnemonic)
      : btcAccountFromPrivateKey(input.source.privateKey).address;

  try {
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(address);
    if (utxos.length === 0) return null;
    // Pick UTXOs greedily until we cover the amount + a 1000 sat buffer.
    let chosen = 0;
    let total = 0;
    for (const u of utxos) {
      chosen++;
      total += u.value;
      if (total >= amountSats + 1000) break;
    }
    const vbytes = 10 + chosen * 68 + 2 * 31;
    const sats = vbytes * feeRate;
    return { sats, btc: (sats / 1e8).toFixed(8), feeRate };
  } catch {
    return null;
  }
}

/* ─── Mempool.space helpers ──────────────────────────────────────────── */

async function getFastestFeeRate(): Promise<number> {
  const res = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `fees ${res.status}`);
  const json = await res.json() as { fastestFee?: number };
  return json.fastestFee ?? 15;
}

interface Utxo { txid: string; vout: number; value: number }
async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `utxo ${res.status}`);
  return await res.json() as Utxo[];
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
