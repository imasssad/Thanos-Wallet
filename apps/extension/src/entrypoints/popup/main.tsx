import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* ──────────────────────── Icons (inline SVG) ──────────────────────── */

const I = (path: React.ReactNode) => ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const Send       = I(<><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></>);
const Receive    = I(<><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></>);
const Swap       = I(<><path d="M7 16V4M3 8l4-4 4 4"/><path d="M17 8v12m4-4l-4 4-4-4"/></>);
const Link       = I(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>);
const Home       = I(<><path d="M3 12L12 3l9 9"/><path d="M5 10.5V21h14V10.5"/></>);
const History    = I(<><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></>);
const Settings   = I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>);
const Copy       = I(<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>);
const ChevDown   = I(<path d="M6 9l6 6 6-6"/>);
const Eye        = I(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>);
const Lock       = I(<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>);
const Sun        = I(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>);
const Moon       = I(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>);

/* ──────────────────────── Mock data ──────────────────────── */

const ACCOUNT = {
  name:    'Account 1',
  address: 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v',
};

const ASSETS = [
  { sym: 'LITHO', name: 'Lithosphere', chain: 'Makalu',  bal: '4,280.00', usd: '$1,284.00', chg:  3.42, grad: ['#8b7df7', '#7060e0'] },
  { sym: 'BTC',   name: 'Bitcoin',     chain: 'Bitcoin', bal: '0.04821',  usd: '$2,891.00', chg: -1.17, grad: ['#f97316', '#ea580c'] },
  { sym: 'SOL',   name: 'Solana',      chain: 'Solana',  bal: '12.380',   usd: '$1,772.00', chg:  5.88, grad: ['#9945ff', '#7c3aed'] },
  { sym: 'ETH',   name: 'Ethereum',    chain: 'EVM',     bal: '0.6142',   usd: '$2,210.00', chg:  0.54, grad: ['#627eea', '#4f63bb'] },
  { sym: 'USDC',  name: 'USD Coin',    chain: 'EVM',     bal: '840.00',   usd: '$840.00',   chg:  0.01, grad: ['#2775ca', '#1a5fa0'] },
  { sym: 'COLLE', name: 'Colle AI',    chain: 'Makalu',  bal: '18,000',   usd: '$360.00',   chg:  8.22, grad: ['#00d68f', '#00a86b'] },
];

const TOTAL_USD = '$9,357.00';
const CHANGE_24H = 2.34;

function shortAddr(a: string) { return a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a; }

/* ──────────────────────── Views ──────────────────────── */

