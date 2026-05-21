/**
 * Lithosphere ecosystem dApp directory — powers the Discover screen.
 *
 * Detached copy of @thanos/sdk-core's ecosystem module (EAS Cloud can't
 * resolve workspace packages). Keep in sync with
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
  section:     string;
}

export const ECOSYSTEM_SECTIONS = ['AI & Agents', 'DeFi & Yield', 'NFTs', 'Rewards'] as const;

export const ECOSYSTEM_APPS: EcosystemApp[] = [
  { id: 'agii',   name: 'AGII',           description: 'AI infrastructure and agents built on Lithosphere.', url: ECOSYSTEM_HUB, color: '#8b7df7', category: 'AI',        section: 'AI & Agents' },
  { id: 'imagen', name: 'Imagen Network', description: 'Decentralized AI image generation network.',        url: ECOSYSTEM_HUB, color: '#10b981', category: 'AI',        section: 'AI & Agents' },
  { id: 'furgpt', name: 'FurGPT',         description: 'AI agents and tooling on Lithosphere.',             url: ECOSYSTEM_HUB, color: '#10b981', category: 'AI',        section: 'AI & Agents' },
  { id: 'mansa',  name: 'Mansa AI',       description: 'AI-driven DeFi and liquidity on Lithosphere.',      url: ECOSYSTEM_HUB, color: '#eab308', category: 'AI · DeFi', section: 'DeFi & Yield' },
  { id: 'colle',  name: 'Colle AI',       description: 'Multi-chain, AI-powered NFT creation and trading.', url: ECOSYSTEM_HUB, color: '#a3e635', category: 'NFT · AI',  section: 'NFTs' },
  { id: 'litho-deals', name: 'LITHO Deals', description: 'Deals, offers and rewards across the Lithosphere ecosystem.', url: ECOSYSTEM_HUB, color: '#3b7af7', category: 'Rewards', section: 'Rewards' },
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
