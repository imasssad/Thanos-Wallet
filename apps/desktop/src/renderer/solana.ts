/**
 * Solana wallet integration — desktop renderer.
 * Mirrors apps/web/lib/solana.ts.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { SolanaClient, SOLANA_MAINNET } from '@thanos/sdk-core';

const NETWORK = SOLANA_MAINNET;
let _connection: Connection | null = null;
function getConnection(): Connection {
  if (_connection) return _connection;
  _connection = new Connection(NETWORK.rpcUrls[0], 'confirmed');
  return _connection;
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
  const lamports = await getConnection().getBalance(new PublicKey(address));
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
