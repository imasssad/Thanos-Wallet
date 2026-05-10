'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const IconGithub = (p: { size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.7-3.87-1.37-3.87-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.79.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"/>
  </svg>
);
const IconX = (p: { size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M18.244 2H21.5l-7.36 8.41L23 22h-6.79l-5.32-6.96L4.8 22H1.54l7.87-8.99L1 2h6.95l4.81 6.36L18.244 2Zm-1.19 18h1.84L7.04 4H5.07l11.984 16Z"/>
  </svg>
);

/* ──────────────────────────────────────────────────────────────────────────
   THANOS LANDING — editorial / Awwwards-style
   Principles: type IS the design · left-aligned · ALL CAPS section openers
   eyebrow + heading · one visual decision per section · 120px breathing room
   ────────────────────────────────────────────────────────────────────────── */

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && (setShown(true), io.disconnect()),
      { threshold: 0.18 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="lp-eyebrow">{children}</div>;
}

export default function Landing() {
  return (
    <div className="lp-root" data-landing="1">
      <Nav />
      <Hero />
      <DashboardSection />
      <ChainsSection />
      <EcosystemSection />
      <SecuritySection />
      <PlatformSection />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ────────────────────────── NAV ────────────────────────── */

function Nav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" className="lp-nav-logo">
          <img src="/images/Thanos_Logo_Transparent.png" alt="" width={28} height={28}/>
          <span>Thanos</span>
        </Link>
        <div className="lp-nav-right">
          <a href="#dashboard" className="lp-nav-link">Product</a>
          <a href="#ecosystem" className="lp-nav-link">Ecosystem</a>
          <a href="#security"  className="lp-nav-link">Security</a>
          <Link href="/app" className="lp-nav-cta">Open wallet <ArrowRight size={14}/></Link>
        </div>
      </div>
    </nav>
  );
}

/* ────────────────────────── HERO ────────────────────────── */

function Hero() {
  return (
    <header className="lp-hero">
      <div className="lp-hero-bg" aria-hidden>
        <div className="lp-hero-glow" />
        <div className="lp-hero-grid" />
      </div>

      <div className="lp-container">
        <Eyebrow>WEB4 · LITHOSPHERE WALLET · v0.8.1</Eyebrow>

        <h1 className="lp-hero-title">
          <span className="lp-line"><span className="lp-line-inner">Every chain.</span></span>
          <span className="lp-line"><span className="lp-line-inner">One <span className="lp-accent">key.</span></span></span>
        </h1>

        <p className="lp-hero-sub">
          A self-custody wallet for the Lithosphere ecosystem.
          LITHO, wLITHO, FGPT, BTC, ETH — signed with a single 12-word phrase
          you actually own.
        </p>

        <div className="lp-hero-cta">
          <Link href="/app" className="lp-btn-primary">
            Launch wallet <ArrowRight size={16}/>
          </Link>
          <a href="#dashboard" className="lp-btn-ghost">See it in motion</a>
        </div>

        <div className="lp-hero-meta">
          <span>Web · Desktop · iOS · Android · Extension</span>
          <span className="lp-dot">·</span>
          <span>Non-custodial</span>
          <span className="lp-dot">·</span>
          <span>Open source</span>
        </div>
      </div>

      <div className="lp-scroll-hint" aria-hidden>SCROLL</div>
    </header>
  );
}

/* ────────────────────────── DASHBOARD SECTION ────────────────────────── */

function DashboardSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section id="dashboard" ref={ref} className={`lp-section ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <Eyebrow>01 · THE DASHBOARD</Eyebrow>
        <h2 className="lp-h2">
          ONE DASHBOARD.<br/>
          EVERYTHING <span className="lp-accent">YOURS.</span>
        </h2>
        <p className="lp-lede">
          Lithosphere positions, EVM balances, Bitcoin wallets — surfaced in a single feed.
          No tab-hopping. No bridge guesswork. The numbers you came to see, on first paint.
        </p>

        <div className="lp-mockup">
          <DashboardMockup/>
        </div>
      </div>
    </section>
  );
}

function DashboardMockup() {
  return (
    <div className="lp-mockup-card">
      <div className="lp-mock-topbar">
        <div className="lp-mock-logo"><img src="/images/Thanos_Logo_Transparent.png" alt="" width={20} height={20}/></div>
        <div className="lp-mock-tabs">
          <span className="lp-mock-tab active">Dashboard</span>
          <span className="lp-mock-tab">Market</span>
          <span className="lp-mock-tab">Portfolio</span>
          <span className="lp-mock-tab">Staking</span>
        </div>
        <div className="lp-mock-acct">RobbyWallet · 0x70cA…2F2B7</div>
      </div>

      <div className="lp-mock-body">
        <div className="lp-mock-balance">
          <div className="lp-mock-balance-label">TOTAL BALANCE</div>
          <div className="lp-mock-balance-amt">$515,950.00 <span className="lp-mock-pill">+18.4%</span></div>
        </div>

        <div className="lp-mock-row">
          {[
            { sym: 'LITHO',  name: 'Lithosphere',         bal: '50,000', usd: '$15,000', chg: '+18%', c: '#8b7df7' },
            { sym: 'BTC',    name: 'Bitcoin',             bal: '5.050',  usd: '$320,250', chg: '+24%', c: '#f7931a' },
            { sym: 'ETH',    name: 'Ethereum',            bal: '94.30',  usd: '$178,150', chg: '-6%',  c: '#627eea' },
            { sym: 'wLITHO', name: 'Wrapped Lithosphere', bal: '5,000',  usd: '$1,500',   chg: '+18%', c: '#a395f8' },
            { sym: 'FGPT',   name: 'FractalGPT',          bal: '80,000', usd: '$1,200',   chg: '+42%', c: '#10b981' },
          ].map(c => (
            <div key={c.sym} className="lp-mock-coin">
              <div className="lp-mock-coin-dot" style={{ background: c.c }} />
              <div className="lp-mock-coin-name">{c.name}</div>
              <div className="lp-mock-coin-bal">{c.bal} {c.sym}</div>
              <div className="lp-mock-coin-usd">{c.usd}</div>
              <div className={`lp-mock-coin-chg ${c.chg.startsWith('-') ? 'neg' : 'pos'}`}>{c.chg}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── CHAINS SECTION ────────────────────────── */

function ChainsSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`lp-section lp-section-tight ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <Eyebrow>02 · SUPPORTED CHAINS</Eyebrow>
        <h2 className="lp-h2">
          THREE WORLDS.<br/>
          ONE SIGNATURE.
        </h2>
        <p className="lp-lede">
          BIP39 mnemonic, BIP44 derivation, native bridges. The same 12 words
          unlock Lithosphere's Makalu chain, Bitcoin native SegWit, and every EVM you'd care to touch.
        </p>

        <div className="lp-chain-grid">
          {[
            { name: 'LITHOSPHERE', desc: 'Makalu mainnet — LITHO native, FGPT, low-latency staking. The chain Thanos is built around.', stat: '18.40% APY', c: '#8b7df7' },
            { name: 'EVM',         desc: 'Ethereum, Polygon, Arbitrum and every wrapped token (wLITHO, USDC, ETH).',                    stat: '40+ networks', c: '#627eea' },
            { name: 'BITCOIN',     desc: 'Native SegWit (bc1q…) addresses derived from your phrase. No custodian.',                    stat: 'Self-custody', c: '#f7931a' },
          ].map(ch => (
            <div key={ch.name} className="lp-chain">
              <div className="lp-chain-stripe" style={{ background: ch.c }} />
              <div className="lp-chain-name">{ch.name}</div>
              <p className="lp-chain-desc">{ch.desc}</p>
              <div className="lp-chain-stat">{ch.stat}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── ECOSYSTEM SECTION ────────────────────────── */

function EcosystemSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section id="ecosystem" ref={ref} className={`lp-section ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <Eyebrow>03 · LITHO ECOSYSTEM</Eyebrow>
        <h2 className="lp-h2">
          STAKE LITHO.<br/>
          EARN <span className="lp-accent-grad">18.40%</span>.
        </h2>
        <p className="lp-lede">
          Validator delegation, wrapped-LITHO pools, and FractalGPT yield —
          live in the wallet. No second app. No bridge friction.
        </p>

        <div className="lp-stat-grid">
          {[
            { v: '18.40%', l: 'LITHO validator APY' },
            { v: '14.20%', l: 'wLITHO pool APY'      },
            { v: '32.50%', l: 'FGPT stake APY'       },
            { v: '$58M',   l: 'Lithosphere TVL'      },
          ].map(s => (
            <div key={s.l} className="lp-stat">
              <div className="lp-stat-v">{s.v}</div>
              <div className="lp-stat-l">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── SECURITY SECTION ────────────────────────── */

function SecuritySection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section id="security" ref={ref} className={`lp-section ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <div className="lp-split">
          <div>
            <Eyebrow>04 · SECURITY MODEL</Eyebrow>
            <h2 className="lp-h2">
              YOUR KEYS.<br/>
              YOUR DEVICE.<br/>
              YOUR <span className="lp-accent">RULES.</span>
            </h2>
            <p className="lp-lede">
              The mnemonic never leaves your machine. AES-encrypted at rest, password-gated,
              biometric-unlock optional. Reset wipes the vault — no support ticket required.
            </p>
            <ul className="lp-bullet">
              <li>BIP39 12-word recovery phrase</li>
              <li>BIP44 / BIP84 derivation paths</li>
              <li>Tap-to-order phrase verification</li>
              <li>Fully open source — github.com/imasssad/Thanos-Wallet</li>
            </ul>
          </div>

          <div className="lp-seed-mock">
            <div className="lp-seed-label">RECOVERY PHRASE · 12 WORDS</div>
            <div className="lp-seed-grid">
              {['stove','marble','orient','liberty','swallow','exit','urgent','wrist','engage','tower','frequent','sweet']
                .map((w, i) => (
                  <div key={i} className="lp-seed-word">
                    <span className="lp-seed-num">{i + 1}.</span> {w}
                  </div>
                ))}
            </div>
            <div className="lp-seed-bar">ENCRYPTED · ON-DEVICE</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── PLATFORM SECTION ────────────────────────── */

function PlatformSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`lp-section lp-section-tight ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <Eyebrow>05 · WHERE IT RUNS</Eyebrow>
        <h2 className="lp-h2">
          ONE WALLET.<br/>
          EVERY DEVICE.
        </h2>
        <p className="lp-lede">
          Same vault, same keys, same UX. Sign on desktop, confirm on mobile, dApp-connect from the extension.
        </p>

        <div className="lp-plat-grid">
          {[
            { n: '01', name: 'Web',       sub: 'Next.js · runs on any browser' },
            { n: '02', name: 'Desktop',   sub: 'Electron · macOS, Windows, Linux' },
            { n: '03', name: 'Mobile',    sub: 'React Native · iOS, Android (APK)' },
            { n: '04', name: 'Extension', sub: 'WXT · Chrome / Firefox dApp signer' },
          ].map(p => (
            <div key={p.n} className="lp-plat">
              <div className="lp-plat-num">{p.n}</div>
              <div className="lp-plat-name">{p.name}</div>
              <div className="lp-plat-sub">{p.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── FINAL CTA ────────────────────────── */

function FinalCta() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`lp-final ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <Eyebrow>READY?</Eyebrow>
        <h2 className="lp-final-h">GET<br/>STARTED.</h2>
        <Link href="/app" className="lp-btn-primary lp-btn-xl">
          Launch wallet <ArrowRight size={20}/>
        </Link>
        <p className="lp-final-sub">12 words. 90 seconds. No email. No KYC.</p>
      </div>
    </section>
  );
}

/* ────────────────────────── FOOTER ────────────────────────── */

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-brand">
          <img src="/images/Thanos_Logo_Transparent.png" alt="" width={22} height={22}/>
          <span>Thanos Wallet</span>
        </div>
        <div className="lp-footer-links">
          <a href="https://github.com/imasssad/Thanos-Wallet" target="_blank" rel="noreferrer" aria-label="GitHub"><IconGithub size={16}/></a>
          <a href="https://x.com/lithospherenet" target="_blank" rel="noreferrer" aria-label="X"><IconX size={16}/></a>
        </div>
        <div className="lp-footer-meta">
          © 2026 Thanos · Built on Lithosphere
        </div>
      </div>
    </footer>
  );
}
