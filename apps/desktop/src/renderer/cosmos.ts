/**
 * Cosmos Hub (ATOM) integration — desktop renderer.
 * Mirrors apps/web/lib/cosmos.ts.
 */
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate';
import { fromBech32 } from '@cosmjs/encoding';
import { stringToPath, type HdPath } from '@cosmjs/crypto';

function env(name: string, fallback: string): string {
  const e = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (e && e[`VITE_${name}`]) || fallback;
}

const RPC_URL  = env('COSMOS_RPC',  'https://cosmos-rpc.publicnode.com');
const REST_URL = env('COSMOS_REST', 'https://cosmos-rest.publicnode.com');
const BECH32_PREFIX  = 'cosmos';
const NATIVE_DENOM   = 'uatom';
const NATIVE_DECIMALS = 6;
const HD_PATH        = "m/44'/118'/0'/0/0";
const GAS_PRICE      = GasPrice.fromString('0.025uatom');

export class CosmosSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'CosmosSendError';
  }
}

export function isValidCosmosAddress(input: string): boolean {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  try {
    const { prefix, data } = fromBech32(trimmed);
    return prefix === BECH32_PREFIX && data.length === 20;
  } catch { return false; }
}

const _addrCache = new Map<string, string>();
export async function getCosmosAddress(mnemonic: string): Promise<string> {
  const cached = _addrCache.get(mnemonic);
  if (cached) return cached;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: BECH32_PREFIX, hdPaths: [stringToPath(HD_PATH) as HdPath],
  });
  const [acc] = await wallet.getAccounts();
  _addrCache.set(mnemonic, acc.address);
  return acc.address;
}

export async function getCosmosBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return '0';
    const json = await res.json() as { balances?: Array<{ denom: string; amount: string }> };
    const row = (json.balances ?? []).find(b => b.denom === NATIVE_DENOM);
    if (!row) return '0';
    return formatUnits(row.amount, NATIVE_DECIMALS);
  } catch { return '0'; }
}

function formatUnits(raw: string, decimals: number): string {
  const negative = raw.startsWith('-');
  const s = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const intPart  = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${fracPart ? '.' + fracPart : ''}`;
}
function parseUnits(human: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(human)) throw new CosmosSendError('invalid_amount', 'Invalid number');
  const [intPart = '0', fracPart = ''] = human.split('.');
  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function estimateCosmosFee(): { atom: string; gas: number } {
  const gas = 100_000;
  const fee = calculateFee(gas, GAS_PRICE);
  const uatom = BigInt(fee.amount[0]?.amount ?? '0');
  return { atom: formatUnits(uatom.toString(), NATIVE_DECIMALS), gas };
}

export async function sendCosmos(input: {
  mnemonic: string; recipient: string; amount: string; memo?: string;
}): Promise<string> {
  const recipient = input.recipient.trim();
  if (!isValidCosmosAddress(recipient)) {
    throw new CosmosSendError('invalid_address', 'Recipient is not a valid Cosmos address');
  }
  let amountUatom: bigint;
  try { amountUatom = parseUnits(input.amount, NATIVE_DECIMALS); }
  catch { throw new CosmosSendError('invalid_amount', 'Enter a valid amount'); }
  if (amountUatom <= 0n) throw new CosmosSendError('invalid_amount', 'Amount must be greater than zero');

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(input.mnemonic, {
    prefix: BECH32_PREFIX, hdPaths: [stringToPath(HD_PATH) as HdPath],
  });
  const [acc] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(RPC_URL, wallet, { gasPrice: GAS_PRICE });

  try {
    const result = await client.sendTokens(
      acc.address, recipient,
      [{ denom: NATIVE_DENOM, amount: amountUatom.toString() }],
      'auto', input.memo ?? '',
    );
    if (result.code !== 0) throw new CosmosSendError('rpc_error', result.rawLog || `Tx failed (code ${result.code})`);
    return result.transactionHash;
  } catch (e) {
    if (e instanceof CosmosSendError) throw e;
    const msg = (e as Error).message || '';
    if (/insufficient/i.test(msg)) throw new CosmosSendError('insufficient', 'Insufficient ATOM for amount + fees');
    if (/rejected|denied/i.test(msg)) throw new CosmosSendError('rejected', 'Transaction rejected');
    throw new CosmosSendError('rpc_error', msg || 'Failed to broadcast');
  } finally { client.disconnect(); }
}

export function cosmosExplorerUrl(hash: string): string {
  return `https://www.mintscan.io/cosmos/tx/${hash}`;
}
