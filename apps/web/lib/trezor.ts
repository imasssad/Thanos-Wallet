'use client';
/**
 * Trezor hardware-wallet integration (web).
 *
 * Unlike Ledger — which we drive over a raw WebUSB transport with a
 * per-coin hw-app — Trezor exposes ONE SDK (@trezor/connect-web) that
 * pops its own trusted popup at connect.trezor.io and handles the
 * transport (WebUSB / Trezor Bridge) itself. So this module is a thin
 * wrapper: init once, then call the typed methods.
 *
 * Covers the three chains the scope calls for — EVM, Bitcoin, Solana:
 *   - discovery: getEvm/Btc/SolAccounts → addresses for the picker
 *   - signing:   sendEvm/Bitcoin/SolWithTrezor → broadcast a tx
 *
 * Every Trezor call returns `{ success, payload }`; we throw a typed
 * TrezorError on `success === false` so the UI can branch.
 */
import {
  Transaction as EthTx, formatUnits as ethFormatUnits,
  parseUnits as ethParseUnits, getAddress, type Provider,
} from 'ethers';
import {
  Connection, PublicKey, SystemProgram, Transaction as SolTx, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getMakaluProvider } from './rpc';
import { getEvmProvider, getEvmChain } from './evm-chains';

/* ─── Types ────────────────────────────────────────────────────────── */

export class TrezorError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TrezorError';
  }
}

export interface TrezorAccount {
  address: string;
  /** Path WITHOUT leading "m/". */
  path:    string;
}

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

/* ─── SDK singleton ───────────────────────────────────────────────── */
/* @trezor/connect-web touches `window`; import + init lazily so it
   never runs during SSR. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _connect: any = null;
let _initPromise: Promise<void> | null = null;

async function trezor(): Promise<typeof import('@trezor/connect-web').default> {
  if (typeof window === 'undefined') {
    throw new TrezorError('no_window', 'Trezor is only available in the browser');
  }
  if (_connect && _initPromise) { await _initPromise; return _connect; }
  const mod = await import('@trezor/connect-web');
  _connect = mod.default;
  _initPromise = _connect.init({
    lazyLoad: true,
    manifest: {
      email:  'devs@thanos.fi',
      appUrl: typeof window !== 'undefined' ? window.location.origin : 'https://devapp.thanos.fi',
    },
  }).catch((e: unknown) => {
    // init() rejects only on a hard failure; a second init() throws
    // "already initialised" which we treat as success.
    const msg = (e as Error)?.message || '';
    if (!/already/i.test(msg)) throw new TrezorError('init_failed', msg || 'Trezor init failed');
  });
  await _initPromise;
  return _connect;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function unwrap<T>(res: any, what: string): T {
  if (!res || res.success !== true) {
    const msg = res?.payload?.error || 'Trezor request failed';
    if (/cancelled|denied/i.test(msg)) throw new TrezorError('rejected', 'You cancelled the request on the Trezor');
    throw new TrezorError('device_error', `${what}: ${msg}`);
  }
  return res.payload as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─── EVM ──────────────────────────────────────────────────────────── */

