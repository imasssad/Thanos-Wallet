'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ethers } from 'ethers';
import { TOKENS } from '../lib/tokens';
import { Globe, Shield, Info, ChevronRight, Key, Download, Lock, User as UserIcon, KeyRound, Usb, AlertTriangle, Copy, Check, Eye } from 'lucide-react';
import { LedgerModal } from './LedgerModal';
import { TrezorModal } from './TrezorModal';
import { useWallet } from './shell/AppShell';
import { loadVault, openVault, setSeedBackedUp } from '../lib/vault';
import { getPortfolio, getActivity, IndexerOffline, type IndexerAsset, type IndexerActivityItem } from '../lib/indexer';
import { apiClient, type AuthUser } from '../lib/auth-client';
import { TokenIcon } from './TokenIcon';
import { Select } from './ui/Select';
import { usePrices, priceOr } from '../lib/usePrices';
import {
  loadContacts, addContact, deleteContact,
  syncContactsFromServer, onContactsChanged,
  type Contact,
} from '../lib/address-book';
import { loadPendingTxs, type PendingTx } from '../lib/tx-store';
import { BumpFeeModal } from './BumpFeeModal';
import { bitcoinExplorerUrl } from '../lib/bitcoin';
import { BookUser, Plus, Trash2, ArrowUpRight, Zap } from 'lucide-react';

/* Lithosphere rows shown at the top of the Market view. Prices come
   from usePrices() at runtime; caps and volumes are intentionally
   blank ("—") until a real market-data feed lands for these chain
   assets. The mainstream rows (BTC/ETH/BNB/SOL/...) come live from
   CoinGecko's /coins/markets endpoint — see useMainstreamMarkets. */
interface MarketRow {
  sym:   string;
  name:  string;
  price: string;
  chg24: number;
  chg7:  number | null;
  cap:   string;
  vol:   string;
  color: string;
  icon?: string;
}

interface CGMarket {
  id: string; symbol: string; name: string;
  current_price?:                      number;
  price_change_percentage_24h?:        number;
  price_change_percentage_7d_in_currency?: number;
  market_cap?:                         number;
  total_volume?:                       number;
  image?:                              string;
}

