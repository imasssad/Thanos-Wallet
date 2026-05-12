'use client';
/**
 * Reactive token icon.
 *
 * Resolution order (each tried in turn, failures fall through):
 *   1) Explicit `icon` prop (typically /images/tokens/{sym}.png — local,
 *      curated, fastest)
 *   2) Canonical TOKENS[sym].icon — same shape as above for known tokens
 *   3) CoinGecko live URL via getLogoUrl(sym) — covers ~10K mainstream
 *      tokens, lazily fetched at app boot via preloadTokenLogos()
 *   4) Letter fallback with the token's brand color — always works
 *
 * The fallback chain runs at render time via state transitions on <img>
 * error, so a single token can attempt all four sources in one component
 * without re-renders cascading.
 */
import React, { useState } from 'react';
import { TOKEN_BY_SYM } from '../lib/tokens';
import { getLogoUrl } from '../lib/token-logos';

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
  const bgColor   = color || canonical?.color || '#52525b';

  /* Build the candidate source chain ONCE per token. We step through it on
     each onError until we run out, at which point the letter avatar wins. */
  const sources = React.useMemo(() => {
    const out: string[] = [];
    if (icon)            out.push(icon);
    if (canonical?.icon) out.push(canonical.icon);
    const live = getLogoUrl(sym);
    if (live)            out.push(live);
    return out;
  }, [icon, canonical?.icon, sym]);

  const [idx, setIdx] = useState(0);
  const src       = sources[idx];
  const showImage = !!src;

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
          key={src} /* force a fresh <img> when we advance to the next source */
          src={src}
          alt={sym}
          width={size}
          height={size}
          onError={() => setIdx(i => i + 1)}
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
