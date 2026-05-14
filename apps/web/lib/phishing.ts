'use client';
/**
 * Phishing / scam-pattern detection for the wallet UI.
 *
 * Three pure classifier functions a UI surface can call to decide
 * whether to warn the user before letting them sign:
 *
 *   classifyOrigin(url)          — Connect-dApp banner (WalletConnectModal)
 *   classifyRecipient(address)   — Send-recipient banner (SendModal)
 *   classifyTransaction(tx)      — pre-sign confirm (WalletConnectHost)
 *
 * Each returns a `Risk` (safe | unknown | warning | critical) plus a
 * list of human-readable reasons the UI can render.
 *
 * Sources
 *   - A built-in mini blocklist of high-confidence phishing patterns
 *     (subset of MetaMask's eth-phishing-detect "blacklist", trimmed to
 *     the domains we expect Lithosphere users to actually encounter).
 *   - Drainer contract addresses observed in incident reports
 *     (Inferno/Pink, Angel, Monkey, ETHDrainer, etc.). These addresses
 *     rotate often — operators can extend via window-level injection
 *     in lib/phishing-remote.ts (future).
 *   - Calldata decoding for the high-blast-radius ABI shapes:
 *     `approve`, `setApprovalForAll`, `permit`, `transferFrom`.
 *
 * The lib is intentionally lib-local — no network calls — so it works
 * offline and pre-signs. A remote refresh is a follow-up.
 */
import { Interface } from 'ethers';

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

/* ─── Known scam recipient/spender addresses ──────────────────────── */

/* Addresses observed pulling funds in public drainer post-mortems.
   Lower-case only; compare case-insensitively. */
const SCAM_ADDRESSES: ReadonlySet<string> = new Set([
  // Inferno Drainer hot wallets (assorted) — known examples
  '0x000000000035b5e5ad9019092c665357240f594e',
  '0x412f10aad96fd78da6736387e2c84931ac20313f',
  // Generic placeholder for hand-curated entries operators may add
  '0xdead000000000000000000000000000000000000',
]);

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
  if (trimmed === '0x0000000000000000000000000000000000000000') {
    return { risk: 'critical', reasons: ['Recipient is the zero address — funds sent here are permanently destroyed.'] };
  }
  if (trimmed.startsWith('0x') && SCAM_ADDRESSES.has(trimmed)) {
    return { risk: 'critical', reasons: ['Recipient appears on the wallet\'s scam-address list.'] };
  }
  return { risk: 'safe', reasons: [] };
}

/* ─── Transaction classifier ─────────────────────────────────────── */

const ERC20_ABI = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
  'function transferFrom(address from, address to, uint256 value)',
]);
const NFT_ABI = new Interface([
  'function setApprovalForAll(address operator, bool approved)',
]);

const UNLIMITED_THRESHOLD = (1n << 240n);

export interface TxLike {
  /** Contract / recipient address. */
  to:    string;
  /** Hex value being sent. */
  value?: string;
  /** Hex calldata. */
  data?: string;
}

export function classifyTransaction(tx: TxLike): Verdict {
  const reasons: string[] = [];
  let risk: Risk = 'safe';
  const bump = (r: Risk) => { if (r === 'critical' || (r === 'warning' && risk !== 'critical')) risk = r; };

  /* 1. Recipient lookup. */
  const r = classifyRecipient(tx.to);
  if (r.risk !== 'safe') { reasons.push(...r.reasons); bump(r.risk); }

  /* 2. Calldata decoding — only the high-blast-radius signatures. */
  const data = tx.data?.toLowerCase() || '';
  if (data && data !== '0x' && data.length >= 10) {
    const selector = data.slice(0, 10);

    if (selector === '0x095ea7b3') {                 // approve(address,uint256)
      try {
        const [spender, value] = ERC20_ABI.decodeFunctionData('approve', data) as unknown as [string, bigint];
        const verdict = classifyRecipient(spender);
        if (verdict.risk === 'critical') {
          reasons.push(`Approving a known-scam spender: ${spender}`);
          bump('critical');
        }
        if (value >= UNLIMITED_THRESHOLD) {
          reasons.push(`Granting UNLIMITED token spend to ${spender}. Revokable later but very high risk.`);
          bump('warning');
        }
      } catch { /* malformed calldata */ }
    } else if (selector === '0xa22cb465') {          // setApprovalForAll(address,bool)
      try {
        const [op, approved] = NFT_ABI.decodeFunctionData('setApprovalForAll', data) as unknown as [string, boolean];
        if (approved) {
          reasons.push(`Granting CONTROL of every NFT in this collection to ${op}.`);
          bump('warning');
          const v = classifyRecipient(op);
          if (v.risk === 'critical') {
            reasons.push(`Operator is on the scam list: ${op}`);
            bump('critical');
          }
        }
      } catch { /* malformed */ }
    } else if (selector === '0x23b872dd') {          // transferFrom(address,address,uint256)
      try {
        const [from, to, val] = ERC20_ABI.decodeFunctionData('transferFrom', data) as unknown as [string, string, bigint];
        // transferFrom is rare in user-signed txs; flag if `from` isn't us.
        // The wallet doesn't know its own address here — caller should
        // pass a stricter check if they want. Conservative bump.
        if (from.toLowerCase() !== to.toLowerCase()) {
          reasons.push(`transferFrom(${from}, …) — make sure you authorised this.`);
          bump('warning');
        }
        void val;
      } catch { /* malformed */ }
    }
  }

  if (reasons.length === 0) reasons.push('No phishing patterns detected.');
  return { risk, reasons };
}

/* ─── EIP-712 typed-data classifier ──────────────────────────────── */

/** Same risk model for permit-shaped typed data. Most drainers use the
 *  EIP-2612 / DAI / Uniswap Permit2 typed-data form. */
export function classifyTypedData(typed: {
  primaryType?: string;
  domain?:      { name?: string; verifyingContract?: string };
  message?:     Record<string, unknown>;
}): Verdict {
  const reasons: string[] = [];
  let risk: Risk = 'safe';

  const pt = (typed.primaryType || '').toLowerCase();
  if (pt === 'permit' || pt === 'permitsingle' || pt === 'permitbatch') {
    reasons.push(
      'This is an off-chain "Permit" approval — same risk as a normal approve(), '
      + 'but invisible on-chain until used. Only sign if you trust the requesting dApp.',
    );
    risk = 'warning';

    const spender = (typed.message as { spender?: string })?.spender;
    if (typeof spender === 'string') {
      const v = classifyRecipient(spender);
      if (v.risk === 'critical') {
        reasons.push(`Spender is on the scam list: ${spender}`);
        risk = 'critical';
      }
    }
    const value = (typed.message as { value?: string | bigint })?.value;
    try {
      const n = typeof value === 'bigint' ? value : BigInt(value ?? '0');
      if (n >= UNLIMITED_THRESHOLD) {
        reasons.push('Permit grants UNLIMITED token spend.');
        risk = risk === 'critical' ? 'critical' : 'warning';
      }
    } catch { /* non-numeric — leave as-is */ }
  }

  if (reasons.length === 0) reasons.push('No phishing patterns detected.');
  return { risk, reasons };
}
