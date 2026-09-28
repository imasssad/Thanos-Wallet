/**
 * Scrubbing wallet secrets out of crash reports — mobile twin of
 * packages/sdk-core/src/security/telemetry-scrub.ts (see that file for the
 * full rationale). Detached copy for the same reason as lib/quantt.ts: EAS
 * builds can't resolve the workspace @thanos/sdk-core dep. Keep the two
 * identical below this header — packages/sdk-core/src/__tests__/
 * telemetry-scrub.test.ts runs its whole suite against both.
 */
import { wordlists } from 'ethers';

export const REDACTED = '[redacted]';

const SECRET_FIELD = /(mnemonic|phrase|seed|password|passphrase|private[_-]?key|secret|vault|session[_-]?key|token|authorization|cookie)/i;
const PHRASE_MIN_WORDS = 8;
const HEX_KEY = /(^|[^0-9a-f])(?:0x)?[0-9a-f]{64}(?![0-9a-f])/gi;
const BASE58_KEY = /\b(?:[xyztuv]prv[1-9A-HJ-NP-Za-km-z]{100,}|[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}|[1-9A-HJ-NP-Za-km-z]{84,90})\b/g;

let bip39: Set<string> | null = null;
function bip39Words(): Set<string> {
  bip39 ??= new Set(Array.from({ length: 2048 }, (_, i) => wordlists.en.getWord(i)));
  return bip39;
}

/** Cut every run of PHRASE_MIN_WORDS+ wordlist words, whatever separates
 *  them (spaces, commas, "1." numbering, JSON quotes). */
function redactPhrases(text: string): string {
  const words = bip39Words();
  let out = '', kept = 0, runStart = 0, runEnd = 0, runLen = 0;
  const endRun = () => {
    if (runLen >= PHRASE_MIN_WORDS) { out += text.slice(kept, runStart) + REDACTED; kept = runEnd; }
    runLen = 0;
  };
  for (const m of text.matchAll(/[a-z]+/gi)) {
    if (!words.has(m[0].toLowerCase())) { endRun(); continue; }
    if (runLen === 0) runStart = m.index!;
    runEnd = m.index! + m[0].length;
    runLen++;
  }
  endRun();
  return out + text.slice(kept);
}

export function redactSecretStrings(text: string): string {
  return redactPhrases(text).replace(HEX_KEY, `$1${REDACTED}`).replace(BASE58_KEY, REDACTED);
}

/** Scrubbed copy of a telemetry payload (a Sentry event or breadcrumb):
 *  secret-named fields replaced whole, every string scanned. */
export function scrubTelemetry<T>(value: T): T {
  if (typeof value === 'string') return redactSecretStrings(value) as T;
  if (Array.isArray(value)) return value.map(scrubTelemetry) as T;
  if (!value || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_FIELD.test(k) ? REDACTED : scrubTelemetry(v);
  return out as T;
}

/** For a Sentry beforeSend hook: the scrubbed event, or null (drop it) if
 *  scrubbing failed. A hook that throws makes Sentry report the failure as
 *  a new event that skips the hook — sent unscrubbed, breadcrumbs and all. */
export function scrubOrDropEvent<T>(event: T): T | null {
  try { return scrubTelemetry(event); } catch { return null; }
}
