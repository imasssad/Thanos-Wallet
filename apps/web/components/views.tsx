'use client';
import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { TOKENS } from '../lib/tokens';
import { Globe, Shield, Info, ChevronRight, Key, Download, Lock, User as UserIcon } from 'lucide-react';
import { useWallet } from './shell/AppShell';
import { getPortfolio, getActivity, IndexerOffline, type IndexerAsset, type IndexerActivityItem } from '../lib/indexer';
import { apiClient, type AuthUser } from '../lib/auth-client';
import { TokenIcon } from './TokenIcon';
import { Select } from './ui/Select';
import { usePrices, priceOr } from '../lib/usePrices';
import { loadContacts, addContact, deleteContact, type Contact } from '../lib/address-book';
import { loadPendingTxs, type PendingTx } from '../lib/tx-store';
import { BumpFeeModal } from './BumpFeeModal';
import { bitcoinExplorerUrl } from '../lib/bitcoin';
import { BookUser, Plus, Trash2, ArrowUpRight, Zap } from 'lucide-react';

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
  const prices = usePrices();

  /* Overlay live CoinGecko prices on the canonical Lithosphere rows.
     Mainstream-coin rows (BNB/XRP/etc.) keep their reference prices for now. */
  const market = React.useMemo(() => MARKET.map(c => {
    const live = prices?.[c.sym];
    if (typeof live !== 'number') return c;
    return { ...c, price: `$${live.toLocaleString('en-US', { maximumFractionDigits: 4 })}` };
  }), [prices]);

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
                <TokenIcon sym={p.sym} color={p.color} size={38} style={{ borderRadius: 10 }}/>
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

  useEffect(() => { setContacts(loadContacts()); }, []);

  const onAdd = () => {
    setErr(null);
    try {
      addContact({ name, address });
      setContacts(loadContacts());
      setName('');
      setAddress('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add contact');
    }
  };

  const onDelete = (id: string) => {
    if (deleteContact(id)) setContacts(loadContacts());
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
          disabled={!name.trim() || !address.trim()}
        >
          <Plus size={14}/> Save contact
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

export function SettingsView() {
  const [currency, setCurrency] = useState('USD');
  const [language, setLanguage] = useState('English');
  const [autoLock, setAutoLock] = useState('5 minutes');

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

        <Section icon={Shield} title="Security" sub="Protect access to your wallet">
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
            <a
              href="https://docs.thanos.fi/abstract"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-btn settings-btn-link"
            >
              View <ChevronRight size={14}/>
            </a>
          </Row>
        </Section>
      </div>
    </div>
  );
}