function HomeView() {
  return (
    <>
      <div className="balance-block">
        <span className="balance-label">Total balance</span>
        <span className="balance-amt">{TOTAL_USD}</span>
        <span className={`balance-change ${CHANGE_24H >= 0 ? 'pos' : 'neg'}`}>
          {CHANGE_24H >= 0 ? '+' : '−'}{Math.abs(CHANGE_24H).toFixed(2)}% · 24h
        </span>
      </div>

      <div className="actions">
        <a className="action primary" href="#send">      <Send size={16}/>     Send</a>
        <a className="action"          href="#receive">   <Receive size={16}/>  Receive</a>
        <a className="action"          href="#swap">      <Swap size={16}/>     Swap</a>
        <a className="action"          href="#dapps">     <Link size={16}/>     dApps</a>
      </div>

      <div>
        <div className="section-title">Assets</div>
        <div className="asset-list">
          {ASSETS.map(a => (
            <button key={`${a.sym}-${a.chain}`} className="asset-row">
              <div className="asset-avatar" style={{ background: `linear-gradient(145deg, ${a.grad[0]}, ${a.grad[1]})` }}>
                {a.sym.slice(0, 2)}
              </div>
              <div className="asset-info">
                <span className="asset-symbol">{a.sym}</span>
                <span className="asset-bal">{a.bal} {a.sym}</span>
              </div>
              <div className="asset-right">
                <span className="asset-usd">{a.usd}</span>
                <span className={`asset-change ${a.chg >= 0 ? 'pos' : 'neg'}`}>
                  {a.chg >= 0 ? '+' : ''}{a.chg.toFixed(2)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function SendView() {
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  return (
    <>
      <div className="section-title">Send LITHO</div>
      <div>
        <label className="field-label">Recipient</label>
        <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder="litho1… or name.litho" />
      </div>
      <div>
        <label className="field-label">Amount</label>
        <input className="input" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" type="number" />
      </div>
      {amt && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', padding: '0 2px' }}>
          <span>Network fee</span><span>~0.002 LITHO</span>
        </div>
      )}
      <button className="btn-primary" disabled={!to || !amt}>Continue</button>
    </>
  );
}

function ReceiveView() {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(ACCOUNT.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <>
      <div className="section-title">Receive on Makalu</div>
      <div className="qr-frame">
        <svg width="140" height="140" viewBox="0 0 160 160">
          <rect x="10" y="10" width="44" height="44" rx="4" fill="none" stroke="#0b0b14" strokeWidth="4"/>
          <rect x="20" y="20" width="24" height="24" rx="2" fill="#0b0b14"/>
          <rect x="106" y="10" width="44" height="44" rx="4" fill="none" stroke="#0b0b14" strokeWidth="4"/>
          <rect x="116" y="20" width="24" height="24" rx="2" fill="#0b0b14"/>
          <rect x="10" y="106" width="44" height="44" rx="4" fill="none" stroke="#0b0b14" strokeWidth="4"/>
          <rect x="20" y="116" width="24" height="24" rx="2" fill="#0b0b14"/>
          <rect x="68" y="68" width="24" height="24" rx="6" fill="#8b7df7"/>
          {[60,68,76,84,92,100].map(x =>
            [60,68,76,84,92,100].map(y => {
              if (x >= 68 && x <= 84 && y >= 68 && y <= 84) return null;
              if (x <= 54 && y <= 54) return null;
              if (x >= 106 && y <= 54) return null;
              if (x <= 54 && y >= 106) return null;
              return (x + y) % 16 !== 0
                ? <rect key={`${x}${y}`} x={x} y={y} width="6" height="6" rx="1" fill="#0b0b14" opacity="0.85"/>
                : null;
            })
          )}
        </svg>
      </div>

      <div className="addr-box">
        <span className="addr-text">{ACCOUNT.address}</span>
        <button className="icon-btn" onClick={copy} title="Copy">
          <Copy size={13} />
        </button>
      </div>
      {copied && <span style={{ fontSize: 10, color: 'var(--green)', textAlign: 'center' }}>Address copied to clipboard</span>}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 2px', lineHeight: 1.5 }}>
        Only send <strong style={{ color: 'var(--text-secondary)' }}>LITHO</strong> and Makalu-network tokens to this address.
      </div>
    </>
  );
}

function HistoryView() {
  const txs = [
    { type: 'Received', sym: 'LITHO', amt: '+1,200',  time: '2 min ago',  pos: true  },
    { type: 'Sent',     sym: 'BTC',   amt: '-0.012',  time: '1 hr ago',   pos: false },
    { type: 'Swap',     sym: 'SOL',   amt: '2.4',     time: '3 hr ago',   pos: false },
    { type: 'Received', sym: 'USDC',  amt: '+840',    time: 'Yesterday',  pos: true  },
    { type: 'Sent',     sym: 'COLLE', amt: '-500',    time: '2 days ago', pos: false },
  ];
  return (
    <>
      <div className="section-title">Recent Activity</div>
      <div className="asset-list">
        {txs.map((t, i) => (
          <button key={i} className="asset-row">
            <div className="asset-avatar" style={{
              background: t.pos ? 'rgba(74,222,128,0.10)' : 'rgba(139,125,247,0.10)',
              color: t.pos ? 'var(--green)' : 'var(--purple-300)',
              border: `1px solid ${t.pos ? 'rgba(74,222,128,0.20)' : 'rgba(139,125,247,0.22)'}`,
            }}>{t.type === 'Sent' ? '↗' : t.type === 'Received' ? '↙' : '⇄'}</div>
            <div className="asset-info">
              <span className="asset-symbol">{t.type}</span>
              <span className="asset-bal">{t.time}</span>
            </div>
            <div className="asset-right">
              <span className={`asset-usd ${t.pos ? 'pos' : 'neg'}`} style={{ color: t.pos ? 'var(--green)' : 'var(--text-primary)' }}>
                {t.amt} {t.sym}
              </span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function SettingsView({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  return (
    <>
      <div className="section-title">Wallet</div>
      <div className="asset-list">
        <div className="setting-row">
          <div>
            <div className="setting-label">Lock wallet</div>
            <div className="setting-desc">Require password to unlock</div>
          </div>
          <Lock size={15} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Connected dApps</div>
            <div className="setting-desc">2 active sessions</div>
          </div>
          <ChevDown size={14} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Network</div>
            <div className="setting-desc">Makalu (testnet)</div>
          </div>
          <ChevDown size={14} />
        </div>
      </div>
      <div className="section-title">Appearance</div>
      <div className="asset-list">
        <button className="setting-row" onClick={onToggleTheme} style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}>
          <div>
            <div className="setting-label">Theme</div>
            <div className="setting-desc">{isDark ? 'Dark mode' : 'Light mode'} — tap to switch</div>
          </div>
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      <div className="section-title">About</div>
      <div className="asset-list">
        <div className="setting-row">
          <div className="setting-label">Version</div>
          <div className="setting-desc">v0.8.1 · Makalu Sync</div>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────── Shell ──────────────────────── */

type Tab = 'home' | 'send' | 'receive' | 'swap' | 'history' | 'settings';

function Popup() {
  const [tab, setTab] = useState<Tab>('home');
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('thanos-theme');
    const system = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const resolved = stored ?? system;
    const dark = resolved !== 'light';
    setIsDark(dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      const theme = next ? 'dark' : 'light';
      localStorage.setItem('thanos-theme', theme);
      document.documentElement.dataset.theme = theme;
      return next;
    });
  };

  return (
    <div className="popup">
      <header className="header">
        <button className="acct">
          <div className="acct-avatar">A</div>
          <div className="acct-info">
            <span className="acct-name">{ACCOUNT.name}</span>
            <span className="acct-addr">{shortAddr(ACCOUNT.address)}</span>
          </div>
          <ChevDown size={12}/>
        </button>
        <span className="net-pill"><span className="net-dot"/>Makalu</span>
        <button className="icon-btn" onClick={toggleTheme} title={isDark ? 'Light mode' : 'Dark mode'}>
          {isDark ? <Sun size={14}/> : <Moon size={14}/>}
        </button>
        <button className="icon-btn" title="Lock"><Lock size={14}/></button>
      </header>

      <main className="body">
        {tab === 'home'     && <HomeView/>}
        {tab === 'send'     && <SendView/>}
        {tab === 'receive'  && <ReceiveView/>}
        {tab === 'swap'     && <SendView/>}
        {tab === 'history'  && <HistoryView/>}
        {tab === 'settings' && <SettingsView isDark={isDark} onToggleTheme={toggleTheme}/>}
      </main>

      <nav className="tabs">
        <button className={`tab ${tab === 'home' ? 'active' : ''}`}     onClick={() => setTab('home')}>     <Home size={17}/>     Home</button>
        <button className={`tab ${tab === 'swap' ? 'active' : ''}`}     onClick={() => setTab('swap')}>     <Swap size={17}/>     Swap</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`}  onClick={() => setTab('history')}>  <History size={17}/>  Activity</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}> <Settings size={17}/> Settings</button>
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup/>);
