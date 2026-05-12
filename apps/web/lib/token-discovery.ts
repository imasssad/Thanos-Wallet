/**
 * Token discovery — when a wallet is imported (or unlocked the first time
 * after import), scan the Lithosphere indexer for every LEP100 balance held
 * by the address. Detected tokens are persisted in localStorage and merged
 * into the displayed token list.
 *
 * The indexer endpoint we hit:
 *   GET  /lep100/balances/:walletAddress
 *
 * Response shape (services/indexer/src/server.ts):
 *   { walletAddress, items: IndexerAsset[] }
 */

import { TOKENS, type Token } from './tokens';
import { getLep100Balances, IndexerOffline } from './indexer';

const STORAGE_KEY = 'thanos.discovered_tokens';

export type DiscoveredToken = Pick<Token, 'sym' | 'name' | 'chain' | 'address' | 'decimals' | 'color' | 'icon'> & {
  /** Live balance from the indexer at the time of discovery (string for big numbers). */
  balance: string;
  /** Whether this token came from auto-discovery vs the canonical TOKENS[] list. */
  discovered: true;
};

/** Read previously-discovered tokens from localStorage. */
export function loadDiscoveredTokens(): DiscoveredToken[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DiscoveredToken[];
  } catch {
    return [];
  }
}

/** Save discovered tokens to localStorage. */
function saveDiscoveredTokens(tokens: DiscoveredToken[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

/** Hit the indexer and discover all LEP100 balances for an address.
 *  Idempotent — calling again refreshes the cache and de-dupes. */
export async function discoverTokens(address: string): Promise<DiscoveredToken[]> {
  if (!address || !address.startsWith('0x')) return [];

  let balances;
  try {
    balances = await getLep100Balances(address);
  } catch (e) {
    if (e instanceof IndexerOffline) return loadDiscoveredTokens();
    throw e;
  }

  // Skip tokens already present in our canonical TOKENS[] list (matched by
  // address or symbol). Avoids double-rendering LITHO, LitBTC, etc.
  const canonicalSyms      = new Set(TOKENS.map(t => t.sym.toLowerCase()));
  const canonicalAddresses = new Set(
    TOKENS.map(t => t.address?.toLowerCase()).filter(Boolean) as string[],
  );

  const discovered: DiscoveredToken[] = balances
    .filter(b => {
      const sym  = (b.symbol ?? '').toLowerCase();
      const addr = (b.tokenAddress ?? '').toLowerCase();
      if (sym  && canonicalSyms.has(sym))           return false;
      if (addr && canonicalAddresses.has(addr))     return false;
      // skip native preview rows the mock indexer emits
      if (addr.startsWith('preview:'))              return false;
      return true;
    })
    .map(b => ({
      sym:       b.symbol,
      name:      b.name ?? b.symbol,
      chain:     'Makalu' as const,
      address:   b.tokenAddress ?? null,
      decimals:  b.decimals ?? 18,
      color:     '#52525b',
      icon:      '/images/tokens/_default.png',
      balance:   b.balance,
      discovered: true,
    }));

  saveDiscoveredTokens(discovered);
  return discovered;
}

/** Combined view: canonical TOKENS[] + anything auto-discovered. */
export function getAllTokens(): (Token | (DiscoveredToken & { priceUsd: number; change24h: number }))[] {
  const disc = loadDiscoveredTokens().map(d => ({
    ...d,
    priceUsd:  0,    // unknown price — UI shows '—' until pricing oracle resolves
    change24h: 0,
  }));
  return [...TOKENS, ...disc];
}
