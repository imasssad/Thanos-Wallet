/**
 * Bitcoin wallet integration — mobile (React Native).
 *
 * Uses @scure/btc-signer (pure-JS, @noble-based) instead of bitcoinjs-lib
 * + tiny-secp256k1 — Hermes can't load the WASM cleanly. Same BIP84
 * P2WPKH + RBF-signaled tx shape as apps/web/lib/bitcoin.ts.
 */
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { hex } from '@scure/base';

const NETWORK = btc.NETWORK; // mainnet
const MEMPOOL_BASE = 'https://mempool.space/api';
const EXPLORER_BASE = 'https://mempool.space';
const RBF_SEQUENCE = 0xfffffffd;
const DUST = 546n;

export class BitcoinSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'BitcoinSendError';
  }
}

interface BtcAccount {
  address: string;
  privKey: Uint8Array;
  pubKey:  Uint8Array;
}

function accountFromMnemonic(mnemonic: string): BtcAccount {
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`m/84'/0'/0'/0/0`);
  if (!child.privateKey || !child.publicKey) {
    throw new BitcoinSendError('derive_failed', 'Unable to derive BTC key');
  }
  const p2wpkh = btc.p2wpkh(child.publicKey, NETWORK);
  if (!p2wpkh.address) throw new BitcoinSendError('derive_failed', 'Unable to derive BTC address');
  return { address: p2wpkh.address, privKey: child.privateKey, pubKey: child.publicKey };
}

export function getBitcoinAddress(mnemonic: string): string {
  return accountFromMnemonic(mnemonic).address;
}

export function isValidBitcoinAddress(input: string): boolean {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  try {
    const outScript = btc.Address(NETWORK).decode(trimmed);
    return !!outScript;
  } catch { return false; }
}

interface Utxo { txid: string; vout: number; value: number }

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `utxo ${res.status}`);
  return await res.json() as Utxo[];
}

async function fetchRawTx(txid: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/tx/${encodeURIComponent(txid)}/hex`);
  if (!res.ok) throw new BitcoinSendError('rpc_error', `rawtx ${res.status}`);
  return await res.text();
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
function selectUtxos(utxos: Utxo[], target: number) {
  const selected: Utxo[] = []; let total = 0;
  for (const u of utxos) { selected.push(u); total += u.value; if (total >= target) break; }
  return { selected, total };
}

export async function estimateBitcoinFee(input: {
  mnemonic: string; amount: string; feeRateSatPerVb?: number;
}): Promise<{ sats: number; btc: string; feeRate: number } | null> {
  const v = parseFloat(input.amount);
  if (!v || v <= 0) return null;
  const amountSats = Math.round(v * 1e8);
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
  mnemonic: string; recipient: string; amount: string; feeRateSatPerVb?: number;
}): Promise<string> {
  if (!isValidBitcoinAddress(input.recipient)) {
    throw new BitcoinSendError('invalid_address', 'Recipient is not a valid Bitcoin address');
  }
  const v = parseFloat(input.amount);
  if (!v || v <= 0) throw new BitcoinSendError('invalid_amount', 'Amount must be greater than zero');
  const amountSats = BigInt(Math.round(v * 1e8));

  try {
    const account = accountFromMnemonic(input.mnemonic);
    const feeRate = input.feeRateSatPerVb ?? await getFastestFeeRate();
    const utxos = await fetchUtxos(account.address);
    const { selected, total } = selectUtxos(utxos, Number(amountSats) + 1000);
    const vbytes = estimateVbytes(selected.length, 2);
    const feeSats = BigInt(vbytes * feeRate);
    const changeSats = BigInt(total) - amountSats - feeSats;
    if (changeSats < 0n) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance');

    const p2wpkh = btc.p2wpkh(account.pubKey, NETWORK);
    const tx = new btc.Transaction({ allowUnknownOutputs: false });

    for (const u of selected) {
      const rawHex = await fetchRawTx(u.txid);
      tx.addInput({
        txid: u.txid,
        index: u.vout,
        sequence: RBF_SEQUENCE,
        witnessUtxo: { script: p2wpkh.script, amount: BigInt(u.value) },
        nonWitnessUtxo: hex.decode(rawHex),
      });
    }
    tx.addOutputAddress(input.recipient.trim(), amountSats, NETWORK);
    if (changeSats > DUST) tx.addOutputAddress(account.address, changeSats, NETWORK);

    tx.sign(account.privKey);
    tx.finalize();
    const rawHex = tx.hex;

    const res = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: rawHex });
    if (!res.ok) throw new BitcoinSendError('rpc_error', `Broadcast failed (${res.status})`);
    return await res.text();
  } catch (e) {
    if (e instanceof BitcoinSendError) throw e;
    const msg = (e as Error)?.message || 'Failed to send';
    if (/insufficient/i.test(msg)) throw new BitcoinSendError('insufficient', 'Insufficient BTC balance');
    if (/mempool|fetch|network/i.test(msg)) throw new BitcoinSendError('rpc_error', 'Mempool.space request failed');
    throw new BitcoinSendError('unknown', msg);
  }
}

export function bitcoinExplorerUrl(txid: string): string {
  return `${EXPLORER_BASE}/tx/${txid}`;
}
