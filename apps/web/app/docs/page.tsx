/**
 * /docs — public developer docs for the Thanos SDK ("Sign in with Thanos").
 *
 * Mirrors packages/connect/README.md (the canonical source). When the README
 * changes, update this page too. Self-contained (no markdown dep, no runtime
 * file reads — safe under Next `output: standalone`).
 */
import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title:       'Developer Docs — Thanos Wallet SDK',
  description:
    'Add "Sign in with Thanos" to your dApp in minutes. EIP-6963 discovery, SIWE message + signature, and a session token — one class, one method.',
  openGraph: {
    title:       'Thanos Wallet — Developer Docs',
    description: 'Drop-in "Sign in with Thanos" for any dApp. thanos-connect SDK.',
    url:         'https://thanos.fi/docs',
    siteName:    'Thanos Wallet',
    type:        'article',
  },
  alternates: { canonical: 'https://thanos.fi/docs' },
};

const page: React.CSSProperties = { background: '#0b0d11', minHeight: '100vh', color: '#e2e8f0' };
const wrap: React.CSSProperties = {
  maxWidth: 820, margin: '0 auto', padding: '56px 24px 110px',
  fontFamily: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Arial, sans-serif',
  lineHeight: 1.65, fontSize: 15,
};
const h1: React.CSSProperties = { fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 6px' };
const lede: React.CSSProperties = { color: '#94a3b8', fontSize: 16, marginBottom: 28 };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, marginTop: 44, marginBottom: 10, letterSpacing: '-0.01em' };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginTop: 26, marginBottom: 6, color: '#e2e8f0' };
const p: React.CSSProperties = { margin: '8px 0 14px', color: '#cbd5e1' };
const hr: React.CSSProperties = { border: 'none', borderTop: '1px solid #1f2937', margin: '40px 0' };
const link: React.CSSProperties = { color: '#7dd3fc', textDecoration: 'none' };
const li: React.CSSProperties = { margin: '4px 0', color: '#cbd5e1' };
const code: React.CSSProperties = {
  background: '#0f1218', border: '1px solid #1f2937', borderRadius: 10,
  padding: '14px 16px', overflowX: 'auto', fontSize: 13, lineHeight: 1.6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  color: '#cbd5e1', margin: '10px 0 22px', whiteSpace: 'pre',
};
const kbd: React.CSSProperties = {
  background: 'rgba(148,163,184,0.12)', borderRadius: 5, padding: '1px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.92em', color: '#e2e8f0',
};
const callout: React.CSSProperties = {
  borderLeft: '3px solid #38bdf8', background: 'rgba(56,189,248,0.06)',
  padding: '12px 16px', borderRadius: 8, margin: '14px 0 24px', color: '#cbd5e1', fontSize: 14,
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '8px 0 22px', fontSize: 13.5 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #1f2937', color: '#94a3b8', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #161b22', color: '#cbd5e1', verticalAlign: 'top' };

/* ── Header ── */
const headerBar: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 10,
  background: 'rgba(11,13,17,0.85)', backdropFilter: 'blur(10px)',
  borderBottom: '1px solid #1a1f2b',
};
const headerInner: React.CSSProperties = {
  maxWidth: 980, margin: '0 auto', padding: '12px 24px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
};
const brand: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: '#fff' };
const brandWord: React.CSSProperties = { fontWeight: 800, letterSpacing: '0.04em', fontSize: 15 };
const brandTag: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#7dd3fc', background: 'rgba(125,211,252,0.10)', border: '1px solid rgba(125,211,252,0.25)', borderRadius: 6, padding: '1px 7px' };
const headerNav: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' };
const navLink: React.CSSProperties = { color: '#cbd5e1', textDecoration: 'none', fontSize: 13.5, fontWeight: 600 };

/* ── Footer ── */
const footerBar: React.CSSProperties = { borderTop: '1px solid #1a1f2b', background: '#090b0e', marginTop: 40 };
const footerInner: React.CSSProperties = {
  maxWidth: 980, margin: '0 auto', padding: '28px 24px 40px',
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
};
const footNav: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 18 };
const footLink: React.CSSProperties = { color: '#94a3b8', textDecoration: 'none', fontSize: 13 };

