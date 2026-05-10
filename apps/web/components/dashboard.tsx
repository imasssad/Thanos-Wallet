'use client';
import React, { useState } from 'react';

const COINS = [
  { sym: 'BTC', name: 'Bitcoin',     bal: '5.050',  usd: '$320,250.00', chg:  24, color: '#f7931a', pct: 44 },
  { sym: 'ETH', name: 'Ethereum',    bal: '94.30',  usd: '$178,150.00', chg:  -6, color: '#627eea', pct: 33 },
  { sym: 'SOL', name: 'Solana',      bal: '148.2',  usd: '$17,548.00',  chg:  10, color: '#14f195', pct: 14 },
  { sym: '···', name: 'Other Coins', bal: '—',      usd: '$17,548.00',  chg:   2, color: '#52525b', pct:  9 },
];

const TXS = [
  { sym: 'BTC',  name: 'Bitcoin',   date: 'Jan 22, 2026', price: '$63,200', status: 'Completed', amount: '+0.142 BTC', pos: true,  color: '#f7931a' },
  { sym: 'ETH',  name: 'Ethereum',  date: 'Jan 20, 2026', price: '$2,814',  status: 'Completed', amount: '-1.500 ETH', pos: false, color: '#627eea' },
  { sym: 'SOL',  name: 'Solana',    date: 'Jan 19, 2026', price: '$118.40', status: 'Completed', amount: '+12.00 SOL', pos: true,  color: '#14f195' },
  { sym: 'BTC',  name: 'Bitcoin',   date: 'Jan 17, 2026', price: '$61,800', status: 'Completed', amount: '-0.050 BTC', pos: false, color: '#f7931a' },
  { sym: 'USDC', name: 'USD Coin',  date: 'Jan 15, 2026', price: '$1.00',   status: 'Pending',   amount: '+840 USDC',  pos: true,  color: '#2775ca' },
];

const PERF_LINE = 'M 22,165 C 48,160 72,156 96,152 C 120,148 145,144 168,138 C 191,132 214,116 238,100 C 262,84 285,76 308,68 C 331,60 358,47 382,40 C 402,34 428,24 452,17 C 468,13 482,9 498,7';
const PERF_AREA = `${PERF_LINE} L 498,185 L 22,185 Z`;
const ANALYTICS_LINE = 'M 6,72 L 12,68 L 18,74 L 24,60 L 30,54 L 36,62 L 42,56 L 48,66 L 54,58 L 60,42 L 66,38 L 70,48 L 76,32 L 82,26 L 88,34 L 94,20 L 100,30 L 106,38 L 112,28 L 118,16 L 124,22 L 130,14 L 136,10 L 142,18 L 148,12 L 154,22 L 160,16 L 165,20';

function PerformanceChart() {
  return (
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
      {[42, 84, 126, 168].map(y => (
        <line key={y} x1="0" y1={y} x2="520" y2={y} stroke="currentColor" opacity="0.06" strokeWidth="1"/>
      ))}
      <path d={PERF_AREA} fill="url(#areaG)"/>
      <path d={PERF_LINE} fill="none" stroke="url(#lineG)" strokeWidth="2.25" strokeLinejoin="round"/>
      <line x1="238" y1="110" x2="238" y2="185" stroke="rgba(59,122,247,0.28)" strokeWidth="1" strokeDasharray="3 3"/>
      <circle cx="238" cy="100" r="10" fill="rgba(59,122,247,0.15)"/>
      <circle cx="238" cy="100" r="4.5" fill="#3b7af7" stroke="#fff" strokeWidth="2"/>
      <g transform="translate(148, 70)">
        <rect width="122" height="22" rx="6" fill="#3b7af7"/>
        <text x="61" y="14" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="Geist Mono,monospace" fontWeight="600">$920.00 · Jan 22</text>
      </g>
    </svg>
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
      <circle cx="6" cy="72" r="3.5" fill="#8b7df7" stroke="var(--bg-card)" strokeWidth="1.5"/>
      <circle cx="136" cy="10" r="3.5" fill="#8b7df7" stroke="var(--bg-card)" strokeWidth="1.5"/>
    </svg>
  );
}

function ExchangeWidget() {
  const [fromAmt, setFromAmt] = useState('1.420');
  return (
    <div className="card">
      <div className="exchange-header">
        <span className="card-title">Exchange</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</span>
      </div>
      <div className="coin-row">
        <div className="coin-icon" style={{ background: '#f7931a' }}>₿</div>
        <div className="coin-pick">BTC ▾</div>
        <input className="coin-amount" value={fromAmt} onChange={e => setFromAmt(e.target.value)} type="number"/>
      </div>
      <div className="coin-balance">Balance: 5.050 BTC</div>
      <div className="swap-divider"><button className="swap-btn">⇅</button></div>
      <div className="coin-row">
        <div className="coin-icon" style={{ background: '#627eea' }}>Ξ</div>
        <div className="coin-pick">ETH ▾</div>
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
            <div className="portfolio-icon" style={{ background: c.color }}>{c.sym.slice(0,1)}</div>
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

function StakingCard() {
  return (
    <div className="staking-card">
      <div className="staking-brand">
        <div className="staking-brand-icon">S</div>
        Solstice
      </div>
      <div className="staking-row">
        <div className="staking-token-icon">eU</div>
        <div>
          <div className="staking-token-name">eUSX</div>
          <div className="staking-token-sub">Unlocks: 11 Jan, 2026</div>
        </div>
        <div className="staking-yield">
          <div className="staking-yield-label">Annual yield</div>
          <div className="staking-yield-val">10.05%</div>
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

export function Dashboard() {
  return (
    <div className="workspace" style={{ width: '100%' }}>
      <div className="main-area">
        <div className="balance-hero">
          <div>
            <div className="balance-label">Total balance</div>
            <div className="balance-amount">
              $3,150,298.00
              <span className="balance-change-pill">▲ +2.34%</span>
            </div>
          </div>
        </div>

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

        <div className="charts-row">
          <div className="card price-analytics-card">
            <div className="card-header">
              <span className="card-title">Price analytics</span>
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

          <div className="card perf-chart-card">
            <div className="card-header">
              <span className="card-title">Portfolio performance</span>
              <button className="chart-selector">This week ▾</button>
            </div>
            <PerformanceChart/>
            <div className="chart-xaxis">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="table-top">
            <span className="card-title">Payment history</span>
            <button className="chart-selector">Last month ▾</button>
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
      </div>

      <aside className="right-panel">
        <ExchangeWidget/>
        <PortfolioList/>
        <StakingCard/>
      </aside>
    </div>
  );
}
