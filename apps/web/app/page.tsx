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
          <img src="/images/Thanos_Logo.png" alt="Thanos" width={44} height={44}/>
          <span className="lp-nav-logo-text">Thanos</span>
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

      <div className="lp-scroll-hint" aria-hidden>SCROLL</div>
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
  Icon: React.FC<{ size?: number }>;
};

const DOWNLOADS: DL[] = [
  { n: '01', name: 'Web',       sub: 'Any modern browser · runs at thanos.fi',            cta: 'Launch wallet', href: '/app', ready: true,  Icon: IconWeb },
  { n: '02', name: 'Desktop',   sub: 'macOS · Windows · Linux · native Electron build',   cta: 'Download',      href: '#',    ready: false, Icon: IconDesktop },
  { n: '03', name: 'iOS',       sub: 'iPhone · iPad · App Store',                          cta: 'App Store',     href: '#',    ready: false, Icon: IconApple },
  { n: '04', name: 'Android',   sub: 'Phone · Tablet · APK (Play Store soon)',            cta: 'Download .apk', href: '/download', ready: true, dl: true, Icon: IconAndroid },
  { n: '05', name: 'Extension', sub: 'Chrome · Firefox · dApp signer for window.thanos',  cta: 'Chrome Store',  href: '#',    ready: false, Icon: IconExtension },
];

function PlatformSection() {
  const { ref, shown } = useReveal<HTMLElement>();
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
          {DOWNLOADS.map(({ n, name, sub, cta, href, ready, dl, Icon }, idx) => {
            // Real downloads (APK) use a plain <a> for full navigation; live
            // in-app routes use Next <Link> for client-side nav.
            const Tag = ready && !dl ? Link : 'a';
            // Web/Desktop = Thanos blue. iOS muted, Android green, Extension cyan.
            const tints = ['#3b7af7', '#06b6d4', '#9ca3af', '#10b981', '#22d3ee'];
            return (
              <Tag
                key={n}
                href={href}
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
          <a href="/privacy">Privacy</a>
          <a href="/.well-known/security.txt">Security</a>
          <a href="https://github.com/imasssad/Thanos-Wallet/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a>
          <a href="mailto:devs@thanos.fi">Contact</a>
        </nav>
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
