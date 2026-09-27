/**
 * Renders an sdk-core SignReview in the popup's approval sheets (dApp
 * requests and WalletConnect): the decoded request — spender / token / amount
 * / expiry, "you give / you get" — and its warnings.
 */
import React from 'react';
import type { SignReview } from '@thanos/sdk-core';

const TONE: Record<SignReview['risk'], { bg: string; fg: string; border: string; heading: string }> = {
  safe:    { bg: 'rgba(34,197,94,0.08)',  fg: '#22c55e', border: 'rgba(34,197,94,0.30)',  heading: 'Looks routine' },
  caution: { bg: 'rgba(245,158,11,0.10)', fg: '#f59e0b', border: 'rgba(245,158,11,0.35)', heading: 'Check before signing' },
  review:  { bg: 'rgba(248,113,113,0.10)', fg: '#f87171', border: 'rgba(248,113,113,0.45)', heading: 'High risk' },
  block:   { bg: 'rgba(248,113,113,0.14)', fg: '#f87171', border: '#f87171',               heading: 'The wallet won’t sign this' },
};

export function SignReviewPanel({ review }: { review: SignReview }) {
  const tone = TONE[review.risk];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.35 }}>{review.title}</div>
      {review.rows.length > 0 && (
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 8, padding: 10, maxHeight: 190, overflowY: 'auto',
          display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr', gap: '5px 10px', fontSize: 11.5,
        }}>
          {review.rows.map((r, i) => (
            <React.Fragment key={`${r.label}-${i}`}>
              <div style={{ color: 'var(--text-muted)' }}>{r.label}</div>
              <div style={{
                wordBreak: 'break-all', whiteSpace: 'pre-wrap',
                color: r.tone === 'danger' ? '#f87171' : r.tone === 'warn' ? '#f59e0b' : 'var(--text-secondary)',
                fontWeight: r.tone ? 700 : 500,
              }}>{r.value}</div>
            </React.Fragment>
          ))}
        </div>
      )}
      {review.warnings.length > 0 && (
        <div role="alert" style={{
          padding: 10, borderRadius: 8, background: tone.bg, border: `1px solid ${tone.border}`,
          color: tone.fg, fontSize: 11.5, lineHeight: 1.4,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{tone.heading}</div>
          {review.warnings.map((w, i) => <div key={i} style={{ marginTop: i ? 4 : 0 }}>• {w}</div>)}
        </div>
      )}
    </div>
  );
}
