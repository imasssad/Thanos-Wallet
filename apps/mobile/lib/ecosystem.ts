/**
 * Lithosphere ecosystem dApp directory — powers the Discover screen.
 *
 * Detached copy of @thanos/sdk-core's ecosystem module: EAS Cloud builds
 * can't resolve workspace packages, so mobile keeps a local copy (same
 * pattern as lib/indexer.ts, lib/pricing.ts, etc.). Keep in sync with
 * packages/sdk-core/src/ecosystem.ts.
 *
 * NOTE on URLs: every app points at the hub until per-app deep links are
 * confirmed; swap in the real URL per app as they land.
 */
export const ECOSYSTEM_HUB = 'https://ecosystem.litho.ai';

export interface EcosystemApp {
  id:          string;
  name:        string;
  description: string;
  url:         string;
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
    color: '#8b7df7',
    category: 'AI',
  },
  {
    id: 'colle',
    name: 'Colle AI',
    description: 'Multi-chain, AI-powered NFT creation and trading.',
    url: ECOSYSTEM_HUB,
    color: '#a3e635',
    category: 'NFT · AI',
  },
  {
    id: 'imagen',
    name: 'Imagen Network',
    description: 'Decentralized AI image generation network.',
    url: ECOSYSTEM_HUB,
    color: '#10b981',
    category: 'AI',
  },
  {
    id: 'furgpt',
    name: 'FurGPT',
    description: 'AI agents and tooling on Lithosphere.',
    url: ECOSYSTEM_HUB,
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
