/**
 * Hide/show networks + assets (desktop) — a pure DISPLAY preference. It never
 * restricts Send/Receive/dApp use, so a hidden asset stays fully reachable
 * once un-hidden; only the portfolio lists respect it. Mirrors the mobile /
 * extension implementations.
 *
 *   - Network-level: hides every row on that chain. Rows without a chainId
 *     (native Makalu LITHO/wLITHO, BTC, SOL, ATOM — see portfolio.ts, which
 *     only sets chainId on external-EVM rows) are keyed by symbol instead,
 *     so Lithosphere Mainnet (chainId 9005) is a distinct, independently
 *     hideable network from Makalu-native LITHO.
 *   - Asset-level: hides one specific row, keyed the same way elsewhere in
 *     the app identifies a coin (sym + chainId + tokenAddress).
 *
 * localStorage is synchronous, so — unlike the extension's browser.storage.local
 * version — there's no async load() step; the cache just hydrates at import time.
 */

const HIDDEN_NETWORKS_KEY = 'thanos.hidden_networks.v1';
const HIDDEN_ASSETS_KEY   = 'thanos.hidden_assets.v1';

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

let hiddenNetworks = readSet(HIDDEN_NETWORKS_KEY);
let hiddenAssets   = readSet(HIDDEN_ASSETS_KEY);

export const networkVisKey = (chainId: number | undefined, sym: string): string =>
  chainId == null ? `sym:${sym}` : `chain:${chainId}`;

export const assetVisKey = (c: { sym: string; chainId?: number; tokenAddress?: string }): string =>
  `${c.sym}@${c.chainId ?? 'litho'}${c.tokenAddress ? ':' + c.tokenAddress : ''}`;

export const getHiddenNetworks = (): ReadonlySet<string> => hiddenNetworks;
export const getHiddenAssets   = (): ReadonlySet<string> => hiddenAssets;

/** True unless the coin's network OR the coin itself was hidden. */
export function isCoinVisible(c: { sym: string; chainId?: number; tokenAddress?: string }): boolean {
  return !hiddenNetworks.has(networkVisKey(c.chainId, c.sym)) && !hiddenAssets.has(assetVisKey(c));
}

export function toggleNetworkVisibility(key: string): void {
  if (hiddenNetworks.has(key)) hiddenNetworks.delete(key); else hiddenNetworks.add(key);
  try { localStorage.setItem(HIDDEN_NETWORKS_KEY, JSON.stringify([...hiddenNetworks])); } catch { /* ignore */ }
}

export function toggleAssetVisibility(key: string): void {
  if (hiddenAssets.has(key)) hiddenAssets.delete(key); else hiddenAssets.add(key);
  try { localStorage.setItem(HIDDEN_ASSETS_KEY, JSON.stringify([...hiddenAssets])); } catch { /* ignore */ }
}

/** Static catalog of every network the wallet supports, for the "Manage
 *  networks" toggle list in Settings. LITHO is native on BOTH Lithosphere
 *  Mainnet (9005) and Lithosphere Makalu — listed as independent rows,
 *  matching how the portfolio itself treats them. */
export const ALL_NETWORKS: Array<{ key: string; name: string; sub: string }> = [
  { key: networkVisKey(9005, 'LITHO'),      name: 'Lithosphere',        sub: 'Mainnet · chain 9005' },
  { key: networkVisKey(undefined, 'LITHO'), name: 'Lithosphere Makalu', sub: 'Testnet' },
  { key: networkVisKey(undefined, 'BTC'),   name: 'Bitcoin',            sub: 'Native' },
  { key: networkVisKey(undefined, 'SOL'),   name: 'Solana',             sub: 'Native' },
  { key: networkVisKey(undefined, 'ATOM'),  name: 'Cosmos Hub',         sub: 'Native' },
  { key: networkVisKey(1, 'ETH'),           name: 'Ethereum',           sub: 'chain 1' },
  { key: networkVisKey(56, 'BNB'),          name: 'BNB Chain',          sub: 'chain 56' },
  { key: networkVisKey(137, 'POL'),         name: 'Polygon',            sub: 'chain 137' },
  { key: networkVisKey(8453, 'ETH'),        name: 'Base',               sub: 'chain 8453' },
  { key: networkVisKey(42161, 'ETH'),       name: 'Arbitrum',           sub: 'chain 42161' },
  { key: networkVisKey(10, 'ETH'),          name: 'Optimism',           sub: 'chain 10' },
  { key: networkVisKey(59144, 'ETH'),       name: 'Linea',              sub: 'chain 59144' },
  { key: networkVisKey(43114, 'AVAX'),      name: 'Avalanche',          sub: 'chain 43114' },
];
