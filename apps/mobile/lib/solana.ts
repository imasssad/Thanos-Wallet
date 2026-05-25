/**
 * Solana wallet integration — mobile (React Native).
 *
 * Uses @solana/web3.js + ed25519-style HD derivation from BIP39 seed
 * (Phantom-compatible: m/44'/501'/0'/0').
 */
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey,
  SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddress, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const EXPLORER_BASE = 'https://explorer.solana.com';
const SOL_PATH = "m/44'/501'/0'/0'";

let _connection: Connection | null = null;
function getConnection(): Connection {
  if (_connection) return _connection;
  _connection = new Connection(RPC_URL, 'confirmed');
  return _connection;
}

export class SolanaSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'SolanaSendError';
  }
}

function keypairFromMnemonic(mnemonic: string): Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  // Solana uses ed25519 SLIP-0010 derivation. @scure/bip32 is secp256k1-only,
  // so we derive via SLIP-0010 manually using the seed.
  const ed25519 = ed25519HD(seed, SOL_PATH);
  return Keypair.fromSeed(ed25519);
}

/** Minimal SLIP-0010 ed25519 master + child derivation — sufficient for
 *  hardened-only paths like Solana's m/44'/501'/0'/0'. */
function ed25519HD(masterSeed: Uint8Array, path: string): Uint8Array {
  // HMAC-SHA512("ed25519 seed", masterSeed) -> {IL: privKey, IR: chainCode}
  const hmacSha512 = require('@noble/hashes/hmac').hmac;
  const { sha512 } = require('@noble/hashes/sha2');
  const utf8 = (s: string) => new TextEncoder().encode(s);
  let I = hmacSha512(sha512, utf8('ed25519 seed'), masterSeed);
  let key = I.slice(0, 32);
  let chain = I.slice(32, 64);

  const parts = path.replace(/^m\//, '').split('/');
  for (const p of parts) {
    const hardened = p.endsWith("'");
    const idx = (parseInt(hardened ? p.slice(0, -1) : p, 10) | (hardened ? 0x80000000 : 0)) >>> 0;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data[33] = (idx >>> 24) & 0xff;
    data[34] = (idx >>> 16) & 0xff;
    data[35] = (idx >>> 8)  & 0xff;
    data[36] =  idx         & 0xff;
    I = hmacSha512(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32, 64);
  }
  return key;
}

export function isValidSolanaAddress(input: string): boolean {
  if (!input) return false;
  try { new PublicKey(input.trim()); return true; } catch { return false; }
}

export function getSolanaAddress(mnemonic: string): string {
  return keypairFromMnemonic(mnemonic).publicKey.toBase58();
}

export async function getSolanaBalance(address: string): Promise<string> {
  const lamports = await getConnection().getBalance(new PublicKey(address));
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

export async function sendSol(input: {
  mnemonic: string; recipient: string; amount: string;
}): Promise<string> {
  if (!isValidSolanaAddress(input.recipient)) {
    throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  }
  const v = parseFloat(input.amount);
  if (!v || v <= 0) throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');

  try {
    const sender = keypairFromMnemonic(input.mnemonic);
    const lamports = Math.round(v * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: new PublicKey(input.recipient.trim()),
        lamports,
      }),
    );
    const conn = getConnection();
    return await sendAndConfirmTransaction(conn, tx, [sender]);
  } catch (e) {
    const msg = (e as Error)?.message || 'Failed to send';
    if (/insufficient/i.test(msg)) throw new SolanaSendError('insufficient', 'Insufficient SOL balance');
    if (/blockhash|node is behind/i.test(msg)) throw new SolanaSendError('rpc_error', 'Solana RPC issue');
    throw new SolanaSendError('unknown', msg);
  }
}

export async function sendSplToken(input: {
  mnemonic: string; recipient: string; amount: string; mintAddress: string; decimals?: number;
}): Promise<string> {
  if (!isValidSolanaAddress(input.recipient))   throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  if (!isValidSolanaAddress(input.mintAddress)) throw new SolanaSendError('invalid_token',   'Token mint address is not valid');
  const v = parseFloat(input.amount);
  if (!v || v <= 0) throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');
  const decimals = input.decimals ?? 6;
  const amountBase = BigInt(Math.round(v * 10 ** decimals));

  const sender = keypairFromMnemonic(input.mnemonic);
  const mint   = new PublicKey(input.mintAddress);
  const dest   = new PublicKey(input.recipient.trim());
  const conn   = getConnection();

  const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);
  const destAta   = await getAssociatedTokenAddress(mint, dest);

  const tx = new Transaction();
  const destAcc = await conn.getAccountInfo(destAta);
  if (!destAcc) {
    tx.add(createAssociatedTokenAccountInstruction(sender.publicKey, destAta, dest, mint));
  }
  tx.add(createTransferCheckedInstruction(
    senderAta, mint, destAta, sender.publicKey, amountBase, decimals, [], TOKEN_PROGRAM_ID,
  ));
  return await sendAndConfirmTransaction(conn, tx, [sender]);
}

export function solanaExplorerUrl(signature: string): string {
  return `${EXPLORER_BASE}/tx/${signature}`;
}
