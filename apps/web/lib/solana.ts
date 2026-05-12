'use client';
/**
 * Solana wallet integration.
 *
 * Thin web-app facade over sdk-core's SolanaClient. The mnemonic is
 * consumed only inside the worker today (signer-worker), but Solana
 * isn't yet routed through the worker — every send here briefly handles
 * the mnemonic on the main thread. Worker integration for Solana is a
 * follow-up; the signing isolation slice covered EVM first because that's
 * where most of the wallet's risk lives.
 *
 * Public surface:
 *   - getSolanaAddress(mnemonic) → base58 address derived at SOL HD path
 *   - getSolanaBalance(address) → SOL balance in human-readable string
 *   - sendSol({ mnemonic, recipient, amount }) → tx signature (base58)
 *   - sendSplToken({ mnemonic, recipient, amount, mintAddress, decimals })
 *   - isValidSolanaAddress(input) → boolean, used in Send recipient validation
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  SolanaClient, SOLANA_MAINNET,
} from '@thanos/sdk-core';

const NETWORK = SOLANA_MAINNET;

let _connection: Connection | null = null;
function getConnection(): Connection {
  if (_connection) return _connection;
  _connection = new Connection(NETWORK.rpcUrls[0], 'confirmed');
  return _connection;
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
  const lamports = await getConnection().getBalance(new PublicKey(address));
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

/** Native SOL transfer. Returns the tx signature. */
export async function sendSol(input: {
  mnemonic: string;
  recipient: string;
  amount:    string;  // human-readable, e.g. "0.5"
}): Promise<string> {
  if (!isValidSolanaAddress(input.recipient)) throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  if (!parseFloat(input.amount) || parseFloat(input.amount) <= 0) {
    throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');
  }
  try {
    return await client.send(input.mnemonic, {
      chainId:   NETWORK.chainId,
      to:        input.recipient,
      amount:    input.amount,
      // mintAddress omitted → native SOL transfer
    });
  } catch (e) {
    throw mapErr(e);
  }
}

/** SPL token transfer. Creates the recipient's associated token account
 *  if it doesn't exist (and pays the rent for it). */
export async function sendSplToken(input: {
  mnemonic:     string;
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
    return await client.send(input.mnemonic, {
      chainId:     NETWORK.chainId,
      to:          input.recipient,
      amount:      input.amount,
      mintAddress: input.mintAddress,
      decimals:    input.decimals ?? 6,
    });
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
