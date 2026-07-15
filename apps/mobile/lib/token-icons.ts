/**
 * Token icon resolver for the mobile wallet.
 *
 * React Native can't load images by a dynamic path string — every
 * bundled asset must be a static `require()`. So the LITHO-ecosystem
 * icons are mapped here once, keyed by lowercase ticker.
 *
 * Mainstream coins (BTC/ETH/SOL/…) resolve to a remote CoinGecko CDN
 * logo via `{ uri }` — no bundling needed, mirrors how the web
 * TokenIcon falls through to token-logos.ts.
 *
 * `tokenIconSource(sym)` returns an ImageSourcePropType or null; the
 * Avatar component renders the image over the brand-colour circle when
 * a source exists, and the colour+initial fallback when it doesn't.
 */
import type { ImageSourcePropType } from 'react-native';

/* Bundled — the 2026-06 client icon pack (apps/mobile/assets/images/
   tokens/). Per the client the marks are pre-sized for visual parity
   with the BTC/ETH logos — render as-is, no extra scaling. Keys are the
   on-chain SYMBOLS: fgpt (name "FurGPT") + musa (name "Mansa AI"). */
const BUNDLED: Record<string, ImageSourcePropType> = {
  litho:  require('../assets/images/tokens/litho.png'),
  jot:    require('../assets/images/tokens/jot.png'),
  lax:    require('../assets/images/tokens/lax.png'),
  colle:  require('../assets/images/tokens/colle.png'),
  image:  require('../assets/images/tokens/image.png'),
  agii:   require('../assets/images/tokens/agii.png'),
  fgpt:   require('../assets/images/tokens/fgpt.png'),
  musa:   require('../assets/images/tokens/musa.png'),
  atua:   require('../assets/images/tokens/atua.png'),
  ignite: require('../assets/images/tokens/ignite.png'),
  ignt:   require('../assets/images/tokens/ignite.png'),
  quantt: require('../assets/images/tokens/quantt.png'),
  // Mainstream coins — bundled now too, so they load offline + render
  // identically across desktop/extension/mobile.
  atom:   require('../assets/images/tokens/atom.png'),
  eth:    require('../assets/images/tokens/eth.png'),
  trx:    require('../assets/images/tokens/trx.png'),
  hype:   require('../assets/images/tokens/hype.png'),
  sol:    require('../assets/images/tokens/sol.png'),  // official solana.com brand logomark
  // Copied from the desktop client's icon set (2026-07 icon pass) so the
  // Receive sheets and token rows stop depending on the CoinGecko CDN —
  // the remote USDT logo rendered poorly and offline showed letter circles.
  usdt:   require('../assets/images/tokens/usdt.png'),
  usdc:   require('../assets/images/tokens/usdc.png'),
  bnb:    require('../assets/images/tokens/bnb.png'),
  btc:    require('../assets/images/tokens/btc.png'),
  litbtc: require('../assets/images/tokens/btc.png'),
  avax:   require('../assets/images/tokens/avax.png'),
  pol:    require('../assets/images/tokens/pol.png'),
};

/* LITHO wears a different mark per Lithosphere network so users can tell
   WHICH chain's LITHO they hold. Mainnet will keep the current logo; the
   client is supplying dedicated Makalu + Kamet marks — until those land,
   Makalu keeps litho.png and Kamet reuses the Kamet-explorer mark (visually
   distinct). Swap the requires below when the client assets arrive. */
export const MAKALU_CHAIN_ID = 700777;
export const KAMET_CHAIN_ID  = 900523;
const LITHO_BY_CHAIN: Record<number, ImageSourcePropType> = {
  [MAKALU_CHAIN_ID]: require('../assets/images/tokens/litho.png'),
  [KAMET_CHAIN_ID]:  require('../assets/images/dapps/kamet-explorer.png'),
};

/* Remote — fallbacks for coins not yet bundled. `large/` variant —
   `small/` was occasionally returning placeholder ghosts. */
const REMOTE: Record<string, string> = {
  btc:   'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  litbtc:'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  bnb:   'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  usdc:  'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
  usdt:  'https://assets.coingecko.com/coins/images/325/large/Tether.png',
  xrp:   'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
  pol:   'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  avax:  'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
};

/** Presentation hints for marks that are NOT full-bleed circles. The
 *  Avatar cover-crops icons into its circle by default, which butchers
 *  transparent, non-square art — Solana's official three-bar logomark
 *  ended up edge-cropped with the avatar's fallback colour bleeding
 *  through the gaps. Such marks render CONTAINED, inset, over their
 *  brand backdrop (Solana brand: the mark on black). */
