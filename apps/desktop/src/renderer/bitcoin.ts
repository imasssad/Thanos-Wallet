/**
 * Bitcoin wallet integration — desktop renderer.
 * Mirrors apps/web/lib/bitcoin.ts (BIP84, P2WPKH, RBF-signaled sends).
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
    super(message); this.name = 'BitcoinSendError';
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

export async function getBitcoinBalance(address: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `balance ${res.status}`);
  const data = await res.json() as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const confirmed = data.chain_stats.funded_txo_sum   - data.chain_stats.spent_txo_sum;
  const pending   = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  return ((confirmed + pending) / 1e8).toFixed(8);
}

function estimateVbytes(nI: number, nO: number) { return 10 + nI * 68 + nO * 31; }
/** Coin selection that accounts for the REAL fee (vbytes × feeRate), recomputed
 *  as inputs are added — the old fixed +1000-sat buffer underfunded the real fee
 *  (~4k–14k sats) → false "Insufficient BTC" on funded wallets. Largest-first,
 *  folds sub-dust change into the fee; `sendMax` spends all minus fee. */
function selectForSend(utxos: Utxo[], amountSats: number, feeRate: number, sendMax = false): {
  selected: Utxo[]; total: number; feeSats: number; changeSats: number; recipientSats: number;
} {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  if (sendMax) {
    const selected = sorted;
    const total = selected.reduce((s, u) => s + u.value, 0);
    const feeSats = estimateVbytes(selected.length, 1) * feeRate;
    const recipientSats = total - feeSats;
    if (recipientSats <= DUST) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover the network fee');
    return { selected, total, feeSats, changeSats: 0, recipientSats };
  }
  const selected: Utxo[] = []; let total = 0;
  for (const u of sorted) {
    selected.push(u); total += u.value;
    const feeSats = estimateVbytes(selected.length, 2) * feeRate;
    if (total >= amountSats + feeSats) {
      const changeSats = total - amountSats - feeSats;
      if (changeSats <= DUST) {
        return { selected, total, feeSats: total - amountSats, changeSats: 0, recipientSats: amountSats };
      }
      return { selected, total, feeSats, changeSats, recipientSats: amountSats };
    }
  }
  throw new BitcoinSendError('insufficient', 'Insufficient BTC balance to cover amount + fees');
}

async function broadcastPsbt(args: {
  account: BtcAccount; utxosToSpend: Utxo[]; recipient: string;
  recipientSats: number; changeSats: number; changeAddress: string;
}): Promise<string> {
  const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });
  const witnessScript = bitcoin.payments.p2wpkh({ pubkey: args.account.pubkey, network: BTC_NETWORK }).output!;
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
  mnemonic: string; amount: string; feeRateSatPerVb?: number;
}): Promise<{ sats: number; btc: string; feeRate: number } | null> {
  const btc = parseFloat(input.amount);
  if (!btc || btc <= 0) return null;
  const amountSats = Math.round(btc * 1e8);
  try {
    const acc = accountFromMnemonic(input.mnemonic);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(acc.address);
    if (utxos.length === 0) return null;
    const sel = selectForSend(utxos, amountSats, feeRate, false);
    return { sats: sel.feeSats, btc: (sel.feeSats / 1e8).toFixed(8), feeRate };
  } catch { return null; }
}

export async function sendBitcoin(input: {
  mnemonic: string; recipient: string; amount: string; feeRateSatPerVb?: number; sendMax?: boolean;
}): Promise<string> {
  if (!isValidBitcoinAddress(input.recipient)) {
    throw new BitcoinSendError('invalid_address', 'Recipient is not a valid Bitcoin address');
  }
  const btc = parseFloat(input.amount);
  if (!input.sendMax && (!btc || btc <= 0)) throw new BitcoinSendError('invalid_amount', 'Amount must be greater than zero');
  const amountSats = Math.round((btc || 0) * 1e8);

  try {
    const account = accountFromMnemonic(input.mnemonic);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(account.address);
    const sel = selectForSend(utxos, amountSats, feeRate, !!input.sendMax);

    return await broadcastPsbt({
      account, utxosToSpend: sel.selected,
      recipient: input.recipient.trim(), recipientSats: sel.recipientSats,
      changeSats: sel.changeSats, changeAddress: account.address,
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
