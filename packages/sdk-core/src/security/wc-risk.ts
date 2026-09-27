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
import { reviewSigningRequest } from './sign-review';
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
  /** The chain the wallet signs for — a typed signature or transaction
   *  naming another chain is blocked (see sign-review.ts). */
  chainId?:   number;
}

/** How much a decoded-request verdict adds to the score. */
const REVIEW_SCORE = { safe: 0, caution: 20, review: 60, block: 100 } as const;

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

  /* ─── What is being signed — decoded by reviewSigningRequest ────────
     (permits, Permit2, Seaport, approve / setApprovalForAll, chainId). */
  const review = reviewSigningRequest({ method: input.method, params: input.params, activeChainId: input.chainId });
  score += REVIEW_SCORE[review.risk];
  reasons.push(...review.warnings);

  /* ─── Verdict mapping ────────────────────────────────────────────── */
  let verdict: WcRiskVerdict;
  if      (score >= 90) verdict = 'block';
  else if (score >= 50) verdict = 'review';
  else if (score >= 15) verdict = 'caution';
  else                  verdict = 'safe';

  return { verdict, score, reasons, website: websiteReport };
}