export function tokenIconPresentation(sym: string): { inset: number; backdrop: string } | null {
  const key = (sym || '').toLowerCase();
  if (key === 'sol') return { inset: 0.24, backdrop: '#000000' };
  return null;
}

/** Resolve a token's icon. Returns null when neither a bundled asset
 *  nor a known remote logo exists — caller shows the colour avatar.
 *  Pass `chainId` where known: LITHO resolves to a per-network mark
 *  (Makalu vs Kamet) so users can tell which chain's LITHO they hold. */
export function tokenIconSource(sym: string, chainId?: number): ImageSourcePropType | null {
  const key = (sym || '').toLowerCase();
  if ((key === 'litho' || key === 'wlitho') && chainId != null && LITHO_BY_CHAIN[chainId]) {
    return LITHO_BY_CHAIN[chainId];
  }
  if (BUNDLED[key]) return BUNDLED[key];
  if (REMOTE[key])  return { uri: REMOTE[key] };
  return null;
}

/* Network logos for chains whose native symbol doesn't identify them —
   Base/Arbitrum/Optimism/Linea are all "ETH", so the Select-network sheet
   rendered four identical Ethereum marks. Trust Wallet assets, bundled. */
const NETWORK_ICONS: Record<string, ImageSourcePropType> = {
  base:     require('../assets/images/networks/base.png'),
  arbitrum: require('../assets/images/networks/arbitrum.png'),
  optimism: require('../assets/images/networks/optimism.png'),
  linea:    require('../assets/images/networks/linea.png'),
};

/** Icon for a network row (Receive flow's Select-network sheet). Returns
 *  null when the network's native-coin logo already identifies it. */
export function networkIconSource(id: string): ImageSourcePropType | null {
  return NETWORK_ICONS[id] ?? null;
}

/* MetaMask-style corner chain badge on token icons: which chain a token
   variant lives on (USDT on BNB vs Ethereum, MUSA BEP20 vs ERC20…).
   Mirrors apps/web/components/TokenIcon.tsx CHAIN_BADGE, but every badge
   is a bundled image here (the web L2 letter-circles are replaced by the
   real network logos). Native coins and Lithosphere tokens stay badge-less
   — same suppression rules as web. */
const CHAIN_BADGES: Record<number, ImageSourcePropType> = {
  1:     require('../assets/images/tokens/eth.png'),
  56:    require('../assets/images/tokens/bnb.png'),
  137:   require('../assets/images/tokens/pol.png'),
  43114: require('../assets/images/tokens/avax.png'),
  8453:  require('../assets/images/networks/base.png'),
  42161: require('../assets/images/networks/arbitrum.png'),
  10:    require('../assets/images/networks/optimism.png'),
  59144: require('../assets/images/networks/linea.png'),
};

/** Badge image for a chainId, or null (unknown chain / Lithosphere). */
export function chainBadgeSource(chainId?: number): ImageSourcePropType | null {
  if (chainId == null) return null;
  if (chainId === MAKALU_CHAIN_ID || chainId === KAMET_CHAIN_ID) return null;
  return CHAIN_BADGES[chainId] ?? null;
}

/* Discover/dApp APP icons — deliberately separate from coin logos above
 * (per client: "AGII App icon to be used for Discover, not the asset
 * icon"). Keyed by ECOSYSTEM_APPS id. Populated as the client's app-icon
 * assets land in assets/images/dapps/; ids without an asset fall back to
 * the colour+initial avatar in the Discover screen. */
const DAPP_ICONS: Record<string, ImageSourcePropType> = {
  agii:   require('../assets/images/dapps/agii.png'),
  colle:  require('../assets/images/dapps/colle.png'),
  mansa:  require('../assets/images/dapps/mansa.png'),
  furgpt: require('../assets/images/dapps/furgpt.png'),
  imagen: require('../assets/images/dapps/imagen.png'),
  ignite: require('../assets/images/dapps/ignite.png'),
  atua:   require('../assets/images/dapps/atua.png'),
  // Infrastructure + rewards — client app-icon pack (2026-06-16).
  'makalu-explorer': require('../assets/images/dapps/makalu-explorer.png'),
  'kamet-explorer':  require('../assets/images/dapps/kamet-explorer.png'),
  'litho-deals':     require('../assets/images/dapps/litho-deals.png'),
};

/** Resolve a Discover app's icon by ECOSYSTEM_APPS id, or null. */
export function discoverAppIcon(id: string): ImageSourcePropType | null {
  return DAPP_ICONS[id] ?? null;
}
