import React from 'react';

/**
 * LITHO currency symbol — 𝕃 (U+1D543, mathematical double-struck capital L).
 *
 * Rendered in the bundled single-glyph LithoSym font (see globals.css
 * @font-face) so it shows correctly even though Geist omits the math block.
 * Use it as a currency symbol wherever a LITHO amount is shown, e.g.
 *   <LithoSym/> {balance}
 */
export function LithoSym({ style, className }: { style?: React.CSSProperties; className?: string }) {
  return (
    <span
      className={className ? `litho-sym ${className}` : 'litho-sym'}
      style={style}
      aria-label="LITHO"
      title="LITHO"
    >
      {'\u{1D543}'}
    </span>
  );
}
