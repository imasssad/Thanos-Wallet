'use client';
/**
 * Ledger — Solana signing.
 *
 * Solana uses Ed25519; the Ledger Solana app exposes:
 *   getAddress(path)              — 32-byte Ed25519 public key
 *   signTransaction(path, msgBuf) — 64-byte signature of the *message*
 *                                    (the bytes returned by
 *                                    Transaction.compileMessage().serialize())
 *
 * We assemble the tx with @solana/web3.js, hand the serialized message
 * to the device, then stitch the signature back on and broadcast.
 *
 * Only native SOL transfers are supported in this commit — SPL token
 * transfers via Ledger need the Solana app's "blind signing" toggle ON
 * and a slightly different message layout, landing in a follow-up.
 */
import {
  Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { SOLANA_MAINNET } from '@thanos/sdk-core';
import { openSolTransport, LedgerError } from './ledger-transport';

const RPC_URL = SOLANA_MAINNET.rpcUrls[0];

export interface LedgerSolAccount {
  /** Base58 PublicKey string. */
  address: string;
  /** Path WITHOUT leading "m/". e.g. "44'/501'/0'". */
  path:    string;
}

let _conn: Connection | null = null;
function getConnection(): Connection {
  if (!_conn) _conn = new Connection(RPC_URL, 'confirmed');
  return _conn;
}

function isValidSolanaAddress(input: string): boolean {
  try { new PublicKey(input.trim()); return true; }
  catch { return false; }
}

/* ─── Discovery ─────────────────────────────────────────────────── */

export async function discoverSolAccounts(count = 5): Promise<LedgerSolAccount[]> {
  const sol = await openSolTransport();
  const out: LedgerSolAccount[] = [];
  /* Phantom/Solflare use the BIP44 with one hardened level (account):
     m/44'/501'/i'/0' is the typical Phantom path. The Ledger Solana app
     also accepts the simpler m/44'/501'/i'. We use the Phantom-style
     path so an account imported from Phantom shows the same address. */
  for (let i = 0; i < count; i++) {
    const path = `44'/501'/${i}'/0'`;
    try {
      const { address } = await sol.getAddress(path, false);
      const pk = new PublicKey(Buffer.from(address));
      out.push({ address: pk.toBase58(), path });
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/locked/i.test(msg))   throw new LedgerError('locked',     'Unlock your Ledger and open the Solana app');
      if (/not open/i.test(msg)) throw new LedgerError('app_closed', 'Open the Solana app on your Ledger');
      throw new LedgerError('rpc_error', msg || 'Failed to read Solana accounts');
    }
  }
  return out;
}

/* ─── Sign + broadcast ────────────────────────────────────────── */

export interface SolSendArgs {
  account:   LedgerSolAccount;
  recipient: string;
  amount:    string;    // SOL, human-readable
}

export async function sendSolWithLedger(args: SolSendArgs): Promise<string> {
  if (!isValidSolanaAddress(args.recipient)) {
    throw new LedgerError('invalid_address', 'Recipient is not a valid Solana address');
  }
  const sol = parseFloat(args.amount);
  if (!sol || sol <= 0) throw new LedgerError('invalid_amount', 'Amount must be greater than zero');
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);

  const conn   = getConnection();
  const feePay = new PublicKey(args.account.address);
  const toPk   = new PublicKey(args.recipient.trim());

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');

  const tx = new Transaction({
    feePayer:        feePay,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({ fromPubkey: feePay, toPubkey: toPk, lamports }),
  );

  const messageBytes = tx.compileMessage().serialize();

  const ledger = await openSolTransport();
  let sig: Buffer;
  try {
    const { signature } = await ledger.signTransaction(args.account.path, Buffer.from(messageBytes));
    sig = signature;
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/denied|rejected|0x6985/i.test(msg)) throw new LedgerError('rejected', 'You rejected the transaction on the Ledger');
    throw new LedgerError('rpc_error', msg || 'Ledger signing failed');
  }

  tx.addSignature(feePay, sig);
  const raw = tx.serialize();

  try {
    const txid = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
    // Best-effort confirm using the last-valid block height returned with
    // the blockhash; if confirmation times out we still return the txid.
    try { await conn.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'confirmed'); }
    catch { /* user can verify on the explorer */ }
    return txid;
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/insufficient/i.test(msg)) throw new LedgerError('insufficient', 'Insufficient SOL for amount + fees');
    throw new LedgerError('rpc_error', msg || 'Failed to broadcast');
  }
}
