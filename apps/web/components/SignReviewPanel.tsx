'use client';
/**
 * Renders an sdk-core SignReview — what a dApp is asking the wallet to sign,
 * decoded (spender / token / amount / expiry, "you give / you get", …) — plus
 * its warnings. Used by the WalletConnect confirm sheet (WalletConnectHost).
 */
import React from 'react';
import { ShieldAlert, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { SignReview } from '@thanos/sdk-core';

const TONE: Record<SignReview['risk'], { bg: string; fg: string; border: string; Icon: React.ElementType }> = {
  safe:    { bg: 'rgba(16,185,129,0.08)', fg: 'var(--green)', border: 'rgba(16,185,129,0.35)', Icon: ShieldCheck },
  caution: { bg: 'rgba(245,158,11,0.10)', fg: 'var(--orange, #f59e0b)', border: 'rgba(245,158,11,0.40)', Icon: AlertTriangle },
  review:  { bg: 'rgba(239,68,68,0.10)', fg: 'var(--red)', border: 'rgba(239,68,68,0.45)', Icon: ShieldAlert },
  block:   { bg: 'rgba(239,68,68,0.14)', fg: 'var(--red)', border: 'rgba(239,68,68,0.60)', Icon: ShieldAlert },
};

export function SignReviewPanel({ review }: { review: SignReview }) {
  const tone = TONE[review.risk];
  const Icon = tone.Icon;
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, wordBreak: 'break-word', lineHeight: 1.4 }}>{review.title}</div>
      {review.rows.length > 0 && (
        <dl style={{
          margin: '10px 0 0', padding: '10px 12px', borderRadius: 10,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          display: 'grid', gridTemplateColumns: 'minmax(80px, auto) 1fr', gap: '6px 12px', fontSize: 12,
          maxHeight: 260, overflowY: 'auto',
        }}>
          {review.rows.map((r, i) => (
            <React.Fragment key={`${r.label}-${i}`}>
              <dt style={{ color: 'var(--text-muted)' }}>{r.label}</dt>
              <dd style={{
                margin: 0, wordBreak: 'break-all', whiteSpace: 'pre-wrap',
                color: r.tone === 'danger' ? 'var(--red)' : r.tone === 'warn' ? 'var(--orange, #f59e0b)' : 'var(--text-primary)',
                fontWeight: r.tone ? 700 : 500,
              }}>{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {review.warnings.length > 0 && (
        <div role="alert" style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, fontSize: 12, lineHeight: 1.45,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
            <Icon size={14}/> {review.risk === 'block' ? 'The wallet won’t sign this' : review.risk === 'review' ? 'High risk' : 'Check before signing'}
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {review.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
