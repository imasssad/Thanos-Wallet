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
import { createDiscoveryOverlay, type DiscoveredTokenRow } from '@thanos/sdk-core';
import { EVM_CHAINS, getEvmProvider, registerChainLookup, browserRpcUrl, type EvmChain } from './evm-chains';
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
export interface EvmTokenLike {
  chainId: number; symbol: string; name: string; address: string; decimals: number;
  /** true on a token the USER added. Such a token keeps its row at zero
   *  balance — see getAllEvmTokenBalancesMerged. */
  custom?: true;
}

/** All tokens for a chain: built-ins, then the user's, then discovered —
 *  deduped by address, so an added token keeps its own entry (and its
 *  always-visible row) rather than being replaced by a discovered twin. */
export function allTokensForChain(chainId: number): EvmTokenLike[] {
  const builtin: EvmTokenLike[] = EVM_TOKENS.filter((t) => t.chainId === chainId);
  const seen = new Set(builtin.map((t) => t.address.toLowerCase()));
  const extra = tokenCache.filter((t) => t.chainId === chainId && !seen.has(t.address.toLowerCase()));
  for (const t of extra) seen.add(t.address.toLowerCase());
  const found = discovery.tokensForChain(chainId).filter((t) => !seen.has(t.address.toLowerCase()));
  return [...builtin, ...extra, ...found];
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
// getEvmProvider() resolves custom networks through this.
registerChainLookup(getEvmChainMerged);

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

/** ERC-20 balances for every known token — built-ins + user-added.
 *  The built-ins are a catalog, so a failed or zero read is omitted. A token
 *  the USER added is an explicit "show me this": it is always returned, at
 *  zero when the read fails, so an added asset never silently vanishes from
 *  the asset list. */
export async function getAllEvmTokenBalancesMerged(address: string): Promise<Array<{ token: EvmTokenLike; balance: number }>> {
  if (!address) return [];
  const { formatUnits } = await import('ethers');
  const all = allEvmTokens();
  const results = await Promise.allSettled(
    all.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return parseFloat(formatUnits(raw, t.decimals)) || 0;
    }),
  );
  return all.flatMap((token, i) => {
    const r = results[i];
    const balance = r.status === 'fulfilled' ? r.value : null;
    if (balance != null && balance > 0) return [{ token, balance }];
    if (token.custom) return [{ token, balance: balance ?? 0 }];
    return [];
  });
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
  const provider = new JsonRpcProvider(browserRpcUrl(rpcUrl));
  const net = await provider.getNetwork();
  return Number(net.chainId);
}

export interface TokenMeta { symbol: string; name: string; decimals: number }

/** Read ERC-20 symbol/name/decimals on-chain. Throws if not a valid ERC-20. */
export async function probeErc20(rpcUrl: string, address: string): Promise<TokenMeta> {
  const provider = new JsonRpcProvider(browserRpcUrl(rpcUrl));
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

/* ── change notification ──────────────────────────────────────────────
   The balance readers above keep their rows in component state keyed on the
   address, so a token added in Settings would not show up until a reload.
   Every mutation goes through persist(), which makes it the one place to
   announce the change from. */
const listeners = new Set<() => void>();

/** Subscribe to custom-network/token changes; returns an unsubscribe fn. */
export function onCustomAssetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* ── tokens discovered on Lithosphere ───────────────────────────────────
   Held tokens the user never added by hand (client 2026-11-13: "tokens from
   lithoscan ... automatically show in thanos if user holds them"). Metadata
   only: the balance on screen is read on the token's own chain by the same
   code that reads a built-in's. Lithosphere alone for now — the other
   chains' sources would add far more rows than were asked for. ── */
const discovery = createDiscoveryOverlay({ chainIds: [9005], onChange: () => notifyChanged() });

/** Read again (throttled) what this address holds on Lithosphere. Resolves
 *  when the pass is over and never throws; call it beside the balance reads,
 *  never in front of them. */
export function refreshDiscoveredTokens(address: string, force = false): Promise<void> {
  return discovery.refresh(address, [
    ...EVM_TOKENS.map((t) => ({ chainId: t.chainId, address: t.address, symbol: t.symbol })),
    ...tokenCache.map((t) => ({ chainId: t.chainId, address: t.address, symbol: t.symbol })),
  ], force);
}

/** Tokens discovery found, for the one address it last read. */
export const discoveredTokens = (): readonly DiscoveredTokenRow[] => discovery.tokens();

/** Forget them (wallet locked, account removed). */
export const clearDiscoveredTokens = (): void => discovery.clear();

function notifyChanged(): void {
  // After the write, never before: a listener re-reads these caches.
  for (const fn of [...listeners]) { try { fn(); } catch { /* one bad listener can't break the rest */ } }
}

function persist(): void {
  try {
    window.localStorage.setItem(CHAINS_KEY, JSON.stringify(chainCache));
    window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokenCache));
  } catch { /* ignore */ }
  notifyChanged();
}

/** Add a custom EVM network. Rejects if the chainId collides with a built-in.
 *  (Makalu, 700777, isn't built in any more — it's added here like any other
 *  network.) */
export async function addCustomChain(input: {
  chainId: number; name: string; rpcUrl: string; nativeSymbol: string; explorerUrl: string;
}): Promise<void> {
  if (EVM_CHAINS.some((c) => c.chainId === input.chainId)) {
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
