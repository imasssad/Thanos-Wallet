import { MultXAdapterError } from './errors.js';
import type { MultXManifest } from './types.js';

/**
 * Loads and integrity-checks the release manifest — the ONLY place a bridge
 * address, token address, or route enters this package. Nothing here is
 * hardcoded, per the acceptance checklist ("No historical bridge or token
 * address is hard-coded", "Manifest identity and integrity are pinned").
 *
 * `expectedSha256` is required — a manifest fetched without a pinned hash to
 * check against is exactly the "unauthenticated release" the integration
 * plan's delivery stages are gating against (stage 1: "Contract freeze: wait
 * for Autha's accepted release identity").
 */
export async function loadManifest(opts: {
  manifestUrl: string;
  expectedSha256: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MultXManifest> {
  const { manifestUrl, expectedSha256, timeoutMs = 8_000 } = opts;
  const doFetch = opts.fetchImpl ?? fetch;

  if (!/^https:\/\//i.test(manifestUrl)) {
    throw new MultXAdapterError('MANIFEST_INVALID', 'Manifest URL must be HTTPS.');
  }
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new MultXAdapterError('MANIFEST_INVALID', 'Expected manifest SHA-256 is missing or malformed.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let raw: string;
  try {
    const res = await doFetch(manifestUrl, { signal: ctrl.signal });
    if (!res.ok) throw new MultXAdapterError('MANIFEST_UNREACHABLE', `Manifest fetch failed (${res.status}).`);
    raw = await res.text();
  } catch (err) {
    if (err instanceof MultXAdapterError) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new MultXAdapterError('MANIFEST_UNREACHABLE', 'Manifest fetch timed out.');
    }
    throw new MultXAdapterError('MANIFEST_UNREACHABLE', 'Could not reach the manifest host.', err);
  } finally {
    clearTimeout(timer);
  }

  const actualSha256 = await sha256Hex(raw);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    // Integrity mismatch is treated as an attack/corruption signal, not a
    // retryable network error — fail closed, do not fall back to any
    // in-package default.
    throw new MultXAdapterError(
      'MANIFEST_INVALID',
      'Manifest integrity check failed — fetched content does not match the approved hash.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new MultXAdapterError('MANIFEST_INVALID', 'Manifest is not valid JSON.', err);
  }

  return validateManifest(parsed);
}

function validateManifest(v: unknown): MultXManifest {
  const fail = (why: string): never => { throw new MultXAdapterError('MANIFEST_INVALID', `Manifest schema error: ${why}`); };
  if (typeof v !== 'object' || v === null) return fail('not an object');
  const m = v as Record<string, unknown>;

  if (typeof m.tag !== 'string' || !m.tag) return fail('missing tag');
  if (typeof m.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(m.commit)) return fail('commit must be a 40-character SHA');
  if (typeof m.disabled !== 'boolean') return fail('disabled must be a boolean');
  if (typeof m.apiUrl !== 'string' || !/^https:\/\//i.test(m.apiUrl)) return fail('apiUrl must be an https URL');
  if (!Array.isArray(m.routes)) return fail('routes must be an array');

  for (const r of m.routes as unknown[]) {
    if (typeof r !== 'object' || r === null) return fail('route is not an object');
    const route = r as Record<string, unknown>;
    if (typeof route.sourceChainId !== 'number') return fail('route.sourceChainId must be a number');
    if (typeof route.sourceBridge !== 'string' || !/^0x[0-9a-f]{40}$/i.test(route.sourceBridge)) return fail('route.sourceBridge must be a checksummable 0x address');
    if (typeof route.destinationChainId !== 'number') return fail('route.destinationChainId must be a number');
    if (typeof route.destinationBridge !== 'string' || !/^0x[0-9a-f]{40}$/i.test(route.destinationBridge)) return fail('route.destinationBridge must be a checksummable 0x address');
    if (!Array.isArray(route.tokens)) return fail('route.tokens must be an array');
    for (const t of route.tokens as unknown[]) {
      if (typeof t !== 'object' || t === null) return fail('token is not an object');
      const tok = t as Record<string, unknown>;
      if (typeof tok.symbol !== 'string' || !tok.symbol) return fail('token.symbol required');
      if (typeof tok.sourceAddress !== 'string' || !/^0x[0-9a-f]{40}$/i.test(tok.sourceAddress)) return fail('token.sourceAddress invalid');
      if (typeof tok.destinationAddress !== 'string' || !/^0x[0-9a-f]{40}$/i.test(tok.destinationAddress)) return fail('token.destinationAddress invalid');
      if (typeof tok.decimals !== 'number') return fail('token.decimals must be a number');
    }
  }

  return m as unknown as MultXManifest;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
