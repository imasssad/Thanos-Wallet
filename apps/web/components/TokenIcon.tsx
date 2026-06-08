'use client';
/**
 * Reactive token icon — Trust Wallet style.
 *
 * Two display modes:
 *   - Native coin of a chain (LITHO on Makalu, ETH on Ethereum, BNB on
 *     BSC, …): full coin icon, no chain badge.
 *   - Token on a chain (USDC on Ethereum, WBNB on BSC, …): token icon
 *     with a small chain-badge overlapping the bottom-right corner.
 *
 * Lithosphere ecosystem tokens (Makalu / Kamet chainIds) are treated as
 * native to "Lithosphere" so they render without a redundant LITHO
 * badge — per design spec.
 *
 * Resolution order for the main icon (each tried in turn, failures
 * fall through):
 *   1) Explicit `icon` prop (typically /images/tokens/{sym}.png — local,
 *      curated, fastest)
 *   2) Canonical TOKENS[sym].icon — same shape as above for known tokens
 *   3) CoinGecko live URL via getLogoUrl(sym) — covers ~10K mainstream
 *      tokens, lazily fetched at app boot via preloadTokenLogos()
 *   4) Letter fallback with the token's brand color — always works
 */
import React, { useEffect, useState } from 'react';
import { TOKEN_BY_SYM } from '../lib/tokens';
import { getLogoUrl, subscribeToLogoMap } from '../lib/token-logos';

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
  /** Chain id of the asset. When set and the asset is NOT native (and the
   *  chain isn't Lithosphere), a small chain-badge appears bottom-right. */
  chainId?: number;
  /** True when this row IS the chain's native coin (LITHO on Makalu, ETH
   *  on Ethereum, BNB on BSC, etc.). Suppresses the chain-badge. */
  native?: boolean;
}

/* ─── Chain-badge map ─────────────────────────────────────────────────
   Lithosphere chains (700777 Makalu, 900523 Kamet) are deliberately
   omitted so LEP100 tokens on Lithosphere render badge-less — per the
   design "besides LITHO ecosystem we have provided".
   ────────────────────────────────────────────────────────────────── */
interface BadgeSpec { url?: string; bg: string; letter: string }
const CHAIN_BADGE: Record<number, BadgeSpec> = {
  1:     { url: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',                       bg: '#627eea', letter: 'E' },
  56:    { url: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',                   bg: '#f3ba2f', letter: 'B' },
  137:   { url: 'https://assets.coingecko.com/coins/images/4713/large/polygon.png',                      bg: '#8247e5', letter: 'P' },
  43114: { url: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png', bg: '#e84142', letter: 'A' },
  // Ethereum L2s — no widely-recognised mini-logo on CoinGecko's CDN at
  // these sizes, so render the chain's letter on its brand colour.
  8453:  { bg: '#0052ff', letter: 'B' }, // Base
  42161: { bg: '#28a0f0', letter: 'A' }, // Arbitrum
  10:    { bg: '#ff0420', letter: 'O' }, // Optimism
  59144: { bg: '#61dfff', letter: 'L' }, // Linea
};

function ChainBadge({ chainId, size }: { chainId: number; size: number }) {
  const spec = CHAIN_BADGE[chainId];
  if (!spec) return null;
  const [failed, setFailed] = useState(false);
  return (
    <div style={{
      position: 'absolute',
      right: -2, bottom: -2,
      width: size, height: size,
      borderRadius: '50%',
      background: spec.bg,
      border: '2px solid var(--bg-card, #0e0e12)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#ffffff',
      fontSize: Math.max(7, Math.floor(size * 0.55)),
      fontWeight: 800,
      lineHeight: 1,
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      <span style={{ position: 'absolute' }}>{spec.letter}</span>
      {spec.url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spec.url}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

export function TokenIcon({
  sym, icon, color, size = 28, style, className,
  chainId, native,
}: Props) {
  const canonical = TOKEN_BY_SYM[sym];
  const bgColor   = color || canonical?.color || '#52525b';

  /* Re-evaluate when the live logo map updates. Without this, the
     useMemo below captures the initial state of the map and never
     refreshes, so a TokenIcon mounted before preloadTokenLogos resolves
     would stay on the letter avatar forever. */
  const [bumper, setBumper] = useState(0);
  useEffect(() => {
    return subscribeToLogoMap(() => setBumper(b => b + 1));
  }, []);

  /* Build the candidate source chain. We step through it on each <img>
     onError until we run out, at which point the letter avatar wins. */
  const sources = React.useMemo(() => {
    const out: string[] = [];
    if (icon)            out.push(icon);
    if (canonical?.icon) out.push(canonical.icon);
    const live = getLogoUrl(sym);
    if (live && !out.includes(live)) out.push(live);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icon, canonical?.icon, sym, bumper]);

  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [sources.length]);
  const src       = sources[idx];
  const showImage = !!src;

  // Lithosphere chains never get a badge (LITHO is the implicit
  // ecosystem and would just clutter every row).
  const isLithosphere = chainId === 700777 || chainId === 900523;
  const showBadge = !!chainId && !native && !isLithosphere && !!CHAIN_BADGE[chainId];
  const badgeSize = Math.max(12, Math.floor(size * 0.42));

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        background: bgColor,
        color: '#ffffff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.max(10, Math.floor(size * 0.42)),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        overflow: 'hidden',
      }}>
        {/* Letter fallback — always rendered underneath; covered when PNG loads. */}
        <span style={{ position: 'absolute' }}>{sym.charAt(0).toUpperCase()}</span>
        {showImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
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
      {showBadge && <ChainBadge chainId={chainId!} size={badgeSize} />}
    </div>
  );
}
