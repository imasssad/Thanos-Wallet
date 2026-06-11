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
   with the BTC/ETH logos — render as-is, no extra scaling. The dead
   `furgpt`/`mansa` token keys are gone: those names were Kamet-explorer
   mislabels; the real tokens are FGPT (Finesse GPT) + MUSA (Musa AI). */
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

/** Resolve a token's icon. Returns null when neither a bundled asset
 *  nor a known remote logo exists — caller shows the colour avatar. */
export function tokenIconSource(sym: string): ImageSourcePropType | null {
  const key = (sym || '').toLowerCase();
  if (BUNDLED[key]) return BUNDLED[key];
  if (REMOTE[key])  return { uri: REMOTE[key] };
  return null;
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
  // makalu-explorer, kamet-explorer, litho-deals: pending client
  // assets — fall through to letter avatar in the Discover screen.
};

/** Resolve a Discover app's icon by ECOSYSTEM_APPS id, or null. */
export function discoverAppIcon(id: string): ImageSourcePropType | null {
  return DAPP_ICONS[id] ?? null;
}
