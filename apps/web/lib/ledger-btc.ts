'use client';
/**
 * Ledger — Bitcoin BIP84 (native segwit) signing.
 *
 * The user has a Ledger Nano / Stax / Flex with the Bitcoin app open.
 * We:
 *   1. Pull the public key at m/84'/0'/0'/0/i for each `i` to discover
 *      the user's bech32 addresses.
 *   2. For a send: fetch UTXOs from mempool.space, look up each input's
 *      raw prev-tx hex, ask Ledger to sign via createPaymentTransaction
 *      (segwit + bech32), then broadcast.
 *
 * No mnemonic touches this module — Ledger holds the seed.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { BITCOIN_MAINNET } from '@thanos/sdk-core';
import { openBtcTransport, closeBtcTransport, LedgerError } from './ledger-transport';

const BTC_NETWORK   = bitcoin.networks.bitcoin;
const MEMPOOL_BASE  = BITCOIN_MAINNET.rpcUrls[0];
const RBF_SEQUENCE  = 0xfffffffd;
const DUST_SATS     = 546;

export interface LedgerBtcAccount {
  address:   string;     // bech32 (bc1q…)
  publicKey: string;     // 33-byte compressed pubkey hex
  /** Path WITHOUT leading "m/". e.g. "84'/0'/0'/0/0". */
  path:      string;
}

/* ─── Discovery ─────────────────────────────────────────────────── */

export async function discoverBtcAccounts(count = 5): Promise<LedgerBtcAccount[]> {
  const btc = await openBtcTransport();
  try {
    const out: LedgerBtcAccount[] = [];
    for (let i = 0; i < count; i++) {
      const path = `84'/0'/0'/0/${i}`;
      const { publicKey, bitcoinAddress } = await btc.getWalletPublicKey(path, { format: 'bech32' });
      out.push({ address: bitcoinAddress, publicKey, path });
    }
    return out;
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/locked/i.test(msg))   throw new LedgerError('locked',     'Unlock your Ledger and open the Bitcoin app');
    if (/not open/i.test(msg)) throw new LedgerError('app_closed', 'Open the Bitcoin app on your Ledger');
    throw new LedgerError('rpc_error', msg || 'Failed to read Bitcoin accounts');
  }
}

/* ─── Mempool.space helpers (mirrors lib/bitcoin.ts) ───────────── */

interface Utxo { txid: string; vout: number; value: number }

async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new LedgerError('rpc_error', `utxo ${res.status}`);
  return await res.json() as Utxo[];
}

