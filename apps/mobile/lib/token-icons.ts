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

/* Bundled — the client icon pack (apps/mobile/assets/images/tokens/). */
const BUNDLED: Record<string, ImageSourcePropType> = {
  litho:  require('../assets/images/tokens/litho.jpg'),
  jot:    require('../assets/images/tokens/jot.png'),
  lax:    require('../assets/images/tokens/lax.png'),
  colle:  require('../assets/images/tokens/colle.png'),
  furgpt: require('../assets/images/tokens/furgpt.png'),
  ignite: require('../assets/images/tokens/ignite.png'),
  ignt:   require('../assets/images/tokens/ignite.png'),
  mansa:  require('../assets/images/tokens/mansa.png'),
  agii:   require('../assets/images/tokens/agii.png'),
  quantt: require('../assets/images/tokens/quantt.png'),
};

/* Remote — mainstream coins, CoinGecko CDN. Stable numeric asset ids. */
const REMOTE: Record<string, string> = {
  btc:   'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  litbtc:'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  eth:   'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  sol:   'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  atom:  'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  bnb:   'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  usdc:  'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  pol:   'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  avax:  'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
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
  agii:  require('../assets/images/dapps/agii.png'),
  colle: require('../assets/images/dapps/colle.png'),
  mansa: require('../assets/images/dapps/mansa.png'),
  // furgpt: pending client asset (Dropbox /preview link not downloadable)
};

/** Resolve a Discover app's icon by ECOSYSTEM_APPS id, or null. */
export function discoverAppIcon(id: string): ImageSourcePropType | null {
  return DAPP_ICONS[id] ?? null;
}