export async function discoverEvmAccounts(count = 5): Promise<TrezorAccount[]> {
  const t = await trezor();
  const out: TrezorAccount[] = [];
  for (let i = 0; i < count; i++) {
    const path = `m/44'/60'/0'/0/${i}`;
    const p = unwrap<{ address: string }>(
      await t.ethereumGetAddress({ path, showOnTrezor: false }),
      'ethereumGetAddress',
    );
    out.push({ address: getAddress(p.address), path: path.replace(/^m\//, '') });
  }
  return out;
}

/** Sign + broadcast a native-coin EVM transfer via Trezor. Works for
 *  Makalu and every external EVM chain. */
export async function sendEvmWithTrezor(args: {
  account:   TrezorAccount;
  chainId:   number;
  recipient: string;
  amount:    string;       // human-readable, 18 decimals
}): Promise<string> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(args.recipient.trim())) {
    throw new TrezorError('invalid_address', 'Recipient must be a 0x address');
  }
  let value: bigint;
  try { value = ethParseUnits(args.amount, 18); }
  catch { throw new TrezorError('invalid_amount', 'Enter a valid amount'); }
  if (value <= 0n) throw new TrezorError('invalid_amount', 'Amount must be greater than zero');

  const provider: Provider =
    getEvmChain(args.chainId) ? getEvmProvider(args.chainId) : getMakaluProvider();

  const [nonce, feeData, net] = await Promise.all([
    provider.getTransactionCount(args.account.address),
    provider.getFeeData(),
    provider.getNetwork(),
  ]);
  const maxFeePerGas         = feeData.maxFeePerGas         ?? feeData.gasPrice ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
  const gasLimit = await provider.estimateGas({ from: args.account.address, to: args.recipient, value });

  const t = await trezor();
  const hex = (n: bigint) => `0x${n.toString(16)}`;
  const signed = unwrap<{ v: string; r: string; s: string }>(
    await t.ethereumSignTransaction({
      path: `m/${args.account.path}`,
      transaction: {
        to:                   args.recipient.trim(),
        value:                hex(value),
        gasLimit:             hex(gasLimit),
        maxFeePerGas:         hex(maxFeePerGas),
        maxPriorityFeePerGas: hex(maxPriorityFeePerGas),
        nonce:                hex(BigInt(nonce)),
        chainId:              Number(net.chainId),
        data:                 '0x',
      },
    }),
    'ethereumSignTransaction',
  );

  // Reassemble the signed EIP-1559 tx and broadcast.
  const tx = EthTx.from({
    type: 2, chainId: Number(net.chainId),
    to: args.recipient.trim(), value, nonce, gasLimit,
    maxFeePerGas, maxPriorityFeePerGas,
  });
  tx.signature = { v: parseInt(signed.v, 16), r: signed.r, s: signed.s };
  const res = await provider.broadcastTransaction(tx.serialized);
  return res.hash;
}

/* ─── Bitcoin ──────────────────────────────────────────────────────── */

const MEMPOOL = 'https://mempool.space/api';

export async function discoverBtcAccounts(count = 5): Promise<TrezorAccount[]> {
  const t = await trezor();
  const out: TrezorAccount[] = [];
  for (let i = 0; i < count; i++) {
    const path = `m/84'/0'/0'/0/${i}`;
    const p = unwrap<{ address: string }>(
      await t.getAddress({ path, coin: 'btc', showOnTrezor: false }),
      'getAddress',
    );
    out.push({ address: p.address, path: path.replace(/^m\//, '') });
  }
  return out;
}

interface Utxo { txid: string; vout: number; value: number }

/** Sign + broadcast a BTC send. Trezor builds and signs the tx from the
 *  inputs/outputs we hand it (native segwit, BIP84) and returns the
 *  serialized hex; we broadcast via mempool.space. */
export async function sendBitcoinWithTrezor(args: {
  account:   TrezorAccount;
  recipient: string;
  amount:    string;       // BTC, human-readable
}): Promise<string> {
  const sats = Math.round(parseFloat(args.amount) * 1e8);
  if (!sats || sats <= 0) throw new TrezorError('invalid_amount', 'Amount must be greater than zero');

  const utxoRes = await fetch(`${MEMPOOL}/address/${encodeURIComponent(args.account.address)}/utxo`);
  if (!utxoRes.ok) throw new TrezorError('rpc_error', 'Could not fetch UTXOs');
  const utxos = await utxoRes.json() as Utxo[];
  if (utxos.length === 0) throw new TrezorError('insufficient', 'No spendable UTXOs');

  // Greedy selection with a flat fee buffer; Trezor recomputes the exact
  // fee from the outputs we declare, so we only need enough inputs.
  const FEE_BUFFER = 800;
  let total = 0;
  const selected: Utxo[] = [];
  for (const u of utxos) {
    selected.push(u); total += u.value;
    if (total >= sats + FEE_BUFFER) break;
  }
  if (total < sats + FEE_BUFFER) throw new TrezorError('insufficient', 'Insufficient BTC for amount + fee');

  const t = await trezor();
  const signed = unwrap<{ serializedTx: string }>(
    await t.signTransaction({
      coin: 'btc',
      inputs: selected.map(u => ({
        address_n:   `m/${args.account.path}`,
        prev_hash:   u.txid,
        prev_index:  u.vout,
        amount:      String(u.value),
        script_type: 'SPENDWITNESS' as const,
      })),
      outputs: [
        { address: args.recipient.trim(), amount: String(sats), script_type: 'PAYTOADDRESS' as const },
        // Change back to our own address — Trezor sizes it after fee.
        { address_n: `m/${args.account.path}`, amount: String(total - sats - FEE_BUFFER),
          script_type: 'PAYTOWITNESS' as const },
      ],
    }),
    'signTransaction',
  );

  const broadcast = await fetch(`${MEMPOOL}/tx`, { method: 'POST', body: signed.serializedTx });
  if (!broadcast.ok) throw new TrezorError('rpc_error', `Broadcast failed (${broadcast.status})`);
  return (await broadcast.text()).trim();
}

/* ─── Solana ───────────────────────────────────────────────────────── */

export async function discoverSolAccounts(count = 5): Promise<TrezorAccount[]> {
  const t = await trezor();
  const out: TrezorAccount[] = [];
  for (let i = 0; i < count; i++) {
    const path = `m/44'/501'/${i}'/0'`;
    const p = unwrap<{ address: string }>(
      await t.solanaGetAddress({ path, showOnTrezor: false }),
      'solanaGetAddress',
    );
    out.push({ address: p.address, path: path.replace(/^m\//, '') });
  }
  return out;
}

/** Sign + broadcast a native SOL transfer via Trezor. */
export async function sendSolWithTrezor(args: {
  account:   TrezorAccount;
  recipient: string;
  amount:    string;       // SOL, human-readable
}): Promise<string> {
  let toPk: PublicKey;
  try { toPk = new PublicKey(args.recipient.trim()); }
  catch { throw new TrezorError('invalid_address', 'Recipient is not a valid Solana address'); }
  const lamports = Math.round(parseFloat(args.amount) * LAMPORTS_PER_SOL);
  if (!lamports || lamports <= 0) throw new TrezorError('invalid_amount', 'Amount must be greater than zero');

  const conn   = new Connection(SOLANA_RPC, 'confirmed');
  const feePk  = new PublicKey(args.account.address);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');

  const tx = new SolTx({ feePayer: feePk, recentBlockhash: blockhash })
    .add(SystemProgram.transfer({ fromPubkey: feePk, toPubkey: toPk, lamports }));

  // Trezor signs the fully-serialized message.
  const serialized = tx.serializeMessage().toString('hex');
  const t = await trezor();
  const signed = unwrap<{ signature: string }>(
    await t.solanaSignTransaction({ path: `m/${args.account.path}`, serializedTx: serialized }),
    'solanaSignTransaction',
  );

  tx.addSignature(feePk, Buffer.from(signed.signature, 'hex'));
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
    try { await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed'); }
    catch { /* user can verify on explorer */ }
    return sig;
  } catch (e) {
    throw new TrezorError('rpc_error', (e as Error).message || 'Broadcast failed');
  }
}

/* ─── Misc ─────────────────────────────────────────────────────────── */

/** Best-effort: format an EVM wei balance for display. */
export function formatEvmBalance(wei: bigint): string {
  return ethFormatUnits(wei, 18);
}
