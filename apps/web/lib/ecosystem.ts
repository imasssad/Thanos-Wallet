/**
 * Web view of the Lithosphere ecosystem directory.
 *
 * The canonical data (names, URLs, colours, categories) is shared across
 * all clients in @thanos/sdk-core. Here we layer in web-specific icon
 * asset paths (public/images/tokens/*); anything without a curated icon
 * falls back to a letter avatar in the UI.
 */
import {
  ECOSYSTEM_HUB,
  ECOSYSTEM_APPS as BASE_APPS,
  type EcosystemApp as BaseEcosystemApp,
} from '@thanos/sdk-core';

export { ECOSYSTEM_HUB };

export interface EcosystemApp extends BaseEcosystemApp {
  /** Local icon (public/images/tokens/*) or remote URL; letter-avatar fallback. */
  icon?: string;
}

/** id → Discover APP-icon path (public/images/dapps/*), distinct from the
 *  coin/asset logos in /images/tokens/. Only ids with a curated app icon
 *  are listed; the rest fall back to a letter avatar. */
const WEB_ICONS: Record<string, string> = {
  agii:   '/images/dapps/agii.png',
  colle:  '/images/dapps/colle.png',
  mansa:  '/images/dapps/mansa.png',
  furgpt: '/images/dapps/furgpt.png', // reuses the token logo as the app mark
  imagen: '/images/dapps/imagen.png', // sourced from imagen.network's official watermark
  ignite: '/images/dapps/ignite.png', // reuses the token logo
  atua:   '/images/dapps/atua.png',   // sourced from atua.ai brand kit
  // Infrastructure + rewards — client app-icon pack (2026-06-16).
  'makalu-explorer': '/images/dapps/makalu-explorer.png',
  'kamet-explorer':  '/images/dapps/kamet-explorer.png',
  'litho-deals':     '/images/dapps/litho-deals.png', // the double-struck 𝕃 mark
};

export const ECOSYSTEM_APPS: EcosystemApp[] = BASE_APPS.map(a => ({
  ...a,
  icon: WEB_ICONS[a.id],
}));
