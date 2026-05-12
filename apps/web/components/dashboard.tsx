'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { ArrowUpRight, ArrowDownLeft, Repeat, ChevronRight, ChevronDown, Maximize2 } from 'lucide-react';
import { SendModal, ReceiveModal, SwapModal, type ModalKind } from './modals';
import { TokenIcon } from './TokenIcon';
import { useWallet } from './shell/AppShell';
import { getPortfolio, IndexerOffline, type IndexerAsset, type IndexerActivityItem } from '../lib/indexer';
import { usePrices, priceOr } from '../lib/usePrices';
import { getSolanaAddress, getSolanaBalance } from '../lib/solana';

import { TOKENS } from '../lib/tokens';

/* Default fallback coin rows derived from the canonical TOKENS list. Used
   on cold start and whenever the indexer is unreachable. */
const FALLBACK_COINS = (() => {
  const raw = TOKENS.map(t => {
    const balNum = parseFloat(t.balance.replace(/,/g, ''));
    const usdNum = balNum * t.priceUsd;
    return { ...t, balNum, usdNum };
  });
  const total = raw.reduce((s, c) => s + c.usdNum, 0) || 1;
  return raw.map(c => ({
    sym:   c.sym,
    name:  c.name,
    bal:   c.balance,
    usdNum: c.usdNum,
    usd:   `$${c.usdNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    chg:   c.change24h,
    color: c.color,
    pct:   Math.max(1, Math.round((c.usdNum / total) * 100)),
  }));
})();

const FALLBACK_TXS = [
  { sym: 'LITHO',  name: 'Lithosphere',                  date: 'Jan 22, 2026', price: '$0.30',   status: 'Completed', amount: '+1,200 LITHO',  pos: true,  color: '#3b7af7' },
  { sym: 'LitBTC', name: 'Bitcoin (Lithosphere)',        date: 'Jan 20, 2026', price: '$63,200', status: 'Completed', amount: '+0.142 LitBTC', pos: true,  color: '#f7931a' },
  { sym: 'JOT',    name: 'Jot Art',                      date: 'Jan 19, 2026', price: '$0.085', status: 'Completed', amount: '+850 JOT',      pos: true,  color: '#ef4444' },
  { sym: 'LAX',    name: 'Lithosphere Algorithmic',      date: 'Jan 18, 2026', price: '$1.00',   status: 'Completed', amount: '-200 LAX',      pos: false, color: '#06b6d4' },
  { sym: 'COLLE',  name: 'Colle AI',                     date: 'Jan 17, 2026', price: '$0.020',  status: 'Completed', amount: '+5,000 COLLE',  pos: true,  color: '#9ca3af' },
  { sym: 'FurGPT', name: 'FurGPT',                       date: 'Jan 15, 2026', price: '$0.015',  status: 'Pending',   amount: '-2,000 FurGPT', pos: false, color: '#f59e0b' },
];

/* Project an indexer asset onto a dashboard coin row, using canonical TOKENS
   for icon/color/price (the indexer doesn't ship that metadata).
   `prices` is the live CoinGecko snapshot; we prefer that over canonical. */
function projectAsset(a: IndexerAsset, prices: Record<string, number> | null) {
  const canon = TOKENS.find(t =>
    t.sym.toLowerCase() === a.symbol.toLowerCase()
    || (a.tokenAddress && t.address?.toLowerCase() === a.tokenAddress.toLowerCase())
  );
  let balNum = 0;
  let balStr = '0';
  try {
    const formatted = ethers.formatUnits(a.balance || '0', a.decimals ?? 18);
    balNum = parseFloat(formatted) || 0;
    balStr = balNum.toLocaleString('en-US', { maximumFractionDigits: 4 });
  } catch { /* malformed */ }
  const priceUsd = priceOr(prices, a.symbol, canon?.priceUsd ?? 0);
  return {
    sym:    a.symbol,
    name:   a.name || canon?.name || a.symbol,
    bal:    balStr,
    balNum,
    usdNum: balNum * priceUsd,
    chg:    canon?.change24h ?? 0,
    color:  canon?.color ?? '#52525b',
  };
}

function projectActivity(item: IndexerActivityItem) {
  const canon = TOKENS.find(t => t.sym.toLowerCase() === item.symbol.toLowerCase());
  const decimals = canon?.decimals ?? 18;
  let amountStr = item.amount;
  try {
    amountStr = parseFloat(ethers.formatUnits(item.amount, decimals))
      .toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch { /* leave raw */ }
  const isOut = item.type === 'send' || item.type === 'burn';
  return {
    sym:    item.symbol,
    name:   canon?.name ?? item.symbol,
    date:   item.ts ? new Date(item.ts).toLocaleDateString() : '—',
    price:  canon ? `$${canon.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '—',
    status: item.status === 'pending' ? 'Pending' : item.status === 'failed' ? 'Failed' : 'Completed',
    amount: `${isOut ? '-' : '+'}${amountStr} ${item.symbol}`,
    pos:    !isOut,
    color:  canon?.color ?? '#52525b',
  };
}

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

function ExchangeWidget({ liveBalances }: { liveBalances: Map<string, number> }) {
  const [fromSym, setFromSym] = useState('LITHO');
  const [toSym,   setToSym]   = useState(TOKENS.find(t => t.sym !== 'LITHO')?.sym ?? 'LitBTC');
  const [fromAmt, setFromAmt] = useState('1000');
  const [pickerOpen, setPickerOpen] = useState<'from' | 'to' | null>(null);

  const fromTok = TOKENS.find(t => t.sym === fromSym) ?? TOKENS[0];
  const toTok   = TOKENS.find(t => t.sym === toSym)   ?? TOKENS[1];
  const fromPrice = fromTok.priceUsd || 1;
  const toPrice   = toTok.priceUsd   || 1;
  const out = (parseFloat(fromAmt || '0') * (fromPrice / toPrice)).toFixed(4);

  // Live balance if the indexer has reported one, otherwise canonical mock.
  const fromBalNum =
    liveBalances.get(fromSym.toLowerCase())
    ?? parseFloat(fromTok.balance.replace(/,/g, ''))
    ?? 0;
  const fromBalDisplay = fromBalNum.toLocaleString('en-US', { maximumFractionDigits: 4 });

  const flip = () => {
    setFromSym(toSym);
    setToSym(fromSym);
  };

  const pick = (side: 'from' | 'to', sym: string) => {
    if (side === 'from') setFromSym(sym);
    else                 setToSym(sym);
    setPickerOpen(null);
  };

  return (
    <div className="card">
      <div className="exchange-header">
        <span className="card-title">Exchange</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</span>
      </div>

      {/* From row */}
      <div className="coin-row" style={{ position: 'relative' }}>
        <TokenIcon sym={fromTok.sym} icon={fromTok.icon} color={fromTok.color} size={32}/>
        <button
          className="coin-pick"
          type="button"
          onClick={() => setPickerOpen(p => p === 'from' ? null : 'from')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
        >
          {fromTok.sym} ▾
        </button>
        <input className="coin-amount" value={fromAmt} onChange={e => setFromAmt(e.target.value)} type="number"/>
        {pickerOpen === 'from' && <TokenPicker exclude={toSym} onPick={s => pick('from', s)}/>}
      </div>
      <div className="coin-balance">Balance: {fromBalDisplay} {fromTok.sym}</div>

      <div className="swap-divider">
        <button className="swap-btn" onClick={flip} type="button" aria-label="flip">⇅</button>
      </div>

      {/* To row */}
      <div className="coin-row" style={{ position: 'relative' }}>
        <TokenIcon sym={toTok.sym} icon={toTok.icon} color={toTok.color} size={32}/>
        <button
          className="coin-pick"
          type="button"
          onClick={() => setPickerOpen(p => p === 'to' ? null : 'to')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
        >
          {toTok.sym} ▾
        </button>
        <span className="coin-amount" style={{ display: 'block', userSelect: 'none' }}>{out}</span>
        {pickerOpen === 'to' && <TokenPicker exclude={fromSym} onPick={s => pick('to', s)}/>}
      </div>

      <button className="btn-exchange">Exchange</button>
    </div>
  );
}

function TokenPicker({ exclude, onPick }: { exclude: string; onPick: (sym: string) => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        zIndex: 30,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 10,
        padding: 4,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        maxHeight: 240,
        overflowY: 'auto',
      }}
      onClick={e => e.stopPropagation()}
    >
      {TOKENS.filter(t => t.sym !== exclude).map(t => (
        <button
          key={t.sym}
          onClick={() => onPick(t.sym)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%',
            padding: '8px 8px',
            borderRadius: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            textAlign: 'left',
          }}
          onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseOut={e  => (e.currentTarget.style.background = 'transparent')}
        >
          <TokenIcon sym={t.sym} icon={t.icon} color={t.color} size={24}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t.sym}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function PortfolioList({ coins }: { coins: typeof FALLBACK_COINS }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">My Assets</span>
        <button className="icon-btn-sm" style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>View all</button>
      </div>
      <div className="portfolio-list">
        {coins.filter(c => c.sym !== '···').map(c => (
          <div key={c.sym} className="portfolio-row">
            <TokenIcon sym={c.sym} color={c.color} size={32}/>
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

export function Dashboard() {
  const [modal, setModal] = useState<ModalKind>(null);
  const wallet = useWallet();
  const evmAddress = wallet?.evmAddress;
  const prices    = usePrices();

  const [liveAssets,   setLiveAssets]   = useState<IndexerAsset[] | null>(null);
  const [liveActivity, setLiveActivity] = useState<IndexerActivityItem[] | null>(null);
  const [indexerOk,    setIndexerOk]    = useState<boolean>(true);

  useEffect(() => {
    if (!evmAddress) return;
    let cancel = false;
    (async () => {
      try {
        const p = await getPortfolio(evmAddress);
        if (cancel) return;
        setLiveAssets(p.assets ?? []);
        setLiveActivity(p.activity ?? []);
        setIndexerOk(true);
      } catch (e) {
        if (cancel) return;
        if (e instanceof IndexerOffline) {
          setIndexerOk(false);
          setLiveAssets([]);
          setLiveActivity([]);
        } else {
          throw e;
        }
      }
    })();
    return () => { cancel = true; };
  }, [evmAddress]);

  /* Solana balance — fetched direct from Solana RPC (the LITHO indexer
     doesn't track non-EVM chains). Only mnemonic wallets can derive a
     SOL address; private-key imports stay EVM-only for now. */
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const walletSeed = wallet?.seed;
  useEffect(() => {
    if (!walletSeed?.length) { setSolBalance(null); return; }
    let cancel = false;
    (async () => {
      try {
        const addr = getSolanaAddress(walletSeed.join(' '));
        const bal  = await getSolanaBalance(addr);
        if (!cancel) setSolBalance(parseFloat(bal));
      } catch {
        if (!cancel) setSolBalance(null);
      }
    })();
    return () => { cancel = true; };
  }, [walletSeed]);

  /* Build the coin rows: prefer live indexer data, fall back to canonical
     TOKENS so the dashboard renders the moment the user lands on it. Both
     paths use live CoinGecko prices when available. SOL is appended
     separately because the indexer is EVM-only. */
  const COINS = useMemo(() => {
    const solToken = TOKENS.find(t => t.sym === 'SOL');
    const solRow = (solBalance !== null && solToken)
      ? {
          sym:    'SOL',
          name:   solToken.name,
          bal:    solBalance.toLocaleString('en-US', { maximumFractionDigits: 4 }),
          balNum: solBalance,
          usdNum: solBalance * priceOr(prices, 'SOL', solToken.priceUsd),
          chg:    solToken.change24h,
          color:  solToken.color,
        }
      : null;

    const fromLive = (liveAssets ?? []).map(a => projectAsset(a, prices)).filter(c => c.balNum > 0);
    if (fromLive.length === 0) {
      // Recompute the canonical fallback with live prices overlaid.
      const raw = TOKENS.filter(t => t.sym !== 'SOL').map(t => {
        const balNum = parseFloat(t.balance.replace(/,/g, ''));
        const usdNum = balNum * priceOr(prices, t.sym, t.priceUsd);
        return {
          sym: t.sym, name: t.name, bal: t.balance, usdNum, chg: t.change24h, color: t.color,
        };
      });
      // Drop in real SOL if we have it, alongside the canonical fallback rows.
      if (solRow) raw.push({ sym: solRow.sym, name: solRow.name, bal: solRow.bal, usdNum: solRow.usdNum, chg: solRow.chg, color: solRow.color });
      const total = raw.reduce((s, c) => s + c.usdNum, 0) || 1;
      return raw.map(c => ({
        ...c,
        usd: `$${c.usdNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        pct: Math.max(1, Math.round((c.usdNum / total) * 100)),
      }));
    }
    const combined = solRow ? [...fromLive, solRow] : fromLive;
    const total = combined.reduce((s, c) => s + c.usdNum, 0) || 1;
    return combined.map(c => ({
      sym: c.sym, name: c.name, bal: c.bal, usdNum: c.usdNum,
      usd: `$${c.usdNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      chg: c.chg, color: c.color,
      pct: Math.max(1, Math.round((c.usdNum / total) * 100)),
    }));
  }, [liveAssets, prices]);

  const TXS = useMemo(() => {
    if (!liveActivity || liveActivity.length === 0) return FALLBACK_TXS;
    return liveActivity.slice(0, 6).map(projectActivity);
  }, [liveActivity]);

  const totalUsd = COINS.reduce((s, c) => s + c.usdNum, 0);
  const totalDisplay = `$${totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  // 24h change: weighted average of per-coin changes by USD value.
  const weighted = COINS.reduce((s, c) => s + (c.chg * c.usdNum), 0);
  const change24h = totalUsd > 0 ? (weighted / totalUsd) : 0;

  // For the Exchange widget — map of lowercase symbol → live balance number.
  const liveBalances = useMemo(() => {
    const m = new Map<string, number>();
    (liveAssets ?? []).map(a => projectAsset(a, prices)).forEach(a => m.set(a.sym.toLowerCase(), a.balNum));
    return m;
  }, [liveAssets, prices]);

  return (
    <div className="workspace" style={{ width: '100%' }}>
      {modal === 'send'    && <SendModal    onClose={() => setModal(null)}/>}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)}/>}
      {modal === 'swap'    && <SwapModal    onClose={() => setModal(null)}/>}

      <div className="main-area">
        <div className="balance-hero">
          <div>
            <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Total balance
              {!indexerOk && (
                <span style={{
                  fontSize: 9, letterSpacing: 1, padding: '2px 6px',
                  background: 'var(--bg-elevated)', borderRadius: 4,
                  color: 'var(--text-secondary)', fontWeight: 600,
                }}>OFFLINE · sample</span>
              )}
            </div>
            <div className="balance-amount">
              {totalDisplay}
              <span className="balance-change-pill">
                {change24h >= 0 ? '▲' : '▼'} {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setModal('send')} className="quick-action-btn">
              <span className="quick-action-icon"><ArrowUpRight size={16} strokeWidth={2.5}/></span><span>Send</span>
            </button>
            <button onClick={() => setModal('receive')} className="quick-action-btn">
              <span className="quick-action-icon"><ArrowDownLeft size={16} strokeWidth={2.5}/></span><span>Receive</span>
            </button>
            <button onClick={() => setModal('swap')} className="quick-action-btn">
              <span className="quick-action-icon"><Repeat size={16} strokeWidth={2.5}/></span><span>Swap</span>
            </button>
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
              <span className="card-title">Asset performance</span>
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
                      <TokenIcon sym={tx.sym} color={tx.color} size={36} style={{ borderRadius: 10 }}/>
                      <div>
                        <div className="tx-name">{tx.name}</div>
                        <div className="tx-sym">{tx.sym}</div>
                      </div>
                    </div>
                  </td>
                  <td>{tx.date}</td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 15 }}>{tx.price}</td>
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
        <ExchangeWidget liveBalances={liveBalances}/>
        <PortfolioList coins={COINS}/>
        <StakingCard/>
      </aside>
    </div>
  );
}
