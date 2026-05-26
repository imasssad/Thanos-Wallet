/**
 * Ledger Solana sign + broadcast for the desktop Send flow.
 *
 * Uses @ledgerhq/hw-transport-webhid + @ledgerhq/hw-app-solana. The
 * user must open the Solana app on-device before connecting. Same
 * single-active-app constraint as the BTC + EVM paths.
 *
 * Path follows Phantom: `m/44'/501'/0'/0'`. Only native SOL sends are
 * exposed in this build — SPL transfers via Ledger need an extra round
 * of token-account hydration and are out of scope for the initial
 * desktop ship (web has them).
 */
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import AppSol from '@ledgerhq/hw-app-solana';
import {
  Connection, LAMPORTS_PER_SOL, PublicKey,
  SystemProgram, Transaction,
} from '@solana/web3.js';

const SOL_HD_PATH = "44'/501'/0'/0'";
const RPC_URL     = 'https://api.mainnet-beta.solana.com';

export interface LedgerSolConnection {
  address:   string;        // base58 pubkey
  pubkey:    PublicKey;
  transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
  close:     () => Promise<void>;
}

export class LedgerSolError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'LedgerSolError';
  }
}

export async function connectLedgerSol(): Promise<LedgerSolConnection> {
  const transport = await TransportWebHID.create();
  try {
    const app = new AppSol(transport);
    const { address: rawPubkey } = await app.getAddress(SOL_HD_PATH);
    const pubkey = new PublicKey(rawPubkey);
    return {
      address: pubkey.toBase58(),
      pubkey,
      transport,
      close:   async () => { try { await transport.close(); } catch { /* ignore */ } },
    };
  } catch (e) {
    try { await transport.close(); } catch { /* ignore */ }
    const m = (e as Error).message ?? '';
    if (m.includes('0x6985')) throw new LedgerSolError('rejected', 'Rejected on Ledger device');
    if (m.includes('UNKNOWN_APDU') || m.toLowerCase().includes('app not open')) {
      throw new LedgerSolError('wrong_app', 'Open the Solana app on your Ledger first');
    }
    throw e;
  }
}

export interface LedgerSolSendParams {
  recipient: string;      // base58
  /** Human-readable SOL, e.g. "0.25". */
  amount: string;
}

export async function sendViaLedgerSol(
  conn: LedgerSolConnection, p: LedgerSolSendParams,
): Promise<string> {
  const sol = parseFloat(p.amount);
  if (!sol || sol <= 0) throw new LedgerSolError('invalid_amount', 'Amount must be > 0');
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);

  let to: PublicKey;
  try { to = new PublicKey(p.recipient.trim()); }
  catch { throw new LedgerSolError('invalid_address', 'Recipient is not a valid Solana address'); }

  const connection = new Connection(RPC_URL, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction({
    feePayer: conn.pubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(SystemProgram.transfer({
    fromPubkey: conn.pubkey,
    toPubkey:   to,
    lamports,
  }));

  // Ledger Solana app signs raw message bytes. Solana's `Transaction`
  // exposes `serializeMessage()` for exactly this.
  const messageBytes = tx.serializeMessage();

  const app = new AppSol(conn.transport);
  let signature: Buffer;
  try {
    const { signature: sig } = await app.signTransaction(SOL_HD_PATH, messageBytes);
    signature = sig;
  } catch (e) {
    const m = (e as Error).message ?? '';
    if (m.includes('0x6985')) throw new LedgerSolError('rejected', 'Rejected on Ledger device');
    throw new LedgerSolError('sign_failed', m || 'Signing failed');
  }

  // Attach the signature and broadcast.
  tx.addSignature(conn.pubkey, signature);
  if (!tx.verifySignatures()) {
    throw new LedgerSolError('mismatch', 'Ledger signature did not verify against the active pubkey');
  }
  const txid = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  return txid;
}
