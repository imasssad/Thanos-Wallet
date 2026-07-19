'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ExtensionPrompt } from '../components/ExtensionPrompt';

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
const IconTelegram = (p: { size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);
const IconInstagram = (p: { size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);
const IconDiscord = (p: { size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
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
      <ExtensionPrompt />
    </div>
  );
}

/* ────────────────────────── NAV ────────────────────────── */

function Nav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" className="lp-nav-logo">
          <img src="/images/Thanos_Logo.png" alt="Thanos" width={44} height={44}/>
          <span className="lp-nav-logo-text">Thanos Wallet</span>
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

      <div className="lp-container lp-hero-stage">
        <div className="lp-hero-text">
          <h1 className="lp-hero-title">
            <span className="lp-line"><span className="lp-line-inner">Every chain.</span></span>
            <span className="lp-line"><span className="lp-line-inner">One <span className="lp-accent">Wallet</span></span></span>
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

        <div className="lp-hero-visual" aria-hidden>
          <PhoneMockup />
        </div>
      </div>
    </header>
  );
}

function PhoneMockup() {
  const COINS = [
    { sym: 'LITHO',  name: 'Lithosphere',  bal: '50,000', usd: '$15,000', chg: '+18%', c: '#3b7af7', pct: 78 },
    { sym: 'BTC',    name: 'Bitcoin',      bal: '5.050',  usd: '$320,250', chg: '+24%', c: '#f7931a', pct: 92 },
    { sym: 'ETH',    name: 'Ethereum',     bal: '94.30',  usd: '$178,150', chg: '-6%',  c: '#627eea', pct: 64 },
    { sym: 'wLITHO', name: 'wLITHO',       bal: '5,000',  usd: '$1,500',   chg: '+18%', c: '#22d3ee', pct: 38 },
  ];
  return (
    <div className="lp-phone">
      <div className="lp-phone-glow" />
      <div className="lp-phone-frame">
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">
          <div className="lp-phone-status">
            <span>9:41</span>
            <span className="lp-phone-status-right">5G  100%</span>
          </div>
          <div className="lp-phone-greeting">Hi Sora,</div>
          <div className="lp-phone-balance">
            <div className="lp-phone-label">TOTAL BALANCE</div>
            <div className="lp-phone-amt">$515,950<span className="lp-phone-cents">.00</span></div>
            <div className="lp-phone-pill">▲ +18.40% TODAY</div>
          </div>
          <div className="lp-phone-coins">
            {COINS.map(c => (
              <div key={c.sym} className="lp-phone-coin">
                <div className="lp-phone-coin-icon" style={{ background: c.c }}>{c.sym.slice(0,1)}</div>
                <div className="lp-phone-coin-info">
                  <div className="lp-phone-coin-name">{c.sym}</div>
                  <div className="lp-phone-coin-bal">{c.bal}</div>
                </div>
                <div className="lp-phone-coin-right">
                  <div className="lp-phone-coin-usd">{c.usd}</div>
                  <div className={`lp-phone-coin-chg ${c.chg.startsWith('-') ? 'neg' : 'pos'}`}>{c.chg}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="lp-phone-tabbar">
            <span className="lp-phone-tab active">Home</span>
            <span className="lp-phone-tab">Send</span>
            <span className="lp-phone-tab">Swap</span>
            <span className="lp-phone-tab">Stake</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── DASHBOARD SECTION ────────────────────────── */

function DashboardSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section id="dashboard" ref={ref} className={`lp-section ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <h2 className="lp-h2">
          ONE ACCESS.<br/>
          FULL <span className="lp-accent">CONTROL.</span>
        </h2>
        <p className="lp-lede">
          Thanos positions, EVM balances, Bitcoin wallets — surfaced in a single feed.
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
        <div className="lp-mock-acct">Sora · 0x70cA…2F2B7</div>
      </div>

      <div className="lp-mock-body">
        <div className="lp-mock-balance">
          <div className="lp-mock-balance-label">TOTAL BALANCE</div>
          <div className="lp-mock-balance-amt">$515,950.00 <span className="lp-mock-pill">+18.4%</span></div>
        </div>

        <div className="lp-mock-row">
          {[
            { sym: 'LITHO',  name: 'Lithosphere',         bal: '50,000', usd: '$15,000', chg: '+18%', c: '#3b7af7' },
            { sym: 'BTC',    name: 'Bitcoin',             bal: '5.050',  usd: '$320,250', chg: '+24%', c: '#f7931a' },
            { sym: 'ETH',    name: 'Ethereum',            bal: '94.30',  usd: '$178,150', chg: '-6%',  c: '#627eea' },
            { sym: 'wLITHO', name: 'Wrapped Lithosphere', bal: '5,000',  usd: '$1,500',   chg: '+18%', c: '#22d3ee' },
            { sym: 'FGPT',   name: 'FurGPT',              bal: '80,000', usd: '$1,200',   chg: '+42%', c: '#10b981' },
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
            { name: 'LITHOSPHERE', desc: 'Makalu — LITHO native, the full LEP100 token suite, dual litho1/0x addressing. The chain Thanos is built around.', stat: '10 LEP100 tokens', c: '#3b7af7' },
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
        <h2 className="lp-h2">
          STAKE <span className="lp-accent-grad">LITHO</span>.
        </h2>
        <p className="lp-lede">
          Validator delegation and wrapped-LITHO pools land in the wallet the
          moment the Lithosphere staking contracts go live. No second app.
          No bridge friction.
        </p>

        {/* Real, verifiable numbers only — the previous fabricated APY/TVL
            stats contradicted the in-app Staking view (contract not yet
            deployed) and were a trust liability on a wallet's homepage. */}
        <div className="lp-stat-grid">
          {[
            { v: '6+',   l: 'chains from one phrase'           },
            { v: '22',   l: 'verified LEP100 tokens tracked'   },
            { v: '4',    l: 'platforms — web · desktop · mobile · extension' },
            { v: '100%', l: 'self-custodial — keys never leave your device' },
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

/* ────────────────────────── DOWNLOAD / PLATFORMS SECTION ────────────────────────── */

/* Brand-mark SVGs for each platform tile.
   - Apple: official simple-icons silhouette
   - Android: official Bugdroid head + antennae
   - Chrome: full multi-colored Chrome ring (extension store)
   - Globe: ringed browser globe with longitudes/latitudes
   - Apple+Win+Linux composite: 3 OS marks for the desktop tile */
const IconWeb = (p: { size?: number }) => (
  // Stylised browser globe with two parallels + meridian — recognisable at small sizes
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="9.5"/>
    <ellipse cx="12" cy="12" rx="9.5" ry="4"/>
    <path d="M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19"/>
  </svg>
);
const IconDesktop = (p: { size?: number }) => (
  // Clean laptop silhouette — sub-text already lists macOS/Windows/Linux
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
    <rect x="3.5" y="4" width="17" height="11" rx="1.5"/>
    <path d="M2 18h20l-1 2H3z"/>
  </svg>
);
const IconApple = (p: { size?: number }) => (
  // Apple — simple-icons official path
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01ZM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z"/>
  </svg>
);
const IconAndroid = (p: { size?: number }) => (
  // Android Bugdroid with antennae + eyes — proper proportions
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.523 15.341c-.55 0-.99-.444-.99-1 0-.553.44-1 .99-1 .551 0 .991.447.991 1 0 .556-.44 1-.991 1m-11.046 0c-.55 0-.99-.444-.99-1 0-.553.44-1 .99-1 .55 0 .99.447.99 1 0 .556-.44 1-.99 1m11.405-6.061 1.985-3.443a.416.416 0 0 0-.152-.564.416.416 0 0 0-.564.152l-2.01 3.484C15.59 8.21 13.846 7.79 12 7.79c-1.846 0-3.59.42-5.139 1.119L4.85 5.425a.413.413 0 0 0-.564-.152.412.412 0 0 0-.151.564l1.985 3.443C2.687 11.087.444 14.337 0 18.182h24c-.444-3.845-2.687-7.095-6.118-8.902"/>
  </svg>
);
const IconExtension = (p: { size?: number }) => (
  // Chrome multi-color logo — uses currentColor for outer ring + opacity for inner segments.
  <svg width={p.size ?? 24} height={p.size ?? 24} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.28"/>
    <circle cx="12" cy="12" r="5"  fill="currentColor" opacity="0.95"/>
    <circle cx="12" cy="12" r="3"  fill="#0e0e12"/>
    <path d="M12 2v10l5.2-3a10 10 0 0 0-5.2-7Z" fill="currentColor" opacity="0.6"/>
    <path d="M2.5 8.5 8.5 12 6.8 18a10 10 0 0 1-4.3-9.5Z" fill="currentColor" opacity="0.6"/>
    <path d="M12 22a10 10 0 0 0 8.6-5L14 14l-2 8Z" fill="currentColor" opacity="0.6"/>
  </svg>
);

type DL = {
  n: string;
  name: string;
  sub: string;
  cta: string;
  href: string;
  ready: boolean;
  /** True for a real file download (e.g. the APK) — rendered as a plain
   *  <a> with full navigation, not a client-side <Link>. */
  dl?: boolean;
  /** True for an external link (e.g. the Chrome Web Store) — plain <a> that
   *  opens in a new tab. */
  ext?: boolean;
  /** Secondary direct-APK download shown beneath the primary CTA (Android:
   *  Google Play as the main button, the raw APK as a fallback link). */
  apk?: string;
  /** Per-OS override for the desktop build. When the Mac app ships, flip ONLY
   *  the `mac` entry — Windows/Linux visitors then still see their own build
   *  (or "coming soon"), and are never offered the Mac binary. */
  byOs?: Partial<Record<'mac' | 'windows' | 'linux', { cta?: string; href?: string; ready?: boolean; sub?: string }>>;
  Icon: React.FC<{ size?: number }>;
};

/** Android APK version shown on the direct-download button. Keep in sync with
 *  apps/mobile/app.json `version` and APK_VERSION in app/download/route.ts —
 *  the route serves the artifact, this just labels it so users can see which
 *  build they're getting before downloading. */
const ANDROID_APK_VERSION = '1.1.1';

/** The visitor's device, at OS granularity — drives which install options we
 *  offer. A phone can't run the browser extension or the desktop app, so those
 *  must never be prompted on mobile; and the desktop build resolves per-OS so
 *  (e.g.) a Windows user is never handed the Mac binary. */
type DevicePlatform = 'android' | 'ios' | 'mac' | 'windows' | 'linux';

function detectDevice(): DevicePlatform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS 13+ reports itself as desktop Safari on Mac — a touch-capable
  // "Macintosh" is really an iPad, so this MUST be tested before 'mac'.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'linux';
}

const DOWNLOADS: DL[] = [
  { n: '01', name: 'Web',       sub: 'Any modern browser · runs at thanos.fi',            cta: 'Launch wallet', href: '/app', ready: true,  Icon: IconWeb },
  // Desktop resolves per-OS via `byOs` below — a visitor is only ever offered
  // the build for the machine they're on. When the Mac .dmg/.pkg ships, set
  // ready+href on the `mac` entry ONLY; Windows/Linux stay untouched.
  { n: '02', name: 'Desktop',   sub: 'macOS · Windows · Linux · native Electron build',   cta: 'Download',      href: '#',    ready: false, Icon: IconDesktop,
    byOs: {
      mac:     { sub: 'macOS · native Electron build',   cta: 'Download for Mac',     ready: false },
      windows: { sub: 'Windows · native Electron build', cta: 'Download for Windows', ready: false },
      linux:   { sub: 'Linux · AppImage / .deb',         cta: 'Download for Linux',   ready: false },
    } },
  { n: '03', name: 'iOS',       sub: 'iPhone · iPad · App Store',                          cta: 'App Store',     href: '#',    ready: false, Icon: IconApple },
  { n: '04', name: 'Android',   sub: 'Phone · Tablet · Google Play or direct APK', cta: 'Google Play', href: 'https://play.google.com/store/apps/details?id=ai.thanos.wallet', ready: true, ext: true, apk: '/download', Icon: IconAndroid },
  { n: '05', name: 'Extension', sub: 'Chrome · Brave · Edge · dApp signer for window.thanos', cta: 'Chrome Store', href: 'https://chromewebstore.google.com/detail/thanos-wallet/jajfgpnlaoakklhnnchdpiglmkkpcehj', ready: true, ext: true, Icon: IconExtension },
];

function PlatformSection() {
  const { ref, shown } = useReveal<HTMLElement>();
  // Detected after mount (navigator isn't available during SSR). Until then we
  // render every tile, which keeps the server HTML complete for SEO and avoids
  // a hydration mismatch; the section sits below the fold, so the narrowing
  // lands well before a visitor scrolls to it.
  const [device, setDevice] = useState<DevicePlatform | null>(null);
  useEffect(() => { setDevice(detectDevice()); }, []);
  const isMobile = device === 'android' || device === 'ios';

  const tiles = DOWNLOADS
    .filter((d) => {
      if (!device) return true;
      if (isMobile) {
        // A phone can't install a browser extension or a desktop binary —
        // never prompt for either (this was the reported issue).
        if (d.name === 'Extension' || d.name === 'Desktop') return false;
        // Only the visitor's own phone OS; hide the other one.
        if (d.name === 'iOS')     return device === 'ios';
        if (d.name === 'Android') return device === 'android';
        // Web stays reachable but is ranked last below — it is NOT the prompt,
        // and on iOS it's the only usable option until the App Store build ships.
        return true;
      }
      return true;
    })
    // Lead with the native app for this device; Web falls to the end on mobile.
    .sort((a, b) => nativeRank(a) - nativeRank(b))
    // Offer only the desktop build matching the visitor's OS.
    .map((d) => {
      if (d.name !== 'Desktop' || !device || isMobile) return d;
      const os = d.byOs?.[device as 'mac' | 'windows' | 'linux'];
      return os ? { ...d, ...os } : d;
    });

  function nativeRank(d: DL): number {
    if (!device || !isMobile) return 0;
    return (device === 'android' && d.name === 'Android') || (device === 'ios' && d.name === 'iOS') ? 0 : 1;
  }

  return (
    <section id="download" ref={ref} className={`lp-section lp-section-tight ${shown ? 'is-shown' : ''}`}>
      <div className="lp-container">
        <h2 className="lp-h2">
          ONE WALLET.<br/>
          EVERY DEVICE.
        </h2>
        <p className="lp-lede">
          Same vault, same keys, same UX. Sign on desktop, confirm on mobile, dApp-connect from the extension.
          Real download links go live with the public release.
        </p>

        <div className="lp-dl-list">
          {tiles.map(({ n, name, sub, cta, href, ready, dl, ext, apk, Icon }, idx) => {
            // External links (Chrome store) + real downloads (APK) use a plain
            // <a>; live in-app routes use Next <Link> for client-side nav.
            const Tag = ready && !dl && !ext ? Link : 'a';
            // Web/Desktop = Thanos blue. iOS muted, Android green, Extension cyan.
            const tints = ['#3b7af7', '#06b6d4', '#9ca3af', '#10b981', '#22d3ee'];

            // Android offers BOTH: Google Play (primary) + a direct .apk link
            // beneath it. Two separate links can't nest inside one <a> tile, so
            // this variant renders the tile as a plain container.
            if (apk) {
              return (
                <div
                  key={n}
                  className="lp-dl-row is-live"
                  style={{ ['--tile-tint' as any]: tints[idx % tints.length] }}
                >
                  <div className="lp-dl-corner" aria-hidden/>
                  <div className="lp-dl-status"><span className="lp-dl-status-dot"/> Available</div>
                  <div className="lp-dl-icon"><Icon size={26}/></div>
                  <div className="lp-dl-info">
                    <div className="lp-dl-name">{name}</div>
                    <div className="lp-dl-sub">{sub}</div>
                  </div>
                  <div className="lp-dl-cta-stack">
                    <a className="lp-dl-cta" href={href} target="_blank" rel="noreferrer">
                      {cta} <ArrowRight size={13}/>
                    </a>
                    <a className="lp-dl-cta" href={apk} download>
                      Download .apk (v{ANDROID_APK_VERSION})
                    </a>
                  </div>
                </div>
              );
            }

            return (
              <Tag
                key={n}
                href={href}
                {...(ext ? { target: '_blank', rel: 'noreferrer' } : {})}
                {...(!ready ? { onClick: (e: React.MouseEvent) => e.preventDefault(), 'aria-disabled': true } : {})}
                className={`lp-dl-row ${ready ? 'is-live' : 'is-soon'}`}
                style={{ ['--tile-tint' as any]: tints[idx % tints.length] }}
              >
                <div className="lp-dl-corner" aria-hidden/>
                <div className="lp-dl-status">
                  {ready
                    ? <><span className="lp-dl-status-dot"/> Available</>
                    : <>Coming soon</>
                  }
                </div>
                <div className="lp-dl-icon"><Icon size={26}/></div>
                <div className="lp-dl-info">
                  <div className="lp-dl-name">{name}</div>
                  <div className="lp-dl-sub">{sub}</div>
                </div>
                <div className="lp-dl-cta">
                  {ready ? (
                    <>{cta} <ArrowRight size={13}/></>
                  ) : (
                    <span className="lp-dl-cta-label">{cta}</span>
                  )}
                </div>
              </Tag>
            );
          })}
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
      <div className="lp-container lp-final-stage">
        <div className="lp-final-text">
          <h2 className="lp-final-h">GET<br/>STARTED.</h2>
          <Link href="/app" className="lp-btn-primary lp-btn-xl">
            Launch wallet <ArrowRight size={20}/>
          </Link>
          <p className="lp-final-sub">12 words. 90 seconds. No email. No KYC.</p>
        </div>

        <div className="lp-final-visual" aria-hidden>
          <BrandConstellation/>
        </div>
      </div>
    </section>
  );
}

function BrandConstellation() {
  // Floating token chips around the Thanos brand mark.
  const TOKENS = [
    { sym: 'LITHO',  color: '#3b7af7', x: '14%', y: '18%' },
    { sym: 'BTC',    color: '#f7931a', x: '78%', y: '12%' },
    { sym: 'ETH',    color: '#627eea', x: '6%',  y: '64%' },
    { sym: 'wLITHO', color: '#22d3ee', x: '82%', y: '70%' },
    { sym: 'FGPT',   color: '#10b981', x: '50%', y: '88%' },
  ];
  return (
    <div className="lp-constellation">
      <div className="lp-const-glow"/>
      <div className="lp-const-ring lp-const-ring-1"/>
      <div className="lp-const-ring lp-const-ring-2"/>
      <div className="lp-const-ring lp-const-ring-3"/>

      <div className="lp-const-mark">
        <img src="/images/Thanos_Logo_Transparent.png" alt="" width={120} height={120}/>
      </div>

      {TOKENS.map((t, i) => (
        <div
          key={t.sym}
          className="lp-const-chip"
          style={{
            left:  t.x,
            top:   t.y,
            ['--chip-color' as any]: t.color,
            ['--chip-delay' as any]: `${i * 0.4}s`,
          }}
        >
          <span className="lp-const-chip-dot" style={{ background: t.color }}/>
          {t.sym}
        </div>
      ))}
    </div>
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
        {/* Legal + transparency links. Required as a public discovery
            surface by App Store + Google Play submission reviewers,
            and the basic-decency move for any wallet. */}
        <nav className="lp-footer-nav" aria-label="Legal and transparency">
          <a href="https://docs.thanos.fi/" target="_blank" rel="noreferrer">Docs</a>
          <a href="/docs">Developers</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/.well-known/security.txt">Security</a>
          <a href="https://github.com/imasssad/Thanos-Wallet/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a>
          <a href="mailto:devs@thanos.fi">Contact</a>
        </nav>
        <div className="lp-footer-links">
          <a href="https://t.me/ThanosWallet" target="_blank" rel="noreferrer" aria-label="Telegram"><IconTelegram size={16}/></a>
          <a href="https://discord.gg/khEm4nArFy" target="_blank" rel="noreferrer" aria-label="Discord"><IconDiscord size={16}/></a>
          <a href="https://x.com/thanoswallets" target="_blank" rel="noreferrer" aria-label="X"><IconX size={16}/></a>
          <a href="https://www.instagram.com/thanoswallet/" target="_blank" rel="noreferrer" aria-label="Instagram"><IconInstagram size={16}/></a>
          <a href="https://github.com/imasssad/Thanos-Wallet" target="_blank" rel="noreferrer" aria-label="GitHub"><IconGithub size={16}/></a>
        </div>
        <div className="lp-footer-meta">
          © 2026 Thanos · Built on Lithosphere
        </div>
      </div>
    </footer>
  );
}
