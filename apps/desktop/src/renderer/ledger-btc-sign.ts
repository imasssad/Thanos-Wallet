/**
 * Ledger Bitcoin sign + broadcast for the desktop Send flow.
 *
 * Uses @ledgerhq/hw-transport-webhid (same vendor allowlist already
 * granted to the EVM signer in src/main/index.ts) + @ledgerhq/hw-app-btc.
 * The user must open the Bitcoin app on-device before connecting; the
 * EVM and BTC apps are mutually exclusive on a single Ledger session.
 *
 * BIP84 native SegWit P2WPKH at `m/84'/0'/0'/0/0`. Broadcasts to
 * mempool.space — same backend the seed-based BTC sender uses.
 */
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import AppBtc from '@ledgerhq/hw-app-btc';

const BTC_HD_PATH    = "84'/0'/0'/0/0";  // Ledger uses path without leading m/
const MEMPOOL_BASE   = 'https://mempool.space/api';
const RBF_SEQUENCE   = 0xfffffffd;
const DUST           = 546;

export interface LedgerBtcConnection {
  address:   string;
  transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
  close:     () => Promise<void>;
}

export class LedgerBtcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'LedgerBtcError';
  }
}

/** Open WebHID, ask the device for the BIP84 receive address. The user
 *  must already have the Bitcoin app launched on the device. */
export async function connectLedgerBtc(): Promise<LedgerBtcConnection> {
  const transport = await TransportWebHID.create();
  try {
    const app = new AppBtc({ transport, currency: 'bitcoin' });
    // BIP84 → native SegWit (bech32). getWalletPublicKey returns
    // { publicKey, bitcoinAddress, chainCode }.
    const { bitcoinAddress } = await app.getWalletPublicKey(BTC_HD_PATH, {
      verify: false,
      format: 'bech32',
    });
    return {
      address:   bitcoinAddress,
      transport,
      close:     async () => { try { await transport.close(); } catch { /* best-effort */ } },
    };
  } catch (e) {
    try { await transport.close(); } catch { /* ignore */ }
    if ((e as Error).message?.includes('0x6985')) {
      throw new LedgerBtcError('rejected', 'Rejected on Ledger device');
    }
    if ((e as Error).message?.includes('UNKNOWN_APDU')) {
      throw new LedgerBtcError('wrong_app', 'Open the Bitcoin app on your Ledger first');
    }
    throw e;
  }
}

interface Utxo { txid: string; vout: number; value: number }

async function fetchUtxos(addr: string): Promise<Utxo[]> {
  const r = await fetch(`${MEMPOOL_BASE}/address/${encodeURIComponent(addr)}/utxo`);
  if (!r.ok) throw new LedgerBtcError('rpc_error', `utxo ${r.status}`);
  return await r.json() as Utxo[];
}
async function fetchRawTx(txid: string): Promise<string> {
  const r = await fetch(`${MEMPOOL_BASE}/tx/${encodeURIComponent(txid)}/hex`);
  if (!r.ok) throw new LedgerBtcError('rpc_error', `rawtx ${r.status}`);
  return await r.text();
}
async function fetchFeeRate(): Promise<number> {
  const r = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
  if (!r.ok) throw new LedgerBtcError('rpc_error', `fees ${r.status}`);
  const j = await r.json() as { fastestFee?: number };
  return j.fastestFee ?? 15;
}

function estimateVbytes(nIn: number, nOut: number) { return 10 + nIn * 68 + nOut * 31; }
function selectUtxos(utxos: Utxo[], target: number) {
  const selected: Utxo[] = []; let total = 0;
  for (const u of utxos) { selected.push(u); total += u.value; if (total >= target) break; }
  return { selected, total };
}

export interface LedgerBtcSendParams {
  recipient: string;
  /** Human-readable BTC, e.g. "0.001". */
  amount: string;
  feeRateSatPerVb?: number;
}

/** Build PSBT-equivalent via hw-app-btc, ask the Ledger to sign each
 *  input, broadcast through mempool.space. Returns the broadcast txid. */
export async function sendViaLedgerBtc(
  conn: LedgerBtcConnection, p: LedgerBtcSendParams,
): Promise<string> {
  const btc = parseFloat(p.amount);
  if (!btc || btc <= 0) throw new LedgerBtcError('invalid_amount', 'Amount must be > 0');
  const amountSats = Math.round(btc * 1e8);
  const feeRate = p.feeRateSatPerVb ?? await fetchFeeRate();

  const utxos = await fetchUtxos(conn.address);
  if (utxos.length === 0) throw new LedgerBtcError('insufficient', 'No spendable UTXOs');

  const { selected, total } = selectUtxos(utxos, amountSats + 1000);
  const vbytes  = estimateVbytes(selected.length, 2);
  const feeSats = vbytes * feeRate;
  const changeSats = total - amountSats - feeSats;
  if (changeSats < 0) throw new LedgerBtcError('insufficient', 'Insufficient balance for amount + fees');

  const app = new AppBtc({ transport: conn.transport, currency: 'bitcoin' });

  // Hydrate each UTXO's parent tx (Ledger needs the full prev-tx to
  // satisfy the SegWit witness rules).
  const inputs: Parameters<typeof app.createPaymentTransaction>[0]['inputs'] = [];
  for (const u of selected) {
    const rawHex = await fetchRawTx(u.txid);
    const tx = app.splitTransaction(rawHex, /* hasTimestamp */ false, /* hasExtraData */ false);
    inputs.push([tx, u.vout, undefined, RBF_SEQUENCE]);
  }
  const outputAddrs: string[] = [p.recipient.trim()];
  const outputAmounts: number[] = [amountSats];
  if (changeSats > DUST) {
    outputAddrs.push(conn.address);
    outputAmounts.push(changeSats);
  }
  // Build the outputs section by hand:
  //   <varint: nOuts> [ <8B amount LE> <varint: scriptLen> <script> ]+
  // This sidesteps hw-app-btc's serializeTransactionOutputs which has a
  // tighter type signature than the runtime actually needs.
  const writeVarInt = (n: number): Buffer => {
    if (n < 0xfd) return Buffer.from([n]);
    if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
  };
  const parts: Buffer[] = [writeVarInt(outputAddrs.length)];
  for (let i = 0; i < outputAddrs.length; i++) {
    const amt = Buffer.alloc(8);
    amt.writeBigUInt64LE(BigInt(outputAmounts[i]));
    const script = addressToScriptPubkey(outputAddrs[i]);
    parts.push(amt, writeVarInt(script.length), script);
  }
  const outputScriptHex = Buffer.concat(parts).toString('hex');

  const signedRaw = await app.createPaymentTransaction({
    inputs,
    associatedKeysets: inputs.map(() => BTC_HD_PATH),
    outputScriptHex,
    segwit: true,
    additionals: ['bech32'],
    sigHashType: 1,
  });

  const r = await fetch(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: signedRaw });
  if (!r.ok) throw new LedgerBtcError('rpc_error', `Broadcast failed (${r.status})`);
  return await r.text();
}

/** Minimal bech32 → output-script encoder. Used only here; the full
 *  bitcoinjs-lib path would do the same but pulls a much bigger import
 *  chain into the desktop bundle. */
function addressToScriptPubkey(addr: string): Buffer {
  // Lazy import — bitcoinjs-lib is already a desktop dep for the
  // seed-based BTC sender so the cost is zero here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bitcoin = require('bitcoinjs-lib');
  return bitcoin.address.toOutputScript(addr, bitcoin.networks.bitcoin);
}
