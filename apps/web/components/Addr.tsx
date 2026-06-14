'use client';
/**
 * Address display with highlighted head + tail — the pattern every major
 * wallet uses so users can visually confirm an address at the two spots
 * that actually matter. Address-poisoning attacks craft a lookalike whose
 * START and END match the real address, so those are exactly what the eye
 * should be drawn to. Client-requested 2026-06-12 for all transact
 * surfaces.
 *
 *   <Addr value="0xdE09…CfEB9"/>      → 0x dE09ce  …  37Ba4CfEB9 (tinted ends)
 *   <Addr value={litho1addr} full/>   → full address, head/tail tinted
 *
 * `head`/`tail` count ADDRESS-SPECIFIC characters — the constant prefix
 * (0x / litho1 / cosmos1 / bc1) is always shown but does NOT eat into the
 * highlighted budget, otherwise a litho1 head of 8 would be "litho1" + 2
 * real chars and a poisoned address could match it trivially.
 */
import React from 'react';

/** Length of the constant human-readable prefix, which carries no
 *  identifying information. Conservative known-prefix list — base58
 *  Solana addresses can contain '1' so we never guess past these. */
function prefixLen(v: string): number {
  if (v.startsWith('0x') || v.startsWith('0X')) return 2;
  if (v.startsWith('litho1'))  return 6;
  if (v.startsWith('cosmos1')) return 7;
  if (v.startsWith('bc1'))     return 3;
  return 0;
}

export function Addr({ value, head = 6, tail = 6, full = false, style }: {
  value: string;
  /** Address-specific leading chars to highlight (excludes the prefix). */
  head?: number;
  /** Trailing chars to highlight. */
  tail?: number;
  /** Render the entire address (middle dimmed) instead of truncating. */
  full?: boolean;
  style?: React.CSSProperties;
}) {
  const v = (value || '').trim();
  if (!v) return null;
  const headEnd = prefixLen(v) + head;
  // Degenerate short strings: no slicing games, just render plain.
  if (v.length <= headEnd + tail) {
    return <span style={{ fontFamily: 'Geist Mono, monospace', ...style }}>{v}</span>;
  }
  const h = v.slice(0, headEnd);
  const t = v.slice(-tail);
  const mid = full ? v.slice(headEnd, v.length - tail) : '…';
  return (
    <span style={{ fontFamily: 'Geist Mono, monospace', ...style }}>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{h}</span>
      <span style={{ opacity: 0.6 }}>{mid}</span>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{t}</span>
    </span>
  );
}
