/**
 * /privacy — Thanos Wallet privacy policy.
 *
 * Source of truth is `docs/Thanos_Wallet_Privacy_Policy.docx` (the
 * KaJ Labs–maintained canonical). When the docx changes, mirror the
 * change here AND in `docs/privacy-policy.md`.
 *
 * Public URL required by App Store + Google Play submission reviewers.
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

const EFFECTIVE_DATE = 'June 2026';
const BRAND_DOMAIN   = 'ThanosWallet.ai';
const OPERATOR       = 'KaJ Labs';
const SUPPORT_EMAIL  = 'support@thanos.fi';

export const metadata: Metadata = {
  title:       'Privacy Policy — Thanos Wallet',
  description:
    'What data Thanos Wallet collects, how we use it, and how your keys and seed phrase are stored. Maintained by KaJ Labs.',
  openGraph: {
    title:       'Privacy Policy — Thanos Wallet',
    description: 'Self-custodial wallet privacy policy. Maintained by KaJ Labs.',
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
const linkStyle: React.CSSProperties = { color: '#7dd3fc', textDecoration: 'none' };
const calloutStyle: React.CSSProperties = {
  borderLeft:  '3px solid #38bdf8',
  background:  'rgba(56,189,248,0.06)',
  padding:     '12px 16px',
  borderRadius: 8,
  margin:      '12px 0 24px',
  color:       '#cbd5e1',
};

export default function PrivacyPolicyPage() {
  return (
    <main style={{ background: '#0b0d11', minHeight: '100vh' }}>
      <article style={wrapStyle}>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={meta}>
          <strong>Effective date:</strong> {EFFECTIVE_DATE} &nbsp;·&nbsp;{' '}
          <strong>{BRAND_DOMAIN}</strong> &nbsp;·&nbsp;{' '}
          Maintained by {OPERATOR}
        </p>

        <p>
          Thanos Wallet is a self-custodial, multi-chain cryptocurrency wallet. This policy explains what
          information we collect, why we collect it, and how we use it. We have written it to be read by a
          person, not a lawyer.
        </p>
        <div style={calloutStyle}>
          The short version: your private keys and seed phrase never leave your device. We do not sell your
          data. We collect only what we need to make the wallet work.
        </div>

        <h2 style={h2}>1. What We Collect</h2>

        <h3 style={h3}>Information you provide</h3>
        <ul>
          <li>
            Email address and password, if you create an account on the Thanos backend. Your password is
            hashed with Argon2id before storage and is never readable by us.
          </li>
          <li>Wallet name and address book contacts you choose to save and sync across devices.</li>
          <li>DNNS names you register or resolve through the wallet.</li>
        </ul>

        <h3 style={h3}>Information collected automatically</h3>
        <ul>
          <li>
            On-chain data: wallet addresses, transaction hashes, token balances, and block events. This data
            is public on the blockchain by its nature.
          </li>
          <li>
            Device session data: device type, platform (iOS, Android, web, desktop, extension), and session
            tokens used to keep you logged in securely.
          </li>
          <li>
            Error and crash reports via Sentry, which may include the app version, device OS, and stack
            trace. Crash reports do not include your seed phrase, private keys, or wallet balances.
          </li>
          <li>
            Basic usage metrics: which features are used and how frequently, to help us improve the app.
            This data is aggregated and not tied to your identity.
          </li>
        </ul>

        <h3 style={h3}>What we never collect</h3>
        <ul>
          <li>
            Your seed phrase or private keys. These are generated on your device, encrypted with your own
            password, and stored only on your device. They are never transmitted to our servers.
          </li>
          <li>The contents of transactions you have not yet broadcast.</li>
          <li>Your location.</li>
          <li>Any data from websites you visit outside of the wallet.</li>
        </ul>

        <h2 style={h2}>2. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>
            Run the wallet and keep it secure, including authenticating your account, syncing contacts, and
            resolving names.
          </li>
          <li>
            Index token balances and transaction history from public blockchain data so your portfolio stays
            up to date.
          </li>
          <li>Detect and fix bugs using crash reports and error logs.</li>
          <li>Improve the wallet based on aggregate usage patterns.</li>
          <li>Communicate with you about important security updates if you have provided an email address.</li>
        </ul>
        <p>
          <strong>
            We do not use your information to show you advertisements. We do not sell your data to third
            parties. We do not use your data to train AI models.
          </strong>
        </p>

        <h2 style={h2}>3. How Your Keys and Seed Phrase Are Stored</h2>
        <p>Thanos Wallet is non-custodial. This means:</p>
        <ul>
          <li>
            Your seed phrase is shown to you once during wallet creation. After that, it is encrypted on
            your device using a key derived from your password via Argon2id. The encrypted vault is stored
            in your device&apos;s secure storage (Keychain on iOS, Keystore on Android, OS vault on
            desktop, encrypted localStorage on web).
          </li>
          <li>
            We cannot recover your seed phrase if you forget your password. There is no &ldquo;forgot
            password&rdquo; for the seed. Keep your seed phrase written down somewhere safe.
          </li>
          <li>
            If you enable cloud sync, only encrypted vault data is synced. The encryption key is derived
            from your password and is never sent to our servers.
          </li>
        </ul>

        <h2 style={h2}>4. Third-Party Services</h2>
        <p>The wallet interacts with the following external services:</p>
        <ul>
          <li>
            <strong>Blockchain RPC nodes</strong> (rpc.litho.ai, rpc-2.litho.ai, rpc-3.litho.ai, public
            Ethereum/Solana/Bitcoin nodes): used to read balances and broadcast transactions. These
            services receive your wallet address and transaction data as part of normal blockchain
            operation.
          </li>
          <li>
            <strong>CoinGecko</strong>: used to fetch token prices. Requests do not include your wallet
            address or identity.
          </li>
          <li>
            <strong>bridge.litho.ai</strong>: used for cross-chain bridge operations. Transaction details
            are shared only when you initiate a bridge.
          </li>
          <li>
            <strong>Sentry</strong>: used for crash reporting. See Section 1 for what is included.
          </li>
          <li>
            <strong>WalletConnect</strong> (Reown relay): used to connect the wallet to decentralised
            applications. Session metadata is relayed through Reown&apos;s infrastructure.
          </li>
        </ul>
        <p>
          We are not responsible for the privacy practices of these third parties. We recommend reviewing
          their policies if you have concerns.
        </p>

        <h2 style={h2}>5. Data Retention</h2>
        <ul>
          <li>
            Account data (email, hashed password, device sessions): retained while your account is active.
            You can delete your account at any time from Settings, which removes all server-side data.
          </li>
          <li>
            Blockchain index data (balances, transaction history): retained to power your portfolio view.
            This data is derived from public blockchain records.
          </li>
          <li>Crash reports: retained for 90 days.</li>
          <li>Usage metrics: retained in aggregate for up to 12 months.</li>
        </ul>

        <h2 style={h2}>6. Your Rights</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, or delete the personal
          data we hold about you. To exercise any of these rights, contact us at the address in Section 9.
        </p>
        <ul>
          <li><strong>Access:</strong> you can request a copy of the data we hold about your account.</li>
          <li>
            <strong>Correction:</strong> you can update your email address from Settings at any time.
          </li>
          <li>
            <strong>Deletion:</strong> you can delete your account and all associated server-side data from
            Settings. On-chain data is public and cannot be deleted.
          </li>
          <li>
            <strong>Portability:</strong> you can export your address book and transaction history from
            Settings.
          </li>
          <li>
            <strong>Objection:</strong> you can opt out of usage metric collection from Settings &gt; Privacy.
          </li>
        </ul>

        <h2 style={h2}>7. Security</h2>
        <p>We take security seriously. Key measures include:</p>
        <ul>
          <li>All data in transit is encrypted with TLS 1.3.</li>
          <li>Passwords are hashed with Argon2id (t=3, m=64MB, p=4) before storage.</li>
          <li>
            Authentication tokens use short-lived JWTs (15 minutes) with rotating refresh tokens.
          </li>
          <li>Rate limiting is enforced on all authentication endpoints.</li>
          <li>
            Private keys and seed phrases are never transmitted to our servers under any circumstances.
          </li>
          <li>We conduct regular dependency audits and maintain a security incident runbook.</li>
        </ul>
        <p>
          No system is perfectly secure. If you discover a vulnerability, please report it responsibly to
          our security contact before disclosing it publicly.
        </p>

        <h2 style={h2}>8. Children</h2>
        <p>
          Thanos Wallet is not intended for use by anyone under the age of 18. We do not knowingly collect
          personal information from children. If you believe a child has provided us with personal
          information, please contact us and we will delete it promptly.
        </p>

        <h2 style={h2}>9. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. When we do, we will update the effective date at the
          top of this page and, for significant changes, notify users who have provided an email address.
          Continued use of the wallet after changes are posted constitutes acceptance of the updated
          policy.
        </p>

        <h2 style={h2}>10. Contact</h2>
        <p>
          If you have questions about this policy or want to exercise your data rights, you can reach us
          at:
        </p>
        <ul>
          <li>Thanos Wallet by {OPERATOR}</li>
          <li>Website: {BRAND_DOMAIN}</li>
          <li>
            Support:{' '}
            <a style={linkStyle} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </li>
        </ul>

        <hr style={hr}/>
        <p style={{ fontSize: 14, color: '#cbd5e1', fontStyle: 'italic' }}>
          Thanos Wallet is self-custodial. Your keys, your crypto.
        </p>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 24 }}>
          <Link href="/" style={linkStyle}>← Back to thanos.fi</Link>
        </p>
      </article>
    </main>
  );
}