async function fetchRawTxHex(txid: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/tx/${txid}/hex`);
  if (!res.ok) throw new LedgerError('rpc_error', `prev tx ${res.status}`);
  return (await res.text()).trim();
}

async function getFastestFeeRate(): Promise<number> {
  const res = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
  if (!res.ok) throw new LedgerError('rpc_error', `fees ${res.status}`);
  const json = await res.json() as { fastestFee?: number };
  return json.fastestFee ?? 15;
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

/* ─── Output script serialisation ────────────────────────────────
   Ledger wants a hex string of the outputs section of the unsigned
   tx (varint count + each output's value/script-len/script). We use
   bitcoinjs-lib's PSBT/Transaction primitives to build it correctly. */

function serializeOutputs(args: {
  recipient:      string;
  recipientSats:  number;
  changeAddress:  string;
  changeSats:     number;
}): string {
  /* bitcoinjs-lib v6.x `Transaction.addOutput` is typed `(script, value: number)`.
     Two outputs above 2 BTC (2.1e8 sat) wouldn't overflow a JS number safely,
     but the wallet caps individual sends well under that threshold.  */
  const tx = new bitcoin.Transaction();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (tx as any).addOutput(bitcoin.address.toOutputScript(args.recipient, BTC_NETWORK), args.recipientSats);
  if (args.changeSats > DUST_SATS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).addOutput(bitcoin.address.toOutputScript(args.changeAddress, BTC_NETWORK), args.changeSats);
  }
  /* Serialize ONLY the outputs section. bitcoinjs doesn't expose this
     directly; we serialize the whole tx and extract the outputs slice
     which starts after `version(4) + input_count(varint=0) = 5 bytes`. */
  const full = tx.toBuffer();
  // version(4) + segwit-marker/flag if any + input-count(varint) + locktime(4) at end.
  // Since this tx has no inputs and no witness, the layout is:
  //   version(4) | vin_count varint=0x00 | vout_count varint | outputs... | locktime(4)
  // So outputs section runs from byte 5 to (length - 4).
  const outputsBuf = full.subarray(5, full.length - 4);
  return Buffer.from(outputsBuf).toString('hex');
}

/* ─── Sign + broadcast ────────────────────────────────────────── */

export interface BtcSendArgs {
  account:         LedgerBtcAccount;
  recipient:       string;
  amount:          string;          // BTC, human-readable
  feeRateSatPerVb?: number;
}

export interface BtcSendResult {
  hash:     string;
  feeSats:  number;
  vbytes:   number;
  feeRate:  number;
}

export async function sendBitcoinWithLedger(args: BtcSendArgs): Promise<BtcSendResult> {
  const btcAmount = parseFloat(args.amount);
  if (!btcAmount || btcAmount <= 0) throw new LedgerError('invalid_amount', 'Amount must be greater than zero');
  const amountSats = Math.round(btcAmount * 1e8);
  try { bitcoin.address.toOutputScript(args.recipient, BTC_NETWORK); }
  catch { throw new LedgerError('invalid_address', 'Recipient is not a valid Bitcoin address'); }

  const utxos = await fetchUtxos(args.account.address);
  if (utxos.length === 0) throw new LedgerError('insufficient', 'No UTXOs available for this Ledger account');
  const feeRate = args.feeRateSatPerVb ?? await getFastestFeeRate();

  // Two-pass fee calc — first guess assumes 2 outputs, then we recompute
  // change after fee. If the change drops below DUST we drop the change
  // output and absorb it into the fee.
  const { selected, total } = selectUtxos(utxos, amountSats + 1000);
  if (total < amountSats) throw new LedgerError('insufficient', 'Insufficient BTC for amount + fees');
  let vbytes      = estimateVbytes(selected.length, 2);
  let feeSats     = vbytes * feeRate;
  let changeSats  = total - amountSats - feeSats;
  if (changeSats < 0) throw new LedgerError('insufficient', 'Fee exceeds balance — try a lower rate');
  if (changeSats <= DUST_SATS) {
    feeSats += changeSats;
    changeSats = 0;
    vbytes = estimateVbytes(selected.length, 1);
  }

  // Build the Ledger inputs array: each entry is
  //   [splitTransaction(prevHex, segwit=true), vout, undefined (no redeem script), RBF_SEQUENCE]
  const btc = await openBtcTransport();
  const inputs: Array<[unknown, number, undefined, number]> = [];
  for (const u of selected) {
    const prevHex = await fetchRawTxHex(u.txid);
    const tx      = btc.splitTransaction(prevHex, true);
    inputs.push([tx, u.vout, undefined, RBF_SEQUENCE]);
  }

  const outputScriptHex = serializeOutputs({
    recipient:     args.recipient.trim(),
    recipientSats: amountSats,
    changeAddress: args.account.address,
    changeSats,
  });

  let signedHex: string;
  try {
    signedHex = await btc.createPaymentTransaction({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputs:            inputs as any,
      associatedKeysets: inputs.map(() => args.account.path),
      outputScriptHex,
      segwit:            true,
      additionals:       ['bech32'],
      lockTime:          0,
      sigHashType:       0x01,
      useTrustedInputForSegwit: true,
    });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/denied|rejected|0x6985/i.test(msg)) throw new LedgerError('rejected', 'You rejected the transaction on the Ledger');
    throw new LedgerError('rpc_error', msg || 'Ledger signing failed');
  }

  const bres = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: signedHex });
  if (!bres.ok) throw new LedgerError('rpc_error', `Broadcast failed (${bres.status})`);
  const hash = await bres.text();
  return { hash, feeSats, vbytes, feeRate };
}

export async function closeBtc(): Promise<void> {
  await closeBtcTransport();
}
