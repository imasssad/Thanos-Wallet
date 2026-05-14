'use client';
/**
 * Bitcoin wallet integration.
 *
 * All PSBT construction happens in this module (not delegated to
 * sdk-core's BitcoinClient) so we can:
 *   - signal RBF on every send (nSequence = 0xfffffffd, BIP125)
 *   - snapshot the inputs + outputs for later replacement
 *   - share one code path between mnemonic and private-key flows
 *
 * Trade-off vs commit eb63f8e: BTC sends touch the mnemonic briefly on
 * the main thread again. Worker re-isolation with snapshot data flowing
 * back through postMessage is a follow-up.
 *
 * Public surface:
 *   - isValidBitcoinAddress(input)
 *   - getBitcoinAddress(mnemonic)
 *   - getBitcoinAddressFromSource(source)
 *   - getBitcoinBalance(address)
 *   - estimateBitcoinFee({ source, amount, feeRateSatPerVb? })
 *   - sendBitcoin({ source, recipient, amount, feeRateSatPerVb? }) → { hash, snapshot }
 *   - replaceBitcoinTx({ source, snapshot, newFeeRateSatPerVb }) → { hash, snapshot }
 *   - bitcoinExplorerUrl(txid)
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import { BITCOIN_MAINNET } from '@thanos/sdk-core';
import type { WalletSource } from './wallet-source';
import type { BtcSnapshot } from './tx-store';

const ECPair = ECPairFactory(ecc);
const bip32  = BIP32Factory(ecc);
const BTC_NETWORK = bitcoin.networks.bitcoin;
const MEMPOOL_BASE = BITCOIN_MAINNET.rpcUrls[0];

/** BIP125 signaling sequence — replaceable, locktime-unaware. */
const RBF_SEQUENCE = 0xfffffffd;

/** Dust threshold for P2WPKH outputs (sat). */
const DUST = 546;

/* ─── Errors ─────────────────────────────────────────────────────────── */

export class BitcoinSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BitcoinSendError';
  }
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

/* ─── Keypair derivation ─────────────────────────────────────────────── */

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface BtcAccount {
  address: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyPair: any;
  pubkey:  Buffer;
}

function accountFromMnemonic(mnemonic: string): BtcAccount {
  const seed  = bip39.mnemonicToSeedSync(mnemonic);
  const root  = bip32.fromSeed(seed, BTC_NETWORK);
  const child = root.derivePath(`m/84'/0'/0'/0/0`);
  const keyPair = ECPair.fromPrivateKey(Buffer.from(child.privateKey!));
  const pubkey  = Buffer.from(child.publicKey);
  const { address } = bitcoin.payments.p2wpkh({ pubkey, network: BTC_NETWORK });
  if (!address) throw new BitcoinSendError('derive_failed', 'Unable to derive BTC address from mnemonic');
  return { address, keyPair, pubkey };
}

function accountFromPrivateKey(privateKey: string): BtcAccount {
  const priv = hexToBytes(privateKey);
  if (priv.length !== 32) throw new BitcoinSendError('invalid_key', 'Private key must be 32 bytes (64 hex chars)');
  const keyPair = ECPair.fromPrivateKey(Buffer.from(priv));
  const pubkey  = Buffer.from(keyPair.publicKey);
  const { address } = bitcoin.payments.p2wpkh({ pubkey, network: BTC_NETWORK });
  if (!address) throw new BitcoinSendError('invalid_key', 'Unable to derive BTC address from key');
  return { address, keyPair, pubkey };
}

function accountFromSource(source: WalletSource): BtcAccount {
  return source.kind === 'mnemonic'
    ? accountFromMnemonic(source.mnemonic)
    : accountFromPrivateKey(source.privateKey);
}

/** Mnemonic-flavoured BTC address (BIP84, m/84'/0'/0'/0/0). */
export function getBitcoinAddress(mnemonic: string): string {
  return accountFromMnemonic(mnemonic).address;
}

/** WalletSource-aware BTC address. */
export function getBitcoinAddressFromSource(source: WalletSource): string {
  return accountFromSource(source).address;
}

/* ─── Mempool.space helpers ──────────────────────────────────────────── */

