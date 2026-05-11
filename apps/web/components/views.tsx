'use client';
import React, { useState } from 'react';
import { TOKENS } from '../lib/tokens';
import { Globe, Shield, Info, ChevronRight, Key, Download, Lock } from 'lucide-react';

// Market view leads with the Lithosphere ecosystem (canonical token list),
// then appends BNB/XRP/ADA/AVAX/DOT/DOGE/LINK as broader-market reference rows.
const MARKET = [
  ...TOKENS.map(t => ({
    sym:   t.sym,
    name:  t.name,
    price: `$${t.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
    chg24: t.change24h,
    chg7:  +(t.change24h * 1.7).toFixed(1),
    cap:   t.sym === 'LITHO' ? '$298M' : t.sym === 'LitBTC' ? '$540M' : t.sym === 'LAX' ? '$120M' : t.sym === 'JOT' ? '$24M' : t.sym === 'COLLE' ? '$8M' : '$12M',
    vol:   t.sym === 'LITHO' ? '$24.5M' : t.sym === 'LitBTC' ? '$38M' : t.sym === 'LAX' ? '$9M' : '$2.4M',
    color: t.color,
  })),
  { sym: 'BNB',    name: 'BNB',          price: '$418.30',    chg24: 0.8,  chg7: 2.1,  cap: '$62.1B',  vol: '$1.8B',  color: '#f3ba2f' },
  { sym: 'XRP',    name: 'XRP',          price: '$0.6280',    chg24: -3.4, chg7: -6.2, cap: '$34.8B',  vol: '$2.3B',  color: '#00aae4' },
  { sym: 'ADA',    name: 'Cardano',      price: '$0.5140',    chg24: 1.1,  chg7: 3.8,  cap: '$18.2B',  vol: '$0.9B',  color: '#0033ad' },
  { sym: 'AVAX',   name: 'Avalanche',    price: '$38.40',     chg24: 4.2,  chg7: 9.4,  cap: '$15.6B',  vol: '$0.7B',  color: '#e84142' },
  { sym: 'DOT',    name: 'Polkadot',     price: '$8.720',     chg24: -0.6, chg7: 1.2,  cap: '$11.4B',  vol: '$0.4B',  color: '#e6007a' },
  { sym: 'DOGE',   name: 'Dogecoin',     price: '$0.1024',    chg24: 6.3,  chg7: 18.2, cap: '$14.6B',  vol: '$1.1B',  color: '#c2a633' },
  { sym: 'LINK',   name: 'Chainlink',    price: '$14.82',     chg24: 2.9,  chg7: 7.3,  cap: '$8.7B',   vol: '$0.5B',  color: '#2a5ada' },
];

export function MarketView() {
  const [search, setSearch] = useState('');
  const filtered = MARKET.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.sym.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Market</h1>
          <div className="search-field">
            <input placeholder="Search coins…" value={search} onChange={e => setSearch(e.target.value)} className="search-field-input"/>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Name</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>24h %</th>
                <th style={{ textAlign: 'right' }}>7d %</th>
                <th style={{ textAlign: 'right' }}>Market Cap</th>
                <th style={{ textAlign: 'right' }}>Volume (24h)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.sym}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                  <td>
                    <div className="tx-cell">
                      <div className="tx-avatar" style={{ background: c.color }}>{c.sym.slice(0,2)}</div>
                      <div>
                        <div className="tx-name">{c.name}</div>
                        <div className="tx-sym">{c.sym}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 12, fontWeight: 600 }}>{c.price}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={c.chg24 >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg24 >= 0 ? '+' : ''}{c.chg24}%</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={c.chg7 >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg7 >= 0 ? '+' : ''}{c.chg7}%</span>
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{c.cap}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{c.vol}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PortfolioView() {
  // Build the portfolio rows from the shared Lithosphere token list,
  // computing USD totals + allocation pct so everything sums to 100%.
  const _raw = TOKENS.map(t => {
    const balNum = parseFloat(t.balance.replace(/,/g, ''));
    return { ...t, balNum, usd: Math.round(balNum * t.priceUsd) };
  });
  const _total = _raw.reduce((s, r) => s + r.usd, 0);
  const coins = _raw.map(r => ({
    sym:   r.sym,
    name:  r.name,
    bal:   r.balance,
    usd:   r.usd,
    chg:   r.change24h,
    color: r.color,
    pct:   Math.max(1, Math.round((r.usd / _total) * 100)),
    price: `$${r.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
  }));
  let offset = 0;
  const r = 70, circ = 2 * Math.PI * r;
  const segments = coins.map(c => {
    const len = (c.pct / 100) * circ;
    const seg = { ...c, offset, len };
    offset += len;
    return seg;
  });
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Assets</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Updated just now</div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24 }}>
            <div style={{ position: 'relative', width: 180, height: 180 }}>
              <svg viewBox="0 0 180 180" width="180" height="180" style={{ transform: 'rotate(-90deg)' }}>
                {segments.map((s, i) => (
                  <circle key={i} cx="90" cy="90" r={r} fill="none" stroke={s.color} strokeWidth="22"
                    strokeDasharray={`${s.len - 2} ${circ - s.len + 2}`} strokeDashoffset={-s.offset}/>
                ))}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total</div>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.04em' }}>$3.15M</div>
              </div>
            </div>
            {coins.map(c => (
              <div key={c.sym} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }}/>
                <span style={{ fontSize: 12, flex: 1, color: 'var(--text-secondary)' }}>{c.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{c.pct}%</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Holdings</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th style={{ textAlign: 'right' }}>24h</th>
                </tr>
              </thead>
              <tbody>
                {coins.map(c => (
                  <tr key={c.sym}>
                    <td>
                      <div className="tx-cell">
                        <div className="tx-avatar" style={{ background: c.color }}>{c.sym.slice(0,2)}</div>
                        <div>
                          <div className="tx-name">{c.name}</div>
                          <div className="tx-sym">{c.sym}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{c.price}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{c.bal} {c.sym}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 12 }}>${c.usd.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={c.chg >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg >= 0 ? '+' : ''}{c.chg}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const ALL_TXS = [
  { sym: 'LITHO',  name: 'Lithosphere',                  date: 'Jan 22, 2026', price: '$0.30',   type: 'Receive', status: 'Completed', amount: '+1,200 LITHO',  pos: true,  color: '#3b7af7' },
  { sym: 'LitBTC', name: 'Bitcoin (Lithosphere)',        date: 'Jan 20, 2026', price: '$63,200', type: 'Receive', status: 'Completed', amount: '+0.142 LitBTC', pos: true,  color: '#f7931a' },
  { sym: 'JOT',    name: 'Jot Art',                      date: 'Jan 19, 2026', price: '$0.085', type: 'Receive', status: 'Completed', amount: '+850 JOT',      pos: true,  color: '#ef4444' },
  { sym: 'LAX',    name: 'Lithosphere Algorithmic',      date: 'Jan 18, 2026', price: '$1.00',   type: 'Swap',    status: 'Completed', amount: '-200 LAX',      pos: false, color: '#06b6d4' },
  { sym: 'COLLE',  name: 'Colle AI',                     date: 'Jan 17, 2026', price: '$0.020',  type: 'Receive', status: 'Completed', amount: '+5,000 COLLE',  pos: true,  color: '#9ca3af' },
  { sym: 'FurGPT', name: 'FurGPT',                       date: 'Jan 15, 2026', price: '$0.015',  type: 'Send',    status: 'Pending',   amount: '-2,000 FurGPT', pos: false, color: '#f59e0b' },
  { sym: 'LITHO',  name: 'Lithosphere',                  date: 'Jan 14, 2026', price: '$0.32',   type: 'Swap',    status: 'Completed', amount: '+420 LITHO',    pos: true,  color: '#3b7af7' },
  { sym: 'LitBTC', name: 'Bitcoin (Lithosphere)',        date: 'Jan 12, 2026', price: '$61,800', type: 'Send',    status: 'Failed',    amount: '-0.005 LitBTC', pos: false, color: '#f7931a' },
  { sym: 'JOT',    name: 'Jot Art',                      date: 'Jan 10, 2026', price: '$0.080',  type: 'Receive', status: 'Completed', amount: '+1,200 JOT',    pos: true,  color: '#ef4444' },
];

export function TransactionsView() {
  const [filter, setFilter] = useState<'All'|'Send'|'Receive'|'Swap'>('All');
  const filtered = filter === 'All' ? ALL_TXS : ALL_TXS.filter(t => t.type === filter);
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Transactions</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['All','Send','Receive','Swap'] as const).map(f => (
              <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Date</th>
                <th>Price</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <tr key={i}>
                  <td>
                    <div className="tx-cell">
                      <div className="tx-avatar" style={{ background: tx.color }}>{tx.sym.slice(0,2)}</div>
                      <div>
                        <div className="tx-name">{tx.name}</div>
                        <div className="tx-sym">{tx.sym}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`type-pill type-${tx.type.toLowerCase()}`}>{tx.type}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tx.date}</td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{tx.price}</td>
                  <td>
                    <span className={`status-pill status-${tx.status.toLowerCase()}`}>
                      <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>
                      {tx.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={tx.pos ? 'amt-pos' : 'amt-neg'}>{tx.amount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const POOLS = [
  { name: 'Lithosphere Validator',   sym: 'LITHO',  apy: '18.40%', minStake: '100 LITHO',  tvl: '$58M',  color: '#3b7af7', locked: false },
  { name: 'LitBTC Liquidity Pool',   sym: 'LitBTC', apy: '6.50%',  minStake: '0.01 LitBTC',tvl: '$22M',  color: '#f7931a', locked: false },
  { name: 'LAX Stable Yield',        sym: 'LAX',    apy: '8.20%',  minStake: '50 LAX',     tvl: '$14M',  color: '#06b6d4', locked: false },
  { name: 'FurGPT Stake',            sym: 'FurGPT', apy: '32.50%', minStake: '1,000 FurGPT',tvl: '$8.4M',color: '#f59e0b', locked: true  },
];

export function StakingView() {
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Staking</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Earn passive yield on your assets</div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Active Position</div>
          <div className="staking-card">
            <div className="staking-brand">
              <div className="staking-brand-icon">S</div>
              Solstice
            </div>
            <div className="staking-row">
              <div className="staking-token-icon">wL</div>
              <div>
                <div className="staking-token-name">wLITHO</div>
                <div className="staking-token-sub">Unlocks: 11 Jan, 2026</div>
              </div>
              <div className="staking-yield">
                <div className="staking-yield-label">Annual yield</div>
                <div className="staking-yield-val">14.20%</div>
              </div>
            </div>
            <div className="staking-meta"><span>41 days left · 4 months total</span><span>68%</span></div>
            <div className="staking-bar"><div className="staking-bar-fill" style={{ width: '68%' }}/></div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Available Pools</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {POOLS.map(p => (
              <div key={p.sym} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="tx-avatar" style={{ background: p.color, width: 38, height: 38, fontSize: 12, borderRadius: 10, flexShrink: 0 }}>{p.sym.slice(0,2)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>TVL {p.tvl} · Min {p.minStake}</div>
                </div>
                <div style={{ textAlign: 'right', marginRight: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em' }}>{p.apy}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>APY</div>
                </div>
                <button className="btn-primary" style={{ width: 90, height: 36, fontSize: 12, marginTop: 0 }}>
                  {p.locked ? 'Locked' : 'Stake'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsView() {
  const [currency, setCurrency] = useState('USD');

  const Section = ({
    icon: Icon, title, sub, children,
  }: { icon: React.ElementType; title: string; sub: string; children: React.ReactNode }) => (
    <section className="settings-section">
      <header className="settings-section-head">
        <div className="settings-section-icon"><Icon size={18} strokeWidth={2}/></div>
        <div>
          <h2 className="settings-section-title">{title}</h2>
          <p className="settings-section-sub">{sub}</p>
        </div>
      </header>
      <div className="settings-card">{children}</div>
    </section>
  );

  const Row = ({
    label, sub, children,
  }: { label: string; sub?: string; children: React.ReactNode }) => (
    <div className="settings-row">
      <div className="settings-row-label">
        <div className="settings-row-title">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );

  return (
    <div className="main-area settings-view">
      <div className="settings-wrap">
        <header className="settings-hero">
          <h1 className="settings-hero-title">Settings</h1>
          <p className="settings-hero-sub">
            Manage your wallet preferences, security, and account details.
          </p>
        </header>

        <Section icon={Globe} title="General" sub="Display, language, and locale">
          <Row label="Currency" sub="Display prices in">
            <select className="settings-select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {['USD','EUR','GBP','JPY','BTC'].map(c => <option key={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="Language" sub="Interface language">
            <select className="settings-select" defaultValue="English">
              <option>English</option><option>Spanish</option><option>Arabic</option>
            </select>
          </Row>
        </Section>

        <Section icon={Shield} title="Security" sub="Protect access to your wallet">
          <Row label="Auto-lock" sub="Lock wallet after inactivity">
            <select className="settings-select" defaultValue="5 minutes">
              <option>1 minute</option>
              <option>5 minutes</option>
              <option>15 minutes</option>
              <option>1 hour</option>
              <option>Never</option>
            </select>
          </Row>
          <Row label="Change password" sub="Update your wallet password">
            <button className="settings-btn">
              <Key size={14}/> Change
            </button>
          </Row>
          <Row label="Backup seed phrase" sub="Export your 12/24-word recovery phrase">
            <button className="settings-btn settings-btn-danger">
              <Download size={14}/> Export
            </button>
          </Row>
          <Row label="Lock wallet now" sub="Sign out on this device">
            <button className="settings-btn">
              <Lock size={14}/> Lock
            </button>
          </Row>
        </Section>

        <Section icon={Info} title="About" sub="Build info and version">
          <Row label="Version" sub="Thanos Wallet">
            <span className="settings-version">v0.8.1</span>
          </Row>
          <Row label="Documentation" sub="Read the wallet guide">
            <a href="#" className="settings-btn settings-btn-link">
              View <ChevronRight size={14}/>
            </a>
          </Row>
        </Section>
      </div>
    </div>
  );
}
