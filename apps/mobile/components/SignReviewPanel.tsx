import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { SignReview } from '../lib/sign-review';

/**
 * Renders a SignReview (lib/sign-review.ts) in the approval sheets — the
 * in-app browser's and WalletConnect's: the decoded request (spender / token
 * / amount / expiry, "you give / you get") and its warnings.
 */
export interface ReviewPalette { text: string; sub: string; muted: string; card: string }

const TONE: Record<SignReview['risk'], { bg: string; fg: string; border: string; heading: string }> = {
  safe:    { bg: 'rgba(34,197,94,0.08)',   fg: '#22c55e', border: 'rgba(34,197,94,0.30)',   heading: 'Looks routine' },
  caution: { bg: 'rgba(245,158,11,0.10)',  fg: '#f59e0b', border: 'rgba(245,158,11,0.35)',  heading: 'Check before signing' },
  review:  { bg: 'rgba(248,113,113,0.10)', fg: '#f87171', border: 'rgba(248,113,113,0.45)', heading: 'High risk' },
  block:   { bg: 'rgba(248,113,113,0.14)', fg: '#f87171', border: '#f87171',                heading: 'The wallet won’t sign this' },
};

export function SignReviewPanel({ review, palette }: { review: SignReview; palette: ReviewPalette }) {
  const tone = TONE[review.risk];
  return (
    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: palette.text, lineHeight: 19 }}>{review.title}</Text>
      {review.rows.length > 0 && (
        <View style={{ backgroundColor: palette.card, borderRadius: 10, padding: 10, gap: 6 }}>
          {review.rows.map((r, i) => (
            <View key={`${r.label}-${i}`} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ width: 96, fontSize: 12, color: palette.muted }}>{r.label}</Text>
              <Text selectable style={{
                flex: 1, fontSize: 12, lineHeight: 16,
                color: r.tone === 'danger' ? '#f87171' : r.tone === 'warn' ? '#f59e0b' : palette.sub,
                fontWeight: r.tone ? '700' : '500',
              }}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}
      {review.warnings.length > 0 && (
        <View accessibilityRole="alert" style={{ backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border, borderRadius: 10, padding: 10, gap: 4 }}>
          <Text style={{ color: tone.fg, fontSize: 12, fontWeight: '700' }}>{tone.heading}</Text>
          {review.warnings.map((w, i) => <Text key={i} style={{ color: tone.fg, fontSize: 12, lineHeight: 17 }}>• {w}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}
