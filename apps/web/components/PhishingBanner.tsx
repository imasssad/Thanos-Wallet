'use client';
/**
 * Tiny banner that renders a phishing/safety verdict.
 *
 * Color-coded by risk so a single glance tells the user how alarmed to
 * be. Reasons render as bullet points beneath. Used by
 *   - WalletConnectModal (dApp origin)
 *   - SendModal           (recipient)
 *   - WalletConnectHost   (tx + typed-data confirm modal)
 */
import React from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, ShieldQuestion } from 'lucide-react';
import type { Verdict, Risk } from '../lib/phishing';

const STYLE: Record<Risk, { bg: string; fg: string; border: string; Icon: React.ElementType; title: string }> = {
  safe:     {
    bg:     'rgba(16,185,129,0.10)',
    fg:     'var(--green)',
    border: 'rgba(16,185,129,0.40)',
    Icon:   ShieldCheck,
    title:  'Looks safe',
  },
  unknown:  {
    bg:     'rgba(148,148,170,0.10)',
    fg:     'var(--text-secondary)',
    border: 'var(--border-default)',
    Icon:   ShieldQuestion,
    title:  'Unknown — verify yourself',
  },
  warning:  {
    bg:     'rgba(245,158,11,0.10)',
    fg:     'var(--orange, #f59e0b)',
    border: 'rgba(245,158,11,0.40)',
    Icon:   AlertTriangle,
    title:  'Caution',
  },
  critical: {
    bg:     'rgba(239,68,68,0.10)',
    fg:     'var(--red)',
    border: 'rgba(239,68,68,0.45)',
    Icon:   ShieldAlert,
    title:  'High risk — likely scam',
  },
};

export function PhishingBanner({
  verdict, title, compact, hideSafe,
}: {
  verdict:  Verdict;
  /** Override the default heading copy. */
  title?:   string;
  /** Tighter padding for inline use under an input. */
  compact?: boolean;
  /** If true, render nothing when the verdict is `safe`. */
  hideSafe?: boolean;
}) {
  if (hideSafe && verdict.risk === 'safe') return null;
  const s = STYLE[verdict.risk];
  const Icon = s.Icon;

  return (
    <div
      role={verdict.risk === 'critical' ? 'alert' : 'status'}
      style={{
        display:        'flex',
        gap:            8,
        padding:        compact ? '8px 10px' : '12px 14px',
        marginTop:      compact ? 6 : 12,
        background:     s.bg,
        border:         `1px solid ${s.border}`,
        borderRadius:   10,
        fontSize:       12,
        color:          'var(--text-primary)',
        lineHeight:     1.45,
      }}
    >
      <Icon size={16} color={s.fg} style={{ flexShrink: 0, marginTop: 1 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: s.fg }}>{title ?? s.title}</div>
        <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
          {verdict.reasons.map((r, i) => (
            <li key={i} style={{ marginTop: i === 0 ? 0 : 3 }}>• {r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
