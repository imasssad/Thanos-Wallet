'use client';
/**
 * Token detail screen — opens when the user taps any asset row (Assets,
 * Market, dashboard token list). MetaMask-style layout, client-requested
 * 2026-06-12: price + chart with range tabs, Buy/Send/Swap, Your balance,
 * Token details, Market details, Your activity.
 *
 * Rendered through a portal onto document.body — the views render it from
 * inside `.main-area`, whose `> *` children carry the contentFade entrance
 * animation, and a fixed-position overlay must not inherit that (nor sit
 * inside any transformed/zoomed ancestor).
 *
 * Honesty rules carried over from the rest of the app:
 *   - Tokens with no CoinGecko feed (Litho ecosystem placeholders) show an
 *     explicit "no price history yet" state, never a fabricated curve; a
 *     FAILED fetch for a real feed (rate limit) shows "try again" copy
 *     instead, so BTC is never described as feedless.
 *   - Market rows render "—" rather than invented numbers.
 *   - Proxy feeds are labelled: LitBTC's chart/market data IS Bitcoin's
 *     (it's the wrapped form), and the screen says so.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatUnits } from 'ethers';
import { Copy, Check, ExternalLink, ArrowUpRight, ArrowDownLeft, Repeat } from 'lucide-react';
import {
  fetchTokenHistory, fetchTokenMarketDetails,
  type TokenHistory, type TokenMarketDetails, type TokenRange,
} from '@thanos/sdk-core';
import { TOKENS, explorerUrl, type Token } from '../lib/tokens';
import { EVM_CHAINS } from '../lib/evm-chains';
import { useQuotes } from '../lib/usePrices';
import { getPortfolio, getActivity, type IndexerActivityItem } from '../lib/indexer';
import { TokenIcon } from './TokenIcon';
import { useWallet } from './shell/AppShell';
import { SendModal, SwapModal } from './modals';

/* Symbols whose CoinGecko feed is a PROXY for another asset — the data is
 * real but belongs to the underlying coin, and the UI must say so. */
const PROXY_FEEDS: Record<string, string> = {
  LitBTC: 'Bitcoin (BTC) — LitBTC is its wrapped form on Makalu',
};

/* ─── Local formatting (mirrors views.tsx fmt helpers) ─────────────────── */

