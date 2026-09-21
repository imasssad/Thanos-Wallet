/**
 * Solana wallet integration — desktop renderer.
 * Mirrors apps/web/lib/solana.ts.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { SolanaClient, SOLANA_MAINNET } from '@thanos/sdk-core';

const NETWORK = SOLANA_MAINNET;
const RPC_URLS = NETWORK.rpcUrls.length ? NETWORK.rpcUrls : ['https://api.mainnet-beta.solana.com'];
let _connection: Connection | null = null;

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

export function isValidSolanaAddress(input: string): boolean {
  if (!input) return false;
  try { new PublicKey(input.trim()); return true; } catch { return false; }
}

export function getSolanaAddress(mnemonic: string): string {
  return client.deriveAccount(mnemonic, 0).address;
}

export async function getSolanaBalance(address: string): Promise<string> {
  const pubkey = new PublicKey(address);
  const lamports = await withSolanaRpc((conn) => conn.getBalance(pubkey));
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

export class SolanaSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'SolanaSendError';
  }
}

export async function sendSol(input: { mnemonic: string; recipient: string; amount: string }): Promise<string> {
  if (!isValidSolanaAddress(input.recipient)) throw new SolanaSendError('invalid_address', 'Recipient is not a valid Solana address');
  if (!parseFloat(input.amount) || parseFloat(input.amount) <= 0) {
    throw new SolanaSendError('invalid_amount', 'Amount must be greater than zero');
  }
  try {
    return await client.send(input.mnemonic, {
      chainId: NETWORK.chainId, to: input.recipient, amount: input.amount,
    });
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
  return await client.send(input.mnemonic, {
    chainId: NETWORK.chainId, to: input.recipient, amount: input.amount,
    mintAddress: input.mintAddress, decimals: input.decimals ?? 6,
  });
}

export function solanaExplorerUrl(signature: string): string {
  return `${NETWORK.blockExplorerUrl}/tx/${signature}`;
}
