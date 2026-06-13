'use client';
/**
 * Address display with highlighted head + tail — the pattern every major
 * wallet uses so users can visually confirm an address at the two spots
 * that actually matter (poisoning attacks rely on matching the start and
 * end, so those are exactly what the eye should be drawn to). Client-
 * requested 2026-06-12 for all transact surfaces.
 *
 *   <Addr value="0xdE09…CfEB9"/>            → 0xdE09 ce89…37Ba 4CfEB9
 *   <Addr value={litho1addr} full/>         → full address, head/tail tinted
 *
 * Head/tail counts include the prefix (0x… / litho1…). Works for any
 * string address format (EVM, bech32, base58, segwit).
 */
import React from 'react';

export function Addr({ value, head = 6, tail = 6, full = false, style }: {
  value: string;
  /** Leading characters to highlight (incl. the 0x / litho1 prefix). */
  head?: number;
  /** Trailing characters to highlight. */
  tail?: number;
  /** Render the entire address (middle dimmed) instead of truncating. */
  full?: boolean;
  style?: React.CSSProperties;
}) {
  const v = (value || '').trim();
  if (!v) return null;
  // Degenerate short strings: no slicing games, just render plain.
  if (v.length <= head + tail) {
    return <span style={{ fontFamily: 'Geist Mono, monospace', ...style }}>{v}</span>;
  }
  const h = v.slice(0, head);
  const t = v.slice(-tail);
  const mid = full ? v.slice(head, v.length - tail) : '…';
  return (
    <span style={{ fontFamily: 'Geist Mono, monospace', ...style }}>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{h}</span>
      <span style={{ opacity: 0.6 }}>{mid}</span>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{t}</span>
    </span>
  );
}