function fmtUsd(n: number): string {
  if (!isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
  if (n < 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtCompactUsd(n: number | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtCompactQty(n: number | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** Indexer activity amounts arrive as raw base units (wei) — format with
 *  the token's decimals, same as views.tsx activityToRow. */
function fmtActivityAmount(raw: string, decimals: number): string {
  try {
    const n = parseFloat(formatUnits(raw, decimals));
    return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch {
    return raw; // already formatted / non-wei
  }
}

/* ─── Chart path builder ───────────────────────────────────────────────── */

function pathFrom(prices: Array<[number, number]>, w: number, h: number): { line: string; area: string } | null {
  if (prices.length < 2) return null;
  const vals = prices.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min;
  const dx = w / (prices.length - 1);
  // A perfectly flat series draws as a centred horizontal line, not a
  // line pinned to the bottom edge.
  const pts = vals.map((v, i) => [
    i * dx,
    span === 0 ? h / 2 : h - 8 - ((v - min) / span) * (h - 16),
  ] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

/* 'All' is intentionally absent: CoinGecko's keyless API rejects days=max
 * (401, paid tier), so the longest honest range we can chart is 1Y. */
const RANGES: Array<{ key: TokenRange; label: string }> = [
  { key: '1d', label: '1D' }, { key: '1w', label: '1W' }, { key: '1m', label: '1M' },
  { key: '3m', label: '3M' }, { key: '1y', label: '1Y' },
];

/* ─── Static row (module scope so the subtree doesn't remount per render) ── */

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</span>
    </div>
  );
}

/* ─── Component ────────────────────────────────────────────────────────── */

type SubModal = 'send' | 'swap' | null;
type BalState = { state: 'loading' } | { state: 'offline' } | { state: 'ok'; qty: string; qtyNum: number };

export function TokenDetailModal({ sym, chainId, onClose }: {
  sym: string;
  /** For EVM-native rows (ETH/BNB/…) the dashboard passes the chain id so
   *  the screen labels the right network and Send pre-seeds correctly. */
  chainId?: number;
  onClose: () => void;
}) {
  const wallet = useWallet();
  const evmAddress = wallet?.evmAddress;
  const quotes = useQuotes();

  const canon = useMemo(() =>
    TOKENS.find(t => t.sym.toLowerCase() === sym.toLowerCase()) ?? null, [sym]);
  const evmChain = useMemo(() =>
    chainId != null ? EVM_CHAINS.find(c => c.chainId === chainId) ?? null : null, [chainId]);

  // Canonical row, or a minimal stand-in for indexer/EVM-discovered symbols.
  // The stand-in claims NOTHING it doesn't know: network comes from the
  // passed chainId (or '—'), and Swap only exists for canonical Makalu tokens.
  const token: Token = useMemo(() => canon ?? {
    sym, name: evmChain ? `${sym} · ${evmChain.name}` : sym,
    chain: 'EVM', address: null, decimals: 18,
    color: '#52525b', icon: '', priceUsd: 0, balance: '0', change24h: 0,
  }, [canon, evmChain, sym]);

  const networkLabel =
    evmChain ? evmChain.name
    : canon ? (canon.chain === 'Makalu' ? 'Lithosphere Makalu' : canon.chain)
    : '—';

  const quote = quotes?.[token.sym];
  const price = quote?.usd ?? token.priceUsd;
  const chg24 = quote?.chg24h ?? null;

  /* Chart */
  const [range, setRange] = useState<TokenRange>('1d');
  const [hist, setHist] = useState<TokenHistory | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    setHistLoading(true);
    fetchTokenHistory(token.sym, range)
      .then(h => { if (!cancel) { setHist(h); setHistLoading(false); } })
      .catch(() => { if (!cancel) { setHist(null); setHistLoading(false); } });
    return () => { cancel = true; };
  }, [token.sym, range]);

  /* Market details */
  const [market, setMarket] = useState<TokenMarketDetails | null>(null);
  useEffect(() => {
    let cancel = false;
    fetchTokenMarketDetails(token.sym).then(d => { if (!cancel) setMarket(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [token.sym]);

  /* Balance for THIS token. Quantity is fetched once per token (NOT per
     price tick — USD value derives from qty × live price at render).
     bigint-safe via formatUnits; the indexer's `balance` is raw base units. */
  const [bal, setBal] = useState<BalState>({ state: 'loading' });
  useEffect(() => {
    if (!evmAddress) { setBal({ state: 'offline' }); return; }
    let cancel = false;
    setBal({ state: 'loading' });
    getPortfolio(evmAddress).then(p => {
      if (cancel) return;
      const a = p.assets.find(x =>
        x.symbol.toLowerCase() === token.sym.toLowerCase() ||
        (x.tokenAddress && token.address && x.tokenAddress.toLowerCase() === token.address.toLowerCase()));
      if (!a) { setBal({ state: 'ok', qty: '0', qtyNum: 0 }); return; }
      const formatted = formatUnits(a.balance, a.decimals ?? token.decimals);
      const qtyNum = parseFloat(formatted);
      setBal({ state: 'ok', qty: qtyNum.toLocaleString('en-US', { maximumFractionDigits: 6 }), qtyNum });
    }).catch(() => { if (!cancel) setBal({ state: 'offline' }); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddress, token.sym, token.address]);
  const balUsd = bal.state === 'ok' ? bal.qtyNum * price : null;

  /* Activity filtered to this token. Offline is distinguishable from
     genuinely-empty so an indexer outage never reads as "no activity". */
  const [activity, setActivity] = useState<IndexerActivityItem[] | null>(null);
  const [actOffline, setActOffline] = useState(false);
  useEffect(() => {
    if (!evmAddress) { setActOffline(true); return; }
    let cancel = false;
    getActivity(evmAddress).then(items => {
      if (cancel) return;
      setActOffline(false);
      setActivity(items.filter(i => i.symbol.toLowerCase() === token.sym.toLowerCase()).slice(0, 10));
    }).catch(() => { if (!cancel) { setActOffline(true); setActivity([]); } });
    return () => { cancel = true; };
  }, [evmAddress, token.sym]);

  /* Sub-modals (Send / Swap pre-seeded with this token) */
  const [sub, setSub] = useState<SubModal>(null);
  const sendNetwork =
    evmChain            ? (`evm:${evmChain.chainId}` as const) :
    token.chain === 'Bitcoin' ? 'bitcoin' :
    token.chain === 'Solana'  ? 'solana'  :
    token.chain === 'Cosmos'  ? 'cosmos'  : 'makalu';
  const canSend = !!canon || !!evmChain;          // only when we know the network
  const canSwap = !!canon && canon.chain === 'Makalu';

  /* Buy — same Transak hand-off the dashboard uses. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transakApiKey = (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_TRANSAK_API_KEY) || '';
  const onBuy = () => {
    if (!transakApiKey || !evmAddress) return;
    const url = 'https://global.transak.com/?' + new URLSearchParams({
      apiKey: transakApiKey, walletAddress: evmAddress,
      defaultCryptoCurrency: token.sym, fiatCurrency: 'USD',
      themeColor: '3b7af7', hideMenu: 'true',
    }).toString();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const [copied, setCopied] = useState(false);
  const copyAddr = async () => {
    if (!token.address) return;
    try { await navigator.clipboard.writeText(token.address); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const W = 520, H = 180;
  const paths = hist?.hasRealData ? pathFrom(hist.prices, W, H) : null;
  const lows  = hist?.hasRealData ? Math.min(...hist.prices.map(p => p[1])) : null;
  const highs = hist?.hasRealData ? Math.max(...hist.prices.map(p => p[1])) : null;
  const up = (hist?.changePct ?? (chg24 ?? 0) / 100) >= 0;
  const stroke = up ? 'var(--green, #10b981)' : 'var(--red, #f87171)';
  const lastTs = hist?.hasRealData ? hist.prices[hist.prices.length - 1][0] : null;
  const proxyNote = PROXY_FEEDS[token.sym];

  if (sub === 'send') return <SendModal onClose={() => setSub(null)} initialNetwork={sendNetwork} initialCoin={token.sym}/>;
  if (sub === 'swap') return <SwapModal onClose={() => setSub(null)} initialFrom={token.sym}/>;

  const body = (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box token-detail-box"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 2 }}>
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TokenIcon sym={token.sym} color={token.color} size={28}/>
            {token.name} ({token.sym})
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: '4px 20px 20px' }}>
          {/* Price hero */}
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'Geist Mono, monospace' }}>
            {fmtUsd(price)}
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 12, marginTop: 2, alignItems: 'baseline' }}>
            {chg24 === null
              ? <span style={{ color: 'var(--text-muted)' }}>— 24h</span>
              : <span className={chg24 >= 0 ? 'amt-pos' : 'amt-neg'}>{chg24 >= 0 ? '+' : ''}{chg24}%</span>}
            {lastTs && (
              <span style={{ color: 'var(--text-muted)' }}>
                {new Date(lastTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          {proxyNote && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Price &amp; market data track {proxyNote}.
            </div>
          )}

          {/* Chart */}
          <div style={{ margin: '14px 0 6px', minHeight: H }}>
            {histLoading && <div className="skeleton" style={{ width: '100%', height: H, borderRadius: 12 }}/>}
            {!histLoading && paths && (
              <div style={{ position: 'relative' }}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: 'block' }}>
                  <defs>
                    <linearGradient id="tok-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity="0.20"/>
                      <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  <path d={paths.area} fill="url(#tok-fill)"/>
                  <path d={paths.line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"/>
                </svg>
                {highs !== null && (
                  <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>{fmtUsd(highs)}</span>
                )}
                {lows !== null && (
                  <span style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>{fmtUsd(lows)}</span>
                )}
              </div>
            )}
            {!histLoading && !paths && (
              <div style={{
                height: H, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '0 24px', lineHeight: 1.5,
              }}>
                {hist?.failed
                  ? 'Chart temporarily unavailable (price service rate-limited). Try again in a minute.'
                  : `No price history for ${token.sym} yet — Lithosphere ecosystem tokens get live charts when a price feed lands.`}
              </div>
            )}
          </div>

          {/* Range pills */}
          <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between', marginBottom: 14 }}>
            {RANGES.map(r => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', border: 'none',
                  background: range === r.key ? 'var(--bg-elevated)' : 'transparent',
                  color: range === r.key ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >{r.label}</button>
            ))}
          </div>

          {/* Buy / Send / Swap */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button
              type="button"
              className="btn-outline" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: transakApiKey ? 1 : 0.5 }}
              disabled={!transakApiKey} onClick={onBuy}
              title={transakApiKey ? '' : 'Buying requires the Transak integration to be configured.'}
            >
              <ArrowDownLeft size={15}/> Buy
            </button>
            {canSend && (
              <button type="button" className="btn-outline" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setSub('send')}>
                <ArrowUpRight size={15}/> Send
              </button>
            )}
            {canSwap && (
              <button type="button" className="btn-outline" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setSub('swap')}>
                <Repeat size={15}/> Swap
              </button>
            )}
          </div>

          {/* Your balance */}
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Your balance</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 16px' }}>
            <TokenIcon sym={token.sym} color={token.color} size={38}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{token.name}</div>
              {chg24 !== null && (
                <div className={chg24 >= 0 ? 'amt-pos' : 'amt-neg'} style={{ fontSize: 11 }}>
                  {chg24 >= 0 ? '+' : ''}{chg24}%
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {bal.state === 'loading' ? '…'
                 : bal.state === 'offline' ? '—'
                 : balUsd !== null && balUsd > 0 && balUsd < 0.01 ? '<$0.01'
                 : fmtUsd(balUsd ?? 0)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                {bal.state === 'loading' ? 'loading…'
                 : bal.state === 'offline' ? 'balance unavailable — indexer offline'
                 : `${bal.qty} ${token.sym}`}
              </div>
            </div>
          </div>

          {/* Token details */}
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Token details</div>
          <DetailRow label="Network">{networkLabel}</DetailRow>
          {token.address ? (
            <DetailRow label="Contract address">
              <button
                type="button"
                onClick={copyAddr}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 999, padding: '4px 10px', color: 'var(--blue)',
                  fontSize: 12, fontFamily: 'Geist Mono, monospace',
                }}
              >
                {token.address.slice(0, 8)}…{token.address.slice(-6)}
                {copied ? <Check size={12}/> : <Copy size={12}/>}
              </button>
              <a href={explorerUrl(token)} target="_blank" rel="noreferrer" aria-label="View on explorer" style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
                <ExternalLink size={13}/>
              </a>
            </DetailRow>
          ) : (
            <DetailRow label="Contract address">{canon ? 'Native coin' : '—'}</DetailRow>
          )}
          <DetailRow label="Token decimal">{token.decimals}</DetailRow>

          {/* Market details */}
          <div style={{ fontSize: 15, fontWeight: 800, margin: '18px 0 2px' }}>Market details</div>
          {proxyNote && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 4px' }}>
              Figures below are for {proxyNote}.
            </div>
          )}
          <DetailRow label="Market cap">{fmtCompactUsd(market?.marketCapUsd ?? null)}</DetailRow>
          <DetailRow label="Total volume">{fmtCompactUsd(market?.totalVolumeUsd ?? null)}</DetailRow>
          <DetailRow label="Circulating supply">{fmtCompactQty(market?.circulatingSupply ?? null)}</DetailRow>
          <DetailRow label="All-time high">{market?.athUsd != null ? fmtUsd(market.athUsd) : '—'}</DetailRow>
          <DetailRow label="All-time low">{market?.atlUsd != null ? fmtUsd(market.atlUsd) : '—'}</DetailRow>

          {/* Your activity */}
          <div style={{ fontSize: 15, fontWeight: 800, margin: '18px 0 6px' }}>Your activity</div>
          {activity === null && !actOffline && <div className="skeleton" style={{ height: 44, borderRadius: 10 }}/>}
          {actOffline && (
            <div style={{ padding: '18px 0 6px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              Activity unavailable — indexer offline.
            </div>
          )}
          {!actOffline && activity?.length === 0 && (
            <div style={{ padding: '18px 0 6px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No {token.sym} activity yet.
            </div>
          )}
          {activity?.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
              <span style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-elevated)', color: a.type === 'receive' ? 'var(--green, #10b981)' : 'var(--text-secondary)',
              }}>
                {a.type === 'receive' ? <ArrowDownLeft size={14}/> : a.type === 'send' ? <ArrowUpRight size={14}/> : <Repeat size={14}/>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{a.type}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {a.ts ? new Date(a.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                  {a.type === 'send' ? '-' : a.type === 'receive' ? '+' : ''}
                  {fmtActivityAmount(a.amount, token.decimals)} {token.sym}
                </div>
                {a.status && <div style={{ fontSize: 10, color: a.status === 'failed' ? 'var(--red, #f87171)' : 'var(--text-muted)', textTransform: 'capitalize' }}>{a.status}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Portal — see header comment.
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}
