'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Shrinks its text's font-size so it ALWAYS fits the parent's width on a single
 * line — used for the balance hero, which must render any magnitude (cents to
 * quintillions) without overflowing or wrapping.
 *
 * Width scales linearly with font-size for fixed text, so one proportional pass
 * (`max × available/needed`) lands the exact fitting size; clamped to [min,max]
 * with a small safety margin. Re-fits when the text or the container resizes.
 */
export function FitText({
  children,
  max,
  min = 20,
  style,
}: {
  children: string;
  max: number;
  min?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const fit = () => {
      el.style.fontSize = `${max}px`;          // measure at the largest size
      const available = parent.clientWidth;
      const needed = el.scrollWidth;
      const next =
        needed > 0 && needed > available
          ? Math.max(min, Math.floor((max * available * 0.97) / needed))
          : max;
      el.style.fontSize = `${next}px`;
      setSize(next);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [children, max, min]);

  return (
    <span
      ref={ref}
      style={{
        ...style,
        fontSize: size,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        maxWidth: '100%',
      }}
    >
      {children}
    </span>
  );
}
