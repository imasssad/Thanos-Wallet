'use client';
/**
 * Solana wallet integration.
 *
 * Thin web-app facade over sdk-core's SolanaClient for address/balance
 * reads. Sending now routes through the signing Worker (signer-worker.ts's
 * send-sol op) — H-1 residual, closed: this used to call
 * `client.send(mnemonic, ...)` directly from here, briefly handling the
 * mnemonic on the main thread for every send. No private-key import
 * exists for SOL, so every send is mnemonic-derived and goes through the
 * worker; there is no fallback main-thread path to keep.
 *
 * Public surface:
 *   - getSolanaAddress(mnemonic) → base58 address derived at SOL HD path
 *   - getSolanaBalance(address) → SOL balance in human-readable string
 *   - sendSol({ recipient, amount }) → tx signature (base58)
 *   - sendSplToken({ recipient, amount, mintAddress, decimals })
 *   - isValidSolanaAddress(input) → boolean, used in Send recipient validation
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  SolanaClient, SOLANA_MAINNET,
} from '@thanos/sdk-core';
import { signerSendSolana } from './signer-client';

const NETWORK = SOLANA_MAINNET;
const RPC_URLS = NETWORK.rpcUrls.length ? NETWORK.rpcUrls : ['https://api.mainnet-beta.solana.com'];

let _connection: Connection | null = null;

/** Prefer a working RPC; mainnet-beta alone rate-limits and zeros balances. */
async function withSolanaRpc<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  const urls = _connection
    ? [_connection.rpcEndpoint, ...RPC_URLS.filter((u) => u !== _connection!.rpcEndpoint)]
    : RPC_URLS;
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const conn = _connection?.rpcEndpoint === url ? _connection : new Connection(url, 'confirmed');
      const out = await fn(conn);
      _connection = conn;
      return out;
    } catch (e) {
      lastErr = e;
      if (_connection?.rpcEndpoint === url) _connection = null;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Solana RPC unavailable');
}

const client = new SolanaClient();

/** Validate a Solana public-key string. base58 + 32-byte length. */
export function isValidSolanaAddress(input: string): boolean {
  if (!input) return false;
  try {
    new PublicKey(input.trim());
    return true;
  } catch {
    return false;
  }
}

/** Derive the user's Solana address (account 0) from their BIP39 mnemonic.
 *  Uses sdk-core's SLIP-0010-based derivation (m/44'/501'/0'/0'). */
export function getSolanaAddress(mnemonic: string): string {
  return client.deriveAccount(mnemonic, 0).address;
}

/** SOL balance in human-readable string ("0.123456789"). */
export async function getSolanaBalance(address: string): Promise<string> {
  const pubkey = new PublicKey(address);
  const lamports = await withSolanaRpc((conn) => conn.getBalance(pubkey));
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

/** Native SOL transfer. Returns the tx signature. Signs through the
 *  Worker — no mnemonic ever passes through this function. */
export async function sendSol(input: {
  recipient: string;
  amount:    string;  // human-readable, e.g. "0.5"
}): Promise<string> {
  if (!isValidSolanaAddress(input.recipient)) throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  if (!parseFloat(input.amount) || parseFloat(input.amount) <= 0) {
    throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');
  }
  try {
    const { hash } = await signerSendSolana({ recipient: input.recipient, amount: input.amount });
    return hash;
  } catch (e) {
    throw mapErr(e);
  }
}

/** SPL token transfer. Creates the recipient's associated token account
 *  if it doesn't exist (and pays the rent for it). Signs through the
 *  Worker — no mnemonic ever passes through this function. */
export async function sendSplToken(input: {
  recipient:    string;
  amount:       string;
  mintAddress:  string;
  decimals?:    number;
}): Promise<string> {
  if (!isValidSolanaAddress(input.recipient))   throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  if (!isValidSolanaAddress(input.mintAddress)) throw new SolanaSendError('invalid_token',   'Token mint address is not valid');
  if (!parseFloat(input.amount) || parseFloat(input.amount) <= 0) {
    throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');
  }
  try {
    const { hash } = await signerSendSolana({
      recipient:   input.recipient,
      amount:      input.amount,
      mintAddress: input.mintAddress,
      decimals:    input.decimals ?? 6,
    });
    return hash;
  } catch (e) {
    throw mapErr(e);
  }
}

/* ─── Error mapping ─────────────────────────────────────────────────── */

export class SolanaSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SolanaSendError';
  }
}

function mapErr(e: unknown): SolanaSendError {
  if (e instanceof SolanaSendError) return e;
  const msg = (e as Error)?.message || 'Failed to send';
  if (/insufficient funds|insufficient lamports/i.test(msg)) {
    return new SolanaSendError('insufficient', 'Insufficient SOL balance to cover amount + fees');
  }
  if (/blockhash|node is behind/i.test(msg)) {
    return new SolanaSendError('rpc_error', 'Solana RPC issue — try again in a moment');
  }
  return new SolanaSendError('unknown', msg);
}

/** Explorer URL for a Solana tx. */
export function solanaExplorerUrl(signature: string): string {
  return `${NETWORK.blockExplorerUrl}/tx/${signature}`;
}
