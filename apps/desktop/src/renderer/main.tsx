import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, HDNodeWallet, Mnemonic, JsonRpcProvider, formatEther } from 'ethers';
import './styles.css';
import {
  createVault, openVault, openVaultWithKey,
  saveVault, loadVault, clearVault,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
} from './vault';

declare global {
  interface Window {
    thanosDesktop?: {
      vaultGet(key: string): Promise<string | null>;
      vaultSet(key: string, value: string): Promise<void>;
      vaultRemove(key: string): Promise<void>;
    };
  }
}

/* ──────────────────────── Types ──────────────────────── */
type View = 'dashboard' | 'market' | 'portfolio' | 'transactions' | 'staking' | 'settings';

/* ──────────────────────── Icons ──────────────────────── */
const Ic = (path: React.ReactNode) => ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const ChevDown  = Ic(<path d="M6 9l6 6 6-6"/>);
const Search    = Ic(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
const Bell      = Ic(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>);
const Expand    = Ic(<><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></>);
const ArrowsUD  = Ic(<><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></>);
const Bot       = Ic(<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M12 7v4M8 11V7M16 11V7"/><circle cx="12" cy="5" r="2"/><path d="M8 16h.01M12 16h.01M16 16h.01"/></>);
const Sun       = Ic(<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>);
const Moon      = Ic(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>);
const Send2     = Ic(<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>);
const Download2 = Ic(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>);
const Repeat2   = Ic(<><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>);

const Globe     = Ic(<><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a14 14 0 0 1 0 20M12 2a14 14 0 0 0 0 20"/></>);
const Shield    = Ic(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>);
const Wifi      = Ic(<><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/><path d="M2 9.5a16 16 0 0 1 20 0"/></>);
const Info      = Ic(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>);
const KeyIcon   = Ic(<><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>);
const Lock2     = Ic(<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>);
const ChevRight2 = Ic(<polyline points="9 18 15 12 9 6"/>);

/* ──────────────────────── Mock data ──────────────────────── */
const ACCOUNT = { name: 'RobbyWallet', address: '0x70cA2F2B7' };

const COINS = [
  { sym: 'LITHO',  name: 'Lithosphere',         bal: '50,000', usd: '$15,000.00',  chg:  18, color: '#8b7df7', pct: 28 },
  { sym: 'BTC',    name: 'Bitcoin',             bal: '5.050',  usd: '$320,250.00', chg:  24, color: '#f7931a', pct: 44 },
  { sym: 'ETH',    name: 'Ethereum',            bal: '94.30',  usd: '$178,150.00', chg:  -6, color: '#627eea', pct: 16 },
  { sym: 'wLITHO', name: 'Wrapped Lithosphere', bal: '5,000',  usd: '$1,500.00',   chg:  18, color: '#a395f8', pct:  7 },
  { sym: 'FGPT',   name: 'FractalGPT',          bal: '80,000', usd: '$1,200.00',   chg:  42, color: '#10b981', pct:  5 },
];

const TXS = [
  { sym: 'LITHO',  name: 'Lithosphere',         date: 'Jan 22, 2026', price: '$0.30',   status: 'Completed', amount: '+1,200 LITHO', pos: true,  color: '#8b7df7' },
  { sym: 'BTC',    name: 'Bitcoin',             date: 'Jan 20, 2026', price: '$63,200', status: 'Completed', amount: '+0.142 BTC',   pos: true,  color: '#f7931a' },
  { sym: 'ETH',    name: 'Ethereum',            date: 'Jan 19, 2026', price: '$2,814',  status: 'Completed', amount: '-1.500 ETH',   pos: false, color: '#627eea' },
  { sym: 'wLITHO', name: 'Wrapped Lithosphere', date: 'Jan 18, 2026', price: '$0.30',   status: 'Completed', amount: '+500 wLITHO',  pos: true,  color: '#a395f8' },
  { sym: 'FGPT',   name: 'FractalGPT',          date: 'Jan 17, 2026', price: '$0.015',  status: 'Completed', amount: '-2,000 FGPT',  pos: false, color: '#10b981' },
  { sym: 'USDC',   name: 'USD Coin',            date: 'Jan 15, 2026', price: '$1.00',   status: 'Pending',   amount: '+840 USDC',    pos: true,  color: '#2775ca' },
];

/* ──────────────────────── Chart paths ──────────────────────── */
// Performance chart: Mon→Sun, generally upward
const PERF_LINE = 'M 22,165 C 48,160 72,156 96,152 C 120,148 145,144 168,138 C 191,132 214,116 238,100 C 262,84 285,76 308,68 C 331,60 358,47 382,40 C 402,34 428,24 452,17 C 468,13 482,9 498,7';
const PERF_AREA = `${PERF_LINE} L 498,185 L 22,185 Z`;

// Price analytics sparkline: Dec 1–31, volatile purple line matching reference
const ANALYTICS_LINE = 'M 6,72 L 12,68 L 18,74 L 24,60 L 30,54 L 36,62 L 42,56 L 48,66 L 54,58 L 60,42 L 66,38 L 70,48 L 76,32 L 82,26 L 88,34 L 94,20 L 100,30 L 106,38 L 112,28 L 118,16 L 124,22 L 130,14 L 136,10 L 142,18 L 148,12 L 154,22 L 160,16 L 165,20';

/* ──────────────────────── Chart components ──────────────────────── */

function PerformanceChart() {
  return (
    <div>
      <svg width="100%" viewBox="0 0 520 192" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="lineG" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b7af7"/>
            <stop offset="100%" stopColor="#06b6d4"/>
          </linearGradient>
          <linearGradient id="areaG" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="rgba(59,122,247,0.16)"/>
            <stop offset="100%" stopColor="rgba(59,122,247,0.00)"/>
          </linearGradient>
        </defs>
        {/* Subtle grid */}
        {[42, 84, 126, 168].map(y => (
          <line key={y} x1="0" y1={y} x2="520" y2={y} stroke="currentColor" opacity="0.06" strokeWidth="1"/>
        ))}
        <path d={PERF_AREA} fill="url(#areaG)"/>
        <path d={PERF_LINE} fill="none" stroke="url(#lineG)" strokeWidth="2.25" strokeLinejoin="round"/>
        {/* Callout at Thu ≈ (238, 100) */}
        <line x1="238" y1="110" x2="238" y2="185" stroke="rgba(59,122,247,0.28)" strokeWidth="1" strokeDasharray="3 3"/>
        <circle cx="238" cy="100" r="10" fill="rgba(59,122,247,0.15)"/>
        <circle cx="238" cy="100" r="4.5" fill="#3b7af7" stroke="#fff" strokeWidth="2"/>
        <g transform="translate(148, 70)">
          <rect width="122" height="22" rx="6" fill="#3b7af7"/>
          <text x="61" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="Geist Mono,monospace" fontWeight="600">$920.00 · Jan 22</text>
        </g>
      </svg>
    </div>
  );
}

function PriceSparkline() {
  const area = `${ANALYTICS_LINE} L 165,82 L 6,82 Z`;
  return (
    <svg width="100%" viewBox="0 0 172 90" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkG" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(139,125,247,0.35)"/>
          <stop offset="60%" stopColor="rgba(139,125,247,0.08)"/>
          <stop offset="100%" stopColor="rgba(139,125,247,0.0)"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkG)"/>
      <path d={ANALYTICS_LINE} fill="none" stroke="#8b7df7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
      {/* Low point dot */}
      <circle cx="6" cy="72" r="3.5" fill="#8b7df7" stroke="var(--bg-card)" strokeWidth="1.5"/>
      {/* High point dot */}
      <circle cx="136" cy="10" r="3.5" fill="#8b7df7" stroke="var(--bg-card)" strokeWidth="1.5"/>
    </svg>
  );
}

/* ──────────────────────── Right panel widgets ──────────────────────── */

function ExchangeWidget() {
  const [fromAmt, setFromAmt] = useState('1.420');

  return (
    <div className="card">
      <div className="exchange-header">
        <span className="card-title">Exchange</span>
        <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>›</button>
      </div>

      {/* From */}
      <div className="coin-row">
        <div className="coin-icon" style={{ background: '#f7931a' }}>₿</div>
        <div className="coin-pick">BTC <ChevDown size={11}/></div>
        <input
          className="coin-amount"
          value={fromAmt}
          onChange={e => setFromAmt(e.target.value)}
          type="number"
        />
      </div>
      <div className="coin-balance">Balance: 5.050 BTC</div>

      <div className="swap-divider">
        <button className="swap-btn"><ArrowsUD size={13}/></button>
      </div>

      {/* To */}
      <div className="coin-row">
        <div className="coin-icon" style={{ background: '#627eea' }}>Ξ</div>
        <div className="coin-pick">ETH <ChevDown size={11}/></div>
        <span className="coin-amount" style={{ display: 'block', userSelect: 'none' }}>23.035</span>
      </div>

      <button className="btn-exchange">Exchange</button>
    </div>
  );
}

function PortfolioList() {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">My Portfolio</span>
        <button className="icon-btn-sm" style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>View all</button>
      </div>
      <div className="portfolio-list">
        {COINS.filter(c => c.sym !== '···').map(c => (
          <div key={c.sym} className="portfolio-row">
            <div className="portfolio-icon" style={{ background: c.color }}>
              {c.sym.slice(0,1)}
            </div>
            <div>
              <div className="portfolio-name">{c.name}</div>
              <div className="portfolio-sym">{c.bal} {c.sym}</div>
            </div>
            <div className="portfolio-right">
              <div className="portfolio-price">{c.usd}</div>
              <div className={`portfolio-chg ${c.chg >= 0 ? 'pos' : 'neg'}`}>
                {c.chg >= 0 ? '+' : ''}{c.chg}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AIAssistant() {
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 10 }}>AI Assistant</div>
      <div className="ai-body">
        <div className="ai-icon"><Bot size={17}/></div>
        <div>
          <div className="ai-title">Optimize your portfolio balance</div>
          <div className="ai-sub">Your portfolio may benefit from better asset diversification across chains.</div>
        </div>
      </div>
    </div>
  );
}

function StakingCard() {
  return (
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
      <div className="staking-meta">
        <span>41 days left · 4 months total</span>
        <span>68%</span>
      </div>
      <div className="staking-bar">
        <div className="staking-bar-fill" style={{ width: '68%' }}/>
      </div>
    </div>
  );
}

/* ──────────────────────── Dashboard ──────────────────────── */

function DashboardView({ onAction, isFreshWallet, liveEth }: { onAction: (a: 'send'|'receive'|'swap') => void; isFreshWallet: boolean; liveEth: string | null }) {
  const balance = isFreshWallet ? '$0.00' : '$3,150,298.00';
  const change  = isFreshWallet ? null    : '+2.34% · 24h';
  const liveLine = liveEth !== null
    ? `Live ETH: ${parseFloat(liveEth).toFixed(6)} ETH`
    : null;
  return (
    <>
      {/* Hero: balance + quick actions */}
      <div className="balance-hero">
        <div>
          <div className="balance-label">Total balance</div>
          <div className="balance-amount">
            {balance}
            {change && <span className="balance-change-pill">▲ {change}</span>}
          </div>
          {liveLine && (
            <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 8, fontFamily: 'Geist Mono, monospace', fontWeight: 500 }}>
              ● {liveLine}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { label: 'Send',    icon: <Send2 size={14}/>,    action: 'send'    as const },
            { label: 'Receive', icon: <Download2 size={14}/>, action: 'receive' as const },
            { label: 'Swap',    icon: <Repeat2 size={14}/>,   action: 'swap'    as const },
          ]).map(a => (
            <button key={a.label} onClick={() => onAction(a.action)} className="quick-action-btn">
              <span className="quick-action-icon">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Allocation: bar + per-coin grid wrapped in card */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="alloc-bar">
          {COINS.map(c => (
            <div key={c.sym} className="alloc-seg" style={{ flex: c.pct, background: c.color }}/>
          ))}
        </div>
        <div className="alloc-coins">
          {COINS.map(c => (
            <div key={c.sym} className="alloc-coin">
              <div className="alloc-coin-top">
                <div className="alloc-dot" style={{ background: c.color }}/>
                <span className="alloc-name">
                  {c.name}{c.sym !== '···' ? ` (${c.sym})` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div className="alloc-val">{c.usd}</div>
                <div className={`alloc-chg ${c.chg >= 0 ? 'pos' : 'neg'}`}>{c.chg >= 0 ? '+' : ''}{c.chg}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Charts row */}
      <div className="charts-row">
        {/* Price analytics */}
        <div className="card price-analytics-card">
          <div className="card-header">
            <span className="card-title">Price analytics</span>
            <button className="icon-btn-sm"><Expand size={13}/></button>
          </div>
          <PriceSparkline/>
          <div className="analytics-prices">
            <span className="analytics-price">$5,240.00</span>
            <span className="analytics-price">$12,900.00</span>
          </div>
          <div className="analytics-date">
            <span>1 Dec, 2025</span>
            <span>31 Dec, 2025</span>
          </div>
        </div>

        {/* Performance chart */}
        <div className="card perf-chart-card">
          <div className="card-header">
            <span className="card-title">Portfolio performance</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="chart-selector">This week <ChevDown size={11}/></button>
              <button className="icon-btn-sm"><Expand size={13}/></button>
            </div>
          </div>
          <PerformanceChart/>
          <div className="chart-xaxis">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Payment history */}
      <div className="card">
        <div className="table-top">
          <span className="card-title">Payment history</span>
          <button className="chart-selector">Last month <ChevDown size={11}/></button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Date</th>
              <th>Price</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {TXS.map((tx, i) => (
              <tr key={i}>
                <td>
                  <div className="tx-cell">
                    <div className="tx-avatar" style={{ background: tx.color }}>
                      {tx.sym.slice(0, 2)}
                    </div>
                    <div>
                      <div className="tx-name">{tx.name}</div>
                      <div className="tx-sym">{tx.sym}</div>
                    </div>
                  </div>
                </td>
                <td>{tx.date}</td>
                <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{tx.price}</td>
                <td>
                  <span className={`status-pill ${
                    tx.status === 'Completed' ? 'status-completed' :
                    tx.status === 'Pending'   ? 'status-pending'   : 'status-failed'
                  }`}>
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
    </>
  );
}

/* ──────────────────────── Modal overlay ──────────────────────── */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────── Send modal ──────────────────────── */
function SendModal({ onClose }: { onClose: () => void }) {
  const [coin, setCoin] = useState('LITHO');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState(false);

  const balMap: Record<string, string> = { LITHO: '4,280.00', BTC: '5.050', ETH: '94.30', SOL: '148.2', USDC: '840.00' };

  if (sent) return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-success">
        <div className="success-icon">✓</div>
        <div className="success-title">Transaction Sent</div>
        <div className="success-sub">{amount} {coin} sent to {to.slice(0,8)}…</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">Asset</label>
        <select className="field-select" value={coin} onChange={e => setCoin(e.target.value)}>
          {['LITHO','wLITHO','FGPT','BTC','ETH','USDC'].map(s => <option key={s}>{s}</option>)}
        </select>

        <label className="field-label" style={{ marginTop: 14 }}>Recipient address</label>
        <input className="field-input" placeholder="0x… or wallet address" value={to} onChange={e => setTo(e.target.value)}/>

        <label className="field-label" style={{ marginTop: 14 }}>Amount</label>
        <div style={{ position: 'relative' }}>
          <input className="field-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} type="number" style={{ paddingRight: 60 }}/>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{coin}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Balance: {balMap[coin] ?? '—'} {coin}
          <button style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }} onClick={() => setAmount(balMap[coin] ?? '')}>MAX</button>
        </div>

        <div className="fee-row">
          <span>Network fee</span>
          <span>~$1.24 (Fast)</span>
        </div>

        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!to || !amount}
          onClick={() => setSent(true)}
        >
          Send {coin}
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────── Receive modal ──────────────────────── */
function ReceiveModal({ onClose, addresses }: { onClose: () => void; addresses?: { evm: string; btc: string; sol: string } }) {
  const fallback = { evm: '0x70cA2F2B7E3d9F1a4C8b5D2e6A0f3C9B7E1d4F2a', btc: 'bc1q…', sol: '11111…' };
  const ad = addresses ?? fallback;
  const [chain, setChain] = useState<'evm'|'btc'|'sol'>('evm');
  const [copied, setCopied] = useState(false);

  const meta = {
    evm: { label: 'Ethereum / EVM',  network: 'Mainnet · ETH/ERC-20 · wLITHO', color: '#627eea' },
    btc: { label: 'Bitcoin',          network: 'Mainnet · Native SegWit',       color: '#f7931a' },
    sol: { label: 'Lithosphere',      network: 'Makalu · LITHO/FGPT',           color: '#8b7df7' },
  } as const;

  const addr = ad[chain];

  const copy = () => {
    navigator.clipboard.writeText(addr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {/* Chain selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, width: '100%' }}>
          {(['evm','btc','sol'] as const).map(c => (
            <button key={c} onClick={() => setChain(c)} className={`filter-pill ${chain === c ? 'active' : ''}`} style={{ flex: 1, fontSize: 11 }}>
              {c === 'evm' ? 'EVM' : c === 'btc' ? 'BTC' : 'LITHO'}
            </button>
          ))}
        </div>

        {/* QR placeholder */}
        <div className="qr-box">
          <svg viewBox="0 0 100 100" width="140" height="140">
            <rect x="5" y="5" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="14" y="14" width="20" height="20" rx="2" fill="currentColor"/>
            <rect x="57" y="5" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="66" y="14" width="20" height="20" rx="2" fill="currentColor"/>
            <rect x="5" y="57" width="38" height="38" rx="4" fill="none" stroke="currentColor" strokeWidth="3"/>
            <rect x="14" y="66" width="20" height="20" rx="2" fill="currentColor"/>
            {[57,63,69,75,81,87,93].map((x,i) =>
              [57,63,69,75,81,87,93].map((y,j) =>
                (i+j)%2===0 ? <rect key={`${i}${j}`} x={x} y={y} width="4" height="4" fill="currentColor" opacity="0.7"/> : null
              )
            )}
          </svg>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{meta[chain].label}</div>
        <div style={{ fontSize: 10, color: meta[chain].color, fontWeight: 600, marginBottom: 8 }}>● {meta[chain].network}</div>
        <div className="addr-box" style={{ fontSize: 10 }}>{addr.length > 50 ? `${addr.slice(0,30)}…${addr.slice(-12)}` : addr}</div>

        <button className="btn-primary" onClick={copy} style={{ marginTop: 14, width: '100%' }}>
          {copied ? '✓ Copied!' : 'Copy Address'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          Only send {meta[chain].label} assets to this address.
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────── Swap modal ──────────────────────── */
function SwapModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('LITHO');
  const [to, setTo]     = useState('ETH');
  const [amt, setAmt]   = useState('100');
  const rates: Record<string, Record<string, number>> = {
    LITHO:  { wLITHO: 1.0,    FGPT: 20.0,   BTC: 0.0000050, ETH: 0.0000832, USDC: 0.30 },
    wLITHO: { LITHO: 1.0,     FGPT: 20.0,   BTC: 0.0000050, ETH: 0.0000832, USDC: 0.30 },
    FGPT:   { LITHO: 0.05,    wLITHO: 0.05, BTC: 0.00000025, ETH: 0.00000416, USDC: 0.015 },
    BTC:    { LITHO: 199867,  wLITHO: 199867, FGPT: 4213333, ETH: 16.22, USDC: 63200 },
    ETH:    { LITHO: 12018,   wLITHO: 12018,  FGPT: 259467,  BTC: 0.0617, USDC: 3892 },
  };
  const out = (rates[from]?.[to] ?? 1) * parseFloat(amt || '0');

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['LITHO','wLITHO','FGPT','BTC','ETH'].map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>

        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}><ArrowsUD size={13}/></button>
        </div>

        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={to} onChange={e => setTo(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['wLITHO','LITHO','FGPT','ETH','BTC','USDC'].map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {out.toFixed(4)}
          </div>
        </div>

        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {(rates[from]?.[to] ?? 0).toLocaleString()} {to}</span>
        </div>
        <div className="fee-row">
          <span>Network fee</span>
          <span>~$2.10</span>
        </div>

        <button className="btn-primary" style={{ marginTop: 18 }}>Swap {from} → {to}</button>
      </div>
    </Modal>
  );
}

/* ──────────────────────── Market view ──────────────────────── */
const MARKET = [
  { sym: 'LITHO',  name: 'Lithosphere',         price: '$0.300',     chg24: 18.4, chg7: 32.1, cap: '$298M',   vol: '$24.5M', color: '#8b7df7' },
  { sym: 'BTC',    name: 'Bitcoin',             price: '$63,200.00', chg24: 2.4,  chg7: 8.1,  cap: '$1.24T',  vol: '$38.2B', color: '#f7931a' },
  { sym: 'ETH',    name: 'Ethereum',            price: '$3,892.00',  chg24: -1.2, chg7: 4.3,  cap: '$468B',   vol: '$18.4B', color: '#627eea' },
  { sym: 'wLITHO', name: 'Wrapped Lithosphere', price: '$0.300',     chg24: 18.4, chg7: 32.1, cap: '$84M',    vol: '$6.8M',  color: '#a395f8' },
  { sym: 'FGPT',   name: 'FractalGPT',          price: '$0.0150',    chg24: 42.3, chg7: 88.7, cap: '$24M',    vol: '$3.2M',  color: '#10b981' },
  { sym: 'BNB',    name: 'BNB',                 price: '$418.30',    chg24: 0.8,  chg7: 2.1,  cap: '$62.1B',  vol: '$1.8B',  color: '#f3ba2f' },
  { sym: 'XRP',  name: 'XRP',          price: '$0.6280',    chg24: -3.4, chg7: -6.2, cap: '$34.8B',  vol: '$2.3B',  color: '#00aae4' },
  { sym: 'ADA',  name: 'Cardano',      price: '$0.5140',    chg24: 1.1,  chg7: 3.8,  cap: '$18.2B',  vol: '$0.9B',  color: '#0033ad' },
  { sym: 'AVAX', name: 'Avalanche',    price: '$38.40',     chg24: 4.2,  chg7: 9.4,  cap: '$15.6B',  vol: '$0.7B',  color: '#e84142' },
  { sym: 'DOT',  name: 'Polkadot',     price: '$8.720',     chg24: -0.6, chg7: 1.2,  cap: '$11.4B',  vol: '$0.4B',  color: '#e6007a' },
  { sym: 'DOGE', name: 'Dogecoin',     price: '$0.1024',    chg24: 6.3,  chg7: 18.2, cap: '$14.6B',  vol: '$1.1B',  color: '#c2a633' },
  { sym: 'LINK', name: 'Chainlink',    price: '$14.82',     chg24: 2.9,  chg7: 7.3,  cap: '$8.7B',   vol: '$0.5B',  color: '#2a5ada' },
];

function MarketView() {
  const [search, setSearch] = useState('');
  const filtered = MARKET.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.sym.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Market</h1>
        <div className="search-field">
          <Search size={13} color="var(--text-muted)"/>
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
              <tr key={c.sym} style={{ cursor: 'pointer' }}>
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
  );
}

/* ──────────────────────── Portfolio view ──────────────────────── */
function PortfolioView() {
  const coins = [
    { sym: 'LITHO',  name: 'Lithosphere',         bal: '50,000', usd: 15000,  chg: 18,  color: '#8b7df7', pct: 28, price: '$0.30' },
    { sym: 'BTC',    name: 'Bitcoin',             bal: '5.050',  usd: 320250, chg: 24,  color: '#f7931a', pct: 44, price: '$63,200' },
    { sym: 'ETH',    name: 'Ethereum',            bal: '94.30',  usd: 178150, chg: -6,  color: '#627eea', pct: 16, price: '$3,892' },
    { sym: 'wLITHO', name: 'Wrapped Lithosphere', bal: '5,000',  usd: 1500,   chg: 18,  color: '#a395f8', pct: 7,  price: '$0.30' },
    { sym: 'FGPT',   name: 'FractalGPT',          bal: '80,000', usd: 1200,   chg: 42,  color: '#10b981', pct: 5,  price: '$0.015' },
  ];

  // Donut chart
  let offset = 0;
  const r = 70, circ = 2 * Math.PI * r;
  const segments = coins.map(c => {
    const len = (c.pct / 100) * circ;
    const seg = { ...c, offset, len };
    offset += len;
    return seg;
  });

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Portfolio</h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Updated just now</div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Donut */}
        <div className="card" style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24 }}>
          <div style={{ position: 'relative', width: 180, height: 180 }}>
            <svg viewBox="0 0 180 180" width="180" height="180" style={{ transform: 'rotate(-90deg)' }}>
              {segments.map((s, i) => (
                <circle key={i} cx="90" cy="90" r={r}
                  fill="none" stroke={s.color} strokeWidth="22"
                  strokeDasharray={`${s.len - 2} ${circ - s.len + 2}`}
                  strokeDashoffset={-s.offset}/>
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

        {/* Holdings table */}
        <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Holdings</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th style={{ textAlign: 'right' }}>24h</th>
                <th style={{ textAlign: 'right' }}>Allocation</th>
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
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                      <div style={{ width: 60, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${c.pct}%`, height: '100%', background: c.color, borderRadius: 2 }}/>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 28, textAlign: 'right' }}>{c.pct}%</span>
                    </div>
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

/* ──────────────────────── Transactions view ──────────────────────── */
const ALL_TXS = [
  { sym: 'LITHO',  name: 'Lithosphere',         date: 'Jan 22, 2026', price: '$0.30',   type: 'Receive', status: 'Completed', amount: '+1,200 LITHO',  pos: true,  color: '#8b7df7' },
  { sym: 'BTC',    name: 'Bitcoin',             date: 'Jan 20, 2026', price: '$63,200', type: 'Receive', status: 'Completed', amount: '+0.142 BTC',    pos: true,  color: '#f7931a' },
  { sym: 'ETH',    name: 'Ethereum',            date: 'Jan 19, 2026', price: '$2,814',  type: 'Send',    status: 'Completed', amount: '-1.500 ETH',    pos: false, color: '#627eea' },
  { sym: 'wLITHO', name: 'Wrapped Lithosphere', date: 'Jan 18, 2026', price: '$0.30',   type: 'Swap',    status: 'Completed', amount: '+500 wLITHO',   pos: true,  color: '#a395f8' },
  { sym: 'FGPT',   name: 'FractalGPT',          date: 'Jan 17, 2026', price: '$0.015',  type: 'Send',    status: 'Completed', amount: '-2,000 FGPT',   pos: false, color: '#10b981' },
  { sym: 'USDC',   name: 'USD Coin',            date: 'Jan 15, 2026', price: '$1.00',   type: 'Receive', status: 'Pending',   amount: '+840 USDC',     pos: true,  color: '#2775ca' },
  { sym: 'ETH',    name: 'Ethereum',            date: 'Jan 14, 2026', price: '$3,100',  type: 'Swap',    status: 'Completed', amount: '+4.20 ETH',     pos: true,  color: '#627eea' },
  { sym: 'LITHO',  name: 'Lithosphere',         date: 'Jan 12, 2026', price: '$0.28',   type: 'Send',    status: 'Failed',    amount: '-500 LITHO',    pos: false, color: '#8b7df7' },
  { sym: 'BNB',    name: 'BNB',                 date: 'Jan 10, 2026', price: '$398.20', type: 'Receive', status: 'Completed', amount: '+2.50 BNB',     pos: true,  color: '#f3ba2f' },
  { sym: 'BTC',    name: 'Bitcoin',             date: 'Jan 8, 2026',  price: '$59,400', type: 'Receive', status: 'Completed', amount: '+0.080 BTC',    pos: true,  color: '#f7931a' },
  { sym: 'USDC',   name: 'USD Coin',            date: 'Jan 5, 2026',  price: '$1.00',   type: 'Send',    status: 'Completed', amount: '-250 USDC',     pos: false, color: '#2775ca' },
];

function TransactionsView() {
  const [filter, setFilter] = useState<'All'|'Send'|'Receive'|'Swap'>('All');
  const filtered = filter === 'All' ? ALL_TXS : ALL_TXS.filter(t => t.type === filter);

  return (
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
                <td>
                  <span className={`type-pill type-${tx.type.toLowerCase()}`}>{tx.type}</span>
                </td>
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
  );
}

/* ──────────────────────── Staking view ──────────────────────── */
const POOLS = [
  { name: 'Lithosphere Validator', sym: 'LITHO',  apy: '18.40%', minStake: '100 LITHO',  tvl: '$58M',   color: '#8b7df7', locked: false },
  { name: 'Wrapped LITHO Pool',    sym: 'wLITHO', apy: '14.20%', minStake: '50 wLITHO',  tvl: '$22M',   color: '#a395f8', locked: false },
  { name: 'FractalGPT Stake',      sym: 'FGPT',   apy: '32.50%', minStake: '1,000 FGPT', tvl: '$8.4M',  color: '#10b981', locked: true  },
  { name: 'Ethereum 2.0',          sym: 'ETH',    apy: '4.20%',  minStake: '0.01 ETH',   tvl: '$12.4B', color: '#627eea', locked: false },
];

function StakingView() {
  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Staking</h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Earn passive yield on your assets</div>
      </div>

      {/* Active position */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Active Position</div>
        <StakingCard/>
      </div>

      {/* Available pools */}
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
  );
}

/* ──────────────────────── Settings view ──────────────────────── */
function SettingsView({ toggleTheme, isDark }: { toggleTheme: () => void; isDark: boolean }) {
  const [currency, setCurrency] = useState('USD');
  const [autoLock, setAutoLock] = useState('5');
  const [rpc, setRpc]           = useState('https://rpc.litho.ai');

  const Section = ({
    icon: Icon, title, sub, children,
  }: { icon: React.ElementType; title: string; sub: string; children: React.ReactNode }) => (
    <section className="settings-section">
      <header className="settings-section-head">
        <div className="settings-section-icon"><Icon size={18}/></div>
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
    <div className="settings-view">
      <div className="settings-wrap">
        <header className="settings-hero">
          <h1 className="settings-hero-title">Settings</h1>
          <p className="settings-hero-sub">
            Manage your wallet preferences, security, and network configuration.
          </p>
        </header>

        <Section icon={Globe} title="General" sub="Display, language, and theme">
          <Row label="Currency" sub="Display prices in">
            <select className="settings-select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {['USD','EUR','GBP','JPY','BTC'].map(c => <option key={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="Appearance" sub={isDark ? 'Dark theme' : 'Light theme'}>
            <button className="settings-btn" onClick={toggleTheme}>
              {isDark ? <Sun size={14}/> : <Moon size={14}/>} {isDark ? 'Switch to light' : 'Switch to dark'}
            </button>
          </Row>
          <Row label="Language" sub="Interface language">
            <select className="settings-select" defaultValue="English">
              <option>English</option><option>Spanish</option><option>Arabic</option>
            </select>
          </Row>
        </Section>

        <Section icon={Shield} title="Security" sub="Protect access to your wallet">
          <Row label="Auto-lock" sub="Lock wallet after inactivity">
            <select className="settings-select" value={autoLock} onChange={e => setAutoLock(e.target.value)}>
              {[['1','1 minute'],['5','5 minutes'],['15','15 minutes'],['60','1 hour'],['0','Never']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          <Row label="Change password" sub="Update your wallet password">
            <button className="settings-btn"><KeyIcon size={14}/> Change</button>
          </Row>
          <Row label="Backup seed phrase" sub="Export your 12/24-word recovery phrase">
            <button className="settings-btn settings-btn-danger"><Download2 size={14}/> Export</button>
          </Row>
          <Row label="Lock wallet now" sub="Sign out on this device">
            <button className="settings-btn"><Lock2 size={14}/> Lock</button>
          </Row>
        </Section>

        <Section icon={Wifi} title="Network" sub="Connection and RPC endpoints">
          <Row label="RPC endpoint" sub="Custom RPC for Makalu">
            <input className="settings-input" value={rpc} onChange={e => setRpc(e.target.value)}/>
          </Row>
          <Row label="Connected network" sub="Current blockchain">
            <span className="settings-network-pill">
              <span className="settings-network-dot"/> Makalu
            </span>
          </Row>
        </Section>

        <Section icon={Info} title="About" sub="Build info and version">
          <Row label="Version" sub="Thanos Wallet Desktop">
            <span className="settings-version">v0.8.1</span>
          </Row>
          <Row label="Build" sub="Release channel">
            <span className="settings-version">Stable</span>
          </Row>
          <Row label="Clear cache" sub="Remove local cached data">
            <button className="settings-btn">Clear</button>
          </Row>
          <Row label="Documentation" sub="Read the desktop guide">
            <a href="#" className="settings-btn settings-btn-link">View <ChevRight2 size={14}/></a>
          </Row>
        </Section>
      </div>
    </div>
  );
}

/* ──────────────────────── Onboarding ──────────────────────── */

const SEED_WORDS_DICT = [
  'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse',
  'access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act',
  'action','actor','actress','actual','adapt','add','addict','address','adjust','admit',
  'adult','advance','advice','aerobic','affair','afford','afraid','again','age','agent',
  'agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert',
  'alien','all','alley','allow','almost','alone','alpha','already','also','alter',
  'always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger',
  'angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique',
  'anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic',
  'area','arena','argue','arm','armed','armor','army','around','arrange','arrest',
  'arrive','arrow','art','artefact','artist','aspect','assault','asset','assist','assume',
  'asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august',
  'aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away',
];

function generateSeedPhrase(_words = 12): string[] {
  // Real BIP39 mnemonic via ethers v6 (browser-native, no Buffer polyfill needed)
  const wallet = Wallet.createRandom();
  return wallet.mnemonic!.phrase.split(' ');
}

function isValidMnemonic(phrase: string): boolean {
  try { Mnemonic.fromPhrase(phrase.trim().toLowerCase()); return true; }
  catch { return false; }
}

interface DerivedAddresses {
  evm:  string;
  btc:  string;  // BTC public-key derivation placeholder
  sol:  string;  // Solana placeholder until we add tweetnacl
  short: string;
}

function deriveAddressesFromSeed(seed: string[]): DerivedAddresses {
  const phrase = seed.join(' ');
  let evm = '0x0000000000000000000000000000000000000000';
  let btc = 'bc1qplaceholder';
  let sol = '11111111111111111111111111111111';
  try {
    // Real EVM address from BIP44 m/44'/60'/0'/0/0
    const evmNode = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0");
    evm = evmNode.address;

    // BTC: BIP84 native segwit path m/84'/0'/0'/0/0 — use compressed public key as display
    // (proper P2WPKH would need bech32 encoding; we display the pubkey hex prefixed for now)
    const btcNode = HDNodeWallet.fromPhrase(phrase, undefined, "m/84'/0'/0'/0/0");
    btc = 'bc1q' + btcNode.publicKey.slice(4, 44).toLowerCase();

    // SOL: deterministic display address derived from a separate path until tweetnacl is added
    const solNode = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/501'/0'/0'");
    sol = solNode.address.slice(2);  // 40-char hex stand-in
  } catch (e) { console.warn('Address derivation failed:', e); }
  const short = evm.length > 12 ? `${evm.slice(0,6)}…${evm.slice(-4)}` : evm;
  return { evm, btc, sol, short };
}

function deriveAddressFromSeed(seed: string[]): string {
  return deriveAddressesFromSeed(seed).evm;
}

async function fetchEthBalance(addr: string): Promise<string | null> {
  try {
    const provider = new JsonRpcProvider('https://eth.llamarpc.com');
    const wei = await provider.getBalance(addr);
    return formatEther(wei);
  } catch (e) {
    console.warn('ETH balance fetch failed:', e);
    return null;
  }
}

type OnboardStep = 'welcome' | 'create-warn' | 'create-show' | 'create-confirm' | 'create-password'
                 | 'import' | 'import-password' | 'unlock' | 'done';

function OnboardingFlow({ onComplete, hasVault }: { onComplete: (seed: string[], pwd: string) => void; hasVault: boolean }) {
  const [step, setStep] = useState<OnboardStep>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
  /* Verify-phrase: only N indices missing; user fills them from a pool */
  const VERIFY_MISSING = 4;
  const [missingIdxs, setMissingIdxs] = useState<number[]>([]);
  const [verifyPicks, setVerifyPicks] = useState<Record<number, string>>({});
  const [verifyPool,  setVerifyPool]  = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [showPwd, setShowPwd]     = useState(false);

  const startCreate = () => {
    setSeed(generateSeedPhrase(12));
    setStep('create-warn');
  };

  const goToConfirm = () => {
    const idxs = Array.from({ length: seed.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, VERIFY_MISSING).sort((a, b) => a - b);
    setMissingIdxs(idxs);
    setVerifyPicks({});
    setVerifyPool(idxs.map(i => seed[i]).sort(() => Math.random() - 0.5));
    setStep('create-confirm');
  };
  const pickWord = (w: string) => {
    const nextEmpty = missingIdxs.find(i => verifyPicks[i] === undefined);
    if (nextEmpty === undefined) return;
    setVerifyPicks(prev => ({ ...prev, [nextEmpty]: w }));
    setVerifyPool(prev => {
      const i = prev.indexOf(w);
      return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)];
    });
  };
  const unpickAt = (slotIdx: number) => {
    const w = verifyPicks[slotIdx];
    if (w === undefined) return;
    setVerifyPicks(prev => { const next = { ...prev }; delete next[slotIdx]; return next; });
    setVerifyPool(prev => [...prev, w]);
  };
  const allConfirmed = missingIdxs.length > 0 && missingIdxs.every(i => verifyPicks[i] === seed[i]);
  const orderMismatch = missingIdxs.length > 0 && missingIdxs.every(i => verifyPicks[i] !== undefined) && !allConfirmed;

  const [vaultBusy, setVaultBusy] = useState(false);

  const finishCreate = async () => {
    if (password !== password2 || password.length < 8 || vaultBusy) return;
    setVaultBusy(true);
    try {
      const vault = await createVault(seed.join(' '), password);
      saveVault(vault);
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(seed, password);
    } finally {
      setVaultBusy(false);
    }
  };

  const finishImport = async () => {
    if (password !== password2 || password.length < 8 || vaultBusy) return;
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) return;
    setVaultBusy(true);
    try {
      const vault = await createVault(words.join(' '), password);
      saveVault(vault);
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(words, password);
    } finally {
      setVaultBusy(false);
    }
  };

  const tryUnlock = async () => {
    if (vaultBusy) return;
    setVaultBusy(true);
    setUnlockErr('');
    try {
      const vault = loadVault();
      if (!vault) {
        setUnlockErr('No wallet found on this device.');
        return;
      }
      const opened = await openVault(vault, unlockPwd);
      if (!opened) {
        setUnlockErr('Incorrect password');
        setUnlockPwd('');
        return;
      }
      cacheSessionKey(opened.key);
      onComplete(opened.mnemonic.split(' '), unlockPwd);
    } finally {
      setVaultBusy(false);
    }
  };

  return (
    <div className="onboard-wrap">
      <div className="onboard-card">
        <div className="onboard-logo">
          <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos"/>
        </div>

        {/* WELCOME ─────────────────────────────────────────── */}
        {step === 'welcome' && (
          <>
            <h1 className="onboard-title">Welcome to Thanos</h1>
            <p className="onboard-sub">A multi-chain Web4 wallet — Lithosphere, Bitcoin, EVM.</p>
            <button className="btn-primary onboard-btn" onClick={startCreate}>Create new wallet</button>
            <button className="btn-outline onboard-btn" style={{ width: '100%', height: 42 }} onClick={() => setStep('import')}>Import existing wallet</button>
          </>
        )}

        {/* CREATE — WARNING ────────────────────────────────── */}
        {step === 'create-warn' && (
          <>
            <h1 className="onboard-title">Save your recovery phrase</h1>
            <p className="onboard-sub">12 words below are the only way to restore your wallet. Anyone with these words has full access. Never share them, never store them online.</p>
            <ul className="warn-list">
              <li>Write them down on paper</li>
              <li>Keep them somewhere safe and private</li>
              <li>Thanos team will never ask for this phrase</li>
            </ul>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('welcome')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => setStep('create-show')}>I understand</button>
            </div>
          </>
        )}

        {/* CREATE — SHOW SEED ──────────────────────────────── */}
        {step === 'create-show' && (
          <>
            <h1 className="onboard-title">Your recovery phrase</h1>
            <p className="onboard-sub">Write these 12 words down in order. You'll confirm them next.</p>
            <div className="seed-grid">
              {seed.map((w, i) => (
                <div key={i} className="seed-word">
                  <span className="seed-num">{i + 1}.</span>{w}
                </div>
              ))}
            </div>
            <button className="btn-link" onClick={() => navigator.clipboard?.writeText(seed.join(' '))}>Copy to clipboard</button>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('create-warn')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={goToConfirm}>I've written it down</button>
            </div>
          </>
        )}

        {/* CREATE — CONFIRM SEED ───────────────────────────── */}
        {step === 'create-confirm' && (
          <>
            <h1 className="onboard-title">Verify your phrase</h1>
            <p className="onboard-sub">Fill in the {VERIFY_MISSING} missing words by tapping from the pool below. Tap a filled slot to undo.</p>
            <div className="seed-grid">
              {seed.map((word, i) => {
                const isMissing = missingIdxs.includes(i);
                const picked = verifyPicks[i];
                const filled = picked !== undefined;
                const wrong = orderMismatch && filled && seed[i] !== picked;
                if (!isMissing) {
                  return (
                    <div key={i} className="seed-word seed-faded">
                      <span className="seed-num">{i + 1}.</span>
                      <span>{word}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className={`seed-word seed-slot${filled ? ' filled' : ''}${wrong ? ' wrong' : ''}`}
                    onClick={() => filled && unpickAt(i)}
                  >
                    <span className="seed-num">{i + 1}.</span>
                    <span>{picked ?? ' '}</span>
                  </div>
                );
              })}
            </div>
            <div className="seed-pool">
              {verifyPool.map((w, i) => (
                <button key={`${w}-${i}`} type="button" className="seed-pool-chip" onClick={() => pickWord(w)}>{w}</button>
              ))}
            </div>
            {orderMismatch && <div className="onboard-err">Order doesn't match. Tap slots to undo and try again.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('create-show')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={!allConfirmed} onClick={() => setStep('create-password')}>Continue</button>
            </div>
          </>
        )}

        {/* CREATE — PASSWORD ───────────────────────────────── */}
        {step === 'create-password' && (
          <>
            <h1 className="onboard-title">Set a password</h1>
            <p className="onboard-sub">Used to unlock your wallet on this device. Minimum 8 characters.</p>
            <input className="field-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 10 }}/>
            <input className="field-input" type="password" placeholder="Confirm password" value={password2} onChange={e => setPassword2(e.target.value)}/>
            {password && password2 && password !== password2 && <div className="onboard-err">Passwords don't match</div>}
            {password && password.length < 8 && <div className="onboard-err">Min 8 characters</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('create-confirm')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={password.length < 8 || password !== password2 || vaultBusy} onClick={finishCreate}>
                {vaultBusy ? 'Encrypting…' : 'Create wallet'}
              </button>
            </div>
          </>
        )}

        {/* IMPORT ──────────────────────────────────────────── */}
        {step === 'import' && (
          <>
            <h1 className="onboard-title">Import wallet</h1>
            <p className="onboard-sub">Paste your 12, 15, 18, 21, or 24-word recovery phrase.</p>
            <textarea
              className="field-input"
              style={{ height: 90, resize: 'none', fontFamily: 'Geist Mono, monospace', fontSize: 12 }}
              placeholder="word1 word2 word3 …"
              value={importInput}
              onChange={e => setImportInput(e.target.value)}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{importInput.trim().split(/\s+/).filter(Boolean).length} words</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('welcome')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={![12,15,18,21,24].includes(importInput.trim().split(/\s+/).filter(Boolean).length)} onClick={() => setStep('import-password')}>Continue</button>
            </div>
          </>
        )}

        {/* IMPORT — PASSWORD ───────────────────────────────── */}
        {step === 'import-password' && (
          <>
            <h1 className="onboard-title">Set a password</h1>
            <p className="onboard-sub">Used to unlock the imported wallet on this device.</p>
            <input className="field-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 10 }}/>
            <input className="field-input" type="password" placeholder="Confirm password" value={password2} onChange={e => setPassword2(e.target.value)}/>
            {password && password2 && password !== password2 && <div className="onboard-err">Passwords don't match</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-outline" style={{ flex: 1, height: 42 }} onClick={() => setStep('import')}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={password.length < 8 || password !== password2 || vaultBusy} onClick={finishImport}>
                {vaultBusy ? 'Encrypting…' : 'Import wallet'}
              </button>
            </div>
          </>
        )}

        {/* UNLOCK (returning user) ─────────────────────────── */}
        {step === 'unlock' && (
          <>
            <p className="onboard-tagline">Secure and trusted multi-chain crypto wallet</p>

            <label className="field-label-pro">Password</label>
            <div className="input-with-trail">
              <input
                className="field-input field-input-with-trail"
                type={showPwd ? 'text' : 'password'}
                value={unlockPwd}
                onChange={e => { setUnlockPwd(e.target.value); setUnlockErr(''); }}
                onKeyDown={e => e.key === 'Enter' && tryUnlock()}
                autoFocus
              />
              <button
                type="button"
                className="input-trail-btn"
                onClick={() => setShowPwd(s => !s)}
                tabIndex={-1}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>

            {unlockErr && <div className="onboard-err">{unlockErr}</div>}

            <button className="btn-primary btn-pill" onClick={tryUnlock} disabled={!unlockPwd || vaultBusy}>
              {vaultBusy ? 'Unlocking…' : 'Unlock'}
            </button>

            <div className="onboard-footer">
              <p className="footer-text">Can't login? You can erase your current wallet and set up a new one</p>
              <button className="footer-link" onClick={() => {
                if (confirm('This will delete your wallet from this device. You can restore it with your recovery phrase. Continue?')) {
                  clearVault();
                  setStep('welcome');
                }
              }}>Reset wallet</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── App ──────────────────────── */

const NAV: { key: View; label: string }[] = [
  { key: 'dashboard',    label: 'Dashboard'    },
  { key: 'market',       label: 'Market'       },
  { key: 'portfolio',    label: 'Portfolio'    },
  { key: 'transactions', label: 'Transactions' },
  { key: 'staking',      label: 'Staking'      },
  { key: 'settings',     label: 'Settings'     },
];

type Modal = 'send' | 'receive' | 'swap' | null;

function App() {
  const [view, setView]     = useState<View>('dashboard');
  const [isDark, setIsDark] = useState(false);
  const [modal, setModal]   = useState<Modal>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [walletSeed, setWalletSeed] = useState<string[]>([]);
  const [hasVault, setHasVault] = useState(false);
  const [liveEth, setLiveEth] = useState<string | null>(null);
  const [accountMenu, setAccountMenu] = useState(false);

  const addrs = walletSeed.length > 0
    ? deriveAddressesFromSeed(walletSeed)
    : { evm: ACCOUNT.address, btc: 'bc1q…', sol: '11111…', short: ACCOUNT.address };
  const walletAddr = addrs.evm;
  const shortAddr  = addrs.short;

  useEffect(() => {
    if (!unlocked || walletSeed.length === 0) return;
    let cancelled = false;
    fetchEthBalance(walletAddr).then(b => { if (!cancelled) setLiveEth(b); });
    return () => { cancelled = true; };
  }, [unlocked, walletAddr, walletSeed.length]);

  // Vault gate: migrate plaintext if present, then try the session-cached
  // key to skip the password prompt on refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (async () => {
      if (hasLegacyPlaintext()) {
        const mig = await migrateLegacyPlaintext();
        if (mig.ok && mig.key) cacheSessionKey(mig.key);
      }
      const vault = loadVault();
      setHasVault(!!vault);
      if (!vault) return;
      const key = getSessionKey();
      if (!key) return;
      const mnemonic = await openVaultWithKey(vault, key);
      if (mnemonic) {
        setWalletSeed(mnemonic.split(' '));
        setUnlocked(true);
      } else {
        clearSessionKey();
      }
    })().catch(() => { /* fall through to onboarding */ });
  }, []);

  useEffect(() => {
    // Default to LIGHT unless user explicitly chose dark
    const stored = localStorage.getItem('thanos-theme');
    const dark   = stored === 'dark';
    setIsDark(dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem('thanos-theme', next ? 'dark' : 'light');
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      return next;
    });
  };

  // Show onboarding/unlock until wallet is unlocked.
  // The session AES key is cached inside OnboardingFlow itself on success;
  // here we just flip the local React state.
  if (!unlocked) {
    return (
      <OnboardingFlow
        hasVault={hasVault}
        onComplete={(seed, _pwd) => {
          setWalletSeed(seed);
          setHasVault(true);
          setUnlocked(true);
        }}
      />
    );
  }

  const lock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    clearSessionKey();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Top navigation */}
      <nav className="topnav">
        <div className="topnav-logo">
          <div className="logo-mark">
            <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos" style={{ width: 34, height: 34, objectFit: 'contain', display: 'block' }}/>
          </div>
        </div>

        <div className="nav-tabs">
          {NAV.map(n => (
            <button
              key={n.key}
              className={`nav-tab ${view === n.key ? 'active' : ''}`}
              onClick={() => setView(n.key)}
            >
              {n.label}
            </button>
          ))}
        </div>

        {/* Spacer pushes right section to far right */}
        <div style={{ flex: 1 }}/>

        <div className="topnav-right">
          <div style={{ position: 'relative' }}>
            <button className="account-chip" onClick={() => setAccountMenu(v => !v)}>
              <div className="chip-avatar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </div>
              <div className="chip-info">
                <span className="chip-name">{ACCOUNT.name}</span>
                <span className="chip-addr">{shortAddr}</span>
              </div>
              <ChevDown size={11} color="var(--text-muted)"/>
            </button>

            {accountMenu && (
              <>
                <div className="menu-overlay" onClick={() => setAccountMenu(false)}/>
                <div className="account-menu">
                  <div className="menu-header">
                    <div className="menu-avatar">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <circle cx="12" cy="8" r="4"/>
                        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                      </svg>
                    </div>
                    <div>
                      <div className="menu-name">{ACCOUNT.name}</div>
                      <div className="menu-addr">{shortAddr}</div>
                    </div>
                  </div>

                  <div className="menu-network">
                    <span className="menu-net-dot"/>
                    <span>Makalu</span>
                    <span className="menu-net-status">synced</span>
                  </div>

                  <div className="menu-divider"/>

                  <button className="menu-item" onClick={() => { navigator.clipboard?.writeText(walletAddr); setAccountMenu(false); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy address
                  </button>

                  <button className="menu-item" onClick={() => { setView('settings'); setAccountMenu(false); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Settings
                  </button>

                  <button className="menu-item" onClick={() => { toggleTheme(); setAccountMenu(false); }}>
                    {isDark
                      ? <Sun size={16}/>
                      : <Moon size={16}/>}
                    {isDark ? 'Light mode' : 'Dark mode'}
                  </button>

                  <div className="menu-divider"/>

                  <button className="menu-item menu-item-danger" onClick={() => { lock(); setAccountMenu(false); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    Lock wallet
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="icon-btn-nav" title="Search"><Search size={14}/></button>
          <button className="icon-btn-nav" title="Notifications" style={{ position: 'relative' }}>
            <Bell size={14}/>
            <span style={{
              position: 'absolute', top: 6, right: 6,
              width: 5, height: 5, background: '#3b7af7',
              borderRadius: '50%', border: '1.5px solid var(--bg-surface)',
            }}/>
          </button>
        </div>
      </nav>

      {/* Modals */}
      {modal === 'send'    && <SendModal    onClose={() => setModal(null)}/>}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)} addresses={{ evm: addrs.evm, btc: addrs.btc, sol: addrs.sol }}/>}
      {modal === 'swap'    && <SwapModal    onClose={() => setModal(null)}/>}

      {/* Workspace */}
      <div className="workspace">
        <div className="main-area">
          {view === 'dashboard'    && <DashboardView onAction={setModal} isFreshWallet={walletSeed.length > 0 && !localStorage.getItem('thanos.has_data')} liveEth={liveEth}/>}
          {view === 'market'       && <MarketView/>}
          {view === 'portfolio'    && <PortfolioView/>}
          {view === 'transactions' && <TransactionsView/>}
          {view === 'staking'      && <StakingView/>}
          {view === 'settings'     && <SettingsView toggleTheme={toggleTheme} isDark={isDark}/>}
        </div>

        {view !== 'settings' && (
          <aside className="right-panel">
            <ExchangeWidget/>
            <PortfolioList/>
            <AIAssistant/>
            <StakingCard/>
          </aside>
        )}
      </div>

    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
