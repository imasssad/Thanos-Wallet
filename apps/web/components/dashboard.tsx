'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ethers } from 'ethers';
import {
  ArrowUpRight, ArrowDownLeft, Repeat,
  ChevronDown, MoreVertical, SlidersHorizontal, ExternalLink,
  Image as ImageIcon, Sparkles, BadgeCheck,
  Eye, EyeOff, ShieldCheck,
} from 'lucide-react';
import { SendModal, ReceiveModal, SwapModal, type ModalKind } from './modals';
import { LaxCardPromo, LaxCardModal } from './LaxCard';
import { QuanttCard } from './QuanttCard';
import { formatFiat, convertFromUsd, withCurrencyAffix } from '@thanos/sdk-core';
import { useDisplayCurrency } from '../lib/use-fx';
import { LithoSym } from './ui/LithoSym';
import { TokenDetailModal } from './TokenDetailModal';
import { Select } from './ui/Select';
import { TokenIcon } from './TokenIcon';
import { PortfolioChart } from './PortfolioChart';
import { FitText } from './FitText';
import { SecurityPanel } from './SecurityPanel';
import type { Holding } from '../lib/price-history';
import { useWallet } from './shell/AppShell';
import { getPortfolio, IndexerOffline, type IndexerAsset, type IndexerActivityItem } from '../lib/indexer';
import { loadPortfolioSnapshot, savePortfolioSnapshot } from '../lib/cache-store';
import { usePrices, useQuotes, priceOr } from '../lib/usePrices';
import { getSolanaAddress, getSolanaBalance } from '../lib/solana';
import { getBitcoinAddress, getBitcoinAddressFromSource, getBitcoinBalance } from '../lib/bitcoin';
import { getAllEvmNativeBalances, getEvmChain, type EvmChain } from '../lib/evm-chains';
import { getAllEvmTokenBalances, type EvmToken } from '../lib/evm-tokens';
import { pendingActivityRows } from '../lib/tx-store';

import { TOKENS } from '../lib/tokens';

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
  // Known only from a real source (LITHO/LAX static or live CoinGecko) —
  // no fabricated canon.priceUsd fallback, so a no-feed asset reads "—"
  // and contributes $0 to the total (client directive 2026-06-15).
  const priceUsd = prices?.[a.symbol] ?? null;
  return {
    sym:    a.symbol,
    name:   a.name || canon?.name || a.symbol,
    bal:    balStr,
    balNum,
    usdNum: balNum * (priceUsd ?? 0),
    priceKnown: priceUsd != null,
    chg:    canon?.change24h ?? 0,
    color:  canon?.color ?? '#52525b',
    /** Chain the asset lives on — drives the TokenIcon chain-badge. */
    chainId: a.chainId,
    /** True for the chain's native coin (LITHO/ETH/BNB/…). */
    native:  !!a.native,
  };
}

function projectActivity(item: IndexerActivityItem & { local?: boolean }) {
  const canon = TOKENS.find(t => t.sym.toLowerCase() === item.symbol.toLowerCase());
  // Both sources now carry a HUMAN-readable amount: the indexer formats by the
  // token's decimals (see services/indexer buildSeedActivity), and local
  // optimistic rows store the amount as the user typed it. So no formatUnits
  // decode here — just prettify with thousands separators when it's numeric.
  const asNum = Number(item.amount);
  const amountStr = Number.isFinite(asNum)
    ? asNum.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : item.amount;
  const isOut = item.type === 'send' || item.type === 'burn';
  return {
    sym:    item.symbol,
    name:   canon?.name ?? item.symbol,
    date:   item.ts ? new Date(item.ts).toLocaleDateString() : '—',
    price:  canon ? withCurrencyAffix(convertFromUsd(canon.priceUsd).toLocaleString('en-US', { maximumFractionDigits: 4 })) : '—',
    status: item.status === 'pending' ? 'Pending' : item.status === 'failed' ? 'Failed' : 'Completed',
    amount: `${isOut ? '-' : '+'}${amountStr} ${item.symbol}`,
    pos:    !isOut,
    color:  canon?.color ?? '#52525b',
  };
}

/* Build an SVG path "M x0,y0 L x1,y1 …" from a series of [time, price]
   pairs. Auto-scaled to the viewBox. */
