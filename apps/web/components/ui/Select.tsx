'use client';
/**
 * Simple value dropdown (currency, language, lock-timeout, …).
 *
 * NATIVE <select> on purpose. This was a Radix portal-based dropdown, but the
 * app renders under `body { zoom: 1.25 }` on desktop (globals.css — a
 * deliberate 125% UI scale). Radix portals its panel into <body> and positions
 * it with floating-ui, which reads the trigger via getBoundingClientRect()
 * (already-zoomed pixels) and writes that back as an inline `left`/`top` — the
 * browser then multiplies those by the zoom AGAIN, so the panel drifted right
 * and down, further the closer the trigger sat to the right edge. A native
 * select's popup is rendered by the browser/OS, so it is immune to that math
 * (this is also what the desktop app uses, which is why it never had the bug).
 *
 * The `.settings-select` class was written for a native select all along —
 * `appearance: none` plus a CSS-drawn chevron and matching right padding.
 */
import React from 'react';

export interface SelectOption {
  /** Stored value */
  value: string;
  /** Optional display label — falls back to value */
  label?: string;
}

interface Props {
  value:    string;
  onChange: (v: string) => void;
  /** Either `string[]` (value === label) or `SelectOption[]`. */
  options:  Array<string | SelectOption>;
  ariaLabel?: string;
  /** Width override for the trigger. */
  width?:   React.CSSProperties['width'];
}

function normalize(opt: string | SelectOption): SelectOption {
  return typeof opt === 'string' ? { value: opt } : opt;
}

export function Select({ value, onChange, options, ariaLabel, width }: Props) {
  const opts = options.map(normalize);

  return (
    <select
      className="settings-select"
      aria-label={ariaLabel ?? 'Select option'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: width ?? '100%', textAlign: 'left' }}
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label ?? o.value}
        </option>
      ))}
    </select>
  );
}
