'use client';
/**
 * Reactive token icon.
 *
 * Loads /images/tokens/{sym}.png and shows the brand-colored letter avatar
 * underneath. If the PNG loads, it covers the avatar. If the PNG 404s or
 * fails to decode, the avatar stays visible — so the wallet looks polished
 * even before the icon assets are committed.
 *
 * Resolution order:
 *   1) Explicit `icon` prop (path to PNG)
 *   2) Canonical TOKENS[sym].icon (e.g. /images/tokens/litho.png)
 *   3) Letter fallback with the token's brand color
 */
import React, { useState } from 'react';
import { TOKEN_BY_SYM } from '../lib/tokens';

interface Props {
  /** Token ticker (e.g. 'LITHO'). Drives both icon lookup and avatar letter. */
  sym:   string;
  /** Optional override path — used when the indexer reports a non-canonical token. */
  icon?: string;
  /** Optional brand-color override — used when sym isn't in canonical TOKENS. */
  color?: string;
  /** Pixel size of the square avatar. Default 28. */
  size?: number;
  /** Optional extra style (e.g. flexShrink: 0). */
  style?: React.CSSProperties;
  /** Optional className for the outer wrapper. */
  className?: string;
}

export function TokenIcon({ sym, icon, color, size = 28, style, className }: Props) {
  const canonical = TOKEN_BY_SYM[sym];
  const src       = icon || canonical?.icon;
  const bgColor   = color || canonical?.color || '#52525b';

  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bgColor,
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(10, Math.floor(size * 0.42)),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    >
      {/* Letter fallback — always rendered underneath; covered when PNG loads. */}
      <span style={{ position: 'absolute' }}>{sym.charAt(0).toUpperCase()}</span>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={sym}
          width={size}
          height={size}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width:  '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      )}
    </div>
  );
}
