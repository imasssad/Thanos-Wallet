'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, DollarSign,
  ChevronDown, MoreVertical, SlidersHorizontal, ExternalLink,
  Image as ImageIcon, Sparkles, BadgeCheck,
} from 'lucide-react';
import { SendModal, ReceiveModal, SwapModal, type ModalKind } from './modals';
import { Select } from './ui/Select';
import { TokenIcon } from './TokenIcon';
import { useWallet } from './shell/AppShell';
import { getPortfolio, IndexerOffline, type IndexerAsset, type IndexerActivityItem } from '../lib/indexer';
import { usePrices, priceOr } from '../lib/usePrices';
import { getSolanaAddress, getSolanaBalance } from '../lib/solana';
import { getBitcoinAddress, getBitcoinAddressFromSource, getBitcoinBalance } from '../lib/bitcoin';

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

/* Build an SVG path "M x0,y0 L x1,y1 …" from a series of [time, price]
   pairs. Auto-scaled to the viewBox. */
function pricesToPath(prices: Array<[number, number]>, w: number, h: number): { line: string; area: string } | null {
  if (prices.length < 2) return null;
  const ys = prices.map(p => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
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

  /* Solana + Bitcoin balances — fetched direct from their respective
     RPCs (the LITHO indexer doesn't track non-EVM chains).
     Solana: mnemonic-only (no SLIP-0010 derivation from raw secp256k1 PK).
     Bitcoin: works for both mnemonic (BIP84) and private-key imports
     (single P2WPKH keypair derived from the raw 32-byte key). */
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [btcBalance, setBtcBalance] = useState<number | null>(null);
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
        chg:    tok.change24h,
        color:  tok.color,
      };
    };
    const solRow = buildNonEvmRow('SOL', solBalance);
    const btcRow = buildNonEvmRow('BTC', btcBalance);
    const extraRows = [solRow, btcRow].filter((r): r is NonNullable<typeof r> => r !== null);

    const fromLive = (liveAssets ?? []).map(a => projectAsset(a, prices)).filter(c => c.balNum > 0);

    const combined = [...fromLive, ...extraRows];
    const total = combined.reduce((s, c) => s + c.usdNum, 0) || 1;
    return combined.map(c => ({
      sym: c.sym, name: c.name, bal: c.bal, usdNum: c.usdNum,
      usd: `$${c.usdNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      chg: c.chg, color: c.color,
      pct: Math.max(1, Math.round((c.usdNum / total) * 100)),
    }));
  }, [liveAssets, solBalance, btcBalance, prices]);

  const TXS = useMemo(() => {
    if (!liveActivity || liveActivity.length === 0) return [];
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

  /* MM-style home: centered vertical column. Hero balance → 4 big
     action buttons → tabs (Tokens / DeFi / NFTs / Activity) → tab body.
     The dense charts + Exchange widget + Staking from the prior layout
     are folded under the DeFi tab so nothing is lost; Activity wraps
     the Payment history table. */
  const [tab, setTab] = useState<'tokens' | 'defi' | 'nfts' | 'activity'>('tokens');

  /* Network filter for the Tokens tab. The wallet today has assets on
     four "kinds" of chain: Lithosphere Makalu, EVM-imported tokens,
     Bitcoin, and Solana. 'all' keeps the current behaviour (everything). */
  type NetFilter = 'all' | 'Makalu' | 'EVM' | 'Bitcoin' | 'Solana';
  const [netFilter, setNetFilter] = useState<NetFilter>('all');

  const filteredCoins = useMemo(() => {
    if (netFilter === 'all') return COINS;
    return COINS.filter(c => {
      const t = TOKENS.find(x => x.sym === c.sym);
      return t?.chain === netFilter;
    });
  }, [COINS, netFilter]);

  /* Buy on-ramp. Today this redirects to Transak's hosted widget with
     the wallet's EVM address pre-populated. Requires
     NEXT_PUBLIC_TRANSAK_API_KEY to be set at build time; without it the
     button stays disabled (no point opening a broken widget). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transakApiKey = (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_TRANSAK_API_KEY) || '';
  const onBuy = () => {
    if (!transakApiKey || !evmAddress) return;
    const url =
      'https://global.transak.com/?'
      + new URLSearchParams({
          apiKey:                transakApiKey,
          walletAddress:         evmAddress,
          defaultCryptoCurrency: 'ETH',
          fiatCurrency:          'USD',
          themeColor:            '3b7af7',
          hideMenu:              'true',
        }).toString();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ width: '100%', overflowY: 'auto', height: '100%' }}>
      {modal === 'send'    && <SendModal    onClose={() => setModal(null)}/>}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)}/>}
      {modal === 'swap'    && <SwapModal    onClose={() => setModal(null)}/>}

      <div style={{
        maxWidth: 760, margin: '0 auto',
        padding: '32px 24px 64px',
        display: 'flex', flexDirection: 'column', gap: 28,
      }}>

        {/* ── Hero: centered balance + change + Discover ─────────────── */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 12, fontWeight: 700, letterSpacing: 1.6,
            color: 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            justifyContent: 'center',
          }}>
            TOTAL BALANCE
            {!indexerOk && (
              <span style={{
                fontSize: 9, letterSpacing: 1.2, padding: '2px 6px',
                background: 'var(--bg-elevated)', borderRadius: 4,
                color: 'var(--text-secondary)', fontWeight: 600,
              }}>OFFLINE · SAMPLE</span>
            )}
          </div>
          <div style={{
            fontSize: 56, fontWeight: 800, letterSpacing: '-0.04em',
            lineHeight: 1.05, marginTop: 8,
          }}>
            {totalDisplay}
          </div>
          <div style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 10,
            fontSize: 15, color: 'var(--text-secondary)',
          }}>
            <span className={change24h >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontSize: 17, fontWeight: 700 }}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <a href="#" style={{
              color: 'var(--blue)', textDecoration: 'none', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }} onClick={e => e.preventDefault()}>
              Discover <ExternalLink size={13}/>
            </a>
          </div>
        </div>

        {/* ── 4 action buttons (Buy / Swap / Send / Receive) ────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}>
          <ActionBtn
            icon={<DollarSign size={26} strokeWidth={2}/>}
            label="Buy"
            disabled={!transakApiKey}
            title={transakApiKey ? 'Buy crypto via Transak (opens in new tab)' : 'Buy disabled — set NEXT_PUBLIC_TRANSAK_API_KEY to enable on-ramp'}
            onClick={onBuy}
          />
          <ActionBtn
            icon={<Repeat size={26} strokeWidth={2}/>}
            label="Swap"
            onClick={() => setModal('swap')}
          />
          <ActionBtn
            icon={<ArrowUpRight size={26} strokeWidth={2}/>}
            label="Send"
            onClick={() => setModal('send')}
          />
          <ActionBtn
            icon={<ArrowDownLeft size={26} strokeWidth={2}/>}
            label="Receive"
            onClick={() => setModal('receive')}
          />
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 28, alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 0,
        }}>
          {(['tokens', 'defi', 'nfts', 'activity'] as const).map(t => {
            const active = tab === t;
            const label = t === 'tokens' ? 'Tokens'
                        : t === 'defi'   ? 'DeFi'
                        : t === 'nfts'   ? 'NFTs'
                        : 'Activity';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: active ? 700 : 500,
                  fontSize: 16,
                  padding: '10px 0',
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
                    { value: 'Makalu',  label: 'Lithosphere Makalu' },
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
              {filteredCoins.length === 0 && (
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
                        href="https://faucet.litho.ai"
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
              {filteredCoins.map(c => (
                <div key={c.sym} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 4px',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <TokenIcon sym={c.sym} color={c.color} size={44}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{c.sym}</div>
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.name}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{c.usd}</div>
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      fontFamily: 'Geist Mono, monospace',
                    }}>
                      {c.bal} {c.sym}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
              <div className="charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="card price-analytics-card">
                  <div className="card-header"><span className="card-title">Price analytics</span></div>
                  <PriceSparkline/>
                  <div className="analytics-prices">
                    <span className="analytics-price">$5,240.00</span>
                    <span className="analytics-price">$12,900.00</span>
                  </div>
                  <div className="analytics-date"><span>1 Dec, 2025</span><span>31 Dec, 2025</span></div>
                </div>
                <div className="card perf-chart-card">
                  <div className="card-header">
                    <span className="card-title">Asset performance</span>
                    <button className="chart-selector">This week ▾</button>
                  </div>
                  <PerformanceChart/>
                  <div className="chart-xaxis">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d}>{d}</span>)}
                  </div>
                </div>
              </div>
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

        {tab === 'activity' && TXS.length === 0 && (
          <div style={{
            padding: '36px 16px', textAlign: 'center',
            background: 'var(--bg-elevated)',
            border: '1px dashed var(--border-default)',
            borderRadius: 12,
            color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5,
          }}>
            No activity yet on this account.
            <div style={{ fontSize: 11, marginTop: 6 }}>
              Every Send / Receive on Lithosphere will land here once the indexer
              picks it up (sync runs every 15s).
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

function ActionBtn({ icon, label, onClick, disabled, title }: {
  icon:     React.ReactNode;
  label:    string;
  onClick:  () => void;
  disabled?: boolean;
  title?:   string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8,
        padding: '20px 12px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        opacity: disabled ? 0.55 : 1,
        minHeight: 92,
        transition: 'background .12s ease, transform .08s ease',
      }}
      onMouseOver={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseOut={e  => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 12,
        background: 'rgba(59,122,247,0.10)',
        color: 'var(--blue)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
