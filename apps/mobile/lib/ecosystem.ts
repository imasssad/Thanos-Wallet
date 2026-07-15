/**
 * Lithosphere ecosystem dApp directory — powers the Discover screen.
 *
 * Detached copy of @thanos/sdk-core's ecosystem module (EAS Cloud can't
 * resolve workspace packages). Keep in sync with
 * packages/sdk-core/src/ecosystem.ts.
 *
 * NOTE on URLs: each entry points at its real product domain (verified
 * against the hub's own outbound links); only apps without a confirmed
 * public URL fall back to the hub.
 */
export const ECOSYSTEM_HUB = 'https://ecosystem.litho.ai';

export interface EcosystemApp {
  id:          string;
  name:        string;
  description: string;
  url:         string;
  color:       string;
  category:    string;
  section:     string;
}

export const ECOSYSTEM_SECTIONS = ['AI & Agents', 'DeFi & Yield', 'NFTs', 'Infrastructure', 'Rewards'] as const;

export const ECOSYSTEM_APPS: EcosystemApp[] = [
  { id: 'agii',   name: 'AGII',           description: 'AI infrastructure and agents built on Lithosphere.', url: 'https://agii.app',       color: '#8b7df7', category: 'AI',        section: 'AI & Agents' },
  { id: 'imagen', name: 'Imagen Network', description: 'Decentralized AI image generation network.',        url: 'https://imagen.network', color: '#10b981', category: 'AI',        section: 'AI & Agents' },
  { id: 'furgpt', name: 'FurGPT',         description: 'AI agents and tooling on Lithosphere.',             url: 'https://furgpt.org',     color: '#10b981', category: 'AI',        section: 'AI & Agents' },
  { id: 'atua',   name: 'ATUA AI',        description: 'AI-driven analytics and on-chain insights.',        url: 'https://atua.ai',        color: '#06b6d4', category: 'AI',        section: 'AI & Agents' },
  { id: 'ignite', name: 'Ignite DEX',     description: 'Same-chain AMM and routing on Lithosphere.',        url: 'https://ignite.litho.ai', color: '#22c55e', category: 'DEX',      section: 'DeFi & Yield' },
  { id: 'mansa',  name: 'Mansa AI',       description: 'AI-driven DeFi and liquidity on Lithosphere.',      url: 'https://mansa.world',    color: '#eab308', category: 'AI · DeFi', section: 'DeFi & Yield' },
  { id: 'colle',  name: 'Colle AI',       description: 'Multi-chain, AI-powered NFT creation and trading.', url: 'https://colle.ai',       color: '#a3e635', category: 'NFT · AI',  section: 'NFTs' },
  { id: 'makalu-explorer', name: 'Makalu Explorer', description: 'Block explorer + portal for the Makalu main chain (700777).',        url: 'https://makalu.litho.ai',    color: '#3b7af7', category: 'Explorer', section: 'Infrastructure' },
  { id: 'kamet-explorer',  name: 'Kamet Explorer',  description: 'Block explorer + portal for the Kamet sister chain (900523, DNNS).', url: 'https://explorer-3.litho.ai', color: '#6366f1', category: 'Explorer', section: 'Infrastructure' },
  { id: 'litho-deals', name: 'LITHO Deals', description: 'Deals, offers and rewards across the Lithosphere ecosystem.', url: 'https://deals.litho.ai', color: '#3b7af7', category: 'Rewards', section: 'Rewards' },
];

export function groupBySection<T extends { section: string }>(apps: T[]): { section: string; apps: T[] }[] {
  const out: { section: string; apps: T[] }[] = [];
  for (const section of ECOSYSTEM_SECTIONS) {
    const inSection = apps.filter((a) => a.section === section);
    if (inSection.length) out.push({ section, apps: inSection });
  }
  const known = new Set<string>(ECOSYSTEM_SECTIONS);
  const rest = apps.filter((a) => !known.has(a.section));
  if (rest.length) out.push({ section: 'More', apps: rest });
  return out;
}

export function looksLikeUrl(q: string): boolean {
  const s = q.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s);
}

export function normalizeUrl(q: string): string | null {
  const s = q.trim();
  if (!looksLikeUrl(s)) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
