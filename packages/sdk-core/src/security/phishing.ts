import type { WebsiteRiskReport } from '../types';

/* O-03: this classifier was 4 keywords / 3 TLDs / 1 brand (MetaMask only) —
 * any dApp impersonating a different wallet, using a TLD outside that list,
 * or phrasing its lure differently sailed straight through as "allow". Still
 * a heuristic, not a real-time threat-intel feed (see "Known limits" below),
 * but it now covers the shapes phishing kits actually use in the wild. */

const blockedKeywords = [
  'drainer', 'seed-verify', 'claim-now', 'wallet-rectify',
  'seed-phrase', 'recover-wallet', 'wallet-recovery', 'verify-wallet',
  'wallet-sync', 'sync-wallet', 'wallet-unlock', 'unlock-wallet',
  'validate-wallet', 'wallet-validate', 'connect-wallet-now',
  'airdrop-claim', 'claim-airdrop', 'free-mint', 'mint-now',
  'revoke-approval', 'wallet-support', 'support-wallet', 'wallet-security',
  'security-alert', 'suspended-wallet', 'wallet-suspended',
];

// TLDs cheap to register and free of any registrar vetting, favored by mass
// phishing kits (alongside the original .zip/.mov, which Chrome/file-manager
// ambiguity made attractive before registries even opened them).
const suspiciousTlds = [
  '.zip', '.mov', '.xyz', '.top', '.club', '.online', '.site', '.click',
  '.live', '.work', '.icu', '.cam', '.cfd', '.rest', '.sbs', '.buzz',
];

// Canonical domain for each brand a phishing kit is likely to impersonate —
// wallets, the exchanges/DEXs a wallet user is routed to, and this wallet's
// own brand (so "thanos-wallet-login.xyz" flags too). bareName is what a
// lookalike hostname would still contain even after the attacker appends
// "-login" / "-verify" / a different TLD.
const knownBrands: Array<{ bareName: string; domain: string }> = [
  { bareName: 'metamask', domain: 'metamask.io' },
  { bareName: 'phantom', domain: 'phantom.app' },
  { bareName: 'trustwallet', domain: 'trustwallet.com' },
  { bareName: 'coinbase', domain: 'coinbase.com' },
  { bareName: 'ledger', domain: 'ledger.com' },
  { bareName: 'trezor', domain: 'trezor.io' },
  { bareName: 'walletconnect', domain: 'walletconnect.com' },
  { bareName: 'uniswap', domain: 'uniswap.org' },
  { bareName: 'opensea', domain: 'opensea.io' },
  { bareName: 'binance', domain: 'binance.com' },
  { bareName: 'exodus', domain: 'exodus.com' },
  { bareName: 'rainbow', domain: 'rainbow.me' },
  { bareName: 'zerion', domain: 'zerion.io' },
  { bareName: 'thanos', domain: 'thanos.fi' },
];

/** True iff `lowered` is the brand's own domain or a genuine subdomain of
 *  it (e.g. "app.metamask.io") — never flag the real site or its own
 *  subdomains, only something that merely mentions the brand elsewhere. */
function isGenuineBrandHost(lowered: string, domain: string): boolean {
  return lowered === domain || lowered.endsWith(`.${domain}`);
}

/** Longest run of [a-z0-9] separated by hyphens — phishing kits chain
 *  several lure words ("metamask-wallet-recovery-verify-now.com"); a
 *  legitimate hostname rarely strings together more than one or two. */
function hyphenSegmentCount(lowered: string): number {
  const label = lowered.split('.')[0] ?? '';
  return label.split('-').filter(Boolean).length;
}

export function inspectWebsite(hostname: string): WebsiteRiskReport {
  const lowered = hostname.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (blockedKeywords.some((keyword) => lowered.includes(keyword))) {
    reasons.push('Hostname matches known phishing keyword patterns.');
    score += 80;
  }

  if (suspiciousTlds.some((tld) => lowered.endsWith(tld))) {
    reasons.push('Hostname uses a high-risk top-level domain.');
    score += 35;
  }

  for (const brand of knownBrands) {
    if (lowered.includes(brand.bareName) && !isGenuineBrandHost(lowered, brand.domain)) {
      reasons.push(`Lookalike brand domain detected (mimics ${brand.domain}).`);
      score += 65;
      break; // one lookalike hit is enough signal; brands can overlap substrings
    }
  }

  // xn-- is IDN/punycode — the usual vector for homograph attacks (a
  // Cyrillic "а" standing in for Latin "a" in "metаmask.io", etc.).
  if (lowered.split('.').some((label) => label.startsWith('xn--'))) {
    reasons.push('Hostname uses punycode (possible homograph/lookalike character).');
    score += 50;
  }

  // A bare IPv4 literal has no domain identity to vet at all.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lowered)) {
    reasons.push('Hostname is a raw IP address, not a registered domain.');
    score += 40;
  }

  if (hyphenSegmentCount(lowered) >= 4) {
    reasons.push('Hostname chains an unusually large number of hyphenated words.');
    score += 20;
  }

  return {
    hostname,
    score,
    verdict: score >= 80 ? 'block' : score >= 35 ? 'review' : 'allow',
    reasons
  };
}

/* Known limits (documented, not hidden — see SECURITY.md / O-03):
 *   - This is a static, client-side heuristic. It has no live threat-intel
 *     feed, no domain-age/WHOIS lookup, and no crowd-sourced blocklist —
 *     a brand-new, keyword-free lookalike domain on a plain .com can still
 *     slip through as "allow" until a human reports it and this list grows.
 *   - The brand/keyword lists are necessarily finite; this raises the bar
 *     for the shapes real phishing kits reuse today, it does not close the
 *     category.
 */
