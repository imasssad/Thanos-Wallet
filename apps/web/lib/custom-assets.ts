/**
 * User-added custom EVM networks + tokens (web).
 *
 * Mirrors apps/extension/src/lib/custom-assets.ts (mobile + desktop have
 * their own twins). The built-in networks (evm-chains.ts `EVM_CHAINS`) and
 * tokens (evm-tokens.ts `EVM_TOKENS`) are hardcoded + on-chain-verified.
 * This module lets users extend both at runtime: a persisted overlay in
 * localStorage, merged with the built-ins at every consumption point.
 *
 * SAFETY: token metadata (symbol/decimals) and a network's real chainId are
 * read ON-CHAIN before saving — a user-typed address/RPC is never trusted
 * blindly (a wrong decimals value is a fund-loss bug). localStorage is
 * synchronous, so the cache hydrates at import time (SSR-safe via a
 * typeof-window guard — this module is only ever used from 'use client'
 * components, but Next can still evaluate it during a server render pass).
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { EVM_CHAINS, getEvmProvider, type EvmChain } from './evm-chains';
import { EVM_TOKENS, type EvmToken } from './evm-tokens';

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
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
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
export function allEvmChains(): EvmChain[] {
  const seen = new Set(EVM_CHAINS.map((c) => c.chainId));
  const extra: EvmChain[] = chainCache
    .filter((c) => !seen.has(c.chainId))
    .map((c) => ({
      chainId: c.chainId, name: c.name, slug: `custom-${c.chainId}`,
      rpcUrl: c.rpcUrl, nativeSymbol: c.nativeSymbol, nativeName: c.nativeSymbol,
      decimals: 18 as const, explorerUrl: c.explorerUrl, color: '#6b7280',
      coingeckoId: '', // unknown for user-added chains — price lookups just miss
    }));
  return [...EVM_CHAINS, ...extra];
}

/** Minimal token shape shared by the built-in catalog and user-added
 *  tokens — everything downstream only reads fields, never a literal type. */
export interface EvmTokenLike { chainId: number; symbol: string; name: string; address: string; decimals: number }

/** All tokens for a chain: built-ins + user tokens (deduped by address). */
export function allTokensForChain(chainId: number): EvmTokenLike[] {
  const builtin: EvmTokenLike[] = EVM_TOKENS.filter((t) => t.chainId === chainId);
  const seen = new Set(builtin.map((t) => t.address.toLowerCase()));
  const extra = tokenCache.filter((t) => t.chainId === chainId && !seen.has(t.address.toLowerCase()));
  return [...builtin, ...extra];
}

/** All tokens across every chain (built-ins + custom). */
export function allEvmTokens(): EvmTokenLike[] {
  return allEvmChains().flatMap((c) => allTokensForChain(c.chainId));
}

/** Merged chain lookup — the one to use everywhere instead of evm-chains.ts's
 *  built-in-only getEvmChain. */
export function getEvmChainMerged(chainId: number): EvmChain | undefined {
  return allEvmChains().find((c) => c.chainId === chainId);
}

/* ── balance readers (merged; mirror evm-chains.ts / evm-tokens.ts) ──── */

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export async function getAllEvmNativeBalancesMerged(address: string): Promise<Array<{ chain: EvmChain; balance: number }>> {
  if (!address) return [];
  const { formatUnits } = await import('ethers');
  const results = await Promise.allSettled(
    allEvmChains().map(async (c) => {
      const wei = await getEvmProvider(c.chainId).getBalance(address);
      return { chain: c, balance: parseFloat(formatUnits(wei, 18)) || 0 };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ chain: EvmChain; balance: number }> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export async function getAllEvmTokenBalancesMerged(address: string): Promise<Array<{ token: EvmTokenLike; balance: number }>> {
  if (!address) return [];
  const { formatUnits } = await import('ethers');
  const all = allEvmTokens();
  const results = await Promise.allSettled(
    all.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return { token: t, balance: parseFloat(formatUnits(raw, t.decimals)) };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ token: EvmTokenLike; balance: number }> => r.status === 'fulfilled' && r.value.balance > 0)
    .map((r) => r.value);
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
    window.localStorage.setItem(CHAINS_KEY, JSON.stringify(chainCache));
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokenCache));
  } catch { /* ignore */ }
}

/** Add a custom EVM network. Rejects if the chainId collides with a built-in. */
export async function addCustomChain(input: {
  chainId: number; name: string; rpcUrl: string; nativeSymbol: string; explorerUrl: string;
}): Promise<void> {
  if (EVM_CHAINS.some((c) => c.chainId === input.chainId) || input.chainId === 700777) {
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
  const dup = EVM_TOKENS.some((t) => t.chainId === input.chainId && t.address.toLowerCase() === address);
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
