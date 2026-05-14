'use client';
/**
 * Cosmos Hub (ATOM) integration.
 *
 * Public surface:
 *   - getCosmosAddress(mnemonic)            → bech32 cosmos1… string
 *   - isValidCosmosAddress(input)           → boolean
 *   - getCosmosBalance(address)             → human-readable ATOM string
 *   - estimateCosmosFee(...)                → static gas-based estimate
 *   - sendCosmos({ mnemonic, recipient, amount }) → tx hash
 *   - cosmosExplorerUrl(hash)
 *
 * Mnemonic-only for v1 (no PK import flow). The signing happens briefly
 * on the main thread; worker re-isolation lands with the multi-chain
 * worker refactor.
 *
 * Network defaults to Cosmos Hub mainnet (cosmoshub-4); operators can
 * override via NEXT_PUBLIC_COSMOS_RPC + NEXT_PUBLIC_COSMOS_CHAIN_ID.
 */
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate';
import { fromBech32 } from '@cosmjs/encoding';
import { stringToPath, type HdPath } from '@cosmjs/crypto';

/* ─── Network defaults ─────────────────────────────────────────────── */
/* Cosmos Hub mainnet — chain ID + a public RPC. The RPC URL list is
 * env-overridable since public Cosmos RPCs rotate; we pick a known
 * stable one as the default. The hash prefix used by Mintscan is
 * "cosmos" — see cosmosExplorerUrl. */

function env(name: string, fallback: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (typeof process !== 'undefined' && (process as any).env?.[name]) || fallback;
}

const RPC_URL  = env('NEXT_PUBLIC_COSMOS_RPC',       'https://cosmos-rpc.publicnode.com');
const REST_URL = env('NEXT_PUBLIC_COSMOS_REST',      'https://cosmos-rest.publicnode.com');
const CHAIN_ID = env('NEXT_PUBLIC_COSMOS_CHAIN_ID',  'cosmoshub-4');
const BECH32_PREFIX = 'cosmos';
const NATIVE_DENOM  = 'uatom';     // 6 decimals
const NATIVE_DECIMALS = 6;
const HD_PATH       = "m/44'/118'/0'/0/0";
const GAS_PRICE     = GasPrice.fromString('0.025uatom');

/* ─── Errors ─────────────────────────────────────────────────────── */

export class CosmosSendError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CosmosSendError';
  }
}

/* ─── Validation ─────────────────────────────────────────────────── */

export function isValidCosmosAddress(input: string): boolean {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  try {
    const { prefix, data } = fromBech32(trimmed);
    return prefix === BECH32_PREFIX && data.length === 20;
  } catch { return false; }
}

/* ─── Derivation ─────────────────────────────────────────────────── */

/** Derive the user's Cosmos Hub address from their BIP39 mnemonic
 *  (account 0, address 0). Cached per-mnemonic for perf — derivation
 *  is sync-ish but DirectSecp256k1HdWallet.fromMnemonic is async. */
const _addrCache = new Map<string, string>();
export async function getCosmosAddress(mnemonic: string): Promise<string> {
  const cached = _addrCache.get(mnemonic);
  if (cached) return cached;
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix:    BECH32_PREFIX,
    hdPaths:   [parseHdPath(HD_PATH)],
  });
  const [acc] = await wallet.getAccounts();
  _addrCache.set(mnemonic, acc.address);
  return acc.address;
}

/* CosmJS's HdPath is a tuple of Slip10RawIndex values. */
function parseHdPath(path: string): HdPath {
  return stringToPath(path);
}

/* ─── Balance read via REST (LCD) ─────────────────────────────────── */

interface CosmosBalanceResp {
  balances?: Array<{ denom: string; amount: string }>;
}

/** Native ATOM balance, human-readable ("12.345678"). LCD is cheaper
 *  to hit than RPC for a single read; falls back to 0 on failure. */
export async function getCosmosBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return '0';
    const json = await res.json() as CosmosBalanceResp;
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

/* ─── Fee estimate ────────────────────────────────────────────────── */

/** Static gas-based estimate matching the value used at broadcast.
 *  ATOM MsgSend takes ~100k gas; at 0.025uatom/gas that's ~2,500 uatom. */
export function estimateCosmosFee(): { atom: string; gas: number } {
  const gas = 100_000;
  const fee = calculateFee(gas, GAS_PRICE);
  const uatom = BigInt(fee.amount[0]?.amount ?? '0');
  return {
    atom: formatUnits(uatom.toString(), NATIVE_DECIMALS),
    gas,
  };
}

/* ─── Send ────────────────────────────────────────────────────────── */

export async function sendCosmos(input: {
  mnemonic:  string;
  recipient: string;
  amount:    string;   // human-readable ATOM, e.g. "1.25"
  memo?:     string;
}): Promise<string> {
  const recipient = input.recipient.trim();
  if (!isValidCosmosAddress(recipient)) {
    throw new CosmosSendError('invalid_address', 'Recipient is not a valid Cosmos address (cosmos1…)');
  }
  let amountUatom: bigint;
  try { amountUatom = parseUnits(input.amount, NATIVE_DECIMALS); }
  catch { throw new CosmosSendError('invalid_amount', 'Enter a valid amount'); }
  if (amountUatom <= 0n) throw new CosmosSendError('invalid_amount', 'Amount must be greater than zero');

  let wallet: DirectSecp256k1HdWallet;
  try {
    wallet = await DirectSecp256k1HdWallet.fromMnemonic(input.mnemonic, {
      prefix:  BECH32_PREFIX,
      hdPaths: [parseHdPath(HD_PATH)],
    });
  } catch (e) {
    throw new CosmosSendError('derive_failed', `Could not derive Cosmos key: ${(e as Error).message}`);
  }

  const [acc] = await wallet.getAccounts();
  let client: SigningStargateClient;
  try {
    client = await SigningStargateClient.connectWithSigner(RPC_URL, wallet, {
      gasPrice: GAS_PRICE,
    });
  } catch (e) {
    throw new CosmosSendError('rpc_error', `Could not connect to Cosmos RPC: ${(e as Error).message}`);
  }

  try {
    const result = await client.sendTokens(
      acc.address,
      recipient,
      [{ denom: NATIVE_DENOM, amount: amountUatom.toString() }],
      'auto',
      input.memo ?? '',
    );
    if (result.code !== 0) {
      throw new CosmosSendError('rpc_error', result.rawLog || `Tx failed (code ${result.code})`);
    }
    return result.transactionHash;
  } catch (e) {
    if (e instanceof CosmosSendError) throw e;
    const msg = (e as Error).message || '';
    if (/insufficient/i.test(msg)) throw new CosmosSendError('insufficient', 'Insufficient ATOM for amount + fees');
    if (/rejected|denied/i.test(msg)) throw new CosmosSendError('rejected', 'Transaction rejected');
    throw new CosmosSendError('rpc_error', msg || 'Failed to broadcast Cosmos transaction');
  } finally {
    client.disconnect();
  }
}

/* ─── Explorer ────────────────────────────────────────────────────── */

export function cosmosExplorerUrl(hash: string): string {
  return `https://www.mintscan.io/cosmos/tx/${hash}`;
}
