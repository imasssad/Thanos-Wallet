/**
 * /privacy — Thanos Wallet privacy policy.
 *
 * Public URL required by App Store + Google Play submissions. The
 * canonical source is `docs/privacy-policy.md` in the repo; this page
 * is a faithful HTML render so anything material here also lives there
 * and goes through the same PR review.
 *
 * Effective date kept in one place (top of this file) so a single
 * line edit + commit updates both the page and the lockup in the
 * page metadata.
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

const EFFECTIVE_DATE = '2026-05-25';
const CONTACT_EMAIL  = 'devs@thanos.fi';
const SECURITY_EMAIL = 'security@thanos.fi';

export const metadata: Metadata = {
  title:       'Privacy Policy — Thanos Wallet',
  description:
    'What data Thanos Wallet handles, where it goes, and what control you have over it. Required by App Store + Google Play submissions.',
  openGraph: {
    title:       'Privacy Policy — Thanos Wallet',
    description: 'What data Thanos Wallet handles and where it goes.',
    url:         'https://thanos.fi/privacy',
    siteName:    'Thanos Wallet',
    type:        'article',
  },
  alternates: { canonical: 'https://thanos.fi/privacy' },
};

const wrapStyle: React.CSSProperties = {
  maxWidth:    760,
  margin:      '0 auto',
  padding:     '64px 24px 96px',
  fontFamily:  '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Arial, sans-serif',
  color:       '#e2e8f0',
  background:  '#0b0d11',
  lineHeight:  1.65,
  fontSize:    15,
};

const h1: React.CSSProperties = { fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 };
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 8 };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginTop: 20, marginBottom: 6 };
const meta: React.CSSProperties = { color: '#94a3b8', fontSize: 13, marginBottom: 32 };
const hr: React.CSSProperties = { border: 'none', borderTop: '1px solid #1f2937', margin: '32px 0' };
const codeStyle: React.CSSProperties = {
  background:  '#111827',
  border:      '1px solid #1f2937',
  borderRadius: 6,
  padding:     '1px 6px',
  fontFamily:  'ui-monospace, SF Mono, Consolas, Menlo, monospace',
  fontSize:    13,
};
const tableStyle: React.CSSProperties = {
  width:        '100%',
  borderCollapse: 'collapse',
  margin:       '16px 0',
  fontSize:     14,
};
const tdStyle: React.CSSProperties = { borderBottom: '1px solid #1f2937', padding: '10px 12px', verticalAlign: 'top' };
const thStyle: React.CSSProperties = { ...tdStyle, fontWeight: 700, color: '#cbd5e1', borderBottom: '1px solid #334155' };
const linkStyle: React.CSSProperties = { color: '#7dd3fc', textDecoration: 'none' };

function Code({ children }: { children: React.ReactNode }) { return <code style={codeStyle}>{children}</code>; }

export default function PrivacyPolicyPage() {
  return (
    <main style={{ background: '#0b0d11', minHeight: '100vh' }}>
      <article style={wrapStyle}>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={meta}>
          <strong>Effective date:</strong> {EFFECTIVE_DATE}<br/>
          <strong>Operator:</strong> Thanos Wallet<br/>
          <strong>Contact:</strong>{' '}
          <a style={linkStyle} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>

        <p>
          This document explains what data Thanos Wallet handles, where it goes, and what control you have over
          it. It applies to every Thanos client: the browser extension (Chrome / Brave / Firefox / Safari), the
          desktop app (macOS / Windows), the mobile app (iOS / Android), and the web wallet at{' '}
          <a style={linkStyle} href="https://thanos.fi">thanos.fi</a>.
        </p>
        <p>
          We wrote this to be a real description of what the software actually does, not a generic template. If
          anything below is inaccurate, file an issue at{' '}
          <a style={linkStyle} href="https://github.com/imasssad/Thanos-Wallet/issues">github.com/imasssad/Thanos-Wallet/issues</a>{' '}
          — we&apos;ll fix it.
        </p>

        <hr style={hr}/>

        <h2 style={h2}>TL;DR</h2>
        <ul>
          <li>We don&apos;t run a custodial service. We never see your seed phrase.</li>
          <li>We don&apos;t sell, share, or build advertising profiles from your data.</li>
          <li>We don&apos;t include any third-party analytics SDKs (no Google Analytics, no Facebook SDK, no
            Mixpanel, no Amplitude).</li>
          <li>The only data that leaves your device is what&apos;s strictly necessary to look at the blockchain:
            public addresses, transaction hashes, contract call data — exactly what&apos;s published on-chain
            anyway.</li>
          <li>An optional cloud-sync feature (address book + DNNS cache) requires you to sign in with an email
            + password. The contents are encrypted on your device before they&apos;re uploaded.</li>
        </ul>

        <hr style={hr}/>

        <h2 style={h2}>1. Data we DO NOT handle</h2>
        <p>To make the boundary clear:</p>
        <ul>
          <li>
            <strong>Your seed phrase</strong> — generated on your device, encrypted with a key derived from your
            password (Argon2id), stored in the OS keychain (Keychain on iOS, EncryptedSharedPreferences +
            KeyStore on Android, Credential Manager on Windows, Keychain on macOS, IndexedDB on web). It never
            crosses the network in any form.
          </li>
          <li>
            <strong>Your password</strong> — only the password&apos;s Argon2id-derived encryption key ever
            exists outside your typing. The password itself is never stored, transmitted, or logged.
          </li>
          <li>
            <strong>Your private keys</strong> — derived on the fly from the seed inside an isolated signing
            context (Worker on web, offscreen document on extension, main process on desktop, module-private
            scope on mobile). They never appear in any error report, breadcrumb, or log line.
          </li>
          <li>
            <strong>Behavioural analytics</strong> — we don&apos;t ship any third-party SDK that records clicks,
            scrolls, time-on-page, or session replays.
          </li>
        </ul>

        <h2 style={h2}>2. Data sent directly from your device</h2>
        <p>
          When you use the wallet, the app talks to several public services on your behalf. Each request
          includes your wallet address (this is public on-chain anyway) and whatever&apos;s needed to fulfil it.
          We don&apos;t proxy these — they go straight from your device to the third party.
        </p>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Service</th><th style={thStyle}>What we send</th><th style={thStyle}>Purpose</th></tr></thead>
          <tbody>
            <tr><td style={tdStyle}>Lithosphere RPC (<Code>rpc.litho.ai</Code>, <Code>rpc-2.litho.ai</Code>)</td><td style={tdStyle}>Your wallet address; signed transactions</td><td style={tdStyle}>Read balances, send transactions on Makalu</td></tr>
            <tr><td style={tdStyle}>Lithosphere Kamet RPC (<Code>rpc.kamet.litho.ai</Code>, <Code>rpc-3.litho.ai</Code>)</td><td style={tdStyle}>Your wallet address; signed transactions</td><td style={tdStyle}>Read balances and send on Kamet; DNNS resolution</td></tr>
            <tr><td style={tdStyle}>Bitcoin (<Code>mempool.space</Code>)</td><td style={tdStyle}>Your BTC address; raw transaction hex</td><td style={tdStyle}>Read BTC balance + UTXOs, broadcast sends</td></tr>
            <tr><td style={tdStyle}>Ethereum / EVM RPCs (configurable)</td><td style={tdStyle}>Your EVM address; signed transactions</td><td style={tdStyle}>Read balances, send transactions</td></tr>
            <tr><td style={tdStyle}>Solana RPC (<Code>api.mainnet-beta.solana.com</Code>)</td><td style={tdStyle}>Your SOL address; signed transactions</td><td style={tdStyle}>Read SOL/SPL balances, send transactions</td></tr>
            <tr><td style={tdStyle}>Cosmos REST LCD (<Code>cosmos-rest.publicnode.com</Code>)</td><td style={tdStyle}>Your Cosmos address; signed transactions</td><td style={tdStyle}>Read ATOM balance, send transactions</td></tr>
            <tr><td style={tdStyle}>MultX bridge (<Code>bridge.litho.ai</Code>)</td><td style={tdStyle}>Source token, destination token, amount</td><td style={tdStyle}>Cross-chain swap quotes + execution</td></tr>
            <tr><td style={tdStyle}>Ignite DEX (<Code>ignite.litho.ai</Code>)</td><td style={tdStyle}>Token pair, amount</td><td style={tdStyle}>Same-chain swap quotes + execution</td></tr>
            <tr><td style={tdStyle}>WalletConnect relay (<Code>relay.walletconnect.com</Code>)</td><td style={tdStyle}>Encrypted dApp pairing payloads</td><td style={tdStyle}>dApp connectivity (relay can&apos;t decrypt the payloads)</td></tr>
            <tr><td style={tdStyle}>CoinGecko (<Code>api.coingecko.com</Code>)</td><td style={tdStyle}>Token symbols only</td><td style={tdStyle}>Spot prices for the dashboard</td></tr>
          </tbody>
        </table>
        <p>
          Each request goes over HTTPS or WSS. You can override the Lithosphere RPC + Ethereum RPC URLs in
          Settings; pointing at your own node bypasses the public services entirely.
        </p>

        <h2 style={h2}>3. Data sent to the Thanos backend (<Code>thanos.fi/api</Code>)</h2>
        <p>
          The backend is the <em>optional</em> cloud-sync layer. None of the wallet&apos;s core functionality
          (create / unlock / send / receive / sign) requires it. When you sign in, the following endpoints
          become available:
        </p>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Endpoint</th><th style={thStyle}>What we receive</th><th style={thStyle}>Why</th></tr></thead>
          <tbody>
            <tr><td style={tdStyle}><Code>POST /auth/register</Code></td><td style={tdStyle}>Email, password (Argon2id-hashed on the server), display name</td><td style={tdStyle}>Create an account so address book + DNNS records sync across devices</td></tr>
            <tr><td style={tdStyle}><Code>POST /auth/login</Code></td><td style={tdStyle}>Email, password</td><td style={tdStyle}>Issue an access + refresh token pair</td></tr>
            <tr><td style={tdStyle}><Code>GET  /contacts</Code></td><td style={tdStyle}>(auth required)</td><td style={tdStyle}>Return your encrypted contacts</td></tr>
            <tr><td style={tdStyle}><Code>POST /contacts</Code></td><td style={tdStyle}>Ciphertext blob for <Code>name</Code> + <Code>notes</Code>, plaintext wallet address</td><td style={tdStyle}>Store a contact you saved</td></tr>
            <tr><td style={tdStyle}><Code>GET  /dnns/resolve?name=…</Code></td><td style={tdStyle}>A DNNS name</td><td style={tdStyle}>Cache the on-chain owner of a name</td></tr>
            <tr><td style={tdStyle}><Code>GET  /portfolio/:address</Code></td><td style={tdStyle}>A wallet address</td><td style={tdStyle}>Aggregate balances across chains</td></tr>
            <tr><td style={tdStyle}><Code>POST /push/register</Code></td><td style={tdStyle}>Expo / FCM push token, wallet address</td><td style={tdStyle}>Notify you when funds arrive (mobile only)</td></tr>
          </tbody>
        </table>
        <p>
          The contact <Code>name</Code> and <Code>notes</Code> fields are encrypted on your device (AES-256-GCM,
          key derived from your seed via HKDF-SHA256) before the bytes leave. The server only sees opaque
          ciphertext for those two fields — a DBA dump won&apos;t reveal who&apos;s in your address book. The
          wallet address itself is stored plaintext (the server deduplicates on it; it&apos;s public on-chain
          regardless).
        </p>

        <h2 style={h2}>4. Error reports (when enabled)</h2>
        <p>
          If the operator running this Thanos instance has set <Code>SENTRY_DSN</Code>, the backend services
          (api, indexer, worker) and optionally the web client will send crash reports to Sentry. Before any
          event is sent, we recursively strip any key matching the regex{' '}
          <Code>/mnemonic|password|seed|private[_-]?key|vault|session[_-]?key|authorization|token/i</Code> from
          the event body, breadcrumbs, and tags. Stack traces, request URLs, and timing data still travel.
        </p>
        <p>
          For the public thanos.fi instance, Sentry is enabled. To opt out entirely, run the wallet against
          your own deployment or block the relevant Sentry ingestion domain in your browser/firewall.
        </p>

        <h2 style={h2}>5. Cookies + local storage</h2>
        <table style={tableStyle}>
          <thead><tr><th style={thStyle}>Storage</th><th style={thStyle}>What we put there</th></tr></thead>
          <tbody>
            <tr><td style={tdStyle}><Code>localStorage</Code> (web + extension + desktop renderer)</td><td style={tdStyle}>Encrypted vault, theme preference, active-account index, address-book cache, token-logo cache, custom RPC URL</td></tr>
            <tr><td style={tdStyle}><Code>sessionStorage</Code> (web only)</td><td style={tdStyle}>Argon2id-derived AES key while a tab is open — wiped on tab close</td></tr>
            <tr><td style={tdStyle}><Code>AsyncStorage</Code> (mobile)</td><td style={tdStyle}>Same as localStorage for mobile-specific equivalents</td></tr>
            <tr><td style={tdStyle}>iOS Keychain / Android KeyStore</td><td style={tdStyle}>The encrypted vault, biometric-unlock token</td></tr>
            <tr><td style={tdStyle}><Code>IndexedDB</Code></td><td style={tdStyle}>Token-logo blob cache (optional)</td></tr>
            <tr><td style={tdStyle}>HTTP cookies</td><td style={tdStyle}>None. We use bearer tokens in <Code>Authorization</Code> headers, not cookies.</td></tr>
          </tbody>
        </table>

        <h2 style={h2}>6. Children</h2>
        <p>
          The wallet is not directed at users under 13. If you become aware that a child under 13 has provided
          us with personal information, contact us at{' '}
          <a style={linkStyle} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will delete the account.
        </p>

        <h2 style={h2}>7. Your rights</h2>
        <p>If you have an account on the cloud-sync layer:</p>
        <ul>
          <li>
            <strong>Access.</strong> <Code>GET /auth/me</Code> returns everything we have associated with you.
            The mobile app surfaces this in Settings → Account.
          </li>
          <li>
            <strong>Deletion.</strong> <Code>DELETE /auth/account</Code> wipes your account, every contact, and
            every cached DNNS record. The token at the moment of deletion is also revoked. This is irreversible.
          </li>
          <li>
            <strong>Export.</strong> <Code>GET /contacts</Code> returns your contacts in JSON. Decrypt the{' '}
            <Code>name</Code> + <Code>notes</Code> fields client-side with your seed-derived key.
          </li>
        </ul>
        <p>You don&apos;t need an account to use the wallet. Skipping sign-in skips this entire section.</p>

        <h2 style={h2}>8. Security incidents</h2>
        <p>
          If we discover that user data has been disclosed without authorisation, we will publish an incident
          report at <a style={linkStyle} href="https://thanos.fi/security">thanos.fi/security</a> within seven
          days of confirming the scope, including:
        </p>
        <ul>
          <li>What data was disclosed</li>
          <li>How many users were affected</li>
          <li>What we&apos;ve changed to prevent recurrence</li>
        </ul>
        <p>Material incidents are pushed via the wallet&apos;s in-app notification.</p>

        <h2 style={h2}>9. Changes to this policy</h2>
        <p>
          We&apos;ll update the <strong>Effective date</strong> at the top of this document when we change
          anything material. The git history at{' '}
          <a style={linkStyle} href="https://github.com/imasssad/Thanos-Wallet/commits/main/docs/privacy-policy.md">github.com/imasssad/Thanos-Wallet/commits/main/docs/privacy-policy.md</a>{' '}
          is the canonical changelog.
        </p>

        <h2 style={h2}>10. Contact</h2>
        <ul>
          <li>
            <strong>General questions:</strong>{' '}
            <a style={linkStyle} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </li>
          <li>
            <strong>Security disclosures:</strong>{' '}
            <a style={linkStyle} href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>{' '}
            (PGP key at{' '}
            <a style={linkStyle} href="https://thanos.fi/.well-known/security.txt">thanos.fi/.well-known/security.txt</a>)
          </li>
        </ul>

        <hr style={hr}/>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          <Link href="/" style={linkStyle}>← Back to thanos.fi</Link>
        </p>
      </article>
    </main>
  );
}