function Code({ children }: { children: string }) {
  return <pre style={code}><code>{children}</code></pre>;
}

export default function DocsPage() {
  return (
    <div style={page}>
      {/* ── Header ── */}
      <header style={headerBar}>
        <div style={headerInner}>
          <Link href="/" style={brand}>
            <img src="/images/Thanos_Logo.png" alt="" width={26} height={26} style={{ objectFit: 'contain' }}/>
            <span style={brandWord}>THANOS</span>
            <span style={brandTag}>Docs</span>
          </Link>
          <nav style={headerNav}>
            <a href="/app" style={navLink}>Open App</a>
            <a href="https://thanos.fi" style={navLink}>Website</a>
            <a href="/sdk/thanos-connect-0.1.0.tgz" download style={{ ...navLink, color: '#7dd3fc' }}>Download SDK</a>
          </nav>
        </div>
      </header>

      <div style={wrap}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#7dd3fc', textTransform: 'uppercase' }}>
            Developer Docs
          </span>
          <h1 style={h1}>Sign in with Thanos</h1>
          <p style={lede}>
            Drop-in wallet authentication for any dApp. EIP-6963 discovery, a SIWE message + signature,
            and a session token — all behind <span style={kbd}>one class, one method</span>.
          </p>
        </div>

        {/* Install */}
        <h2 style={h2}>Install</h2>
        <p style={p}>Published on npm — install directly:</p>
        <Code>{`npm install thanos-connect`}</Code>
        <p style={p}>Or pull the hosted package file (no npm account needed):</p>
        <Code>{`npm install https://thanos.fi/sdk/thanos-connect-0.1.0.tgz`}</Code>
        <p style={{ ...p, margin: '0 0 14px' }}>
          <a href="/sdk/thanos-connect-0.1.0.tgz" download style={{ ...link, fontWeight: 600 }}>
            ↓ Download thanos-connect-0.1.0.tgz
          </a>
          <span style={{ color: '#64748b' }}> · v0.1.0 · MIT</span>
        </p>
        <div style={callout}>
          Zero runtime dependencies. Tree-shakeable. Dual <span style={kbd}>ESM + CommonJS</span> build, so it
          works in a browser/bundler frontend <em>and</em> a Node/CJS backend (for server-side SIWE
          verification). React component shipped at <span style={kbd}>thanos-connect/react</span>.
        </div>

        {/* Why */}
        <h2 style={h2}>Why this exists</h2>
        <p style={p}>Adding “Sign in with Thanos” yourself means handling all of this:</p>
        <ul style={{ paddingLeft: 20, marginTop: 0 }}>
          <li style={li}>EIP-6963 discovery (multi-wallet safe)</li>
          <li style={li}>A SIWE-compatible message format</li>
          <li style={li}><span style={kbd}>personal_sign</span> round-trip</li>
          <li style={li}>Backend verify-endpoint contract</li>
          <li style={li}>Sensible error handling (user cancels, no wallet, …)</li>
        </ul>
        <p style={p}>
          This package collapses all of it into a single class and one method. It pairs with the wallet’s
          backend at thanos.fi but works with your own auth server too.
        </p>

        {/* Vanilla */}
        <h2 style={h2}>60-second integration — vanilla JS / TS</h2>
        <Code>{`import { ThanosConnect } from 'thanos-connect';

const thanos = new ThanosConnect({
  appName: 'Ignite DEX',
  chainId: 700777, // Lithosphere Makalu — default
});

document.getElementById('signin').addEventListener('click', async () => {
  try {
    const { address, sessionToken } = await thanos.signIn();
    console.log('signed in as', address);
    // sessionToken is what your /api/auth/verify endpoint returned
  } catch (err) {
    console.error('sign-in failed:', err);
  }
});`}</Code>
        <p style={p}>That’s the whole flow — discovery, fallback, nonce fetch, signature, and backend verify are all handled.</p>

        {/* React */}
        <h2 style={h2}>60-second integration — React</h2>
        <Code>{`import { ThanosConnectButton } from 'thanos-connect/react';

export function Header() {
  return (
    <ThanosConnectButton
      config={{ appName: 'EGO Exchange', chainId: 700777 }}
      onSignIn={(session) => {
        console.log('signed in:', session.address);
        // Persist session.sessionToken in your auth context
      }}
      onError={(err) => console.error(err)}
    />
  );
}`}</Code>
        <p style={p}>The button auto-detects whether Thanos is installed and switches to an “Install Thanos Wallet” CTA when it isn’t. For custom UI, use the hook:</p>
        <Code>{`import { useThanos } from 'thanos-connect/react';

export function MyConnect() {
  const { signIn, signOut, session, isSigningIn, isAvailable } = useThanos({
    appName: 'AGII',
    chainId: 700777,
  });

  if (!isAvailable) return <a href="https://thanos.fi/app">Install Thanos</a>;
  if (session)     return <button onClick={signOut}>Sign out</button>;
  return <button onClick={() => signIn()} disabled={isSigningIn}>Sign in</button>;
}`}</Code>

        {/* Backend */}
        <h2 style={h2}>Backend contract</h2>
        <p style={p}>
          By default the package calls two endpoints on your server. Override the paths via
          <span style={kbd}>nonceEndpoint</span> / <span style={kbd}>verifyEndpoint</span>, or set them to
          <span style={kbd}>null</span> to handle the round-trip yourself.
        </p>
        <h3 style={h3}>GET /api/auth/nonce?address=0x… → text/plain</h3>
        <p style={p}>Issue a fresh nonce keyed by address with a 5–10 min TTL, returned as plain text (not JSON):</p>
        <Code>{`import crypto from 'crypto';

app.get('/api/auth/nonce', (req, res) => {
  const address = req.query.address as string;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).end();
  const nonce = crypto.randomBytes(16).toString('hex');
  storeNonce(address, nonce, { ttlSec: 300 });
  res.type('text/plain').send(nonce);
});`}</Code>
        <h3 style={h3}>POST /api/auth/verify → application/json</h3>
        <p style={p}>Recover the address from the signed message, validate the nonce, issue a session:</p>
        <Code>{`import { verifyMessage } from 'ethers';
import { parseSiweMessage } from 'thanos-connect';

app.post('/api/auth/verify', async (req, res) => {
  const { message, signature, address } = req.body;

  const recovered = verifyMessage(message, signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: 'signature mismatch' });
  }

  const parsed = parseSiweMessage(message);
  if (!parsed) return res.status(400).json({ error: 'malformed message' });
  if (!await consumeNonce(address, parsed.nonce)) {
    return res.status(401).json({ error: 'nonce invalid or already used' });
  }

  const sessionToken = await issueSession(address);
  res.json({ sessionToken });
});`}</Code>
        <p style={p}>
          <span style={kbd}>parseSiweMessage()</span> and <span style={kbd}>buildSiweMessage()</span> are exported
          from the package — use them to keep the wire format identical on both sides.
        </p>

        {/* Config */}
        <h2 style={h2}>Configuration reference</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr><th style={th}>Field</th><th style={th}>Type</th><th style={th}>Default</th><th style={th}>Notes</th></tr>
            </thead>
            <tbody>
              {[
                ['appName', 'string', 'required', 'Shown in the SIWE message statement'],
                ['appUrl', 'string', 'window.location.origin', 'Canonical URL anchor'],
                ['chainId', 'number', '700777 (Makalu)', 'Chain ID for the sign-in'],
                ['statement', 'string', 'Sign in to {appName}…', 'Custom SIWE statement'],
                ['nonceEndpoint', 'string | null', '/api/auth/nonce', 'null = generate nonce client-side'],
                ['verifyEndpoint', 'string | null', '/api/auth/verify', 'null = skip backend round-trip'],
                ['fetch', 'typeof fetch', 'global', 'Override for SSR / RN / edge runtimes'],
                ['walletRdns', 'string', 'fi.thanos.wallet', 'Loosen for any EIP-6963 wallet'],
                ['debug', 'boolean', 'false', 'Log discovery + flow steps'],
              ].map(([f, t, d, n]) => (
                <tr key={f}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={kbd}>{f}</span></td>
                  <td style={{ ...td, color: '#94a3b8' }}>{t}</td>
                  <td style={{ ...td, color: '#94a3b8' }}>{d}</td>
                  <td style={td}>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Errors */}
        <h2 style={h2}>Errors</h2>
        <Code>{`import { ThanosUnavailable, SignInRejected } from 'thanos-connect';

try {
  await thanos.signIn();
} catch (err) {
  if (err instanceof ThanosUnavailable) {
    // Show install CTA
  } else if (err instanceof SignInRejected) {
    // User cancelled in the wallet — silent recovery, no banner needed
  } else {
    // Network / backend / unexpected
  }
}`}</Code>

        {/* Multi-chain */}
        <h2 style={h2}>Multi-chain</h2>
        <p style={p}>Sign in on any chain, then switch after:</p>
        <Code>{`const thanos = new ThanosConnect({ appName: 'COLLE AI', chainId: 1 }); // Ethereum

const provider = await thanos.getProvider();
await provider.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0xab169' }], // 700777 (Makalu)
});`}</Code>

        {/* Ecosystem */}
        <h2 style={h2}>Ecosystem drop-in</h2>
        <p style={p}>
          Copy-paste snippets for the apps already wired into the Thanos Discover screen (full set in the
          repo README). Most use the default Makalu chain (<span style={kbd}>700777</span>); Kamet uses
          <span style={kbd}>900523</span>:
        </p>
        <Code>{`// Ignite DEX — ignite.litho.ai
<ThanosConnectButton
  config={{ appName: 'Ignite DEX', chainId: 700777 }}
  onSignIn={({ sessionToken }) => { localStorage.setItem('ignite.session', sessionToken!); location.reload(); }}
/>

// Kamet Explorer — kamet.litho.ai (sister chain, DNNS)
<ThanosConnectButton
  config={{ appName: 'Kamet Explorer', chainId: 900523 }}
  onSignIn={(s) => loginExplorer(s)}
/>`}</Code>

        {/* SSR */}
        <h2 style={h2}>SSR / Next.js</h2>
        <p style={p}>
          The wallet only exists in the browser. The React component is already marked
          <span style={kbd}>use client</span> on import, so in the Next.js app router there’s no extra setup —
          just drop it into a client component.
        </p>

        <hr style={hr} />
        <p style={{ ...p, fontSize: 13.5, color: '#94a3b8' }}>
          License: MIT — use everywhere. Questions or integration help?{' '}
          <a href="mailto:support@thanos.fi" style={link}>support@thanos.fi</a>.
        </p>
      </div>

      {/* ── Footer ── */}
      <footer style={footerBar}>
        <div style={footerInner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <img src="/images/Thanos_Logo.png" alt="" width={20} height={20} style={{ objectFit: 'contain' }}/>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: '#e2e8f0' }}>Thanos Wallet</span>
          </div>
          <nav style={footNav}>
            <Link href="/" style={footLink}>Home</Link>
            <a href="/app" style={footLink}>App</a>
            <Link href="/privacy" style={footLink}>Privacy</Link>
            <a href="/download" style={footLink}>Download APK</a>
            <a href="https://github.com/imasssad/Thanos-Wallet" target="_blank" rel="noreferrer" style={footLink}>GitHub</a>
            <a href="mailto:support@thanos.fi" style={footLink}>Support</a>
          </nav>
          <div style={{ fontSize: 12, color: '#64748b' }}>© 2026 Thanos Wallet · MIT</div>
        </div>
      </footer>
    </div>
  );
}