function fmtUsd(n: number, fractionDigits = 4): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: fractionDigits })}`;
}
function fmtCompactUsd(n: number | undefined | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** Top mainstream markets — live from CoinGecko. We deliberately exclude
 *  Bitcoin / Solana from this list when they're already in TOKENS so we
 *  don't show them twice. */
function useMainstreamMarkets(): MarketRow[] | null {
  const [rows, setRows] = useState<MarketRow[] | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const url =
          'https://api.coingecko.com/api/v3/coins/markets?'
          + 'vs_currency=usd&order=market_cap_desc&per_page=15&page=1'
          + '&price_change_percentage=24h,7d&sparkline=false';
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json() as CGMarket[];
        if (cancel) return;
        const out: MarketRow[] = data.map(c => ({
          sym:   (c.symbol || '').toUpperCase(),
          name:  c.name,
          price: typeof c.current_price === 'number' ? fmtUsd(c.current_price, 6) : '—',
          chg24: typeof c.price_change_percentage_24h === 'number' ? +c.price_change_percentage_24h.toFixed(2) : 0,
          chg7:  typeof c.price_change_percentage_7d_in_currency === 'number' ? +c.price_change_percentage_7d_in_currency.toFixed(2) : null,
          cap:   fmtCompactUsd(c.market_cap),
          vol:   fmtCompactUsd(c.total_volume),
          color: '#52525b',
          icon:  c.image,
        }));
        setRows(out);
      } catch { /* network blip — UI shows Lithosphere rows only */ }
    })();
    return () => { cancel = true; };
  }, []);
  return rows;
}

export function MarketView() {
  const [search, setSearch] = useState('');
  const prices       = usePrices();
  const mainstream   = useMainstreamMarkets();

  /* Lithosphere rows derived from canonical TOKENS + live priceUsd.
     No fabricated caps/vols — they show '—' until we have a real source. */
  const lithoRows: MarketRow[] = React.useMemo(() => TOKENS.map(t => {
    const live = prices?.[t.sym];
    const p    = typeof live === 'number' ? live : t.priceUsd;
    return {
      sym:   t.sym,
      name:  t.name,
      price: fmtUsd(p, 4),
      chg24: 0,    // no live 24h tracking for Litho ecosystem yet
      chg7:  null,
      cap:   '—',
      vol:   '—',
      color: t.color,
    };
  }), [prices]);

  /* Drop mainstream rows that duplicate Lithosphere rows (BTC/SOL appear
     in TOKENS already; we don't want them twice). Comparison by symbol. */
  const lithoSyms = new Set(lithoRows.map(r => r.sym.toUpperCase()));
  const mainstreamFiltered = (mainstream ?? []).filter(r => !lithoSyms.has(r.sym));

  const market = [...lithoRows, ...mainstreamFiltered];
  const filtered = market.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.sym.toLowerCase().includes(search.toLowerCase()));
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
                      <TokenIcon sym={c.sym} color={c.color} size={36} style={{ borderRadius: 10 }}/>
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
                    {c.chg7 === null
                      ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                      : <span className={c.chg7 >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg7 >= 0 ? '+' : ''}{c.chg7}%</span>}
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
  const wallet = useWallet();
  const evmAddress = wallet?.evmAddress;
  const prices = usePrices();

  // Indexer-backed live balances. Null = haven't tried yet; [] = tried,
  // got nothing; non-empty = real data. We never throw out the canonical
  // TOKENS list — it provides icons/colors/prices the indexer doesn't have.
  const [liveAssets, setLiveAssets] = useState<IndexerAsset[] | null>(null);
  const [indexerOk,  setIndexerOk]  = useState<boolean>(true);
  const [updatedAt,  setUpdatedAt]  = useState<string | null>(null);

  useEffect(() => {
    if (!evmAddress) return;
    let cancel = false;
    (async () => {
      try {
        const portfolio = await getPortfolio(evmAddress);
        if (cancel) return;
        setLiveAssets(portfolio.assets ?? []);
        setUpdatedAt(portfolio.updatedAt);
        setIndexerOk(true);
      } catch (e) {
        if (cancel) return;
        if (e instanceof IndexerOffline) {
          setIndexerOk(false);
          setLiveAssets([]); // fall back to canonical TOKENS rendering below
        } else {
          throw e;
        }
      }
    })();
    return () => { cancel = true; };
  }, [evmAddress]);

  // Map a live indexer asset onto a UI row, using canonical TOKENS for
  // icon/color/price (the indexer doesn't know about those).
  function mergeRow(a: IndexerAsset) {
    const canon = TOKENS.find(t =>
      t.sym.toLowerCase() === a.symbol.toLowerCase() ||
      (a.tokenAddress && t.address?.toLowerCase() === a.tokenAddress.toLowerCase())
    );
    let displayBal = '0';
    try {
      displayBal = ethers.formatUnits(a.balance || '0', a.decimals ?? 18);
    } catch { /* malformed — leave 0 */ }
    const balNum  = parseFloat(displayBal) || 0;
    const priceUsd = priceOr(prices, a.symbol, canon?.priceUsd ?? 0);
    return {
      sym:   a.symbol,
      name:  a.name || canon?.name || a.symbol,
      bal:   balNum.toLocaleString('en-US', { maximumFractionDigits: 4 }),
      balNum,
      usd:   Math.round(balNum * priceUsd),
      chg:   canon?.change24h ?? 0,
      color: canon?.color ?? '#52525b',
      priceUsd,
    };
  }

  // Pick which dataset to render:
  //  - STRICTLY real indexer data. No canonical fallback — if the indexer
  //    has no rows we render an empty state below.
  const _raw = (liveAssets ?? []).map(mergeRow).filter(r => r.balNum > 0);
  const _total = _raw.reduce((s, r) => s + r.usd, 0) || 1;

  const coins = _raw.map(r => ({
    sym:   r.sym,
    name:  r.name,
    bal:   r.bal,
    usd:   r.usd,
    chg:   r.chg,
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
          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {!indexerOk && (
              <span style={{
                fontSize: 10, letterSpacing: 1, padding: '2px 6px',
                background: 'var(--bg-elevated)', borderRadius: 4,
                color: 'var(--text-secondary)',
              }}>OFFLINE · sample data</span>
            )}
            <span>
              Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'just now'}
            </span>
          </div>
        </div>
        <div className="assets-layout">
          <div className="card assets-chart-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 24 }}>
            <div style={{ position: 'relative', width: 180, height: 180 }}>
              <svg viewBox="0 0 180 180" width="180" height="180" style={{ transform: 'rotate(-90deg)' }}>
                {segments.map((s, i) => (
                  <circle key={i} cx="90" cy="90" r={r} fill="none" stroke={s.color} strokeWidth="22"
                    strokeDasharray={`${s.len - 2} ${circ - s.len + 2}`} strokeDashoffset={-s.offset}/>
                ))}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total</div>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.04em' }}>
                  ${_total.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
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
          <div className="card assets-table-card" style={{ padding: 0 }}>
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
                        <TokenIcon sym={c.sym} color={c.color} size={36} style={{ borderRadius: 10 }}/>
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

function activityToRow(item: IndexerActivityItem) {
  // The indexer's activity rows are normalised but light on display metadata;
  // we look up icon/color from canonical TOKENS by symbol and format the
  // amount with the right decimals. Unknown tokens fall back to neutral grey.
  const canon = TOKENS.find(t => t.sym.toLowerCase() === item.symbol.toLowerCase());
  const decimals = canon?.decimals ?? 18;
  let amountStr = item.amount;
  try {
    const formatted = ethers.formatUnits(item.amount, decimals);
    const n = parseFloat(formatted);
    amountStr = n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch { /* indexer returned a non-wei value (e.g. already-formatted) */ }
  const isOut = item.type === 'send' || item.type === 'burn';
  const typeLabel =
    item.type === 'send'    ? 'Send'    :
    item.type === 'receive' ? 'Receive' :
    item.type === 'swap'    ? 'Swap'    :
    item.type.charAt(0).toUpperCase() + item.type.slice(1);
  return {
    sym:    item.symbol,
    name:   canon?.name ?? item.symbol,
    date:   item.ts ? new Date(item.ts).toLocaleDateString() : '—',
    price:  canon ? `$${canon.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : '—',
    type:   typeLabel,
    status: item.status === 'pending' ? 'Pending'
          : item.status === 'failed'  ? 'Failed'
          : 'Completed',
    amount: `${isOut ? '-' : '+'}${amountStr} ${item.symbol}`,
    pos:    !isOut,
    color:  canon?.color ?? '#52525b',
  };
}

