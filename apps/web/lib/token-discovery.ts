/**
 * Token discovery — when a wallet is imported (or unlocked the first time
 * after import), scan the Lithosphere indexer for every LEP100 balance held
 * by the address. Detected tokens are persisted in localStorage and merged
 * into the displayed token list.
 *
 * The indexer endpoint we hit:
 *   GET  /indexer/balances?address=0x…&chainId=700777
 *
 * Response shape (current mock; services/indexer/src/server.ts):
 *   { chainId, symbol, name, balance, usdValue, change24hPct, tokenAddress?, decimals? }[]
 */

import { TOKENS, type Token } from './tokens';

const STORAGE_KEY = 'thanos.discovered_tokens';

export type DiscoveredToken = Pick<Token, 'sym' | 'name' | 'chain' | 'address' | 'decimals' | 'color' | 'icon'> & {
  /** Live balance from the indexer at the time of discovery (string for big numbers). */
  balance: string;
  /** Whether this token came from auto-discovery vs the canonical TOKENS[] list. */
  discovered: true;
};

interface IndexerBalance {
  chainId:        number;
  symbol:         string;
  name?:          string;
  balance:        string;
  usdValue?:      string;
  change24hPct?:  number;
  tokenAddress?:  string;
  decimals?:      number;
}

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

  const baseUrl =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_INDEXER_URL) ||
    '/indexer';

  let balances: IndexerBalance[] = [];
  try {
    const res = await fetch(`${baseUrl}/balances?address=${encodeURIComponent(address)}&chainId=700777`);
    if (res.ok) {
      const data = await res.json();
      balances = Array.isArray(data) ? data : (data?.balances ?? []);
    }
  } catch {
    // Indexer offline / network failure — return empty so the UI keeps the canonical list.
    return loadDiscoveredTokens();
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
      color:     '#52525b',       // neutral until the user assigns one
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
