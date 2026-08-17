/**
 * User-added custom EVM networks + tokens (extension).
 *
 * The built-in networks (evm-external.ts `EXT_EVM_CHAINS`) and tokens
 * (`EXT_EVM_TOKENS`) are hardcoded + on-chain-verified. This module lets users
 * extend both at runtime: a persisted overlay in `browser.storage.local`, merged
 * with the built-ins at every consumption point (portfolio, send, dApp chains).
 *
 * SAFETY: token metadata (symbol/decimals) and a network's real chainId are read
 * ON-CHAIN before saving — a user-typed address/RPC is never trusted blindly (a
 * wrong decimals value is a fund-loss bug). A synchronous in-memory cache is
 * primed by load() at popup/background startup so the sync DappChain lookups keep
 * working; every mutation refreshes it.
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { EXT_EVM_CHAINS, EXT_EVM_TOKENS, type ExtEvmChain, type ExtEvmToken } from './evm-external';

const CHAINS_KEY = 'custom_evm_chains';
const TOKENS_KEY = 'custom_evm_tokens';

export interface CustomChain {
  chainId:      number;
  name:         string;
  rpcUrl:       string;
  nativeSymbol: string;
  explorerUrl:  string;
  custom:       true;
}

export interface CustomToken {
  chainId:  number;
  symbol:   string;
  name:     string;
  address:  string;   // lowercased
  decimals: number;
  custom:   true;
}

/* ── in-memory cache (primed by load()) ─────────────────────────────── */

let chainCache: CustomChain[] = [];
let tokenCache: CustomToken[] = [];
let loaded = false;

/** Prime the caches from storage. Call once at popup/background startup. */
export async function loadCustomAssets(): Promise<void> {
  try {
    const r = await browser.storage.local.get([CHAINS_KEY, TOKENS_KEY]);
    chainCache = Array.isArray(r[CHAINS_KEY]) ? (r[CHAINS_KEY] as CustomChain[]) : [];
    tokenCache = Array.isArray(r[TOKENS_KEY]) ? (r[TOKENS_KEY] as CustomToken[]) : [];
  } catch {
    chainCache = []; tokenCache = [];
  }
  loaded = true;
}

/** Synchronous readers (empty until load() runs). */
export const customChains = (): readonly CustomChain[] => chainCache;
export const customTokens = (): readonly CustomToken[] => tokenCache;
export const customAssetsLoaded = (): boolean => loaded;

/** All EVM chains: built-ins first, then user chains (deduped by chainId). */
export function allEvmChains(): ExtEvmChain[] {
  const seen = new Set(EXT_EVM_CHAINS.map((c) => c.chainId));
  const extra: ExtEvmChain[] = chainCache
    .filter((c) => !seen.has(c.chainId))
    .map((c) => ({
      chainId: c.chainId, name: c.name, slug: `custom-${c.chainId}`,
      rpcUrl: c.rpcUrl, nativeSymbol: c.nativeSymbol, nativeName: c.nativeSymbol,
      explorerUrl: c.explorerUrl, color: '#6b7280',
    }));
  return [...EXT_EVM_CHAINS, ...extra];
}

/** All tokens for a chain: built-ins + user tokens (deduped by address). */
export function allTokensForChain(chainId: number): Array<ExtEvmToken | CustomToken> {
  const builtin = EXT_EVM_TOKENS.filter((t) => t.chainId === chainId);
  const seen = new Set(builtin.map((t) => t.address.toLowerCase()));
  const extra = tokenCache.filter((t) => t.chainId === chainId && !seen.has(t.address.toLowerCase()));
  return [...builtin, ...extra];
}

/* ── on-chain validation / metadata (never trust user input blindly) ── */

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

/** Read a network's real chainId from its RPC (validates the URL + id match). */
export async function probeChainId(rpcUrl: string): Promise<number> {
  const provider = new JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  return Number(net.chainId);
}

export interface TokenMeta { symbol: string; name: string; decimals: number }

/** Read ERC-20 symbol/name/decimals on-chain. Throws if not a valid ERC-20. */
export async function probeErc20(rpcUrl: string, address: string): Promise<TokenMeta> {
  const provider = new JsonRpcProvider(rpcUrl);
  const c = new Contract(address, ERC20_ABI, provider);
  const [symbol, decimals, name] = await Promise.all([
    c.symbol() as Promise<string>,
    c.decimals() as Promise<bigint | number>,
    (c.name() as Promise<string>).catch(() => ''),
  ]);
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) throw new Error('Invalid token decimals');
  return { symbol: String(symbol), name: name ? String(name) : String(symbol), decimals: dec };
}

/* ── mutations (persist + refresh cache) ────────────────────────────── */

async function persist(): Promise<void> {
  await browser.storage.local.set({ [CHAINS_KEY]: chainCache, [TOKENS_KEY]: tokenCache });
}

/** Add a custom EVM network. Rejects if the chainId collides with a built-in. */
export async function addCustomChain(input: {
  chainId: number; name: string; rpcUrl: string; nativeSymbol: string; explorerUrl: string;
}): Promise<void> {
  if (EXT_EVM_CHAINS.some((c) => c.chainId === input.chainId) || input.chainId === 700777) {
    throw new Error('That network is already built in');
  }
  chainCache = [
    ...chainCache.filter((c) => c.chainId !== input.chainId),
    { ...input, custom: true },
  ];
  await persist();
}

export async function removeCustomChain(chainId: number): Promise<void> {
  chainCache = chainCache.filter((c) => c.chainId !== chainId);
  // Drop that chain's custom tokens too.
  tokenCache = tokenCache.filter((t) => t.chainId !== chainId);
  await persist();
}

/** Add a custom token. `address` is stored lowercased; dedupes per chain. */
export async function addCustomToken(input: {
  chainId: number; symbol: string; name: string; address: string; decimals: number;
}): Promise<void> {
  const address = input.address.toLowerCase();
  const dup = EXT_EVM_TOKENS.some((t) => t.chainId === input.chainId && t.address.toLowerCase() === address);
  if (dup) throw new Error('That token is already built in');
  tokenCache = [
    ...tokenCache.filter((t) => !(t.chainId === input.chainId && t.address.toLowerCase() === address)),
    { ...input, address, custom: true },
  ];
  await persist();
}

export async function removeCustomToken(chainId: number, address: string): Promise<void> {
  const a = address.toLowerCase();
  tokenCache = tokenCache.filter((t) => !(t.chainId === chainId && t.address.toLowerCase() === a));
  await persist();
}
