/**
 * Ecosystem helpers — section grouping + URL detection used by every
 * Discover/Explore screen across web/desktop/extension/mobile.
 *
 * A regression here would either drop apps off the screen (groupBySection
 * leaves them out) or let the search box silently swallow a typed URL
 * (looksLikeUrl/normalizeUrl), so both deserve real cases.
 */
import { describe, it, expect } from 'vitest';
import {
  groupBySection,
  looksLikeUrl,
  normalizeUrl,
  ECOSYSTEM_SECTIONS,
  ECOSYSTEM_APPS,
} from '../ecosystem.js';

describe('groupBySection', () => {
  it('keeps the canonical section order (AI & Agents → DeFi → NFTs → Rewards)', () => {
    const groups = groupBySection(ECOSYSTEM_APPS);
    const order = groups.map((g) => g.section);
    // Each present section must appear in ECOSYSTEM_SECTIONS' relative order.
    const known = ECOSYSTEM_SECTIONS.filter((s) => order.includes(s));
    expect(order.slice(0, known.length)).toEqual(known);
  });

  it('puts unknown sections into a trailing "More" bucket', () => {
    const apps = [
      { section: 'AI & Agents' },
      { section: 'Brand-new category' },
      { section: 'Another unknown' },
    ];
    const groups = groupBySection(apps);
    const more = groups.find((g) => g.section === 'More');
    expect(more).toBeDefined();
    expect(more!.apps.length).toBe(2);
    // More is the trailing bucket.
    expect(groups[groups.length - 1].section).toBe('More');
  });

  it('omits empty sections rather than rendering empty headers', () => {
    const groups = groupBySection([{ section: 'AI & Agents' }]);
    expect(groups.length).toBe(1);
    expect(groups[0].section).toBe('AI & Agents');
  });

  it('returns [] for no apps', () => {
    expect(groupBySection([])).toEqual([]);
  });
});

describe('looksLikeUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://x.io/path')).toBe(true);
  });

  it('accepts a bare domain', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('uniswap.org/swap')).toBe(true);
    expect(looksLikeUrl('a.b.c.io')).toBe(true);
  });

  it('rejects plain words / queries with spaces', () => {
    expect(looksLikeUrl('hello')).toBe(false);
    expect(looksLikeUrl('hello world')).toBe(false);
    expect(looksLikeUrl('uniswap swap')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });

  it('trims whitespace before classifying', () => {
    expect(looksLikeUrl('  https://x.io  ')).toBe(true);
    expect(looksLikeUrl('  hello  ')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('returns null for non-URL queries', () => {
    expect(normalizeUrl('hello world')).toBe(null);
    expect(normalizeUrl('')).toBe(null);
  });

  it('passes through full https URLs unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('prefixes https:// to a bare domain', () => {
    expect(normalizeUrl('uniswap.org')).toBe('https://uniswap.org');
    expect(normalizeUrl('  a.b.c/path  ')).toBe('https://a.b.c/path');
  });
});

describe('ECOSYSTEM_APPS dataset', () => {
  it('every app has a section that is recognised (so groupBySection never sends them to "More")', () => {
    const known = new Set<string>(ECOSYSTEM_SECTIONS);
    for (const app of ECOSYSTEM_APPS) {
      expect(known.has(app.section)).toBe(true);
    }
  });

  it('every app has a non-empty id, name, url and category', () => {
    for (const app of ECOSYSTEM_APPS) {
      expect(app.id).toMatch(/.+/);
      expect(app.name).toMatch(/.+/);
      expect(app.url).toMatch(/^https?:\/\//);
      expect(app.category).toMatch(/.+/);
    }
  });

  it('app ids are unique (so DAPP_ICONS lookups + React keys never collide)', () => {
    const ids = ECOSYSTEM_APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
