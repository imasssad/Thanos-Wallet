/**
 * User-added custom EVM networks + tokens (desktop).
 *
 * Mirrors apps/extension/src/lib/custom-assets.ts (and the mobile twin). The
 * built-in networks/tokens live in evm-external-meta.ts (pure data, no
 * ethers — imported here instead of evm-external.ts to avoid a circular
 * import, since evm-external.ts itself re-exports the merged getExtEvmChain
 * defined below). This module lets users extend both at runtime: a
 * persisted overlay in localStorage, merged with the built-ins at every
 * consumption point (portfolio, Send, dApp chains).
 *
 * SAFETY: token metadata (symbol/decimals) and a network's real chainId are
 * read ON-CHAIN before saving — a user-typed address/RPC is never trusted
 * blindly (a wrong decimals value is a fund-loss bug). A synchronous
 * in-memory cache hydrates at import time (localStorage is synchronous);
 * every mutation refreshes it.
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { EXT_EVM_CHAINS, EXT_EVM_TOKENS, type ExtEvmChain, type ExtEvmToken } from './evm-external-meta';

const CHAINS_KEY = 'thanos.custom_evm_chains.v1';
const TOKENS_KEY = 'thanos.custom_evm_tokens.v1';

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

function readArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
}

let chainCache: CustomChain[] = readArr<CustomChain>(CHAINS_KEY);
let tokenCache: CustomToken[] = readArr<CustomToken>(TOKENS_KEY);

export const customChains = (): readonly CustomChain[] => chainCache;
export const customTokens = (): readonly CustomToken[] => tokenCache;

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

/** Minimal token shape shared by the built-in catalog (symbol typed as
 *  'USDT'|'USDC') and user-added tokens (symbol is whatever the contract
 *  reports) — everything downstream only reads fields, never the literal type. */
export interface ExtTokenLike { chainId: number; symbol: string; name: string; address: string; decimals: number }

/** All tokens for a chain: built-ins + user tokens (deduped by address). */
export function allTokensForChain(chainId: number): ExtTokenLike[] {
  const builtin: ExtTokenLike[] = EXT_EVM_TOKENS.filter((t) => t.chainId === chainId);
  const seen = new Set(builtin.map((t) => t.address.toLowerCase()));
  const extra = tokenCache.filter((t) => t.chainId === chainId && !seen.has(t.address.toLowerCase()));
  return [...builtin, ...extra];
}

/** All tokens across every chain (built-ins + custom) — for building the
 *  full Send asset list / zero-balance placeholder rows. */
export function allEvmTokens(): ExtTokenLike[] {
  return allEvmChains().flatMap((c) => allTokensForChain(c.chainId));
}

/** Merged chain lookup — the one to use everywhere instead of the built-in-
 *  only getExtEvmChain in evm-external-meta.ts. */
export function getExtEvmChain(chainId: number): ExtEvmChain | undefined {
  return allEvmChains().find((c) => c.chainId === chainId);
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

function persist(): void {
  try {
    localStorage.setItem(CHAINS_KEY, JSON.stringify(chainCache));
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokenCache));
  } catch { /* ignore */ }
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
  persist();
}

export function removeCustomChain(chainId: number): void {
  chainCache = chainCache.filter((c) => c.chainId !== chainId);
  tokenCache = tokenCache.filter((t) => t.chainId !== chainId);
  persist();
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
  persist();
}

export function removeCustomToken(chainId: number, address: string): void {
  const a = address.toLowerCase();
  tokenCache = tokenCache.filter((t) => !(t.chainId === chainId && t.address.toLowerCase() === a));
  persist();
}
