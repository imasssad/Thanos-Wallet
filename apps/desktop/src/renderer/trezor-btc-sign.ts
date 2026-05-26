/**
 * Trezor Bitcoin sign + broadcast for the desktop Send flow.
 *
 * @trezor/connect-web exposes `signTransaction` for Bitcoin. The user
 * confirms the spend on-device; Connect returns the fully-signed raw
 * tx hex which we broadcast through mempool.space.
 *
 * BIP84 native SegWit at m/84'/0'/0'/0/0 — same path as the seed-based
 * and Ledger BTC senders, so receive addresses match across signers.
 */
import TrezorConnect from '@trezor/connect-web';

const BTC_HD_PATH    = "m/84'/0'/0'/0/0";
const MEMPOOL_BASE   = 'https://mempool.space/api';
const RBF_SEQUENCE   = 0xfffffffd;
const DUST           = 546;

export interface TrezorBtcConnection {
  address: string;
  close:   () => Promise<void>;
}

export class TrezorBtcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'TrezorBtcError';
  }
}

let initialised = false;
async function ensureInit(): Promise<void> {
  if (initialised) return;
  await TrezorConnect.init({
    lazyLoad: true,
    manifest: { appName: 'Thanos Wallet', email: 'support@thanos.fi', appUrl: 'https://thanos.fi' },
  });
  initialised = true;
}

export async function connectTrezorBtc(): Promise<TrezorBtcConnection> {
  await ensureInit();
  const res = await TrezorConnect.getAddress({
    path:         BTC_HD_PATH,
    coin:         'btc',
    showOnTrezor: true,
  });
  if (!res.success) throw new TrezorBtcError('connect_failed', res.payload?.error ?? 'Trezor returned an error');
  return { address: res.payload.address, close: async () => { /* Connect manages its iframe */ } };
}

interface Utxo { txid: string; vout: number; value: number }

async function fetchUtxos(addr: string): Promise<Utxo[]> {
  const r = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(addr)}/utxo`);
  if (!r.ok) throw new TrezorBtcError('rpc_error', `utxo ${r.status}`);
  return await r.json() as Utxo[];
}
async function fetchFeeRate(): Promise<number> {
  const r = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
  if (!r.ok) throw new TrezorBtcError('rpc_error', `fees ${r.status}`);
  const j = await r.json() as { fastestFee?: number };
  return j.fastestFee ?? 15;
}

function estimateVbytes(nIn: number, nOut: number) { return 10 + nIn * 68 + nOut * 31; }
function selectUtxos(utxos: Utxo[], target: number) {
  const selected: Utxo[] = []; let total = 0;
  for (const u of utxos) { selected.push(u); total += u.value; if (total >= target) break; }
  return { selected, total };
}

export interface TrezorBtcSendParams {
  recipient: string;
  amount: string;
  feeRateSatPerVb?: number;
}

export async function sendViaTrezorBtc(
  conn: TrezorBtcConnection, p: TrezorBtcSendParams,
): Promise<string> {
  await ensureInit();
  const btc = parseFloat(p.amount);
  if (!btc || btc <= 0) throw new TrezorBtcError('invalid_amount', 'Amount must be > 0');
  const amountSats = Math.round(btc * 1e8);
  const feeRate    = p.feeRateSatPerVb ?? await fetchFeeRate();

  const utxos = await fetchUtxos(conn.address);
  if (utxos.length === 0) throw new TrezorBtcError('insufficient', 'No spendable UTXOs');
  const { selected, total } = selectUtxos(utxos, amountSats + 1000);
  const vbytes  = estimateVbytes(selected.length, 2);
  const feeSats = vbytes * feeRate;
  const changeSats = total - amountSats - feeSats;
  if (changeSats < 0) throw new TrezorBtcError('insufficient', 'Insufficient balance for amount + fees');

  const inputs = selected.map(u => ({
    address_n: [84 | 0x80000000, 0 | 0x80000000, 0 | 0x80000000, 0, 0],
    prev_index: u.vout,
    prev_hash:  u.txid,
    amount:     u.value.toString(),
    script_type: 'SPENDWITNESS' as const,
    sequence:    RBF_SEQUENCE,
  }));

  const outputs = [
    {
      address: p.recipient.trim(),
      amount:  amountSats.toString(),
      script_type: 'PAYTOADDRESS' as const,
    },
    ...(changeSats > DUST ? [{
      address_n: [84 | 0x80000000, 0 | 0x80000000, 0 | 0x80000000, 1, 0],
      amount:    changeSats.toString(),
      script_type: 'PAYTOWITNESS' as const,
    }] : []),
  ];

  const res = await TrezorConnect.signTransaction({
    coin:    'btc',
    inputs,
    outputs,
    version: 2,
  });
  if (!res.success) {
    const msg = res.payload?.error ?? 'Trezor signing failed';
    if (/cancel|denied|rejected/i.test(msg)) throw new TrezorBtcError('rejected', 'Rejected on Trezor device');
    throw new TrezorBtcError('sign_failed', msg);
  }
  const signedTxHex = res.payload.serializedTx;

  const broadcast = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: signedTxHex });
  if (!broadcast.ok) throw new TrezorBtcError('rpc_error', `Broadcast failed (${broadcast.status})`);
  return await broadcast.text();
}
