'use client';
/**
 * Phishing / scam-pattern detection for the wallet UI.
 *
 * Pure classifier functions a UI surface can call to decide whether to
 * warn the user:
 *
 *   classifyOrigin(url)          — Connect-dApp banner (WalletConnectModal),
 *                                  and a hard stop in the signing sheet
 *   classifyRecipient(address)   — Send-recipient banner (SendModal)
 *
 * What a dApp asks to SIGN (permits, Permit2, Seaport, approve, …) is
 * decoded by sdk-core reviewSigningRequest (WalletConnectHost), which also
 * owns the scam-address list used here.
 *
 * Each returns a `Risk` (safe | unknown | warning | critical) plus a
 * list of human-readable reasons the UI can render.
 *
 * Sources
 *   - A built-in mini blocklist of high-confidence phishing patterns
 *     (subset of MetaMask's eth-phishing-detect "blacklist", trimmed to
 *     the domains we expect Lithosphere users to actually encounter).
 *   - Drainer contract addresses observed in incident reports
 *     (sdk-core isKnownScamAddress — one list for every client).
 *
 * The lib is intentionally lib-local — no network calls — so it works
 * offline and pre-signs. A remote refresh is a follow-up.
 */
import { checkRecipient } from '@thanos/sdk-core';

export type Risk = 'safe' | 'unknown' | 'warning' | 'critical';

export interface Verdict {
  risk:    Risk;
  reasons: string[];
}

/* ─── Trusted origins ─────────────────────────────────────────────── */

/* dApps the wallet officially considers safe. Exact-match on host.
   Subdomains of these hosts also pass. */
const TRUSTED_HOSTS: readonly string[] = [
  'thanos.fi',
  'devapp.thanos.fi',
  'litho.ai',
  'makalu.litho.ai',
  'bridge.litho.ai',
  'rpc.litho.ai',
];

/* ─── Phishing host blocklist ─────────────────────────────────────── */

/* High-confidence phishing domains.  Subset of widely-tracked lists; we
   keep this short on purpose — false positives are very expensive. */
const PHISH_HOSTS: readonly string[] = [
  'metamask-pro.io',
  'opensea-mint.com',
  'opensea-launchpad.io',
  'rariblee.io',
  'walletconnct.com',
  'walletconnectt.org',
  'unisswap.com',
  'unniswap.org',
  'pancakeswap.cash',
  'litho-claim.com',
  'litho-airdrop.io',
  'thanoswallet.io',         // mis-typed brand
  'thanoswallet.app',
];

/* Heuristic substrings: anything containing these in the *host* is a
   probable scam. Used only when the host is not in the explicit list. */
const PHISH_HOST_PATTERNS: readonly RegExp[] = [
  /claim[-.]?(airdrop|reward|bonus|free|nft)/i,
  /(connect|verify|recover|restore|sync|update)[-.]?wallet/i,
  /(metamask|walletconnect|trust|coinbase|phantom|exodus|ledger|trezor)[-.]?(login|signin|verify|connect|update)/i,
  /(thanos|litho|lithosphere)[-.]?(airdrop|claim|reward|free|mint|gift)/i,
];

/* ─── Hosts ─────────────────────────────────────────────────────── */

function parseHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSubdomainOf(host: string, root: string): boolean {
  return host === root || host.endsWith('.' + root);
}

/** Apex (eTLD+1) lookup — strips obvious 2-level co.uk / com.au cases
 *  conservatively so 'mail.opensea-mint.com' still hits the rootlist. */
function pickApex(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

/* ─── classifyOrigin ─────────────────────────────────────────────── */

export function classifyOrigin(url: string): Verdict {
  const host = parseHost(url);
  if (!host) {
    return { risk: 'warning', reasons: ['The dApp did not provide a valid URL.'] };
  }
  const apex = pickApex(host);

  if (TRUSTED_HOSTS.some(t => isSubdomainOf(host, t))) {
    return { risk: 'safe', reasons: [`Verified domain (${host})`] };
  }

  if (PHISH_HOSTS.some(p => isSubdomainOf(host, p)) || PHISH_HOSTS.includes(apex)) {
    return { risk: 'critical', reasons: [`Known phishing site: ${host}`] };
  }
  for (const re of PHISH_HOST_PATTERNS) {
    if (re.test(host)) {
      return { risk: 'critical', reasons: [`Domain pattern suggests phishing: "${host}"`] };
    }
  }

  /* Non-HTTPS dApps are inherently unsafe — credentials and signing
     traffic should never go through a plaintext channel. */
  try {
    const proto = new URL(url).protocol;
    if (proto !== 'https:' && proto !== 'wss:' && !host.endsWith('localhost')) {
      return { risk: 'warning', reasons: [`dApp is served over ${proto} — connection is not encrypted.`] };
    }
  } catch { /* already handled above */ }

  return { risk: 'unknown', reasons: ['This dApp is not on the wallet\'s verified list. Proceed only if you trust it.'] };
}

/* ─── classifyRecipient ──────────────────────────────────────────── */

export function classifyRecipient(address: string): Verdict {
  const trimmed = (address || '').trim().toLowerCase();
  if (!trimmed) return { risk: 'unknown', reasons: [] };
  // Same rule as the extension / desktop / mobile Send screens (sdk-core).
  const problem = trimmed.startsWith('0x') ? checkRecipient(trimmed) : null;
  return problem ? { risk: 'critical', reasons: [problem] } : { risk: 'safe', reasons: [] };
}
