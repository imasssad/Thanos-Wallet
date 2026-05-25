/**
 * Bitcoin wallet integration — extension popup.
 * Mirrors apps/web/lib/bitcoin.ts (BIP84, P2WPKH, RBF-signaled sends).
 *
 * Mnemonic-only for v1; private-key import lives elsewhere on the
 * extension and is converted to a mnemonic-equivalent flow upstream.
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import ECPairFactory from 'ecpair';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import { BITCOIN_MAINNET } from '@thanos/sdk-core';

const ECPair = ECPairFactory(ecc);
const bip32  = BIP32Factory(ecc);
const BTC_NETWORK = bitcoin.networks.bitcoin;
const MEMPOOL_BASE = BITCOIN_MAINNET.rpcUrls[0];
const RBF_SEQUENCE = 0xfffffffd;
const DUST = 546;

export class BitcoinSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BitcoinSendError';
  }
}

export function isValidBitcoinAddress(input: string): boolean {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  try { bitcoin.address.toOutputScript(trimmed, BTC_NETWORK); return true; }
  catch { return false; }
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
  if (!address) throw new BitcoinSendError('derive_failed', 'Unable to derive BTC address');
  return { address, keyPair, pubkey };
}

export function getBitcoinAddress(mnemonic: string): string {
  return accountFromMnemonic(mnemonic).address;
}

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

export async function getBitcoinBalance(address: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `balance ${res.status}`);
  const data = await res.json() as MempoolAddress;
  const confirmed = data.chain_stats.funded_txo_sum   - data.chain_stats.spent_txo_sum;
  const pending   = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  return ((confirmed + pending) / 1e8).toFixed(8);
}

function estimateVbytes(nInputs: number, nOutputs: number): number {
  return 10 + nInputs * 68 + nOutputs * 31;
}

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
    pubkey: args.account.pubkey, network: BTC_NETWORK,
  }).output!;

  for (const utxo of args.utxosToSpend) {
    psbt.addInput({
      hash: utxo.txid, index: utxo.vout, sequence: RBF_SEQUENCE,
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

export async function estimateBitcoinFee(input: {
  mnemonic:         string;
  amount:           string;
  feeRateSatPerVb?: number;
}): Promise<{ sats: number; btc: string; feeRate: number } | null> {
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) return null;
  const amountSats = Math.round(btc * 1e8);
  try {
    const acc = accountFromMnemonic(input.mnemonic);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(acc.address);
    if (utxos.length === 0) return null;
    const { selected, total } = selectUtxos(utxos, amountSats + 1000);
    if (total < amountSats) return null;
    const vbytes = estimateVbytes(selected.length, 2);
    const sats = vbytes * feeRate;
    return { sats, btc: (sats / 1e8).toFixed(8), feeRate };
  } catch { return null; }
}

export async function sendBitcoin(input: {
  mnemonic:         string;
  recipient:        string;
  amount:           string;
  feeRateSatPerVb?: number;
}): Promise<string> {
  if (!isValidBitcoinAddress(input.recipient)) {
    throw new BitcoinSendError('invalid_address', 'Recipient is not a valid Bitcoin address');
  }
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) throw new BitcoinSendError('invalid_amount', 'Amount must be greater than zero');
  const amountSats = Math.round(btc * 1e8);

  try {
    const account = accountFromMnemonic(input.mnemonic);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(account.address);
    const { selected, total } = selectUtxos(utxos, amountSats + 1000);
    const vbytes = estimateVbytes(selected.length, 2);
    const feeSats = vbytes * feeRate;
    const changeSats = total - amountSats - feeSats;
    if (changeSats < 0) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance for amount + fees');

    return await broadcastPsbt({
      account, utxosToSpend: selected,
      recipient: input.recipient.trim(), recipientSats: amountSats,
      changeSats, changeAddress: account.address,
    });
  } catch (e) {
    if (e instanceof BitcoinSendError) throw e;
    const msg = (e as Error)?.message || 'Failed to send';
    if (/insufficient/i.test(msg)) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance');
    if (/mempool|fetch|network/i.test(msg)) throw new BitcoinSendError('rpc_error', 'Mempool.space request failed');
    throw new BitcoinSendError('unknown', msg);
  }
}

export function bitcoinExplorerUrl(txid: string): string {
  return `${BITCOIN_MAINNET.blockExplorerUrl}/tx/${txid}`;
}