interface Utxo { txid: string; vout: number; value: number }

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `utxo ${res.status}`);
  return await res.json() as Utxo[];
}

async function getFastestFeeRate(): Promise<number> {
  const res = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `fees ${res.status}`);
  const json = await res.json() as { fastestFee?: number };
  return json.fastestFee ?? 15;
}

interface MempoolAddress {
  chain_stats:   { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

/** Confirmed + mempool BTC balance, as a human-readable string ("0.00123456"). */
export async function getBitcoinBalance(address: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `balance ${res.status}`);
  const data = await res.json() as MempoolAddress;
  const confirmed = data.chain_stats.funded_txo_sum   - data.chain_stats.spent_txo_sum;
  const pending   = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  return ((confirmed + pending) / 1e8).toFixed(8);
}

/* ─── PSBT helpers ───────────────────────────────────────────────────── */

/** Same heuristic the original sdk-core code uses: 10 base + 68n + 31m. */
function estimateVbytes(nInputs: number, nOutputs: number): number {
  return 10 + nInputs * 68 + nOutputs * 31;
}

/** Greedy UTXO selection: accumulate inputs until amount + buffer is covered. */
function selectUtxos(utxos: Utxo[], target: number): { selected: Utxo[]; total: number } {
  const selected: Utxo[] = [];
  let total = 0;
  for (const u of utxos) {
    selected.push(u);
    total += u.value;
    if (total >= target) break;
  }
  return { selected, total };
}

/** Build, sign, and broadcast a PSBT given pre-selected inputs + outputs. */
async function broadcastPsbt(args: {
  account:        BtcAccount;
  utxosToSpend:   Utxo[];
  recipient:      string;
  recipientSats:  number;
  changeSats:     number;
  changeAddress:  string;
}): Promise<string> {
  const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });

  const witnessScript = bitcoin.payments.p2wpkh({
    pubkey:  args.account.pubkey,
    network: BTC_NETWORK,
  }).output!;

  for (const utxo of args.utxosToSpend) {
    psbt.addInput({
      hash:        utxo.txid,
      index:       utxo.vout,
      sequence:    RBF_SEQUENCE,
      witnessUtxo: { script: witnessScript, value: utxo.value },
    });
  }
  psbt.addOutput({ address: args.recipient, value: args.recipientSats });
  if (args.changeSats > DUST) psbt.addOutput({ address: args.changeAddress, value: args.changeSats });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  psbt.signAllInputs(args.account.keyPair as any);
  psbt.finalizeAllInputs();
  const rawHex = psbt.extractTransaction().toHex();

  const res = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: rawHex });
  if (!res.ok) throw new BitcoinSendError('rpc_error', `Broadcast failed (${res.status})`);
  return await res.text();
}

/* ─── Live fee estimate ──────────────────────────────────────────────── */

/** Returns sat fee, BTC string and the assumed fee-rate. Doesn't sign. */
export async function estimateBitcoinFee(input: {
  source:          WalletSource;
  amount:          string;
  feeRateSatPerVb?: number;
}): Promise<{ sats: number; btc: string; feeRate: number } | null> {
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) return null;
  const amountSats = Math.round(btc * 1e8);

  try {
    const acc = accountFromSource(input.source);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(acc.address);
    if (utxos.length === 0) return null;
    const { selected, total } = selectUtxos(utxos, amountSats + 1000);
    if (total < amountSats) return null;
    const vbytes = estimateVbytes(selected.length, 2);
    const sats = vbytes * feeRate;
    return { sats, btc: (sats / 1e8).toFixed(8), feeRate };
  } catch {
    return null;
  }
}

/* ─── Send ───────────────────────────────────────────────────────────── */

export interface SendResult { hash: string; snapshot: BtcSnapshot }

