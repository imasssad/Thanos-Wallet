/**
 * /support — Thanos Wallet help & support.
 *
 * Public support page required by App Store (Guideline 1.5) and Google Play.
 * The App Store Connect "Support URL" must point here (https://thanos.fi/support)
 * — a functional page where users can find answers and request help.
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

const SUPPORT_EMAIL  = 'support@thanos.fi';
const SECURITY_EMAIL = 'security@thanos.fi';
const OPERATOR       = 'KaJ Labs';

export const metadata: Metadata = {
  title:       'Support — Thanos Wallet',
  description: 'Get help with Thanos Wallet: contact support, recover your wallet, add tokens, and read common questions. Maintained by KaJ Labs.',
  openGraph: {
    title:       'Support — Thanos Wallet',
    description: 'Help and contact for Thanos Wallet users.',
    url:         'https://thanos.fi/support',
    siteName:    'Thanos Wallet',
    type:        'website',
  },
  alternates: { canonical: 'https://thanos.fi/support' },
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 760, margin: '0 auto', padding: '64px 24px 96px',
  fontFamily: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Arial, sans-serif',
  color: '#e2e8f0', background: '#0b0d11', lineHeight: 1.65, fontSize: 15,
};
const h1: React.CSSProperties = { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 };
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 34, marginBottom: 10 };
const meta: React.CSSProperties = { color: '#94a3b8', fontSize: 13, marginBottom: 28 };
const hr: React.CSSProperties = { border: 'none', borderTop: '1px solid #1f2937', margin: '32px 0' };
const linkStyle: React.CSSProperties = { color: '#7dd3fc', textDecoration: 'none' };
const card: React.CSSProperties = {
  border: '1px solid #1f2937', background: '#0f141b', borderRadius: 12, padding: '18px 20px', margin: '14px 0',
};
const qStyle: React.CSSProperties = { fontWeight: 700, color: '#f1f5f9', marginBottom: 4 };
const aStyle: React.CSSProperties = { color: '#cbd5e1', margin: 0 };

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: 'How do I contact support?',
    a: <>Email <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>{SUPPORT_EMAIL}</a>. Include your device
       and app version (Settings → bottom of the screen) and a description of the issue. We typically reply
       within 1–2 business days.</>,
  },
  {
    q: 'I lost my phone / reinstalled — how do I recover my wallet?',
    a: <>Thanos is self-custodial: your funds live on-chain, not on our servers. Reinstall the app, choose
       <b> Import wallet</b>, and enter your 12- or 24-word recovery phrase. Anyone with that phrase controls
       the wallet, so never share it — our support team will never ask for it.</>,
  },
  {
    q: 'I forgot my wallet password.',
    a: <>The password only unlocks the app on this device; it cannot be reset because we never store it. Reset
       the wallet and re-import it with your recovery phrase, then set a new password.</>,
  },
  {
    q: 'A token I hold isn’t showing.',
    a: <>Balances refresh automatically from the network. Pull to refresh on the home screen. If a token still
       doesn’t appear, email us the token’s contract address and the network it’s on.</>,
  },
  {
    q: 'How do I report a security issue?',
    a: <>Please email <a href={`mailto:${SECURITY_EMAIL}`} style={linkStyle}>{SECURITY_EMAIL}</a> with details.
       Do not post exploit details publicly before we’ve had a chance to respond.</>,
  },
];

export default function SupportPage() {
  return (
    <main style={wrapStyle}>
      <h1 style={h1}>Support</h1>
      <p style={meta}>Thanos Wallet · maintained by {OPERATOR}</p>

      <p>
        Need help with Thanos Wallet? The fastest way to reach us is email —{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>{SUPPORT_EMAIL}</a>. We’re happy to answer questions
        about your wallet, transactions, supported networks, or anything else.
      </p>

      <h2 style={h2}>Contact us</h2>
      <div style={card}>
        <p style={{ margin: '0 0 6px' }}><b>General support:</b>{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>{SUPPORT_EMAIL}</a></p>
        <p style={{ margin: 0 }}><b>Security reports:</b>{' '}
          <a href={`mailto:${SECURITY_EMAIL}`} style={linkStyle}>{SECURITY_EMAIL}</a></p>
      </div>

      <h2 style={h2}>Frequently asked questions</h2>
      {FAQ.map((f, i) => (
        <div key={i} style={card}>
          <p style={qStyle}>{f.q}</p>
          <p style={aStyle}>{f.a}</p>
        </div>
      ))}

      <hr style={hr}/>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>
        See also our{' '}
        <Link href="/docs" style={linkStyle}>documentation</Link>,{' '}
        <Link href="/privacy" style={linkStyle}>privacy policy</Link>, and{' '}
        <Link href="/terms" style={linkStyle}>terms of service</Link>.
      </p>
    </main>
  );
}