function pricesToPath(prices: Array<[number, number]>, w: number, h: number): { line: string; area: string } | null {
  if (prices.length < 2) return null;
  const ys = prices.map(p => p[1]);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  // Honest Y-scaling (same rule as mobile): never let the domain be narrower
  // than ±1% of the mid value — auto-fitting min/max blew a stablecoin's
  // ±0.05% jitter up into full-height mountains ("$1.00 pumping 2x").
  const midY = (minY + maxY) / 2;
  const minSpan = midY * 0.02;
  if (midY > 0 && maxY - minY < minSpan) { minY = midY - minSpan / 2; maxY = midY + minSpan / 2; }
  const range = (maxY - minY) || 1;
  const stepX = w / (prices.length - 1);
  const points = prices.map((p, i) => [i * stepX, h - ((p[1] - minY) / range) * h * 0.85 - h * 0.075] as const);
  const line = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${w.toFixed(1)},${h.toFixed(1)} L 0,${h.toFixed(1)} Z`;
  return { line, area };
}

/** Live BTC price chart via CoinGecko market_chart endpoint. Cached
 *  in-memory for 5 minutes — same shape as usePrices. Used as a proxy
 *  for "the chain" until we have a real Lithosphere price oracle. */
function useMarketChart(coingeckoId: string, days = 7) {
  const [data, setData] = useState<Array<[number, number]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=usd&days=${days}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json() as { prices?: Array<[number, number]> };
        if (!cancelled && Array.isArray(json.prices)) setData(json.prices);
      } catch {
        /* swallow — UI shows empty state */
      }
    })();
    return () => { cancelled = true; };
  }, [coingeckoId, days]);
  return data;
}

type ChartRange = 7 | 30 | 365;

const RANGE_LABELS: Record<ChartRange, string> = {
  7:   '7D',
  30:  '30D',
  365: '1Y',
};

/* Single date formatter — used by AssetPerformanceCard's first/last
 * labels. Caches the en-GB formatter once so the chart re-renders
 * without recreating the Intl instance. */
const DAY_FMT = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' })
  : null;
function fmtDay(msSinceEpoch: number): string {
  if (!DAY_FMT) return new Date(msSinceEpoch).toLocaleDateString();
  return DAY_FMT.format(new Date(msSinceEpoch));
}
function fmtUsdShort(n: number): string {
  return formatFiat(n);
}

/** Asset performance card with a working 7D / 30D / 1Y toggle.
 *  Replaces the prior placeholder card that hardcoded $5,240 / $12,900
 *  / "1 Dec 2025" and shipped a dead "This week ▾" button. Pulls real
 *  BTC market history from CoinGecko's /market_chart endpoint — we use
 *  BTC as a portfolio-proxy until a Lithosphere price oracle exists. */
function AssetPerformanceCard() {
  const [range, setRange] = useState<ChartRange>(7);
  const points = useMarketChart('bitcoin', range);
  const path = useMemo(() => points ? pricesToPath(points, 520, 192) : null, [points]);

  const firstPoint = points?.[0];
  const lastPoint  = points?.[points.length - 1];
  const change = firstPoint && lastPoint && firstPoint[1] > 0
    ? ((lastPoint[1] - firstPoint[1]) / firstPoint[1]) * 100
    : null;

  // X-axis labels — evenly-spaced ticks across the actual data range
  // instead of static Mon..Sun. For 7D we show day names, for 30D / 1Y
  // we show dates.
  const xAxisLabels: string[] = useMemo(() => {
    if (!points || points.length < 2) return [];
    const TICKS = range === 7 ? 7 : 6;
    const step = (points.length - 1) / (TICKS - 1);
    const labels: string[] = [];
    for (let i = 0; i < TICKS; i++) {
      const idx = Math.min(points.length - 1, Math.round(i * step));
      const ts = points[idx][0];
      if (range === 7) {
        const dayName = new Date(ts).toLocaleDateString('en-US', { weekday: 'short' });
        labels.push(dayName);
      } else {
        labels.push(fmtDay(ts));
      }
    }
    return labels;
  }, [points, range]);

  return (
    <div className="card perf-chart-card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span className="card-title">Asset performance</span>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>BTC · {RANGE_LABELS[range]}</div>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-elevated)', padding: 3, borderRadius: 8 }}>
          {(Object.keys(RANGE_LABELS) as Array<`${ChartRange}`>).map((k) => {
            const r = Number(k) as ChartRange;
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                style={{
                  background: active ? 'var(--bg-card)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none', padding: '4px 10px', borderRadius: 6,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >{RANGE_LABELS[r]}</button>
            );
          })}
        </div>
      </div>

      {firstPoint && lastPoint && change !== null ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 16px 8px' }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{fmtUsdShort(lastPoint[1])}</span>
          <span className={change >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontSize: 13, fontWeight: 700 }}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {fmtDay(firstPoint[0])} → {fmtDay(lastPoint[0])}
          </span>
        </div>
      ) : null}

      {path ? (
        <svg width="100%" viewBox="0 0 520 192" style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="apcLine" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#3b7af7"/>
              <stop offset="100%" stopColor="#06b6d4"/>
            </linearGradient>
            <linearGradient id="apcArea" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor="rgba(59,122,247,0.16)"/>
              <stop offset="100%" stopColor="rgba(59,122,247,0.00)"/>
            </linearGradient>
          </defs>
          {[42, 84, 126, 168].map(y => (
            <line key={y} x1="0" y1={y} x2="520" y2={y} stroke="currentColor" opacity="0.06" strokeWidth="1"/>
          ))}
          <path d={path.area} fill="url(#apcArea)"/>
          <path d={path.line} fill="none" stroke="url(#apcLine)" strokeWidth="2.25" strokeLinejoin="round"/>
        </svg>
      ) : (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          Loading market data…
        </div>
      )}

      {xAxisLabels.length > 0 && (
        <div className="chart-xaxis">
          {xAxisLabels.map((d, i) => <span key={i}>{d}</span>)}
        </div>
      )}
    </div>
  );
}

function PerformanceChart() {
  const points = useMarketChart('bitcoin', 7);
  const path = useMemo(() => points ? pricesToPath(points, 520, 192) : null, [points]);
  if (!path) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Loading market data…
      </div>
    );
  }
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
      <path d={path.area} fill="url(#areaG)"/>
      <path d={path.line} fill="none" stroke="url(#lineG)" strokeWidth="2.25" strokeLinejoin="round"/>
    </svg>
  );
}

function PriceSparkline() {
  const points = useMarketChart('bitcoin', 30);
  const path = useMemo(() => points ? pricesToPath(points, 172, 90) : null, [points]);
  if (!path) {
    return <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 10 }}>Loading…</div>;
  }
  return (
    <svg width="100%" viewBox="0 0 172 90" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sparkG" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(139,125,247,0.35)"/>
          <stop offset="60%" stopColor="rgba(139,125,247,0.08)"/>
          <stop offset="100%" stopColor="rgba(139,125,247,0.0)"/>
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#sparkG)"/>
      <path d={path.line} fill="none" stroke="#8b7df7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
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

  // Live balance only — zero if nothing reported. No canonical fallback.
  const fromBalNum = liveBalances.get(fromSym.toLowerCase()) ?? 0;
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

function StakingCard() {
  return (
    <div style={{
      padding: '20px 16px', textAlign: 'center',
      background: 'var(--bg-elevated)',
      border: '1px dashed var(--border-default)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>No active stakes</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.5 }}>
        Lithosphere validator + LP staking opens with the next protocol
        rollout. Your active positions will appear here.
      </div>
    </div>
  );
}

/* ─── Skeletons (cold-load only) ───────────────────────────────────────
   Shimmer placeholders SHAPED like the real content, shown ONLY on a true
   cold first load (loading && no cached/prior data). Reuses the `.skeleton`
   shimmer class from globals.css; `sk-` wrappers just lay out the shapes. */

function Sk({ w, h, r = 6, style }: { w?: number | string; h: number; r?: number; style?: React.CSSProperties }) {
  return (
    <span
      className="skeleton"
      style={{ display: 'block', width: w ?? '100%', height: h, borderRadius: r, ...style }}
    />
  );
}

/** Token-row skeletons — same layout as the real coin rows below. */
function TokenRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="sk-token-rows" style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 4px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Sk w={44} h={44} r={22}/>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Sk w={90} h={14}/>
            <Sk w={140} h={11}/>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <Sk w={80} h={14}/>
            <Sk w={56} h={11}/>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Activity-row skeletons — matches the payment-history table rhythm. */
function ActivityRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card sk-activity">
      <div className="table-top" style={{ marginBottom: 8 }}>
        <Sk w={140} h={16}/>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 0', borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <Sk w={36} h={36} r={10}/>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Sk w={120} h={13}/>
              <Sk w={70} h={10}/>
            </div>
            <Sk w={80} h={13}/>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  // Re-render when the display currency changes. AppShell can't do this for us
  // — it holds the page as {children}, so its state never re-renders this tree.
  useDisplayCurrency();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [modal, setModal] = useState<ModalKind>(null);
  // Swap opened from the nav/footer renders full-screen; from the Home
  // quick-action it stays a pop-up. Tracks which entry point opened it.
  const [swapFull, setSwapFull] = useState(false);
  /** Token-detail screen — opened by tapping any token row. chainId rides
   *  along for EVM-native rows (ETH/BNB/…) so the screen labels the right
   *  network instead of assuming Makalu. */
  const [detail, setDetail] = useState<{ sym: string; chainId?: number } | null>(null);
  const wallet = useWallet();
  const evmAddress = wallet?.evmAddress;
  const prices    = usePrices();
  const quotes    = useQuotes();

  /* CACHED-FIRST: seed live state synchronously from THIS address's
     last-known-good snapshot so the dashboard paints real numbers on
     mount instead of blank/skeleton. A background refresh still runs
     (loading stays "live" until getPortfolio resolves). Purely additive —
     the fetch/offline logic below is unchanged. */
  const initialSnap = useMemo(() => loadPortfolioSnapshot(evmAddress), [evmAddress]);
  const [liveAssets,   setLiveAssets]   = useState<IndexerAsset[] | null>(initialSnap?.assets ?? null);
  const [liveActivity, setLiveActivity] = useState<IndexerActivityItem[] | null>(initialSnap?.activity ?? null);
  const [indexerOk,    setIndexerOk]    = useState<boolean>(true);

  /* When the address changes, swap to THAT address's snapshot (or null if
     none) before the background refresh lands. Skipped on the very first
     render — the useState initializers already applied the snapshot, and
     re-applying would clobber a fresh fetch that resolved first. */
  const firstAddrRef = React.useRef(true);
  useEffect(() => {
    if (firstAddrRef.current) { firstAddrRef.current = false; return; }
    const snap = loadPortfolioSnapshot(evmAddress);
    setLiveAssets(snap?.assets ?? null);
    setLiveActivity(snap?.activity ?? null);
  }, [evmAddress]);

  useEffect(() => {
    if (!evmAddress) return;
    let cancel = false;
    (async () => {
      try {
        const p = await getPortfolio(evmAddress);
        if (cancel) return;
        const assets   = p.assets ?? [];
        const activity = p.activity ?? [];
        setLiveAssets(assets);
        setLiveActivity(activity);
        setIndexerOk(true);
        // Only persist a real, successful result — never an offline/empty
        // fallback — so a good snapshot is never poisoned.
        savePortfolioSnapshot(evmAddress, { assets, activity });
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

  /* Solana + Bitcoin balances — fetched direct from their respective
     RPCs (the LITHO indexer doesn't track non-EVM chains).
     Solana: mnemonic-only (no SLIP-0010 derivation from raw secp256k1 PK).
     Bitcoin: works for both mnemonic (BIP84) and private-key imports
     (single P2WPKH keypair derived from the raw 32-byte key). */
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [btcBalance, setBtcBalance] = useState<number | null>(null);
  /* Per-chain EVM native balances (ETH on mainnet + L2s, BNB, POL, AVAX).
     Each chain is one parallel RPC call; one slow / dead endpoint doesn't
     block the rest. */
  const [evmChainBalances, setEvmChainBalances] = useState<Array<{ chain: EvmChain; balance: number }>>([]);
  const [evmTokenBalances, setEvmTokenBalances] = useState<Array<{ token: EvmToken; balance: number }>>([]);
  const walletSeed = wallet?.seed;
  const walletPk   = wallet?.privateKey;
  useEffect(() => {
    if (!walletSeed?.length && !walletPk) { setSolBalance(null); setBtcBalance(null); return; }
    let cancel = false;
    (async () => {
      // Solana — mnemonic only.
      if (walletSeed?.length) {
        try {
          const addr = getSolanaAddress(walletSeed.join(' '));
          const bal  = await getSolanaBalance(addr);
          if (!cancel) setSolBalance(parseFloat(bal));
        } catch {
          if (!cancel) setSolBalance(null);
        }
      } else {
        setSolBalance(null);
      }
      // Bitcoin — works for either source.
      try {
        const source = walletPk
          ? { kind: 'privateKey' as const, privateKey: walletPk }
          : { kind: 'mnemonic'   as const, mnemonic: walletSeed!.join(' ') };
        const addr = getBitcoinAddressFromSource(source);
        const bal  = await getBitcoinBalance(addr);
        if (!cancel) setBtcBalance(parseFloat(bal));
      } catch {
        if (!cancel) setBtcBalance(null);
      }
    })();
    return () => { cancel = true; };
  }, [walletSeed, walletPk]);

  /* EVM-chain native balances — Ethereum, BNB, Polygon, Base, Arbitrum,
     Linea, Optimism, Avalanche. Fired off in parallel via
     getAllEvmNativeBalances and stored as per-chain rows so the
     dashboard can show "ETH on Arbitrum" separately from "ETH on
     mainnet". */
  useEffect(() => {
    if (!evmAddress) { setEvmChainBalances([]); setEvmTokenBalances([]); return; }
    let cancel = false;
    (async () => {
      try {
        const rows = await getAllEvmNativeBalances(evmAddress);
        if (!cancel) setEvmChainBalances(rows.filter(r => r.balance > 0));
      } catch {
        if (!cancel) setEvmChainBalances([]);
      }
    })();
    // Stablecoins (USDT/USDC) across the same chains — separate so a slow
    // token read doesn't hold up the native-balance render.
    (async () => {
      try {
        const toks = await getAllEvmTokenBalances(evmAddress);
        if (!cancel) setEvmTokenBalances(toks);
      } catch {
        if (!cancel) setEvmTokenBalances([]);
      }
    })();
    return () => { cancel = true; };
  }, [evmAddress]);

  /* Build the coin rows STRICTLY from real chain state. No canonical
     fallback: if the indexer says zero and the non-EVM RPCs say zero,
     we show an empty list. This avoids the "wallet looks mocked" feel
     when the user is on a fresh testnet account. */
  const COINS = useMemo(() => {
    const buildNonEvmRow = (sym: 'SOL' | 'BTC', balance: number | null) => {
      const tok = TOKENS.find(t => t.sym === sym);
      if (balance === null || balance <= 0 || !tok) return null;
      const decimals = sym === 'BTC' ? 6 : 4;
      return {
        sym,
        name:   tok.name,
        bal:    balance.toLocaleString('en-US', { maximumFractionDigits: decimals }),
        balNum: balance,
        usdNum: balance * priceOr(prices, sym, tok.priceUsd),
        priceKnown: true,
        chg:    tok.change24h,
        color:  tok.color,
        chainId: undefined as number | undefined,
        native:  true,
      };
    };
    const solRow = buildNonEvmRow('SOL', solBalance);
    const btcRow = buildNonEvmRow('BTC', btcBalance);
    const extraRows = [solRow, btcRow].filter((r): r is NonNullable<typeof r> => r !== null);

    /* One row per EVM chain with a non-zero native balance. Symbol is
       displayed alone but `name` carries the chain context so the user
       can tell ETH-on-Arbitrum from ETH-on-mainnet. */
    const evmRows = evmChainBalances.map(({ chain, balance }) => ({
      sym:    chain.nativeSymbol,
      name:   chain.name,
      bal:    balance.toLocaleString('en-US', { maximumFractionDigits: 6 }),
      balNum: balance,
      usdNum: balance * priceOr(prices, chain.nativeSymbol, 0),
      priceKnown: true,
      chg:    0,
      color:  chain.color,
      chainId: chain.chainId as number | undefined,
      native:  true,
    }));

    /* Stablecoins (USDT/USDC) per EVM chain — one row each, the chain in the
       name so USDT-on-Ethereum reads distinct from USDT-on-BSC. Priced ~$1
       (CoinGecko if available, else $1 fallback). */
    const evmTokenRows = evmTokenBalances.map(({ token, balance }) => {
      const chainName = getEvmChain(token.chainId)?.name ?? `Chain ${token.chainId}`;
      return {
        sym:    token.symbol,
        name:   `${token.name} · ${chainName}`,
        bal:    balance.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        balNum: balance,
        usdNum: balance * priceOr(prices, token.symbol, 1),
        priceKnown: true,
        chg:    0,
        color:  token.symbol === 'USDT' ? '#26a17b' : '#2775ca',
        chainId: token.chainId as number | undefined,
        native:  false,
      };
    });

    const fromLive = (liveAssets ?? []).map(a => projectAsset(a, prices)).filter(c => c.balNum > 0);

    const combined = [...fromLive, ...evmRows, ...evmTokenRows, ...extraRows];
    const total = combined.reduce((s, c) => s + c.usdNum, 0) || 1;
    return combined.map(c => ({
      sym: c.sym, name: c.name, bal: c.bal, balNum: c.balNum, usdNum: c.usdNum,
      usd: c.priceKnown ? withCurrencyAffix(convertFromUsd(c.usdNum).toLocaleString('en-US', { maximumFractionDigits: 2 })) : '—',
      priceKnown: c.priceKnown,
      chg: c.chg, color: c.color,
      chainId: c.chainId, native: c.native,
      pct: Math.max(1, Math.round((c.usdNum / total) * 100)),
    }));
  }, [liveAssets, solBalance, btcBalance, evmChainBalances, evmTokenBalances, prices]);

  /* Bumped to force a recompute of the optimistic pending rows (localStorage
     mutations don't trigger React). Ticked when the Send modal closes and on
     a light interval so a just-broadcast tx shows instantly, and a pending
     row that reconciles/expires drops on its own. */
  const [pendingTick, setPendingTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPendingTick(t => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const TXS = useMemo(() => {
    // Confirmed/indexed activity rows.
    const indexed = (liveActivity ?? []).map(projectActivity);
    // Optimistic local sends not yet in the indexer result — deduped by hash
    // against the indexed rows, so a tx drops its Pending copy the moment the
    // indexer reports it (the real confirmed row wins).
    const indexedHashes = (liveActivity ?? [])
      .map(a => a.txHash ?? a.id)
      .filter((h): h is string => !!h);
    const pending = pendingActivityRows(indexedHashes).map(projectActivity);
    // Pending rows first (top of the list), then indexed. Cap at 6 like before.
    return [...pending, ...indexed].slice(0, 6);
    // pendingTick forces re-eval after a send / on the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveActivity, pendingTick]);

  const totalUsd = COINS.reduce((s, c) => s + c.usdNum, 0);
  // Converted into the active display currency (formatFiat applies that
  // currency's own decimals — 2 for USD/EUR/GBP, 0 for JPY, 6 for BTC).
  const totalDisplay = formatFiat(totalUsd);
  // Holdings for the portfolio history chart (qty + current USD value).
  const holdings: Holding[] = useMemo(
    () => COINS.filter(c => c.balNum > 0 && c.usdNum > 0)
               .map(c => ({ sym: c.sym, qty: c.balNum, usd: c.usdNum })),
    [COINS],
  );
  /* 24h change — weighted average of per-coin REAL changes by USD value.
     A coin without a real % source (Litho ecosystem tokens not on
     CoinGecko) is excluded from BOTH the numerator AND the
     denominator, so the average reflects only the assets we have a
     real movement source for. If no coin has a real change, change24h
     is `null` and the hero shows "—" rather than fake 0.00%. */
  const { change24h, change24hCoveredUsd } = (() => {
    let weighted = 0;
    let coveredUsd = 0;
    for (const c of COINS) {
      const q = quotes?.[c.sym];
      const chg = q?.chg24h;
      if (typeof chg === 'number') {
        weighted   += chg * c.usdNum;
        coveredUsd += c.usdNum;
      }
    }
    return {
      change24h:           coveredUsd > 0 ? (weighted / coveredUsd) : null,
      change24hCoveredUsd: coveredUsd,
    };
  })();

  // For the Exchange widget — map of lowercase symbol → live balance number.
  const liveBalances = useMemo(() => {
    const m = new Map<string, number>();
    (liveAssets ?? []).map(a => projectAsset(a, prices)).forEach(a => m.set(a.sym.toLowerCase(), a.balNum));
    return m;
  }, [liveAssets, prices]);

  /* MM-style home: centered vertical column. Hero balance → 4 big
     action buttons → tabs (Tokens / DeFi / NFTs / Activity) → tab body.
     The dense charts + Exchange widget + Staking from the prior layout
     are folded under the DeFi tab so nothing is lost; Activity wraps
     the Payment history table. */
  const [tab, setTab] = useState<'tokens' | 'defi' | 'nfts' | 'activity' | 'cards'>('tokens');

  /* Network filter for the Tokens tab. The wallet today has assets on
     four "kinds" of chain: Lithosphere Makalu, EVM-imported tokens,
     Bitcoin, and Solana. 'all' keeps the current behaviour (everything). */
  type NetFilter = 'all' | 'Makalu' | 'Kamet' | 'EVM' | 'Bitcoin' | 'Solana';
  const [netFilter, setNetFilter] = useState<NetFilter>('all');

  /* Privacy: hide the dollar total when shoulder-surfing risk. Stored
     only in component state — restoring on each mount is intentional
     (you opt in for the session, not forever). */
  const [balanceHidden, setBalanceHidden] = useState(false);

  /* The top-nav "Swap" and "NFTs" entries route here with a query param
     rather than to a standalone page (Swap is a modal; NFTs is a tab).
     Apply it once, then strip the param so back/refresh stay clean. */
  useEffect(() => {
    const swap = searchParams.get('swap');
    const t    = searchParams.get('tab');
    if (swap === '1') { setSwapFull(true); setModal('swap'); router.replace('/app'); }
    else if (t && (['tokens', 'defi', 'nfts', 'activity', 'cards'] as const).includes(t as never)) {
      setTab(t as 'tokens' | 'defi' | 'nfts' | 'activity' | 'cards');
      router.replace('/app');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filteredCoins = useMemo(() => {
    if (netFilter === 'all') return COINS;
    return COINS.filter(c => {
      const t = TOKENS.find(x => x.sym === c.sym);
      return t?.chain === netFilter;
    });
  }, [COINS, netFilter]);

  /* COLD LOAD = the portfolio fetch hasn't resolved AND no snapshot
     hydrated the view (liveAssets/liveActivity are still their initial
     null). In that state show skeletons; once a snapshot or the fresh
     fetch supplied data, render the real content (never a skeleton). */
  const assetsCold   = liveAssets   === null;
  const activityCold = liveActivity === null;

  /* TGE — the Ignite token-generation event. Opens in a new tab; the page
     connects to this wallet via WalletConnect (the web wallet doesn't inject
     a provider into other tabs/iframes, so there's no silent auto-connect
     here — a cross-origin iframe couldn't reach window.thanos either). */
  const onTge = () => window.open('https://tge.ignite.trade/', '_blank', 'noopener,noreferrer');

  return (
    <div style={{
      width: '100%', overflowY: 'auto', overflowX: 'hidden', height: '100%', minHeight: 0,
      // Match .main-area: momentum scroll + contained overscroll on mobile.
      // overflowX:'hidden' is REQUIRED — with overflowY:'auto' the browser
      // promotes overflowX to 'auto' too, so any briefly-too-wide child let the
      // whole home page be dragged sideways (the "still moving" the user saw).
      WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', scrollBehavior: 'smooth',
    }}>
      {modal === 'send'    && <SendModal    onClose={() => { setModal(null); setPendingTick(t => t + 1); }}/>}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)}/>}
      {modal === 'swap'    && <SwapModal    fullScreen={swapFull} onClose={() => { setModal(null); setSwapFull(false); }}/>}
      {modal === 'laxcard' && <LaxCardModal onClose={() => setModal(null)}/>}
      {detail && <TokenDetailModal sym={detail.sym} chainId={detail.chainId} onClose={() => setDetail(null)}/>}

      <div style={{
        maxWidth: 760, margin: '0 auto',
        padding: '32px 24px 64px',
        display: 'flex', flexDirection: 'column', gap: 28,
      }}>

        {/* ── Hero: self-custody pill + balance + change + Discover ──── */}
        <div style={{ textAlign: 'center' }}>
          {/* Trust signal: this wallet holds your keys, not us. */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.22)',
            borderRadius: 999,
            color: 'var(--green, #10b981)',
            fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
            marginBottom: 18,
          }}>
            <ShieldCheck size={12} strokeWidth={2.4}/>
            Self-custody
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, letterSpacing: 1.8,
            color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 8,
            justifyContent: 'center',
          }}>
            TOTAL BALANCE
            <button
              type="button"
              aria-label={balanceHidden ? 'Show balance' : 'Hide balance'}
              onClick={() => setBalanceHidden(v => !v)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 2, display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {balanceHidden ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
            {!indexerOk && (
              <span style={{
                fontSize: 9, letterSpacing: 1.2, padding: '2px 6px',
                background: 'var(--bg-elevated)', borderRadius: 4,
                color: 'var(--text-secondary)', fontWeight: 600,
              }}>OFFLINE · SAMPLE</span>
            )}
          </div>
          <div style={{ marginTop: 10, width: '100%', textAlign: 'center' }}>
            {assetsCold ? (
              /* Cold-load balance hero placeholder — same visual weight as
                 the real total, centered. */
              <Sk w={260} h={54} r={12} style={{ margin: '0 auto' }}/>
            ) : (
              /* Auto-shrinks so any magnitude fits on one line without overflow. */
              <FitText max={68} min={22} style={{ fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
                {balanceHidden ? '••••••' : totalDisplay}
              </FitText>
            )}
          </div>
          <div style={{
            marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 12,
            fontSize: 17, color: 'var(--text-secondary)',
          }}>
            {change24h === null ? (
              <span
                style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-muted)' }}
                title={change24hCoveredUsd === 0
                  ? 'No public price feed for your assets — % unavailable'
                  : '24h change loading…'}
              >—</span>
            ) : (
              <span
                className={change24h >= 0 ? 'amt-pos' : 'amt-neg'}
                style={{ fontSize: 19, fontWeight: 700 }}
                title={`Based on ${change24hCoveredUsd > 0 ? 'tracked' : 'no'} assets — Litho ecosystem tokens excluded until a price oracle ships`}
              >
                {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
              </span>
            )}
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <a href="/app/discover" style={{
              color: 'var(--blue)', textDecoration: 'none', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }} onClick={e => { e.preventDefault(); router.push('/app/discover'); }}>
              Discover <ExternalLink size={16}/>
            </a>
          </div>
          {holdings.length > 0 && (
            <PortfolioChart holdings={holdings} hidden={balanceHidden}/>
          )}
        </div>

        {/* ── 4 action buttons (Buy / Swap / Send / Receive) ────────── */}
        <div style={{
          display: 'grid',
          // minmax(0,1fr) (not bare 1fr) lets all 4 cards SHRINK to fit any
          // width. Bare 1fr keeps each track at its content min-size, so on a
          // narrow phone the row overflowed the viewport and the whole page
          // could be dragged sideways — the "moving" the user saw.
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
          width: '100%',
        }}>
          <ActionBtn
            icon={<Sparkles size={30} strokeWidth={2}/>}
            label="TGE"
            title="Open the Ignite TGE (tge.ignite.trade) in a new tab"
            onClick={onTge}
          />
          <ActionBtn
            icon={<Repeat size={30} strokeWidth={2}/>}
            label="Swap"
            onClick={() => { setSwapFull(false); setModal('swap'); }}
          />
          <ActionBtn
            icon={<ArrowUpRight size={30} strokeWidth={2}/>}
            label="Send"
            onClick={() => setModal('send')}
          />
          <ActionBtn
            icon={<ArrowDownLeft size={30} strokeWidth={2}/>}
            label="Receive"
            onClick={() => setModal('receive')}
          />
        </div>

        {/* ── Security signals (backup status + connected apps) ──────── */}
        <SecurityPanel/>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 28, alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 0,
        }}>
          {(['tokens', 'defi', 'nfts', 'activity', 'cards'] as const).map(t => {
            const active = tab === t;
            const label = t === 'tokens' ? 'Tokens'
                        : t === 'defi'   ? 'DeFi'
                        : t === 'nfts'   ? 'NFTs'
                        : t === 'activity' ? 'Activity'
                        : 'Cards';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: active ? 700 : 500,
                  fontSize: 19,
                  padding: '12px 0',
                  borderBottom: active ? '2px solid var(--text-primary)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Tab bodies ────────────────────────────────────────────── */}

        {tab === 'tokens' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Network filter — real Radix Select; filters the COINS list
                by canonical token.chain. The right-side filter/menu icons
                stay decorative for now (no sort or hide-small-balances yet). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 200 }}>
                <Select
                  value={netFilter}
                  onChange={v => setNetFilter(v as NetFilter)}
                  options={[
                    { value: 'all',     label: 'All networks' },
                    { value: 'Makalu',  label: 'Lithosphere Makalu · Testnet' },
                    { value: 'Kamet',   label: 'Lithosphere Kamet · Testnet' },
                    { value: 'EVM',     label: 'Ethereum & EVM' },
                    { value: 'Bitcoin', label: 'Bitcoin' },
                    { value: 'Solana',  label: 'Solana' },
                  ]}
                  ariaLabel="Filter tokens by network"
                />
              </div>
              <div style={{ display: 'flex', gap: 6, color: 'var(--text-muted)' }}>
                <button style={iconBtnStyle} title="Coming soon"><SlidersHorizontal size={16}/></button>
                <button style={iconBtnStyle} title="Coming soon"><MoreVertical    size={16}/></button>
              </div>
            </div>

            {/* Big token rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {assetsCold && <TokenRowsSkeleton rows={4}/>}
              {!assetsCold && filteredCoins.length === 0 && (
                <div style={{
                  padding: '32px 16px', textAlign: 'center',
                  background: 'var(--bg-elevated)',
                  border: '1px dashed var(--border-default)',
                  borderRadius: 12,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {netFilter === 'all' ? 'No assets yet' : 'Nothing on this network'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.5 }}>
                    {netFilter === 'all'
                      ? <>Receive LITHO, BTC, SOL or any LEP100 token to this wallet to see it here. Balances refresh automatically.</>
                      : <>Switch the filter back to <b>All networks</b> to see what you do have.</>}
                  </div>
                  {netFilter === 'all' && evmAddress && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="settings-btn" onClick={() => setModal('receive')}>
                        Receive
                      </button>
                      <a
                        href="https://makalu.litho.ai/faucet"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="settings-btn"
                      >
                        Get testnet LITHO
                      </a>
                    </div>
                  )}
                </div>
              )}
              {filteredCoins.map(c => {
                const price = c.balNum > 0 ? c.usdNum / c.balNum : 0;
                const priceTxt = !c.priceKnown
                  ? '—'
                  : price > 0
                  ? '$' + price.toLocaleString('en-US', {
                      minimumFractionDigits: price >= 1 ? 2 : 4,
                      maximumFractionDigits: price >= 1 ? 2 : 6,
                    })
                  : '';
                return (
                <div
                  key={c.sym}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail({ sym: c.sym, chainId: c.chainId })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail({ sym: c.sym, chainId: c.chainId }); } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 4px',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <TokenIcon sym={c.sym} color={c.color} size={44} chainId={c.chainId} native={c.native}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{c.sym}</div>
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span>{priceTxt || c.name}</span>
                      {c.chg !== 0 && (
                        <span className={c.chg >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontWeight: 600 }}>
                          {c.chg >= 0 ? '+' : ''}{c.chg.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {balanceHidden ? '••••'
                        : c.sym === 'LITHO'
                          ? <><LithoSym/>{c.bal}</>
                          : `${c.bal} ${c.sym}`}
                    </div>
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      fontFamily: 'Geist Mono, monospace',
                    }}>
                      {balanceHidden ? '••••' : c.usd}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

          </div>
        )}

        {tab === 'cards' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <LaxCardPromo onGetStarted={() => setModal('laxcard')}/>
            {/* Quantt Agents — same AI-assistant offer the desktop/extension/
                mobile clients show; on web it routes sign-in via the extension
                (desktop) or the native app deep link (phones). */}
            <QuanttCard/>
          </div>
        )}

        {tab === 'defi' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Swap — primary DeFi action, top of the tab */}
            <div>
              <SectionHead title="Swap" sub="Bridge LITHO ecosystem tokens via MultX"/>
              <ExchangeWidget liveBalances={liveBalances}/>
            </div>

            {/* Stake — Solstice (live position) + a "More pools coming" hint */}
            <div>
              <SectionHead title="Stake" sub="Earn passive yield on your assets"/>
              <StakingCard/>
              <div style={{
                marginTop: 8, padding: '12px 14px',
                background: 'var(--bg-elevated)',
                border: '1px dashed var(--border-default)',
                borderRadius: 12,
                fontSize: 11, color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Sparkles size={13}/>
                More staking pools (LAX yield, LitBTC LP) launching with the
                next protocol rollout.
              </div>
            </div>

            {/* Charts — analytics on the user's portfolio */}
            <div>
              <SectionHead title="Analytics" sub="Portfolio performance over time"/>
              <AssetPerformanceCard/>
            </div>
          </div>
        )}

        {tab === 'nfts' && (
          <div style={{
            padding: '36px 16px', textAlign: 'center',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 16,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'rgba(139,125,247,0.12)',
              border: '1px solid rgba(139,125,247,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--purple500, #8b7df7)',
            }}>
              <ImageIcon size={26}/>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>No NFTs yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, lineHeight: 1.5 }}>
              NFTs you receive on Lithosphere (LEP-721 / LEP-1155) will appear here.
              Indexing pipeline ships with the next backend slice — until then,
              browse and mint on the Lithosphere marketplace.
            </div>
            <a
              href="https://makalu.litho.ai/nfts"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-btn"
              style={{ marginTop: 4 }}
            >
              <BadgeCheck size={14}/> Browse marketplace
            </a>
          </div>
        )}

        {tab === 'activity' && activityCold && (
          <ActivityRowsSkeleton rows={5}/>
        )}

        {tab === 'activity' && !activityCold && TXS.length === 0 && (
          <div style={{
            padding: '36px 16px', textAlign: 'center',
            background: 'var(--bg-elevated)',
            border: '1px dashed var(--border-default)',
            borderRadius: 12,
            color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>
              No activity yet
            </div>
            <div style={{ fontSize: 12, maxWidth: 360 }}>
              Every Send / Receive on Lithosphere will land here. The indexer
              picks transactions up roughly every 15s.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="settings-btn" onClick={() => setModal('receive')}>
                <ArrowDownLeft size={14}/> Receive funds
              </button>
              <a
                href="https://makalu.litho.ai/faucet"
                target="_blank"
                rel="noopener noreferrer"
                className="settings-btn"
              >
                Get testnet LITHO
              </a>
            </div>
          </div>
        )}

        {tab === 'activity' && TXS.length > 0 && (
          <div className="card">
            <div className="table-top">
              <span className="card-title">Payment history</span>
              <button className="chart-selector">Last month ▾</button>
            </div>
            <table className="data-table">
              <thead><tr>
                <th>Name</th><th>Date</th><th>Price</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr></thead>
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
        )}

      </div>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', padding: 6,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
        color: 'var(--text-muted)', textTransform: 'uppercase',
      }}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, onClick, disabled, title, soonBadge }: {
  icon:       React.ReactNode;
  label:      string;
  onClick:    () => void;
  disabled?:  boolean;
  title?:     string;
  /** Show a "SOON" pill in the corner when disabled (so it reads as
   *  "feature pending" instead of "feature dead"). */
  soonBadge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10,
        padding: '20px 8px',
        minWidth: 0,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-secondary)' : 'var(--text-primary)',
        opacity: disabled ? 0.78 : 1,
        minHeight: 108,
        transition: 'background .12s ease, transform .08s ease',
      }}
      onMouseOver={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseOut={e  => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
    >
      {soonBadge && disabled && (
        <span style={{
          position: 'absolute', top: 8, right: 8,
          fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
          padding: '2px 6px', borderRadius: 4,
          background: 'rgba(139,125,247,0.18)',
          color: 'var(--purple500, #8b7df7)',
          border: '1px solid rgba(139,125,247,0.3)',
        }}>SOON</span>
      )}
      <span style={{
        width: 48, height: 48, borderRadius: 14,
        background: 'rgba(59,122,247,0.10)',
        color: 'var(--blue)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
