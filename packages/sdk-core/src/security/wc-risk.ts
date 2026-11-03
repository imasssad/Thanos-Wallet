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

/** WalletConnect's own cryptographic check of the dApp's claimed origin
 *  (its Verify API — https://docs.reown.com/advanced/verify-api), carried on
 *  `session_proposal` / `session_request` events as `verifyContext`.
 *  `VALID` means the origin is attested; `INVALID` means it provably is NOT
 *  the origin the dApp's metadata claims (a strong phishing signal); `UNKNOWN`
 *  means WalletConnect couldn't check (offline relay, unlisted project, …). */
export type WcVerifyValidation = 'VALID' | 'INVALID' | 'UNKNOWN';

export interface WcVerifyContext {
  verified?: {
    /** The origin WalletConnect itself observed the connection coming from —
     *  not the dApp's self-declared `metadata.url`, which is just a string
     *  the dApp provides and asserts nothing about where the request is
     *  really from (THN-03: scoring/display must prefer this field). */
    origin?:     string;
    validation?: WcVerifyValidation;
    /** Set when the origin matches a project the WalletConnect Cloud
     *  registry has flagged as malicious. */
    isScam?:     boolean;
  };
}

export interface WcRiskReport {
  verdict:        WcRiskVerdict;
  score:          number;       // 0..100+
  reasons:        string[];
  website?:       WebsiteRiskReport;
  /** The origin actually scored/shown — verifyContext's when present,
   *  else the caller-supplied (self-declared) one. */
  scoredOrigin?:  string;
}

export interface WcRiskInput {
  /** dApp metadata's `url` field (or the WC peer's origin). Used only when
   *  `verifyContext` carries no verified origin of its own — never shown or
   *  scored over a verified one. */
  origin?:         string;
  /** WalletConnect's Verify result for this proposal/request, when the
   *  transport supplies one (all WC session_proposal / session_request
   *  events do, from @walletconnect/core / @reown/walletkit). */
  verifyContext?:  WcVerifyContext;
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

  /* ─── WalletConnect's own Verify result (THN-03) ────────────────────
     Scored and reasoned about BEFORE the phishing heuristics below, and
     using the verified origin in preference to the dApp's self-declared
     one for every signal that follows — a spoofed metadata.url is exactly
     what Verify exists to catch. */
  const verified      = input.verifyContext?.verified;
  const scoredOrigin  = verified?.origin ?? input.origin;
  if (verified?.isScam) {
    score += 100;
    reasons.push("WalletConnect's Verify API flags this origin as a known malicious dApp.");
  } else if (verified?.validation === 'INVALID') {
    score += 60;
    reasons.push("WalletConnect could not verify this dApp's origin — it does NOT match the domain the dApp claims. Likely spoofed.");
  } else if (verified?.validation === 'UNKNOWN') {
    score += 20;
    reasons.push("WalletConnect could not verify this dApp's origin (unlisted or the relay couldn't check). Treat its identity as unconfirmed.");
  }

  /* ─── Origin / phishing ──────────────────────────────────────────── */
  if (scoredOrigin) {
    try {
      const hostname = new URL(scoredOrigin).hostname;
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

  return { verdict, score, reasons, website: websiteReport, scoredOrigin };
}

const VERDICT_RANK: Record<WcRiskVerdict, number> = { safe: 0, caution: 1, review: 2, block: 3 };

/** THN-03: fold WalletConnect's own Verify result into any risk-shaped
 *  review — a signing review from `reviewSigningRequest`, or a bare
 *  `{ risk: 'safe', warnings: [] }` for the connect/session_proposal
 *  decision, which has no signed content of its own to review yet still
 *  needs to refuse a scam origin outright. `isScam` escalates straight to
 *  `block`; `INVALID` (the origin provably does NOT match what the dApp's
 *  own metadata claims) escalates to at least `review`; `UNKNOWN`
 *  (WalletConnect couldn't check — offline relay, unlisted project) escalates
 *  to at least `caution`. Never downgrades a verdict reached some other way,
 *  and a missing verifyContext is a no-op (never upgrades on absence — some
 *  callers, e.g. a wallet's own stored sessions, don't carry one). */
export function applyWcVerifyContext<T extends { risk: WcRiskVerdict; warnings: string[]; blockReason?: string | null }>(
  review: T,
  verifyContext: WcVerifyContext | undefined,
): T {
  const verified = verifyContext?.verified;
  if (!verified) return review;
  let floor: WcRiskVerdict | null = null;
  let reason = '';
  if (verified.isScam) {
    floor = 'block';
    reason = "WalletConnect's Verify API flags this dApp's origin as a known scam. Refusing.";
  } else if (verified.validation === 'INVALID') {
    floor = 'review';
    reason = "WalletConnect could not verify this dApp's origin — it does NOT match the domain the dApp claims. Likely spoofed.";
  } else if (verified.validation === 'UNKNOWN') {
    floor = 'caution';
    reason = "WalletConnect could not verify this dApp's origin. Treat its identity as unconfirmed.";
  }
  if (!floor || VERDICT_RANK[review.risk] >= VERDICT_RANK[floor]) return review;
  return {
    ...review,
    risk: floor,
    warnings: [reason, ...review.warnings],
    ...(floor === 'block' ? { blockReason: review.blockReason ?? reason } : {}),
  } as T;
}

/** What the connect/approval sheet should show for a WalletConnect peer:
 *  the VERIFIED origin when WalletConnect supplied one, never the dApp's
 *  own self-declared `metadata.url` while a verified one exists (THN-03 —
 *  showing the self-declared URL next to a passing-looking check is exactly
 *  what let a mislabelled origin read as trustworthy). Falls back to the
 *  declared URL only when there is no verifyContext at all to prefer. */
export function wcDisplayOrigin(
  verifyContext: WcVerifyContext | undefined,
  declaredUrl: string | undefined,
): { origin?: string; validation?: WcVerifyValidation; isScam?: boolean } {
  const v = verifyContext?.verified;
  return { origin: v?.origin ?? declaredUrl, validation: v?.validation, isScam: v?.isScam };
}
