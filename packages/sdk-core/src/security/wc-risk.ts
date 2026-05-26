/**
 * Risk scoring for incoming WalletConnect requests.
 *
 * The WC approval sheet shows the user one of four verdicts:
 *   `safe`    — proceed normally, no banner.
 *   `caution` — show an amber banner with the reasons.
 *   `review`  — show a red banner; the approve button is still
 *               enabled but secondary.
 *   `block`   — refuse to render the approve button; the user has to
 *               explicitly override (the wallet's UI calls this
 *               "force-approve" and we tag the event in audit logs).
 *
 * Each input contributes a numeric score; the total maps to a verdict.
 * This is intentionally simple — a clever attacker can engineer around
 * any single rule, so the value is the *combination* of signals + the
 * fact that the user has to ack the breakdown before signing.
 */

import { inspectWebsite } from './phishing';
import type { WebsiteRiskReport } from '../types';

export type WcRiskVerdict = 'safe' | 'caution' | 'review' | 'block';

export interface WcRiskReport {
  verdict:   WcRiskVerdict;
  score:     number;       // 0..100+
  reasons:   string[];
  website?:  WebsiteRiskReport;
}

export interface WcRiskInput {
  /** dApp metadata's `url` field (or the WC peer's origin). */
  origin?:    string;
  /** RPC method name — eth_sendTransaction / personal_sign / etc. */
  method:     string;
  /** Decoded params, when the wallet has been able to parse them.
   *  Used for value-magnitude + unlimited-approval heuristics. */
  params?:    unknown;
  /** The active chain id, in case method-specific rules differ
   *  per chain (none today, but kept for forward compat). */
  chainId?:   number;
}

const APPROVE_SELECTOR     = '0x095ea7b3';                          // approve(address,uint256)
const SET_APPROVAL_FOR_ALL = '0xa22cb465';                          // setApprovalForAll(address,bool)
const MAX_UINT_HEX         = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export function scoreWcRequest(input: WcRiskInput): WcRiskReport {
  const reasons: string[] = [];
  let   score              = 0;
  let   websiteReport: WebsiteRiskReport | undefined;

  /* ─── Origin / phishing ──────────────────────────────────────────── */
  if (input.origin) {
    try {
      const hostname = new URL(input.origin).hostname;
      websiteReport  = inspectWebsite(hostname);
      score         += websiteReport.score;
      reasons.push(...websiteReport.reasons);
    } catch { /* malformed URL — treat as no signal */ }
  }

  /* ─── Method-specific signals ────────────────────────────────────── */
  if (input.method === 'eth_sendTransaction') {
    const tx = Array.isArray(input.params)
      ? (input.params as Array<{ to?: string; value?: string; data?: string }>)[0]
      : (input.params as { to?: string; value?: string; data?: string });
    if (tx && typeof tx === 'object') {
      // ERC-20 approve with MaxUint256 — the canonical drainer setup.
      const data = (tx.data ?? '').toLowerCase();
      if (data.startsWith(APPROVE_SELECTOR) && data.includes(MAX_UINT_HEX)) {
        reasons.push('Unlimited ERC-20 approval — the contract can spend the entire balance forever.');
        score += 60;
      } else if (data.startsWith(APPROVE_SELECTOR)) {
        reasons.push('ERC-20 spend approval — verify the spender and amount.');
        score += 15;
      }
      // setApprovalForAll — NFT-equivalent of "drain everything".
      if (data.startsWith(SET_APPROVAL_FOR_ALL)) {
        reasons.push('setApprovalForAll — grants the contract full transfer rights over your NFT collection.');
        score += 70;
      }
      // Value flag — sending native ETH/LITHO without data is normal;
      // sending value AND calldata is a contract call that should be
      // inspected. We don't penalise it heavily but surface as info.
      if (tx.value && tx.value !== '0x0' && data.length > 2 && !data.startsWith(APPROVE_SELECTOR)) {
        reasons.push('Transaction sends value AND calls a contract method — review the call data.');
        score += 5;
      }
    }
  }

  if (input.method === 'eth_signTypedData_v4') {
    // EIP-712 typed-data signs are commonly used by Permit / Permit2
    // off-chain approvals. We don't fully decode here but surface the
    // category so the UI can warn.
    reasons.push('EIP-712 typed-data signature — often used for off-chain Permit approvals; verify the spender.');
    score += 20;
  }

  if (input.method === 'eth_sign') {
    // Legacy eth_sign is famously dangerous — the signed payload is
    // an arbitrary hash, so a malicious dApp can craft it to match a
    // real tx. Best practice: refuse.
    reasons.push('Legacy eth_sign is unsafe — the payload is an arbitrary hash that can be reused to authorise a transaction.');
    score += 80;
  }

  /* ─── Verdict mapping ────────────────────────────────────────────── */
  let verdict: WcRiskVerdict;
  if      (score >= 90) verdict = 'block';
  else if (score >= 50) verdict = 'review';
  else if (score >= 15) verdict = 'caution';
  else                  verdict = 'safe';

  return { verdict, score, reasons, website: websiteReport };
}
