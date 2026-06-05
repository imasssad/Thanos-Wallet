/**
 * Lithosphere ecosystem dApp directory — shared across all clients
 * (web, desktop, extension, mobile). Powers the Discover/Explore screen.
 *
 * This module is platform-agnostic: it carries the canonical hub URL and
 * the per-app metadata (name, description, destination URL, brand colour,
 * category) but NOT icon asset paths, since those differ per client
 * (web public/, RN require(), etc.). Each client layers in its own icons.
 *
 * URLs: the canonical directory lives at https://ecosystem.litho.ai —
 * each entry below points at its real product domain when known,
 * falling back to the hub when a public URL hasn't been confirmed
 * (currently only EGO Exchange).
 */
export const ECOSYSTEM_HUB = 'https://ecosystem.litho.ai';

export interface EcosystemApp {
  id:          string;
  name:        string;
  description: string;
  /** Destination opened in the browser. */
  url:         string;
  /** Brand colour for the letter-avatar fallback. */
  color:       string;
  /** Short tag shown on the row (e.g. "AI", "DeFi"). */
  category:    string;
  /** Grouping section header (SafePal-style). One of ECOSYSTEM_SECTIONS. */
  section:     string;
}

/** Section headers in display order. Apps render grouped under these. */
export const ECOSYSTEM_SECTIONS = [
  'AI & Agents',
  'DeFi & Yield',
  'NFTs',
  'Infrastructure',
  'Rewards',
] as const;

export const ECOSYSTEM_APPS: EcosystemApp[] = [
  // ─── AI & Agents ─────────────────────────────────────────────────────
  {
    id: 'agii',
    name: 'AGII',
    description: 'AI infrastructure and agents built on Lithosphere.',
    url: 'https://agii.app',
    color: '#8b7df7',
    category: 'AI',
    section: 'AI & Agents',
  },
  {
    id: 'imagen',
    name: 'Imagen Network',
    description: 'Decentralized AI image generation network.',
    url: 'https://imagen.network',
    color: '#10b981',
    category: 'AI',
    section: 'AI & Agents',
  },
  {
    id: 'furgpt',
    name: 'FurGPT',
    description: 'AI agents and tooling on Lithosphere.',
    url: 'https://furgpt.org',
    color: '#10b981',
    category: 'AI',
    section: 'AI & Agents',
  },
  {
    id: 'atua',
    name: 'ATUA AI',
    description: 'AI-driven analytics and on-chain insights.',
    url: 'https://atua.ai',
    color: '#06b6d4',
    category: 'AI',
    section: 'AI & Agents',
  },
  // ─── DeFi & Yield ────────────────────────────────────────────────────
  {
    id: 'ignite',
    name: 'Ignite DEX',
    description: 'Same-chain AMM and routing on Lithosphere.',
    url: 'https://ignite.litho.ai',
    color: '#22c55e',
    category: 'DEX',
    section: 'DeFi & Yield',
  },
  {
    id: 'ego',
    name: 'EGO Exchange',
    description: 'Cross-chain swap exchange on the Lithosphere bridge.',
    // URL TBD — Esha to confirm. Falls back to the ecosystem hub for now.
    url: ECOSYSTEM_HUB,
    color: '#f97316',
    category: 'DEX',
    section: 'DeFi & Yield',
  },
  {
    id: 'mansa',
    name: 'Mansa AI',
    description: 'AI-driven DeFi and liquidity on Lithosphere.',
    url: 'https://mansa.world',
    color: '#eab308',
    category: 'AI · DeFi',
    section: 'DeFi & Yield',
  },
  // ─── NFTs ────────────────────────────────────────────────────────────
  {
    id: 'colle',
    name: 'Colle AI',
    description: 'Multi-chain, AI-powered NFT creation and trading.',
    url: 'https://colle.ai',
    color: '#a3e635',
    category: 'NFT · AI',
    section: 'NFTs',
  },
  // ─── Infrastructure ──────────────────────────────────────────────────
  {
    id: 'makalu-explorer',
    name: 'Makalu Explorer',
    description: 'Block explorer + portal for the Makalu main chain (700777).',
    url: 'https://makalu.litho.ai',
    color: '#3b7af7',
    category: 'Explorer',
    section: 'Infrastructure',
  },
  {
    id: 'kamet-explorer',
    name: 'Kamet Explorer',
    description: 'Block explorer + portal for the Kamet sister chain (900523, DNNS).',
    url: 'https://kamet.litho.ai',
    color: '#6366f1',
    category: 'Explorer',
    section: 'Infrastructure',
  },
  // ─── Rewards ─────────────────────────────────────────────────────────
  {
    id: 'litho-deals',
    name: 'LITHO Deals',
    description: 'Deals, offers and rewards across the Lithosphere ecosystem.',
    url: ECOSYSTEM_HUB,
    color: '#3b7af7',
    category: 'Rewards',
    section: 'Rewards',
  },
];

/* ─── Helpers shared by every client's Discover/Explore screen ──────── */

/** Group apps under their section in ECOSYSTEM_SECTIONS order. Empty
 *  sections are omitted; any app whose section isn't recognised lands in
 *  a trailing "More" group so nothing silently disappears. */
export function groupBySection<T extends { section: string }>(
  apps: T[],
): { section: string; apps: T[] }[] {
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

/** True when the query looks like a URL or bare domain the user wants to
 *  open directly (SafePal's "enter a link" behaviour). */
export function looksLikeUrl(q: string): boolean {
  const s = q.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // bare domain: something.tld (+ optional path)
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s);
}

/** Normalise a typed link to an https URL, or null if it isn't openable. */
export function normalizeUrl(q: string): string | null {
  const s = q.trim();
  if (!looksLikeUrl(s)) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