export async function sendBitcoin(input: {
  source:          WalletSource;
  recipient:       string;
  amount:          string;          // BTC, human-readable
  feeRateSatPerVb?: number;
}): Promise<SendResult> {
  if (!isValidBitcoinAddress(input.recipient)) {
    throw new BitcoinSendError('invalid_address', 'Recipient is not a valid Bitcoin address');
  }
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) throw new BitcoinSendError('invalid_amount', 'Amount must be greater than zero');
  const amountSats = Math.round(btc * 1e8);

  try {
    const account = accountFromSource(input.source);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(account.address);

    const { selected, total } = selectUtxos(utxos, amountSats + 1000);
    const vbytes = estimateVbytes(selected.length, 2);
    const feeSats = vbytes * feeRate;
    const changeSats = total - amountSats - feeSats;
    if (changeSats < 0) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover amount + fees');

    const txid = await broadcastPsbt({
      account,
      utxosToSpend:  selected,
      recipient:     input.recipient.trim(),
      recipientSats: amountSats,
      changeSats,
      changeAddress: account.address,
    });

    const snapshot: BtcSnapshot = {
      inputs: selected.map(u => ({ txid: u.txid, vout: u.vout, valueSat: u.value })),
      recipient:      input.recipient.trim(),
      amountSats,
      changeAddress:  account.address,
      feeRateSatPerVb: feeRate,
      feeSats,
      vbytes,
    };
    return { hash: txid, snapshot };
  } catch (e) {
    throw mapErr(e);
  }
}

/* ─── Replace-by-fee ─────────────────────────────────────────────────── */

/** Build a higher-fee replacement that re-spends the same inputs. The
 *  recipient gets the same amount; the additional fee comes out of the
 *  change output (which can shrink below DUST and disappear, but cannot
 *  go negative — that would mean the user is asking to pay more than
 *  they have left).
 *
 *  Returns a SendResult whose snapshot reflects the NEW state (so the
 *  caller can bump again if needed). */
export async function replaceBitcoinTx(input: {
  source:               WalletSource;
  snapshot:             BtcSnapshot;
  newFeeRateSatPerVb:   number;
}): Promise<SendResult> {
  const { snapshot, newFeeRateSatPerVb: newRate } = input;
  if (newRate <= snapshot.feeRateSatPerVb) {
    throw new BitcoinSendError('rbf_too_low', `New fee rate must be greater than ${snapshot.feeRateSatPerVb} sat/vB`);
  }

  const account = accountFromSource(input.source);
  if (account.address !== snapshot.changeAddress) {
    // Defensive: the WalletSource has to be the same wallet that originally
    // sent the tx, otherwise we can't re-sign the inputs.
    throw new BitcoinSendError('source_mismatch', "Can't replace: the wallet doesn't match the original sender");
  }

  // Same input set, same recipient amount; new fee + new change.
  const total = snapshot.inputs.reduce((s, u) => s + u.valueSat, 0);
  const vbytes = estimateVbytes(snapshot.inputs.length, 2);
  const feeSats = vbytes * newRate;
  const changeSats = total - snapshot.amountSats - feeSats;
  if (changeSats < 0) {
    throw new BitcoinSendError('insufficient', 'Fee bump exceeds change — pick a lower rate or top up');
  }

  const utxosToSpend = snapshot.inputs.map(i => ({ txid: i.txid, vout: i.vout, value: i.valueSat }));
  const txid = await broadcastPsbt({
    account,
    utxosToSpend,
    recipient:     snapshot.recipient,
    recipientSats: snapshot.amountSats,
    changeSats,
    changeAddress: snapshot.changeAddress,
  });

  const newSnapshot: BtcSnapshot = {
    ...snapshot,
    feeRateSatPerVb: newRate,
    feeSats,
    vbytes,
  };
  return { hash: txid, snapshot: newSnapshot };
}

/* ─── Error mapping ──────────────────────────────────────────────────── */

function mapErr(e: unknown): BitcoinSendError {
  if (e instanceof BitcoinSendError) return e;
  const msg = (e as Error)?.message || 'Failed to send';
  if (/insufficient/i.test(msg))                       return new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover amount + fees');
  if (/mempool|fetch|network/i.test(msg))              return new BitcoinSendError('rpc_error', 'Mempool.space request failed — try again in a moment');
  return new BitcoinSendError('unknown', msg);
}

/** Explorer URL for a BTC tx. */
export function bitcoinExplorerUrl(txid: string): string {
  return `${BITCOIN_MAINNET.blockExplorerUrl}/tx/${txid}`;
}