export function TransactionsView() {
  const wallet = useWallet();
  const evmAddress = wallet?.evmAddress;
  const [filter, setFilter] = useState<'All'|'Send'|'Receive'|'Swap'>('All');
  const [live,   setLive]   = useState<IndexerActivityItem[] | null>(null);
  const [indexerOk, setIndexerOk] = useState<boolean>(true);

  /* Pending (broadcast-but-unconfirmed) txs from local store. Currently
     only BTC is persisted here — EVM / Solana pending state lands when
     we wire those through tx-store too. */
  const [pending, setPending] = useState<PendingTx[]>([]);
  const [bumpTarget, setBumpTarget] = useState<PendingTx | null>(null);
  useEffect(() => {
    const refresh = () => setPending(loadPendingTxs().filter(t => t.status === 'broadcast'));
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  useEffect(() => {
    if (!evmAddress) return;
    let cancel = false;
    (async () => {
      try {
        const items = await getActivity(evmAddress);
        if (!cancel) { setLive(items); setIndexerOk(true); }
      } catch (e) {
        if (cancel) return;
        if (e instanceof IndexerOffline) {
          setIndexerOk(false);
          setLive([]);
        } else {
          throw e;
        }
      }
    })();
    return () => { cancel = true; };
  }, [evmAddress]);

  const rows = live && live.length > 0 ? live.map(activityToRow) : [];
  const filtered = filter === 'All' ? rows : rows.filter(t => t.type === filter);
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Transactions</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!indexerOk && (
              <span style={{
                fontSize: 10, letterSpacing: 1, padding: '2px 6px',
                background: 'var(--bg-elevated)', borderRadius: 4,
                color: 'var(--text-secondary)',
              }}>OFFLINE · sample data</span>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['All','Send','Receive','Swap'] as const).map(f => (
                <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
        </div>
        {/* Pending section — appears above the main table when there are
            unconfirmed broadcasts. BTC pending txs get a "Bump fee" action;
            other chains show a status pill only (no RBF surface yet). */}
        {pending.length > 0 && (
          <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-default)',
              fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
              color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)' }}/>
              PENDING ({pending.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {pending.map(tx => (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <TokenIcon sym={tx.symbol} size={32} style={{ borderRadius: 10 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Send {tx.amount} {tx.symbol}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      → {tx.recipient}
                    </div>
                    {tx.btc && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {tx.btc.feeRateSatPerVb} sat/vB · {(tx.btc.feeSats / 1e8).toFixed(8)} BTC fee
                      </div>
                    )}
                  </div>
                  {tx.chain === 'bitcoin' && (
                    <a
                      href={bitcoinExplorerUrl(tx.id)}
                      target="_blank"
                      rel="noreferrer"
                      title="View on mempool.space"
                      style={{
                        fontSize: 11, color: 'var(--blue)',
                        fontFamily: 'Geist Mono, monospace',
                        textDecoration: 'none',
                      }}
                    >
                      <ArrowUpRight size={14}/>
                    </a>
                  )}
                  {tx.chain === 'bitcoin' && tx.btc && (
                    <button
                      onClick={() => setBumpTarget(tx)}
                      className="settings-btn"
                      style={{ padding: '6px 10px', fontSize: 11 }}
                      title="Replace by fee"
                    >
                      <Zap size={12}/> Bump fee
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {bumpTarget && (
          <BumpFeeModal
            pending={bumpTarget}
            onClose={() => {
              setBumpTarget(null);
              setPending(loadPendingTxs().filter(t => t.status === 'broadcast'));
            }}
          />
        )}

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
                      <TokenIcon sym={tx.sym} color={tx.color} size={36} style={{ borderRadius: 10 }}/>
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

/* Staking is a route stub today — the Lithosphere validator + LP pools
 *  aren't deployed on Makalu testnet yet. Once a real staking contract +
 *  position-query endpoint land, this view becomes a real list. Until
 *  then it's an honest "Coming soon" instead of a Solstice mock. */
export function StakingView() {
  return (
    <div className="main-area" style={{ width: '100%' }}>
      <div className="page-wrap">
        <div className="page-header">
          <h1 className="page-title">Staking</h1>
        </div>
        <div style={{
          padding: '40px 24px', textAlign: 'center',
          background: 'var(--bg-elevated)',
          border: '1px dashed var(--border-default)',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          maxWidth: 480, margin: '20px auto 0',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Staking opens with the protocol rollout</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 380 }}>
            Lithosphere validator staking, LITHO/LitBTC LP, and the LAX
            stable-yield vault will appear here as soon as the staking
            contract is deployed on Makalu. Your active positions will
            show up automatically.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Cloud account section (optional sign-in) ─────────────────────────────
   Keeps the wallet local-first: a user can fully operate without ever
   creating an account. Signing in lets us sync settings / device list /
   email-driven recovery in the future. */
function AccountSection({ Section, Row }: {
  Section: React.FC<{ icon: React.ElementType; title: string; sub: string; children: React.ReactNode }>;
  Row:     React.FC<{ label: string; sub?: string; children: React.ReactNode }>;
}) {
  const [me, setMe]           = useState<AuthUser | null>(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [email, setEmail]     = useState('');
  const [password, setPwd]    = useState('');
  const [mode, setMode]       = useState<'login' | 'register'>('login');

  useEffect(() => {
    (async () => {
      if (await apiClient.isAuthenticated()) {
        try {
          const u = await apiClient.me();
          setMe(u);
        } catch { /* stale token — silently treat as logged-out */ }
      }
    })();
  }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = mode === 'login'
        ? await apiClient.login({ email, password })
        : await apiClient.register({ email, password });
      setMe(res.user);
      setEmail(''); setPwd('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try { await apiClient.logout(); } finally {
      setMe(null);
      setBusy(false);
    }
  };

  if (me) {
    return (
      <Section icon={UserIcon} title="Account" sub="Cloud-synced account (optional)">
        <Row label="Signed in" sub={me.email}>
          <button className="settings-btn" disabled={busy} onClick={logout}>
            <Lock size={14}/> Sign out
          </button>
        </Row>
      </Section>
    );
  }

  return (
    <Section icon={UserIcon} title="Account" sub="Optional — link a cloud account for sync/recovery">
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className={`filter-pill ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
            type="button"
          >Sign in</button>
          <button
            className={`filter-pill ${mode === 'register' ? 'active' : ''}`}
            onClick={() => setMode('register')}
            type="button"
          >Create</button>
        </div>
        <input
          className="settings-select"
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          className="settings-select"
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={e => setPwd(e.target.value)}
        />
        {error && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>{error}</div>
        )}
        <button
          className="settings-btn"
          onClick={submit}
          disabled={busy || !email || password.length < 8}
        >
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Your seed phrase stays on this device. Signing in is optional and
          only used for cross-device settings sync.
        </div>
      </div>
    </Section>
  );
}

/* ─── Address book section ──────────────────────────────────────────────── */
function AddressBookSection({ Section, Row }: {
  Section: React.FC<{ icon: React.ElementType; title: string; sub: string; children: React.ReactNode }>;
  Row:     React.FC<{ label: string; sub?: string; children: React.ReactNode }>;
}) {
  void Row; // we render our own rows below
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name,     setName]     = useState('');
  const [address,  setAddress]  = useState('');
  const [err,      setErr]      = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  /* Hydrate from the local cache immediately, then kick off a background
     sync from the server (no-op when not signed in). Subscribe to cache
     changes so any other tab / sync update re-renders this list. */
  useEffect(() => {
    setContacts(loadContacts());
    syncContactsFromServer()
      .then(() => setContacts(loadContacts()))
      .catch(() => { /* offline / not authed — local cache is still fine */ });
    const off = onContactsChanged(() => setContacts(loadContacts()));
    return off;
  }, []);

  const onAdd = async () => {
    setErr(null);
    setBusy(true);
    try {
      await addContact({ name, address });
      setContacts(loadContacts());
      setName('');
      setAddress('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add contact');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      if (await deleteContact(id)) setContacts(loadContacts());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete contact');
    }
  };

  return (
    <Section icon={BookUser} title="Address book" sub="Saved contacts for quick send">
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <input
          className="settings-select"
          placeholder="Name (e.g. Sora)"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="settings-select"
          placeholder="0x… or litho1…"
          value={address}
          onChange={e => setAddress(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          style={{ fontFamily: address ? 'Geist Mono, monospace' : undefined, fontSize: address ? 12 : undefined }}
        />
        {err && <div style={{ fontSize: 11, color: 'var(--red)' }}>{err}</div>}
        <button
          className="settings-btn"
          onClick={onAdd}
          disabled={busy || !name.trim() || !address.trim()}
        >
          <Plus size={14}/> {busy ? 'Saving…' : 'Save contact'}
        </button>
      </div>

      {contacts.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contacts.map(c => (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 8,
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--bg-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)',
              }}>
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.evm}
                </div>
              </div>
              <button
                onClick={() => onDelete(c.id)}
                aria-label="Delete contact"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 6, display: 'flex',
                }}
              >
                <Trash2 size={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* Reveal the recovery phrase after a password re-prompt. The phrase is
   read from the unlocked wallet context; the password check is a
   shoulder-surf / unattended-device gate, and a successful reveal marks
   the wallet as backed up. */
function SeedRevealModal({ seed, privateKey, onClose }: { seed: string[]; privateKey?: string; onClose: () => void }) {
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const isPk = !seed.length && !!privateKey;

  const verify = async () => {
    if (busy || !pwd) return;
    setBusy(true);
    setErr('');
    try {
      const vault = loadVault();
      if (!vault) { setErr('No wallet found on this device.'); return; }
      const opened = await openVault(vault, pwd);
      if (!opened) { setErr('Incorrect password'); setPwd(''); return; }
      setRevealed(true);
      setSeedBackedUp(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    const text = isPk ? (privateKey ?? '') : seed.join(' ');
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }}/>
      <div style={{
        position: 'relative', width: 'min(440px, 92vw)', background: 'var(--bg-card)',
        border: '1px solid var(--border-default)', borderRadius: 16, padding: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,0.14)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18}/>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            {isPk ? 'Export private key' : 'Recovery phrase'}
          </div>
        </div>

        {!revealed ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: '#f59e0b' }}/>
              <span>Anyone with {isPk ? 'your private key' : 'these words'} can take your funds. Never share them. Make sure no one is watching your screen.</span>
            </div>
            <input
              className="field-input"
              type="password"
              value={pwd}
              autoFocus
              onChange={e => setPwd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') verify(); }}
              placeholder="Enter your password to continue"
              style={{ width: '100%' }}
            />
            {err && <div style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} disabled={busy || !pwd} onClick={verify}>
                <Eye size={15}/> Reveal
              </button>
            </div>
          </>
        ) : (
          <>
            {isPk ? (
              <div style={{
                wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', fontSize: 13,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                borderRadius: 10, padding: 14, lineHeight: 1.6,
              }}>{privateKey}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {seed.map((w, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 6, alignItems: 'baseline',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    borderRadius: 8, padding: '8px 10px', fontSize: 13,
                  }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 16 }}>{i + 1}</span>
                    <span style={{ fontWeight: 600 }}>{w}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={copy}>
                {copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── DNNS name-management section ─────────────────────────────────────── */
function DnnsSection({ Section }: {
  Section: React.FC<{ icon: React.ElementType; title: string; sub: string; children: React.ReactNode }>;
}) {
  const wallet = useWallet();
  const [name,    setName]    = useState('');
  const [years,   setYears]   = useState('1');
  const [status,  setStatus]  = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const [resolveAddr, setResolveAddr] = useState<string | null>(null);
  const [err,     setErr]     = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);

  // Reverse-lookup: show "you currently own X.litho" when the active
  // address has a primary name.
  useEffect(() => {
    if (!wallet?.evmAddress) { setReverse(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const { reverseLookup } = await import('../lib/dnns');
        const n = await reverseLookup(wallet.evmAddress);
        if (!cancelled) setReverse(n);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [wallet?.evmAddress]);

  // Debounced availability check on name input. A non-zero resolveAddr =
  // taken; null = available (or unresolvable, which we treat the same).
  useEffect(() => {
    const v = name.trim().toLowerCase();
    if (!v) { setStatus('idle'); setResolveAddr(null); return; }
    if (!/^[a-z0-9-]+\.litho$/.test(v)) { setStatus('idle'); setResolveAddr(null); return; }
    setStatus('checking');
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { resolveName } = await import('../lib/dnns');
        const addr = await resolveName(v);
        if (cancelled) return;
        setResolveAddr(addr);
        setStatus(addr ? 'taken' : 'available');
      } catch {
        if (!cancelled) { setStatus('error'); setResolveAddr(null); }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name]);

  const onRegister = async () => {
    setErr(null); setTxHash(null);
    if (!wallet?.evmAddress) { setErr('Unlock your wallet first'); return; }
    const v = name.trim().toLowerCase();
    if (!/^[a-z0-9-]+\.litho$/.test(v)) {
      setErr('Name must look like "alice.litho" (a-z, 0-9, hyphens)');
      return;
    }
    if (status === 'taken') { setErr('Name already taken'); return; }
    const yrs = parseInt(years, 10);
    if (!Number.isFinite(yrs) || yrs < 1 || yrs > 10) {
      setErr('Years must be between 1 and 10');
      return;
    }
    setBusy(true);
    try {
      const { DnnsService, MAKALU_TESTNET } = await import('@thanos/sdk-core');
      const svc = new DnnsService();
      const result = await svc.register({
        chainId: MAKALU_TESTNET.chainId,
        name:    v,
        owner:   wallet.evmAddress,
        years:   yrs,
      });
      setTxHash(result.txHash);
      setName(''); setYears('1');
    } catch (e) {
      setErr((e as Error).message || 'Registration failed');
    } finally { setBusy(false); }
  };

  return (
    <Section icon={Globe} title="Lithosphere names (.litho)" sub="Register a human-readable name for your wallet">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
        {reverse && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
            You currently own <strong style={{ color: 'var(--text-primary)' }}>{reverse}</strong>
          </div>
        )}

        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>NAME</label>
        <input
          className="field"
          placeholder="alice.litho"
          value={name}
          onChange={e => setName(e.target.value.toLowerCase())}
          spellCheck={false}
          autoCapitalize="off"
        />

        {status === 'checking'  && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Checking availability…</div>}
        {status === 'available' && <div style={{ fontSize: 11, color: 'var(--green, #10b981)' }}>✓ Available</div>}
        {status === 'taken'     && (
          <div style={{ fontSize: 11, color: 'var(--orange, #f59e0b)' }}>
            Taken — owned by <span style={{ fontFamily: 'Geist Mono, monospace' }}>{resolveAddr}</span>
          </div>
        )}

        <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>YEARS</label>
        <input
          className="field"
          type="number" min={1} max={10} step={1}
          value={years}
          onChange={e => setYears(e.target.value)}
        />

        {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        {txHash && (
          <div style={{ fontSize: 12, color: 'var(--green, #10b981)' }}>
            Registration submitted · <span style={{ fontFamily: 'Geist Mono, monospace' }}>{txHash.slice(0, 14)}…</span>
          </div>
        )}

        <button
          className="btn-primary"
          disabled={busy || status !== 'available'}
          onClick={onRegister}
          style={{ marginTop: 4 }}
        >
          {busy ? 'Submitting…' : status === 'taken' ? 'Not available' : 'Register name'}
        </button>
      </div>
    </Section>
  );
}

export function SettingsView() {
  const wallet = useWallet();
  const [revealOpen, setRevealOpen] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [language, setLanguage] = useState('English');
  const [autoLock, setAutoLock] = useState('5 minutes');
  const [hwModal,  setHwModal]  = useState<'ledger' | 'trezor' | null>(null);

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
            <Select
              value={currency}
              onChange={setCurrency}
              options={['USD','EUR','GBP','JPY','BTC','LAX']}
              ariaLabel="Display currency"
            />
          </Row>
          <Row label="Language" sub="Interface language">
            <Select
              value={language}
              onChange={setLanguage}
              options={['English','Spanish','Arabic']}
              ariaLabel="Interface language"
            />
          </Row>
        </Section>

        <AccountSection Section={Section} Row={Row}/>

        <AddressBookSection Section={Section} Row={Row}/>
        <DnnsSection Section={Section}/>

        <Section icon={Shield} title="Security" sub="Protect access to your wallet">
          <Row label="Permissions" sub="Token allowances + connected dApps">
            <Link href="/app/permissions" className="settings-btn settings-btn-link">
              <KeyRound size={14}/> Manage <ChevronRight size={14}/>
            </Link>
          </Row>
          <Row label="Hardware wallet" sub="Sign with a Ledger or Trezor device">
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="settings-btn" onClick={() => setHwModal('ledger')}>
                <Usb size={14}/> Ledger
              </button>
              <button className="settings-btn" onClick={() => setHwModal('trezor')}>
                <Usb size={14}/> Trezor
              </button>
            </div>
          </Row>
          <Row label="Auto-lock" sub="Lock wallet after inactivity">
            <Select
              value={autoLock}
              onChange={setAutoLock}
              options={['1 minute','5 minutes','15 minutes','1 hour','Never']}
              ariaLabel="Auto-lock timeout"
            />
          </Row>
          <Row label="Change password" sub="Update your wallet password">
            <button className="settings-btn">
              <Key size={14}/> Change
            </button>
          </Row>
          <Row
            label={wallet?.privateKey && !wallet?.seed?.length ? 'Export private key' : 'Backup seed phrase'}
            sub={wallet?.privateKey && !wallet?.seed?.length ? 'Reveal your raw private key' : 'Export your 12/24-word recovery phrase'}
          >
            <button className="settings-btn settings-btn-danger" onClick={() => setRevealOpen(true)}>
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
            <a
              href="https://docs.thanos.fi/abstract"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-btn settings-btn-link"
            >
              View <ChevronRight size={14}/>
            </a>
          </Row>
          <Row label="Privacy policy" sub="What data leaves your device, and where it goes">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-btn settings-btn-link"
            >
              View <ChevronRight size={14}/>
            </a>
          </Row>
          <Row label="Security disclosures" sub="Report a vulnerability + PGP key">
            <a
              href="/.well-known/security.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-btn settings-btn-link"
            >
              View <ChevronRight size={14}/>
            </a>
          </Row>
        </Section>
      </div>

      {/* Hardware-wallet connect modals */}
      {hwModal === 'ledger' && <LedgerModal onClose={() => setHwModal(null)}/>}
      {hwModal === 'trezor' && <TrezorModal onClose={() => setHwModal(null)}/>}

      {/* Recovery-phrase / private-key reveal */}
      {revealOpen && (
        <SeedRevealModal
          seed={wallet?.seed ?? []}
          privateKey={wallet?.privateKey}
          onClose={() => setRevealOpen(false)}
        />
      )}
    </div>
  );
}
