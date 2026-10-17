/**
 * Which network Thanos MultiSig runs on, and where the Litho Vault contracts are.
 *
 * By default: Lithosphere Mainnet (9005) with the Litho Vault deployment published in the SDK.
 * Until that deployment exists the MultiSig screens say so instead of offering actions. A build
 * can point at a testnet or a local chain with the same keys Litho Vault's apps use, prefixed
 * per app (NEXT_PUBLIC_MULTISIG_*, VITE_MULTISIG_*, EXPO_PUBLIC_MULTISIG_*).
 */
import { chainFromEnv, type Address, type ChainConfig } from '@litho-vault/sdk';

export interface MultisigEnv {
  CHAIN_ID?: string;
  CHAIN_NAME?: string;
  RPC_URL?: string;
  EXPLORER_URL?: string;
  FACTORY?: string;
  LENS?: string;
  AI_GUARD?: string;
  RECOVERY_GUARD?: string;
  FREEZE_GUARD?: string;
  IMPLEMENTATION?: string;
  DEPLOY_BLOCK?: string;
  /** Litho Vault indexer: finds every vault an account signs for, and relays off-chain approvals. */
  INDEXER_URL?: string;
  /** Litho Vault app, for the settings Thanos MultiSig doesn't edit (policies, agents, recovery). */
  APP_URL?: string;
}

export interface MultisigNetwork {
  chain: ChainConfig;
  /** RPC the screens read through. Web builds route CORS-limited RPCs through their own proxy. */
  readRpcUrl: string;
  /** RPC the wallet broadcasts through. */
  sendRpcUrl: string;
  factory: Address | null;
  deployBlock: number;
  indexerUrl: string | null;
  appUrl: string | null;
}

function serviceUrl(value: string | undefined, name: string): string | null {
  const v = value?.trim();
  if (!v) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error(`Invalid ${name}: ${v}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`${name} must be an https URL`);
  }
  return url.toString().replace(/\/$/, '');
}

/** Drops unset and empty values, so an app can pass every key it knows about. */
function defined(env: MultisigEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''));
}

export function multisigNetwork(env: MultisigEnv = {}, options: { browserRpcUrl?: (url: string) => string } = {}): MultisigNetwork {
  const values = defined(env);
  const chain = chainFromEnv(values);
  const factory = chain.contracts?.factory ?? null;
  return {
    chain,
    readRpcUrl: options.browserRpcUrl ? options.browserRpcUrl(chain.rpcUrl) : chain.rpcUrl,
    sendRpcUrl: chain.rpcUrl,
    factory,
    deployBlock: chain.contracts?.deployBlock ?? 0,
    indexerUrl: serviceUrl(values.INDEXER_URL, 'MultiSig indexer URL'),
    appUrl: serviceUrl(values.APP_URL, 'Litho Vault app URL'),
  };
}
