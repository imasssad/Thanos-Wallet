/**
 * Hide/show networks + assets (extension) — a pure DISPLAY preference. It
 * never restricts Send/Receive/dApp use, so a hidden asset stays fully
 * reachable once un-hidden; only the Home asset list respects it. Mirrors
 * the mobile implementation (apps/mobile/App.tsx's useHiddenAssets).
 *
 *   - Network-level: hides every row on that chain. Rows without a chainId
 *     (native Makalu LITHO/wLITHO/FGPT, BTC, SOL, ATOM — see portfolio.ts,
 *     which only sets chainId on external-EVM rows) are keyed by symbol
 *     instead, so Lithosphere Mainnet (chainId 9005) is a distinct,
 *     independently-hideable network from Makalu-native LITHO.
 *   - Asset-level: hides one specific row, keyed the same way the Send
 *     picker already identifies coins (see coinKey in main.tsx) so identity
 *     stays consistent across the app.
 *
 * Same sync-cache-primed-by-load() shape as custom-assets.ts, for the same
 * reason: the popup's screens are conditionally rendered (unmount on tab
 * switch), so a toggle made in Settings is picked up fresh the next time
 * Home remounts — no shared subscription needed.
 */

const HIDDEN_NETWORKS_KEY = 'hidden_networks';
const HIDDEN_ASSETS_KEY   = 'hidden_assets';

let hiddenNetworks = new Set<string>();
let hiddenAssets   = new Set<string>();
let loaded = false;

/** Prime the caches from storage. Call once at popup startup. */
export async function loadHiddenAssets(): Promise<void> {
  try {
    const r = await browser.storage.local.get([HIDDEN_NETWORKS_KEY, HIDDEN_ASSETS_KEY]);
    hiddenNetworks = new Set(Array.isArray(r[HIDDEN_NETWORKS_KEY]) ? (r[HIDDEN_NETWORKS_KEY] as string[]) : []);
    hiddenAssets   = new Set(Array.isArray(r[HIDDEN_ASSETS_KEY])   ? (r[HIDDEN_ASSETS_KEY]   as string[]) : []);
  } catch {
    hiddenNetworks = new Set();
    hiddenAssets   = new Set();
  }
  loaded = true;
}

export const hiddenAssetsLoaded = (): boolean => loaded;

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

async function persist(): Promise<void> {
  await browser.storage.local.set({
    [HIDDEN_NETWORKS_KEY]: [...hiddenNetworks],
    [HIDDEN_ASSETS_KEY]:   [...hiddenAssets],
  });
}

export async function toggleNetworkVisibility(key: string): Promise<void> {
  if (hiddenNetworks.has(key)) hiddenNetworks.delete(key); else hiddenNetworks.add(key);
  await persist();
}

export async function toggleAssetVisibility(key: string): Promise<void> {
  if (hiddenAssets.has(key)) hiddenAssets.delete(key); else hiddenAssets.add(key);
  await persist();
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
