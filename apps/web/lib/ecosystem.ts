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

/** id → web icon path. Only entries with a curated asset are listed. */
const WEB_ICONS: Record<string, string> = {
  agii:   '/images/tokens/agii.png',
  colle:  '/images/tokens/colle.png',
  imagen: '/images/tokens/image.png',
  furgpt: '/images/tokens/furgpt.png',
};

export const ECOSYSTEM_APPS: EcosystemApp[] = BASE_APPS.map(a => ({
  ...a,
  icon: WEB_ICONS[a.id],
}));
