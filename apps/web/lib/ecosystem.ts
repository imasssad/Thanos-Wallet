/**
 * Lithosphere ecosystem dApp directory — powers the Discover/Explore page.
 *
 * Each entry opens in the browser (a new tab on web; desktop/extension/
 * mobile can later route these through a true in-app browser view).
 *
 * NOTE on URLs: the canonical directory is ecosystem.litho.ai. Until the
 * per-app deep links are confirmed, every app points at the hub. Swap in
 * the real URL per app as they're confirmed — that's the only change
 * needed; the UI reads straight off this array.
 */
export const ECOSYSTEM_HUB = 'https://ecosystem.litho.ai';

export interface EcosystemApp {
  id:          string;
  name:        string;
  description: string;
  /** Destination opened in the browser. */
  url:         string;
  /** Local icon (public/images/tokens/*) or remote URL; letter-avatar fallback. */
  icon?:       string;
  /** Brand colour for the letter-avatar fallback. */
  color:       string;
  category:    string;
}

export const ECOSYSTEM_APPS: EcosystemApp[] = [
  {
    id: 'litho-deals',
    name: 'LITHO Deals',
    description: 'Deals, offers and rewards across the Lithosphere ecosystem.',
    url: ECOSYSTEM_HUB,
    color: '#3b7af7',
    category: 'Rewards',
  },
  {
    id: 'agii',
    name: 'AGII',
    description: 'AI infrastructure and agents built on Lithosphere.',
    url: ECOSYSTEM_HUB,
    icon: '/images/tokens/agii.png',
    color: '#8b7df7',
    category: 'AI',
  },
  {
    id: 'colle',
    name: 'Colle AI',
    description: 'Multi-chain, AI-powered NFT creation and trading.',
    url: ECOSYSTEM_HUB,
    icon: '/images/tokens/colle.png',
    color: '#a3e635',
    category: 'NFT · AI',
  },
  {
    id: 'imagen',
    name: 'Imagen Network',
    description: 'Decentralized AI image generation network.',
    url: ECOSYSTEM_HUB,
    icon: '/images/tokens/image.png',
    color: '#10b981',
    category: 'AI',
  },
  {
    id: 'furgpt',
    name: 'FurGPT',
    description: 'AI agents and tooling on Lithosphere.',
    url: ECOSYSTEM_HUB,
    icon: '/images/tokens/furgpt.png',
    color: '#10b981',
    category: 'AI',
  },
  {
    id: 'mansa',
    name: 'Mansa AI',
    description: 'AI-driven DeFi and liquidity on Lithosphere.',
    url: ECOSYSTEM_HUB,
    color: '#eab308',
    category: 'AI · DeFi',
  },
];
