import React, { useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, HDNodeWallet, Mnemonic, JsonRpcProvider, formatEther } from 'ethers';
import './styles.css';
import {
  createVault, openVault, openVaultWithKey,
  saveVault, loadVault, clearVault,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
  isSeedBackedUp, setSeedBackedUp,
  getActiveAccountIndex, setActiveAccountIndex,
  getAccountCount,       setAccountCount,
  MAX_ACCOUNTS,
} from './vault';
import { UpdateBanner } from './components/UpdateBanner';
import { usePortfolio, PortfolioContext, usePortfolioCtx, formatUsd } from './portfolio';
import { useMarket, formatMarketPrice, formatCompact } from './market';
import { WalletSeedContext, useWalletSeed, resolveRecipient, sendAsset } from './send';
import {
  evmToLitho, ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp,
  groupBySection, looksLikeUrl, normalizeUrl,
  fetchPortfolioHistory, type Holding, type PortfolioHistory, type Range,
} from '@thanos/sdk-core';
import { HardwareModal } from './hardware';
import { WalletConnectModal } from './walletconnect';
import { connectLedger, type LedgerConnection } from './ledger-sign';
import { connectTrezor, type TrezorConnection } from './trezor-sign';
import {
  loadContacts, addContact, deleteContact,
  syncContactsFromServer, onContactsChanged,
  type Contact as AbContact,
} from './address-book';
import { setContactEncryptionKey } from './contact-crypto';

type SignerChoice = 'seed' | 'ledger' | 'trezor';

/** Bridge exposed by src/main/preload.ts. The updater fields are
 *  optional so the renderer keeps working on older Electron shells
 *  that predate the auto-update wiring. */
type UpdaterEvent =
  | { kind: 'checking' }
  | { kind: 'available';   version: string; releaseNotes?: string | null }
  | { kind: 'not-available' }
  | { kind: 'progress';    percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'downloaded';  version: string; releaseNotes?: string | null }
  | { kind: 'error';       message: string };

interface IpcTxRequest {
  to?: string; value?: string; data?: string;
  gas?: string; gasPrice?: string;
  maxFeePerGas?: string; maxPriorityFeePerGas?: string;
  nonce?: number;
}
interface IpcTypedDataPayload {
  domain: Record<string, unknown>;
  types:  Record<string, Array<{ name: string; type: string }>>;
  value:  Record<string, unknown>;
}

declare global {
  interface Window {
    thanosDesktop?: {
      vaultGet(key: string): Promise<string | null>;
      vaultSet(key: string, value: string): Promise<void>;
      vaultRemove(key: string): Promise<void>;
      openExternal?:      (url: string) => Promise<unknown>;
      onUpdateEvent?:     (cb: (ev: UpdaterEvent) => void) => () => void;
      checkForUpdate?:    () => Promise<unknown>;
      installAndRestart?: () => Promise<unknown>;
      /** Main-process signer bridge. The renderer never holds private
       *  keys — the seed crosses IPC once at unlock, then signing
       *  requests round-trip. See src/main/signer.ts for the receiver. */
      signer?: {
        setSeed(seed: string):                                       Promise<void>;
        clearSeed():                                                 Promise<void>;
        hasSeed():                                                   Promise<boolean>;
        address(hdPath: string):                                     Promise<string>;
        sendTx(hdPath: string, tx: IpcTxRequest):                    Promise<string>;
        signTx(hdPath: string, tx: IpcTxRequest):                    Promise<string>;
        personal(hdPath: string, msg: string | Uint8Array):          Promise<string>;
        typedData(hdPath: string, payload: IpcTypedDataPayload):     Promise<string>;
        erc20Transfer(hdPath: string, args: { tokenAddress: string; to: string; amount: string }): Promise<string>;
      };
      /** Native-HID Ledger fallback — present only on desktop builds
       *  whose main process has the optional
       *  @ledgerhq/hw-transport-node-hid-noevents dep installed. The
       *  renderer probes `available()` before advertising the path. */
      ledgerNative?: {
        available():                                                 Promise<boolean>;
        getAddress(hdPath?: string):                                 Promise<string>;
        signEvmTx(hdPath: string, unsignedHex: string):              Promise<{ v: string; r: string; s: string }>;
      };
    };
  }
}

/* ──────────────────────── Types ──────────────────────── */
type View = 'dashboard' | 'market' | 'portfolio' | 'transactions' | 'staking' | 'settings' | 'discover' | 'nfts';

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
const User      = Ic(<><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></>);
const Trash     = Ic(<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></>);

/* ──────────────────────── Account ──────────────────────── */
const ACCOUNT = { name: 'Thanos Wallet', address: '0x0000000000000000000000000000000000000000' };

/* ──────────────────────── Token icon ──────────────────────── */

/* Bundled client icon pack — public/images/tokens/, served at app root.
   Mainstream coins fall through to a CoinGecko CDN logo. Same model as
   the web TokenIcon + mobile/extension resolvers. */
const BUNDLED_ICONS: Record<string, string> = {
  litho:  '/images/tokens/litho.jpg',
  jot:    '/images/tokens/jot.png',
  lax:    '/images/tokens/lax.png',
  colle:  '/images/tokens/colle.png',
  furgpt: '/images/tokens/furgpt.png',
  ignite: '/images/tokens/ignite.png',
  quantt: '/images/tokens/quantt.png',
  // Mainstream coins — bundled (clean cropped PNGs from CoinGecko, offline-safe).
  atom:   '/images/tokens/atom.png',
  eth:    '/images/tokens/eth.png',
  trx:    '/images/tokens/trx.png',
  hype:   '/images/tokens/hype.png',
  // Solana — rendered from the official solana.com/branding SVG so it
  // matches Solana Foundation brand guidelines (purple→green gradient
  // logomark) rather than the CoinGecko thumbnail.
  sol:    '/images/tokens/sol.png',
};
const REMOTE_ICONS: Record<string, string> = {
  // Fallbacks for coins we don't bundle yet. CoinGecko CDN; `large/`
  // variant — `small/` was occasionally returning placeholder ghosts.
  btc:    'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  litbtc: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  usdc:   'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
  usdt:   'https://assets.coingecko.com/coins/images/325/large/Tether.png',
  bnb:    'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  xrp:    'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
};
function iconFor(sym: string): string | null {
  const k = (sym || '').toLowerCase();
  return BUNDLED_ICONS[k] ?? REMOTE_ICONS[k] ?? null;
}

/** Coin icon composited over the brand-colour circle; ticker initial is
 *  the fallback when no icon resolves or the image errors. `className`
 *  carries the size/shape from the existing CSS (portfolio-icon etc). */
function TokenAvatar({ sym, color, className, label, style }: {
  sym: string; color: string; className: string;
  /** Fallback text — defaults to the first letter; tx rows used 2. */
  label?: string;
  /** Extra style merged onto the wrapper (e.g. tx-avatar size overrides). */
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : iconFor(sym);
  return (
    <div className={className} style={{ background: color, position: 'relative', overflow: 'hidden', ...style }}>
      <span>{label ?? sym.slice(0, 1)}</span>
      {src && (
        <img
          src={src}
          alt={sym}
          onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

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
  const { coins, loading, offline } = usePortfolioCtx();
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">My Portfolio</span>
        <button className="icon-btn-sm" style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>View all</button>
      </div>
      <div className="portfolio-list">
        {loading && <div className="portfolio-sym" style={{ padding: 12 }}>Loading balances…</div>}
        {!loading && offline && <div className="portfolio-sym" style={{ padding: 12 }}>Indexer offline</div>}
        {!loading && !offline && coins.length === 0 && (
          <div className="portfolio-sym" style={{ padding: 12 }}>No assets yet</div>
        )}
        {coins.map(c => (
          <div key={c.sym} className="portfolio-row">
            <TokenAvatar sym={c.sym} color={c.color} className="portfolio-icon"/>
            <div>
              <div className="portfolio-name">{c.name}</div>
              <div className="portfolio-sym">{c.balanceText} {c.sym}</div>
            </div>
            <div className="portfolio-right">
              <div className="portfolio-price">{formatUsd(c.usdValue)}</div>
              <div className="portfolio-chg">{c.priceUsd > 0 ? formatUsd(c.priceUsd) : '—'}</div>
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

/* ──────────────────────── Portfolio chart ──────────────────────── */
function buildChartPath(points: number[], w: number, h: number): { line: string; area: string } {
  if (points.length < 2) return { line: '', area: '' };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const dx = w / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * dx;
    const y = h - 6 - ((p - min) / span) * (h - 12);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

function PortfolioChart({ holdings }: { holdings: Holding[] }) {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<PortfolioHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const W = 600, H = 110;
  const key = useMemo(() => holdings.map(h => `${h.sym}:${h.qty.toFixed(6)}`).join('|'), [holdings]);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchPortfolioHistory(holdings, range)
      .then(d => { if (!cancel) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [key, range]);

  const up = (data?.changePct ?? 0) >= 0;
  const stroke = up ? 'var(--green, #10b981)' : 'var(--red, #f87171)';
  const { line, area } = useMemo(() => buildChartPath(data?.points ?? [], W, H), [data]);

  return (
    <div className="card" style={{ padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Portfolio</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['7d', '30d'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                background: range === r ? 'var(--bg-elevated)' : 'transparent',
                color: range === r ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >{r.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}
        style={{ display: 'block', opacity: loading ? 0.5 : 1 }}>
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22"/>
            <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#pf-fill)"/>}
        {line && <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"/>}
      </svg>
      {data && !data.hasRealData && !loading && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          No price history for your current holdings yet.
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── Security panel ──────────────────────── */
function SecurityPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [backedUp, setBackedUp] = useState<boolean | null>(null);
  useEffect(() => { setBackedUp(isSeedBackedUp()); }, []);
  if (backedUp === null) return null;
  return (
    <button
      className="card"
      onClick={onOpenSettings}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
        cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: backedUp ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: backedUp ? 'var(--green, #10b981)' : '#f59e0b',
      }}><Shield size={18}/></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {backedUp ? 'Recovery phrase backed up' : 'Back up your recovery phrase'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {backedUp ? 'Your wallet can be restored from your phrase.' : 'Export and store it safely in Settings.'}
        </div>
      </div>
      {!backedUp && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6, background: 'rgba(245,158,11,0.16)', color: '#f59e0b' }}>ACTION</span>
      )}
      <ChevRight2 size={18}/>
    </button>
  );
}

function DashboardView({ onAction, liveEth, onOpenSettings }: { onAction: (a: 'send'|'receive'|'swap') => void; liveEth: string | null; onOpenSettings: () => void }) {
  const { coins, activity, totalUsd, loading } = usePortfolioCtx();
  const balance = loading ? '···' : formatUsd(totalUsd);
  const liveLine = liveEth !== null
    ? `Live ETH: ${parseFloat(liveEth).toFixed(6)} ETH`
    : null;
  const holdings: Holding[] = useMemo(
    () => coins.filter(c => c.balance > 0 && c.usdValue > 0)
               .map(c => ({ sym: c.sym, qty: c.balance, usd: c.usdValue })),
    [coins],
  );
  return (
    <>
      {/* Hero: balance + quick actions */}
      <div className="balance-hero">
        <div>
          <div className="balance-label">Total balance</div>
          <div className="balance-amount">
            {balance}
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

      {/* Portfolio history chart */}
      {holdings.length > 0 && <PortfolioChart holdings={holdings}/>}

      {/* Security: recovery-phrase backup status */}
      <SecurityPanel onOpenSettings={onOpenSettings}/>

      {/* Allocation: bar + per-coin grid wrapped in card */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="alloc-bar">
          {coins.map(c => (
            <div key={c.sym} className="alloc-seg" style={{ flex: c.pct || 1, background: c.color }}/>
          ))}
        </div>
        <div className="alloc-coins">
          {coins.map(c => (
            <div key={c.sym} className="alloc-coin">
              <div className="alloc-coin-top">
                <div className="alloc-dot" style={{ background: c.color }}/>
                <span className="alloc-name">{c.name} ({c.sym})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div className="alloc-val">{formatUsd(c.usdValue)}</div>
                <div className="alloc-chg">{c.pct}%</div>
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
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Date</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {activity.slice(0, 6).map((tx) => (
              <tr key={tx.id}>
                <td>
                  <div className="tx-cell">
                    <TokenAvatar sym={tx.sym} color={tx.color} className="tx-avatar" label={tx.sym.slice(0, 2)}/>
                    <div>
                      <div className="tx-name">{tx.name}</div>
                      <div className="tx-sym">{tx.sym}</div>
                    </div>
                  </div>
                </td>
                <td>{tx.date}</td>
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
        {!loading && activity.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No transactions yet.</div>
        )}
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
type DesktopSendChain = 'evm' | 'bitcoin' | 'solana' | 'cosmos';

const DESKTOP_CHAIN_META: Record<DesktopSendChain, { label: string; sym: string; decimals: number; placeholder: string }> = {
  evm:     { label: 'Lithosphere', sym: 'LITHO', decimals: 18, placeholder: '0x… , litho1… or name.litho' },
  bitcoin: { label: 'Bitcoin',     sym: 'BTC',   decimals: 8,  placeholder: 'bc1q… / 1… / 3…' },
  solana:  { label: 'Solana',      sym: 'SOL',   decimals: 9,  placeholder: 'Base58 Solana address' },
  cosmos:  { label: 'Cosmos Hub',  sym: 'ATOM',  decimals: 6,  placeholder: 'cosmos1…' },
};

function SendModal({ onClose }: { onClose: () => void }) {
  const { coins } = usePortfolioCtx();
  const seed = useWalletSeed();
  const [chain, setChain] = useState<DesktopSendChain>('evm');
  const [selectedSym, setSelectedSym] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // Hardware-signer state (Ledger / Trezor are mutually exclusive).
  const [signer, setSigner]         = useState<SignerChoice>('seed');
  const [ledger, setLedger]         = useState<LedgerConnection | null>(null);
  const [trezor, setTrezor]         = useState<TrezorConnection | null>(null);
  const [hwBusy,  setHwBusy]        = useState(false);
  // Pre-send simulation — parity with web Send modal. Runs on debounce
  // when recipient + amount are both set. Critical issues gate canSend.
  const [simReport, setSimReport]   = useState<import('@thanos/sdk-core').SimulationReport | null>(null);

  // Close any open hardware-wallet transport when the modal unmounts.
  useEffect(() => () => {
    void ledger?.close().catch(() => {});
    void trezor?.close().catch(() => {});
  }, [ledger, trezor]);

  const useLedger = signer === 'ledger';
  const useTrezor = signer === 'trezor';

  const coin = coins.find(c => c.sym === selectedSym) ?? coins[0] ?? null;
  const amtNum = parseFloat(amount || '0');
  // Balance is from the seed account; when signing with hardware the
  // FROM account changes, so we don't gate on it (the device + RPC will).
  const overBalance = chain === 'evm' && signer === 'seed' && !!coin && amtNum > coin.balance;
  const hwReady     = (signer === 'ledger' && !!ledger) || (signer === 'trezor' && !!trezor);
  const simHasCritical = simReport?.issues.some(i => i.level === 'critical') ?? false;
  const recipientOk = (() => {
    const v = to.trim();
    if (!v) return false;
    if (chain === 'bitcoin') return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,}$/.test(v);
    if (chain === 'solana')  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
    if (chain === 'cosmos')  return /^cosmos1[0-9a-z]{38,}$/.test(v);
    return true; // EVM validated server-side / via resolveRecipient
  })();
  const canSend =
    chain === 'evm'
      ? !!coin && amtNum > 0 && !overBalance && !!to.trim() && !sending
        && (signer === 'seed' || hwReady) && !simHasCritical
      : amtNum > 0 && recipientOk && !sending
        && (signer === 'seed' || hwReady);
  const hwAddress: string | null = signer === 'ledger' ? (ledger?.address ?? null)
                                  : signer === 'trezor' ? (trezor?.address ?? null) : null;

  /* Debounced pre-send simulation — keeps desktop parity with the web
     Send modal. Only fires when recipient + amount are both valid. */
  useEffect(() => {
    if (chain !== 'evm' || !coin || !to.trim() || amtNum <= 0 || overBalance) { setSimReport(null); return; }
    const toAddr   = to.trim();
    const fromAddr = hwAddress || '';
    const amt      = amount;
    const sym      = coin.sym;
    let cancelled  = false;
    const t = setTimeout(async () => {
      try {
        const { TransactionSimulator } = await import('@thanos/sdk-core');
        const r = await new TransactionSimulator().simulateSend({
          chainId:     700777,
          from:        fromAddr,
          to:          toAddr,
          amount:      amt,
          tokenSymbol: sym,
        });
        if (!cancelled) setSimReport(r);
      } catch { if (!cancelled) setSimReport(null); }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amount, amtNum, overBalance, hwAddress]);

  const chooseSigner = async (choice: SignerChoice) => {
    setError(null);
    if (choice === signer) return;
    // Tear down the previous hardware transport before opening another.
    void ledger?.close().catch(() => {});
    void trezor?.close().catch(() => {});
    setLedger(null); setTrezor(null);
    if (choice === 'seed') { setSigner('seed'); return; }
    setHwBusy(true);
    try {
      if (choice === 'ledger') {
        // The Ledger app loaded on-device must match the active chain.
        // EVM → Ethereum app; bitcoin → Bitcoin app; solana → Solana app.
        if (chain === 'bitcoin') {
          const m = await import('./ledger-btc-sign');
          const conn = await m.connectLedgerBtc();
          setLedger({ kind: 'webhid', address: conn.address, transport: conn.transport, close: conn.close } as LedgerConnection);
        } else if (chain === 'solana') {
          const m = await import('./ledger-sol-sign');
          const conn = await m.connectLedgerSol();
          setLedger({ kind: 'webhid', address: conn.address, transport: conn.transport, close: conn.close } as LedgerConnection);
        } else if (chain === 'cosmos') {
          throw new Error('Ledger Cosmos support not yet in this build');
        } else {
          const conn = await connectLedger();
          setLedger(conn);
        }
      } else {
        if (chain === 'bitcoin') {
          const m = await import('./trezor-btc-sign');
          const conn = await m.connectTrezorBtc();
          setTrezor({ address: conn.address, close: conn.close } as TrezorConnection);
        } else if (chain === 'solana' || chain === 'cosmos') {
          throw new Error(`Trezor ${chain} support not yet in this build`);
        } else {
          const conn = await connectTrezor();
          setTrezor(conn);
        }
      }
      setSigner(choice);
    } catch (e) {
      const msg = (e as Error)?.message || `Could not reach the ${choice}`;
      setError(msg.includes('0x6985') ? 'Rejected on device' : msg);
      setSigner('seed');
    } finally {
      setHwBusy(false);
    }
  };

  const doSend = async () => {
    if (chain === 'evm') {
      if (!coin) return;
      if (!coin.native && !coin.tokenAddress) {
        setError(`${coin.sym} has no contract address available.`);
        return;
      }
    }
    setSending(true);
    setError(null);
    try {
      const meta = DESKTOP_CHAIN_META[chain];
      const recipient = chain === 'evm' ? await resolveRecipient(to) : to.trim();

      // Hardware-wallet paths for BTC / SOL bypass `sendAsset` since
      // sendAsset's hardware support is EVM-only by design. We dispatch
      // directly to the chain-specific signer modules instead.
      if (signer === 'ledger' && chain === 'bitcoin' && ledger) {
        const m = await import('./ledger-btc-sign');
        const conn = ledger as unknown as Awaited<ReturnType<typeof m.connectLedgerBtc>>;
        const hash = await m.sendViaLedgerBtc(conn, { recipient, amount });
        setTxHash(hash); setSending(false); return;
      }
      if (signer === 'ledger' && chain === 'solana' && ledger) {
        const m = await import('./ledger-sol-sign');
        const conn = ledger as unknown as Awaited<ReturnType<typeof m.connectLedgerSol>>;
        const hash = await m.sendViaLedgerSol(conn, { recipient, amount });
        setTxHash(hash); setSending(false); return;
      }
      if (signer === 'trezor' && chain === 'bitcoin' && trezor) {
        const m = await import('./trezor-btc-sign');
        const conn = trezor as unknown as Awaited<ReturnType<typeof m.connectTrezorBtc>>;
        const hash = await m.sendViaTrezorBtc(conn, { recipient, amount });
        setTxHash(hash); setSending(false); return;
      }

      const hash = await sendAsset({
        seed,
        chain,
        to:           recipient,
        amount,
        decimals:     chain === 'evm' && coin ? coin.decimals : meta.decimals,
        tokenAddress: chain === 'evm' && coin && !coin.native ? coin.tokenAddress : undefined,
        memo:         chain === 'cosmos' ? memo : undefined,
        signWith:     chain === 'evm' ? signer : 'seed',
        ledger:       chain === 'evm' && signer === 'ledger' ? ledger ?? undefined : undefined,
        trezor:       chain === 'evm' && signer === 'trezor' ? trezor ?? undefined : undefined,
      });
      setTxHash(hash);
      setSending(false);
    } catch (e) {
      setSending(false);
      setError((e as Error)?.message || 'Could not broadcast the transaction.');
    }
  };

  if (txHash) return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-success">
        <div className="success-icon">✓</div>
        <div className="success-title">Transaction Sent</div>
        <div className="success-sub">{amount} {chain === 'evm' ? (coin?.sym ?? '') : DESKTOP_CHAIN_META[chain].sym} broadcast on {chain === 'evm' ? 'Makalu' : DESKTOP_CHAIN_META[chain].label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all', margin: '10px 0' }}>{txHash}</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        {/* Chain selector — switching out of EVM hides the LEP-100 asset
            picker and the hardware-signer panel (HW signing is EVM-only
            in this build). */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(Object.keys(DESKTOP_CHAIN_META) as DesktopSendChain[]).map(c => {
            const selected = c === chain;
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setChain(c); setTo(''); setAmount(''); setMemo(''); }}
                style={{
                  flex: 1, padding: '8px 10px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700,
                  background: selected ? 'var(--blue, #3b7af7)' : 'transparent',
                  color: selected ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${selected ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                }}
              >
                {DESKTOP_CHAIN_META[c].sym}
              </button>
            );
          })}
        </div>

        {chain === 'evm' ? (
          <>
            <label className="field-label">Asset</label>
            <select className="field-select" value={coin?.sym ?? ''} onChange={e => setSelectedSym(e.target.value)}>
              {coins.length === 0 && <option value="">No assets available</option>}
              {coins.map(c => <option key={c.sym} value={c.sym}>{c.sym} — {c.name}</option>)}
            </select>
          </>
        ) : (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', fontSize: 12 }}>
            Sending native <strong>{DESKTOP_CHAIN_META[chain].sym}</strong> on {DESKTOP_CHAIN_META[chain].label}.
          </div>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>Recipient address</label>
        <input className="field-input" placeholder={DESKTOP_CHAIN_META[chain].placeholder} value={to} onChange={e => setTo(e.target.value)}/>
        {!!to.trim() && !recipientOk && chain !== 'evm' && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
            Not a valid {DESKTOP_CHAIN_META[chain].label} address
          </div>
        )}

        {chain === 'cosmos' && (
          <>
            <label className="field-label" style={{ marginTop: 14 }}>Memo (optional)</label>
            <input className="field-input" placeholder="Exchange tag, transfer note…" value={memo} onChange={e => setMemo(e.target.value)}/>
          </>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>Amount</label>
        <div style={{ position: 'relative' }}>
          <input className="field-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} type="number" style={{ paddingRight: 60 }}/>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            {chain === 'evm' ? (coin?.sym ?? '') : DESKTOP_CHAIN_META[chain].sym}
          </span>
        </div>
        {chain === 'evm' && (
        <div style={{ fontSize: 11, color: overBalance ? '#dc2626' : 'var(--text-muted)', marginTop: 4 }}>
          {overBalance ? 'Amount exceeds balance' : `Balance: ${coin?.balanceText ?? '—'} ${coin?.sym ?? ''}`}
          {coin && (
            <button
              style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}
              onClick={() => setAmount(String(coin.balance))}
            >MAX</button>
          )}
        </div>
        )}

        {/* Signer choice: software wallet vs Ledger vs Trezor.
            EVM: all three. BTC: seed / Ledger / Trezor. SOL: seed / Ledger.
            Cosmos: seed only (Ledger Cosmos app integration is a follow-up). */}
        {chain !== 'cosmos' && (
        <div style={{
          marginTop: 16, padding: 12, borderRadius: 10,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>Sign with</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              ['seed',   'Software', true],
              ['ledger', 'Ledger',   true],                                  // EVM + BTC + SOL all supported via chain-specific signer modules
              ['trezor', 'Trezor',   chain === 'evm' || (chain as string) === 'bitcoin'],
            ] as const).map(([key, label, supported]) => {
              const active = signer === key;
              const disabledForChain = !supported;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={hwBusy || sending || disabledForChain}
                  onClick={() => void chooseSigner(key)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8,
                    cursor: hwBusy ? 'wait' : disabledForChain ? 'not-allowed' : 'pointer',
                    fontSize: 12, fontWeight: 700,
                    background: active ? 'var(--blue, #3b7af7)' : 'transparent',
                    color: active ? '#fff' : disabledForChain ? 'var(--text-muted)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                    opacity: disabledForChain ? 0.5 : 1,
                  }}
                  title={disabledForChain ? `${label} doesn't support ${DESKTOP_CHAIN_META[chain].label} on this build` : ''}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {hwBusy && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>Connecting to device…</div>}
          {hwAddress && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              Sending from <span style={{ fontFamily: 'Geist Mono, monospace', color: 'var(--text-secondary)' }}>{hwAddress.slice(0, 8)}…{hwAddress.slice(-6)}</span>
              <br/>Confirm on your {signer === 'ledger' ? 'Ledger' : 'Trezor'} when prompted.
            </div>
          )}
          {signer === 'ledger' && !ledger && !hwBusy && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              Plug in your Ledger, unlock it, and open the {' '}
              {chain === 'bitcoin' ? 'Bitcoin' : chain === 'solana' ? 'Solana' : 'Ethereum'} app.
            </div>
          )}
          {signer === 'trezor' && !trezor && !hwBusy && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>Plug in your Trezor and approve the connection in the Trezor Connect window.</div>
          )}
        </div>
        )}

        {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 10 }}>{error}</div>}

        {/* Pre-send simulation — warning/critical only. Critical also
            gates `canSend`, so the primary button below disables. */}
        {simReport && simReport.issues.filter(i => i.level !== 'info').map((issue, i) => {
          const isCritical = issue.level === 'critical';
          return (
            <div
              key={`${issue.code}-${i}`}
              style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: isCritical ? 'rgba(239,68,68,0.10)' : 'rgba(247,144,9,0.10)',
                border:     isCritical ? '1px solid var(--red)' : 'none',
                color:      isCritical ? 'var(--red)' : 'var(--orange)',
                fontSize: 12, lineHeight: 1.4,
              }}
            >
              {issue.message}
            </div>
          );
        })}

        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!canSend}
          onClick={doSend}
          title={simHasCritical ? 'Simulator found a critical issue — sending is blocked.' : undefined}
        >
          {sending
            ? (signer === 'seed' ? 'Sending…' : 'Confirm on device…')
            : simHasCritical
            ? 'Issue detected — blocked'
            : `Send ${chain === 'evm' ? (coin?.sym ?? '') : DESKTOP_CHAIN_META[chain].sym}${chain === 'evm' && signer === 'ledger' ? ' (Ledger)' : chain === 'evm' && signer === 'trezor' ? ' (Trezor)' : ''}`}
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────── Receive modal ──────────────────────── */
function ReceiveModal({ onClose, addresses }: { onClose: () => void; addresses?: { evm: string; btc: string; sol: string } }) {
  void addresses; // legacy prop — addresses are now derived lazily from the unlocked seed
  const seed = useContext(WalletSeedContext);
  const evmAddr = useMemo(() => seed.length ? deriveAddressesFromSeed(seed).evm : '', [seed]);
  const [chain, setChain] = useState<'evm'|'btc'|'sol'|'atom'>('evm');
  const [copied, setCopied] = useState(false);
  const [showAlt, setShowAlt] = useState(false);   // EVM tab: false=litho1, true=0x
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [btcAddr, setBtcAddr] = useState<string>('');
  const [solAddr, setSolAddr] = useState<string>('');
  const [atomAddr, setAtomAddr] = useState<string>('');
  const [chainBalance, setChainBalance] = useState<string>('');

  // Derive the Lithosphere bech32 form from the same 0x keypair.
  const lithoAddr = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddr)) return '';
    try { return evmToLitho(evmAddr); } catch { return ''; }
  }, [evmAddr]);

  // Lazy derivation — BTC/SOL/ATOM addresses are computed only when the
  // user picks that tab. Avoids loading 4 chain libs at modal open.
  useEffect(() => {
    if (chain === 'btc' && !btcAddr && seed.length) {
      void import('./bitcoin').then(m => setBtcAddr(m.getBitcoinAddress(seed.join(' '))))
        .catch(() => setBtcAddr(''));
    }
    if (chain === 'sol' && !solAddr && seed.length) {
      void import('./solana').then(m => setSolAddr(m.getSolanaAddress(seed.join(' '))))
        .catch(() => setSolAddr(''));
    }
    if (chain === 'atom' && !atomAddr && seed.length) {
      void import('./cosmos').then(m => m.getCosmosAddress(seed.join(' ')))
        .then(setAtomAddr)
        .catch(() => setAtomAddr(''));
    }
  }, [chain, seed, btcAddr, solAddr, atomAddr]);

  // Live balance for the active chain.
  useEffect(() => {
    setChainBalance('');
    if (chain === 'evm') return;
    let cancelled = false;
    const addr = chain === 'btc' ? btcAddr : chain === 'sol' ? solAddr : atomAddr;
    if (!addr) return;
    const fetchFor = async () => {
      try {
        if (chain === 'btc') {
          const m = await import('./bitcoin');
          const b = await m.getBitcoinBalance(addr);
          if (!cancelled) setChainBalance(`${b} BTC`);
        } else if (chain === 'sol') {
          const m = await import('./solana');
          const b = await m.getSolanaBalance(addr);
          if (!cancelled) setChainBalance(`${b} SOL`);
        } else {
          const m = await import('./cosmos');
          const b = await m.getCosmosBalance(addr);
          if (!cancelled) setChainBalance(`${b} ATOM`);
        }
      } catch { if (!cancelled) setChainBalance('—'); }
    };
    void fetchFor();
    return () => { cancelled = true; };
  }, [chain, btcAddr, solAddr, atomAddr]);

  // Reset the dual-format toggle when switching chains.
  useEffect(() => { setShowAlt(false); }, [chain]);

  const meta = {
    evm:  { label: 'Lithosphere / EVM', network: 'Lithosphere Makalu + every EVM chain', color: '#627eea' },
    btc:  { label: 'Bitcoin',           network: 'Mainnet · Native SegWit (BIP84)',      color: '#f7931a' },
    sol:  { label: 'Solana',            network: 'Mainnet-Beta · ed25519',               color: '#14f195' },
    atom: { label: 'Cosmos Hub',        network: 'cosmoshub-4',                          color: '#2e3148' },
  } as const;

  const addr =
    chain === 'evm'  ? (lithoAddr && !showAlt ? lithoAddr : evmAddr)
    : chain === 'btc'  ? btcAddr
    : chain === 'sol'  ? solAddr
    : atomAddr;

  // Render a real QR for whatever address is displayed.
  useEffect(() => {
    if (!addr) { setQrDataUrl(''); return; }
    let cancelled = false;
    void import('qrcode').then(qr => qr.toDataURL(addr, { width: 220, margin: 1 }))
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [addr]);

  const copy = () => {
    if (!addr) return;
    navigator.clipboard.writeText(addr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {/* Chain selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, width: '100%' }}>
          {(['evm','btc','sol','atom'] as const).map(c => (
            <button key={c} onClick={() => setChain(c)} className={`filter-pill ${chain === c ? 'active' : ''}`} style={{ flex: 1, fontSize: 11 }}>
              {c === 'evm' ? 'EVM' : c === 'btc' ? 'BTC' : c === 'sol' ? 'SOL' : 'ATOM'}
            </button>
          ))}
        </div>

        {/* Lithosphere dual-format toggle — only on the EVM tab. */}
        {chain === 'evm' && lithoAddr && (
          <div style={{
            display: 'inline-flex',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 999, padding: 3, marginBottom: 12,
          }}>
            {[
              { isAlt: false, label: 'Litho1' },
              { isAlt: true,  label: 'EVM'    },
            ].map(o => {
              const selected = o.isAlt === showAlt;
              return (
                <button
                  key={o.label}
                  onClick={() => setShowAlt(o.isAlt)}
                  style={{
                    background: selected ? 'var(--bg-card)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                    padding: '5px 14px', borderRadius: 999,
                    fontSize: 11, fontWeight: 600,
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >{o.label}</button>
              );
            })}
          </div>
        )}

        {/* Real QR encoding the displayed address. */}
        <div className="qr-box" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 220, height: 220, background: '#fff', borderRadius: 10 }}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt={addr} width={220} height={220}/>
            : <span style={{ fontSize: 12, color: '#666' }}>{addr ? 'Generating QR…' : 'Loading…'}</span>}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, marginTop: 12 }}>{meta[chain].label}</div>
        <div style={{ fontSize: 10, color: meta[chain].color, fontWeight: 600, marginBottom: 8 }}>● {meta[chain].network}</div>
        {chain !== 'evm' && chainBalance && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Balance: {chainBalance}
          </div>
        )}
        <div className="addr-box" style={{ fontSize: 10 }}>{addr ? (addr.length > 50 ? `${addr.slice(0,30)}…${addr.slice(-12)}` : addr) : '—'}</div>

        <button className="btn-primary" onClick={copy} style={{ marginTop: 14, width: '100%' }} disabled={!addr}>
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
  const [to, setTo]     = useState('LitBTC');
  const [amt, setAmt]   = useState('100');
  const [slippagePct, setSlippagePct] = useState<number>(0.5);
  const [, setExpTick] = useState(0);

  type QuoteShape = {
    quoteId: string; from: string; to: string;
    fromAmount: string; toAmount: string; rate: number; feeFrom: string;
    expiresAt?: number;
    unsignedTx?: {
      to: string; value?: string; data?: string;
      gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
    };
  };
  const [quote,    setQuote]    = useState<QuoteShape | null>(null);
  const [provider, setProvider] = useState<'multx' | 'ignite' | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [pollMsg,  setPollMsg]  = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    const v = amt.trim();
    if (!v || parseFloat(v) <= 0 || from === to) {
      setQuote(null); setProvider(null); setErr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const [mux, ign] = await Promise.allSettled([
        import('./multx').then(m => m.getQuote(from, to, v)),
        import('./ignite').then(m => m.getQuote(from, to, v)),
      ]);
      if (cancelled) return;
      const cands: Array<{ provider: 'multx' | 'ignite'; q: QuoteShape }> = [];
      if (mux.status === 'fulfilled') cands.push({ provider: 'multx',  q: mux.value });
      if (ign.status === 'fulfilled') cands.push({ provider: 'ignite', q: ign.value });
      if (cands.length === 0) {
        setQuote(null); setProvider(null);
        setErr('Bridge + DEX unavailable — try again shortly');
        return;
      }
      cands.sort((a, b) => Number(b.q.toAmount) - Number(a.q.toAmount));
      setQuote(cands[0].q); setProvider(cands[0].provider); setErr(null);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amt]);

  const quoteExpired = !!(quote?.expiresAt && Date.now() > quote.expiresAt);
  const quoteSecsLeft = quote?.expiresAt && quote.expiresAt > Date.now()
    ? Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000))
    : 0;
  const minReceived = quote ? Number(quote.toAmount) * (1 - slippagePct / 100) : 0;

  useEffect(() => {
    if (!quote?.expiresAt) return;
    const id = setInterval(() => setExpTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt]);

  const onSwap = async () => {
    if (!quote || !provider || busy) return;
    if (quoteExpired) {
      setErr('Quote expired — refresh to get a new rate.');
      setQuote(null); setProvider(null);
      return;
    }
    setBusy(true); setPollMsg('Awaiting execution…');
    try {
      const mod = await import(provider === 'multx' ? './multx' : './ignite');

      // Dual-mode dispatch — sign+broadcast locally if the quote includes
      // an `unsignedTx`, otherwise post the quoteId alone and let the
      // bridge/DEX run the source-chain tx server-side.
      let signedTxHash = '';
      if (quote.unsignedTx) {
        const bridge = window.thanosDesktop?.signer;
        if (bridge && (await bridge.hasSeed())) {
          signedTxHash = await bridge.sendTx("m/44'/60'/0'/0/0", {
            to:                   quote.unsignedTx.to,
            value:                quote.unsignedTx.value,
            data:                 quote.unsignedTx.data,
            gas:                  quote.unsignedTx.gas,
            maxFeePerGas:         quote.unsignedTx.maxFeePerGas,
            maxPriorityFeePerGas: quote.unsignedTx.maxPriorityFeePerGas,
          });
          setPollMsg(`Source tx: ${signedTxHash.slice(0, 10)}…`);
        }
      }

      const exec = await mod.execute(quote.quoteId, signedTxHash);
      const id = exec.executionId;
      if (exec.sourceHash) setPollMsg(`Source tx: ${exec.sourceHash.slice(0, 10)}…`);
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, Math.min(4000 + i * 2000, 30000)));
        try {
          const s = await mod.getStatus(id);
          if (s.state === 'completed') { setPollMsg('Swap complete ✓'); break; }
          if (s.state === 'failed') { setErr(s.error || 'Swap failed'); break; }
          setPollMsg(`Status: ${s.state}`);
        } catch { /* keep polling */ }
      }
    } catch (e) {
      setErr((e as Error).message || 'Swap failed');
    } finally { setBusy(false); }
  };

  const out = quote ? Number(quote.toAmount).toFixed(6) : '—';

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['LITHO','wLITHO','FGPT','LitBTC','LitETH','USDC'].map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>

        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}><ArrowsUD size={13}/></button>
        </div>

        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={to} onChange={e => setTo(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['LitBTC','LitETH','LITHO','wLITHO','FGPT','USDC'].map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {out}
          </div>
        </div>

        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>{quote ? `1 ${from} ≈ ${quote.rate.toFixed(6)} ${to}` : 'Quoting…'}</span>
        </div>
        <div className="fee-row">
          <span>Route</span>
          <span>{provider ? <strong style={{ color: 'var(--text-primary)' }}>{provider}</strong> : '—'}</span>
        </div>
        <div className="fee-row">
          <span>Fee</span>
          <span>{quote ? `${quote.feeFrom} ${from}` : '—'}</span>
        </div>

        {/* Slippage tolerance */}
        <div className="fee-row" style={{ alignItems: 'center' }}>
          <span>Slippage</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {[0.1, 0.5, 1, 2].map(s => {
              const active = slippagePct === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlippagePct(s)}
                  style={{
                    padding: '3px 8px', fontSize: 11, fontWeight: 700,
                    borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                    background: active ? 'var(--blue, #3b7af7)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                  }}
                >{s}%</button>
              );
            })}
          </span>
        </div>

        <div className="fee-row">
          <span>Minimum received</span>
          <span>{quote ? `${minReceived.toFixed(6)} ${to}` : '—'}</span>
        </div>

        {quote?.expiresAt && (
          <div className="fee-row">
            <span>Quote</span>
            <span style={{ color: quoteExpired ? 'var(--red)' : (quoteSecsLeft < 5 ? 'var(--orange, #f59e0b)' : 'var(--text-muted)') }}>
              {quoteExpired ? 'Expired — refresh to retry' : `Expires in ${quoteSecsLeft}s`}
            </span>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
        {pollMsg && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{pollMsg}</div>}

        <button className="btn-primary" style={{ marginTop: 18 }} disabled={!quote || busy || quoteExpired} onClick={onSwap}>
          {busy ? 'Swapping…' : quoteExpired ? 'Quote expired' : `Swap ${from} → ${to}`}
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────── Market view ──────────────────────── */
function MarketView() {
  const { rows, loading, offline } = useMarket();
  const [search, setSearch] = useState('');
  const filtered = rows.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.sym.toLowerCase().includes(search.toLowerCase()));

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
              <tr key={c.id} style={{ cursor: 'pointer' }}>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                <td>
                  <div className="tx-cell">
                    <TokenAvatar sym={c.sym} color={c.color} className="tx-avatar" label={c.sym.slice(0,2)}/>
                    <div>
                      <div className="tx-name">{c.name}</div>
                      <div className="tx-sym">{c.sym}</div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 12, fontWeight: 600 }}>{formatMarketPrice(c.price)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span className={c.chg24 >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg24 >= 0 ? '+' : ''}{c.chg24.toFixed(1)}%</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className={c.chg7 >= 0 ? 'amt-pos' : 'amt-neg'}>{c.chg7 >= 0 ? '+' : ''}{c.chg7.toFixed(1)}%</span>
                </td>
                <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>{formatCompact(c.cap)}</td>
                <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{formatCompact(c.vol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Loading market data…</div>}
        {!loading && offline && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Market data unavailable — CoinGecko may be rate-limiting.</div>}
        {!loading && !offline && filtered.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No coins match your search.</div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────── Portfolio view ──────────────────────── */
function PortfolioView() {
  const { coins, totalUsd, loading, offline } = usePortfolioCtx();

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
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.04em' }}>{loading ? '···' : formatUsd(totalUsd)}</div>
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
                <th style={{ textAlign: 'right' }}>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {coins.map(c => (
                <tr key={c.sym}>
                  <td>
                    <div className="tx-cell">
                      <TokenAvatar sym={c.sym} color={c.color} className="tx-avatar" label={c.sym.slice(0,2)}/>
                      <div>
                        <div className="tx-name">{c.name}</div>
                        <div className="tx-sym">{c.sym}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{c.priceUsd > 0 ? formatUsd(c.priceUsd) : '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>{c.balanceText} {c.sym}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 12 }}>{formatUsd(c.usdValue)}</td>
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
          {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Loading holdings…</div>}
          {!loading && offline && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Indexer offline.</div>}
          {!loading && !offline && coins.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No holdings yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────── Transactions view ──────────────────────── */
function TransactionsView() {
  const { activity, loading, offline } = usePortfolioCtx();
  const [filter, setFilter] = useState<'All'|'Send'|'Receive'|'Swap'>('All');
  const filtered = filter === 'All' ? activity : activity.filter(t => t.type === filter);

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
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => (
              <tr key={tx.id}>
                <td>
                  <div className="tx-cell">
                    <TokenAvatar sym={tx.sym} color={tx.color} className="tx-avatar" label={tx.sym.slice(0,2)}/>
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
        {loading && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Loading transactions…</div>}
        {!loading && offline && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Indexer offline.</div>}
        {!loading && !offline && filtered.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No transactions.</div>
        )}
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
              <TokenAvatar sym={p.sym} color={p.color} className="tx-avatar" label={p.sym.slice(0,2)} style={{ width: 38, height: 38, fontSize: 12, borderRadius: 10, flexShrink: 0 }}/>
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
function SettingsView({ toggleTheme, isDark, walletAddr }: { toggleTheme: () => void; isDark: boolean; walletAddr: string }) {
  const [currency, setCurrency] = useState('USD');
  const [autoLock, setAutoLock] = useState('5');
  const [rpc, setRpc]           = useState('https://rpc.litho.ai');
  const [hwOpen, setHwOpen]     = useState(false);
  const [wcOpen, setWcOpen]     = useState(false);

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

        <AddressBookSection Section={Section}/>
        <PermissionsSection Section={Section}/>

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
          <Row label="Hardware wallet" sub="Connect a Ledger via USB (Trezor support is wired through the same vendor allowlist)">
            <button className="settings-btn" onClick={() => setHwOpen(true)}><KeyIcon size={14}/> Connect</button>
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
          <Row label="WalletConnect" sub="Pair this wallet with a dApp via wc: link">
            <button className="settings-btn" onClick={() => setWcOpen(true)}><Globe size={14}/> Open</button>
          </Row>
        </Section>

        {hwOpen && <HardwareModal onClose={() => setHwOpen(false)} isDark={isDark}/>}
        {wcOpen && <WalletConnectModal evmAddress={walletAddr} onClose={() => setWcOpen(false)}/>}

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
            <button
              type="button"
              className="settings-btn settings-btn-link"
              onClick={() => { void window.thanosDesktop?.openExternal?.('https://thanos.fi/app'); }}
            >View <ChevRight2 size={14}/></button>
          </Row>
          <Row label="Privacy policy" sub="What data the wallet sends, where, and why">
            <button
              type="button"
              className="settings-btn settings-btn-link"
              onClick={() => { void window.thanosDesktop?.openExternal?.('https://thanos.fi/privacy'); }}
            >View <ChevRight2 size={14}/></button>
          </Row>
          <Row label="Security disclosures" sub="Report a vulnerability + PGP key">
            <button
              type="button"
              className="settings-btn settings-btn-link"
              onClick={() => { void window.thanosDesktop?.openExternal?.('https://thanos.fi/.well-known/security.txt'); }}
            >View <ChevRight2 size={14}/></button>
          </Row>
        </Section>
      </div>
    </div>
  );
}

/* ──────────────────────── Address book section ──────────────────────── */
function AddressBookSection({
  Section,
}: {
  Section: React.FC<{ icon: React.ElementType; title: string; sub: string; children: React.ReactNode }>;
}) {
  const [contacts, setContacts] = useState<AbContact[]>([]);
  const [name,     setName]     = useState('');
  const [address,  setAddress]  = useState('');
  const [err,      setErr]      = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    setContacts(loadContacts());
    syncContactsFromServer()
      .then(() => setContacts(loadContacts()))
      .catch(() => { /* offline / not authed */ });
    return onContactsChanged(() => setContacts(loadContacts()));
  }, []);

  const onAdd = async () => {
    setErr(null); setBusy(true);
    try {
      await addContact({ name, address });
      setName(''); setAddress('');
      setContacts(loadContacts());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add contact');
    } finally { setBusy(false); }
  };
  const onDelete = async (id: string) => {
    try { if (await deleteContact(id)) setContacts(loadContacts()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete'); }
  };

  return (
    <Section icon={User} title="Address book" sub="Saved contacts, cloud-synced when signed in">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
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
          className="btn-primary"
          onClick={onAdd}
          disabled={busy || !name.trim() || !address.trim()}
          style={{ marginTop: 4 }}
        >
          {busy ? 'Saving…' : 'Save contact'}
        </button>

        {contacts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {contacts.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: 'var(--bg-elevated)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {c.name}
                    {c.pendingSync && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>· not synced</span>}
                  </div>
                  <div style={{
                    color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace',
                    fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.evm}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(c.id)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--red)',
                    cursor: 'pointer', fontSize: 12, padding: '4px 8px',
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ──────────────────────── Permissions section ──────────────────────── */
function PermissionsSection({
  Section,
}: {
  Section: React.FC<{ icon: React.ElementType; title: string; sub: string; children: React.ReactNode }>;
}) {
  const seed = useContext(WalletSeedContext);
  const [tab, setTab] = useState<'allowances' | 'sessions'>('allowances');
  return (
    <Section icon={Shield} title="Permissions" sub="Token allowances + connected dApps">
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 10 }}>
          <button onClick={() => setTab('allowances')} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: tab === 'allowances' ? 'var(--bg-surface)' : 'transparent',
            color: tab === 'allowances' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600,
          }}>Token allowances</button>
          <button onClick={() => setTab('sessions')} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: tab === 'sessions' ? 'var(--bg-surface)' : 'transparent',
            color: tab === 'sessions' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600,
          }}>Connected apps</button>
        </div>
        {tab === 'allowances' ? <DesktopAllowancesPanel seed={seed}/> : <DesktopSessionsPanel/>}
      </div>
    </Section>
  );
}

function DesktopAllowancesPanel({ seed }: { seed: string[] }) {
  const [rows, setRows] = useState<Array<{
    tokenAddress: string; symbol: string; spender: string;
    amount: string; unlimited: boolean; decimals: number;
  }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const { fetchMakaluAllowances, getMakaluProvider } = await import('@thanos/sdk-core');
      const { HDNodeWallet, Mnemonic } = await import('ethers');
      const idx = getActiveAccountIndex();
      const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${idx}`);
      setRows(await fetchMakaluAllowances({ walletAddress: w.address, provider: getMakaluProvider() }));
    } catch (e) {
      setErr((e as Error).message); setRows([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const revoke = async (row: { tokenAddress: string; spender: string }) => {
    if (!seed.length) { setErr('Wallet is locked'); return; }
    const k = `${row.tokenAddress}|${row.spender}`;
    setBusy(k); setErr(null);
    try {
      const { revokeAllowance, getMakaluProvider } = await import('@thanos/sdk-core');
      const { HDNodeWallet, Mnemonic } = await import('ethers');
      const idx = getActiveAccountIndex();
      const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${idx}`)
        .connect(getMakaluProvider());
      const tx = await revokeAllowance({ signer: w, tokenAddress: row.tokenAddress, spender: row.spender });
      await tx.wait();
      void load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Scanning approvals…</div>;
  if (err)     return <div style={{ color: 'var(--red)', fontSize: 12 }}>{err}</div>;
  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No active allowances on Makalu.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(r => {
        const k = `${r.tokenAddress}|${r.spender}`;
        return (
          <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {r.symbol}
                {r.unlimited && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: 'rgba(245,158,11,0.16)', color: '#f59e0b', borderRadius: 4 }}>UNLIMITED</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.spender}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {r.unlimited ? 'Unlimited' : `${r.amount} ${r.symbol}`}
              </div>
            </div>
            <button onClick={() => revoke(r)} disabled={busy === k} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)',
              cursor: busy === k ? 'not-allowed' : 'pointer', opacity: busy === k ? 0.6 : 1,
            }}>{busy === k ? 'Revoking…' : 'Revoke'}</button>
          </div>
        );
      })}
    </div>
  );
}

function DesktopSessionsPanel() {
  const [rows, setRows] = useState<Array<{ topic: string; name: string; url: string; chains: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const { listActiveSessions } = await import('./walletconnect');
      const map = await listActiveSessions();
      setRows(Object.values(map).map(s => ({
        topic: s.topic,
        name:  s.peer?.metadata?.name || 'Unknown dApp',
        url:   s.peer?.metadata?.url  || '',
        chains: (s.namespaces?.eip155?.chains ?? []).join(', ') || 'eip155:700777',
      })));
    } catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { void load(); }, []);

  const disconnect = async (topic: string) => {
    setBusy(topic); setErr(null);
    try {
      const { disconnectSession } = await import('./walletconnect');
      await disconnectSession(topic);
      setRows(prev => prev?.filter(r => r.topic !== topic) ?? prev);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  if (!rows) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading sessions…</div>;
  if (rows.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No active dApp connections.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {err && <div style={{ color: 'var(--red)', fontSize: 11 }}>{err}</div>}
      {rows.map(r => (
        <div key={r.topic} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, background: 'var(--bg-elevated)', borderRadius: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.url}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>{r.chains}</div>
          </div>
          <button onClick={() => disconnect(r.topic)} disabled={busy === r.topic} style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
            background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)',
            cursor: busy === r.topic ? 'not-allowed' : 'pointer', opacity: busy === r.topic ? 0.6 : 1,
          }}>{busy === r.topic ? 'Disconnecting…' : 'Disconnect'}</button>
        </div>
      ))}
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

function deriveAddressesFromSeed(seed: string[], accountIdx = 0): DerivedAddresses {
  const phrase = seed.join(' ');
  let evm = '0x0000000000000000000000000000000000000000';
  try {
    // Real EVM address from BIP44 m/44'/60'/0'/0/{idx}
    const evmNode = HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${accountIdx}`);
    evm = evmNode.address;
  } catch (e) { console.warn('EVM derivation failed:', e); }
  // BTC + SOL + ATOM addresses are derived lazily inside ReceiveModal /
  // SendModal using their respective chain-specific modules (bitcoin.ts,
  // solana.ts, cosmos.ts). They aren't returned here because the
  // synchronous ethers-only derivation produces invalid bech32 / base58
  // addresses — sending coins there would lose them.
  const short = evm.length > 12 ? `${evm.slice(0,6)}…${evm.slice(-4)}` : evm;
  return { evm, btc: '', sol: '', short };
}

function deriveAddressFromSeed(seed: string[]): string {
  return deriveAddressesFromSeed(seed).evm;
}

async function fetchEthBalance(addr: string): Promise<string | null> {
  try {
    const provider = new JsonRpcProvider('https://ethereum.publicnode.com');
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
  /* Seed auto-mask — parity with web. After 30 s on the create-show
     screen the phrase blurs out and the user has to tap to re-reveal. */
  const [seedHidden, setSeedHidden] = useState(false);
  useEffect(() => {
    if (step !== 'create-show') { setSeedHidden(false); return; }
    if (seedHidden) return;
    const t = setTimeout(() => setSeedHidden(true), 30_000);
    return () => clearTimeout(t);
  }, [step, seedHidden]);
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
      setSeedBackedUp(true); // create flow includes seed verification
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
      setSeedBackedUp(true); // imported — user already holds the phrase
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
            <div className="seed-grid" style={{ position: 'relative' }}>
              {seed.map((w, i) => (
                <div key={i} className="seed-word">
                  <span className="seed-num">{i + 1}.</span>
                  <span style={{ filter: seedHidden ? 'blur(8px)' : 'none', transition: 'filter 0.2s' }}>{w}</span>
                </div>
              ))}
              {seedHidden && (
                <button
                  type="button"
                  onClick={() => setSeedHidden(false)}
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)',
                    borderRadius: 12, border: 'none',
                    color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  Tap to reveal
                </button>
              )}
            </div>
            <button
              className="btn-link"
              disabled={seedHidden}
              onClick={() => navigator.clipboard?.writeText(seed.join(' '))}
            >
              Copy to clipboard
            </button>
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

/* ──────────────────────── Discover / NFTs ──────────────────────── */

/** Open an http(s) URL in the user's default browser via the preload
 *  bridge (Electron blocks renderer window.open by default). */
function openExternal(url: string) {
  window.thanosDesktop?.openExternal?.(url);
}

function DiscoverAppRow({ app }: { app: EcosystemApp }) {
  return (
    <button
      className="discover-row"
      onClick={() => openExternal(app.url)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', background: 'transparent', border: 'none',
        borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
        textAlign: 'left', color: 'inherit',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 14, flexShrink: 0,
        background: app.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, fontWeight: 700,
      }}>{app.name.charAt(0)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{app.name}</span>
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontWeight: 600,
          }}>{app.category}</span>
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{app.description}</div>
      </div>
      <ChevRight2 size={18}/>
    </button>
  );
}

function DiscoverView() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const isLink = looksLikeUrl(q);
  const apps = query && !isLink
    ? ECOSYSTEM_APPS.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.category.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.section.toLowerCase().includes(query))
    : ECOSYSTEM_APPS;
  const groups = groupBySection(apps);
  const submit = () => { const u = normalizeUrl(q); if (u) openExternal(u); };

  return (
    <div className="view-wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>Discover</h1>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Apps from the Lithosphere ecosystem — open in your browser.
      </div>

      <div style={{ position: 'relative', marginBottom: 16 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'inline-flex' }}>
          <Search size={15}/>
        </span>
        <input
          className="field-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Search DApp or enter a link"
          style={{ paddingLeft: 36, width: '100%' }}
        />
      </div>

      {isLink && (
        <button
          onClick={submit}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 14,
            borderRadius: 14, marginBottom: 16, cursor: 'pointer', textAlign: 'left', color: 'inherit',
            background: 'rgba(59,122,247,0.10)', border: '1px solid var(--blue, #3b7af7)',
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'rgba(59,122,247,0.18)', color: 'var(--blue, #3b7af7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Globe size={20}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Open link</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normalizeUrl(q)}</div>
          </div>
        </button>
      )}

      <button
        onClick={() => openExternal(ECOSYSTEM_HUB)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 16,
          borderRadius: 16, marginBottom: 20, cursor: 'pointer', textAlign: 'left',
          color: 'inherit',
          background: 'linear-gradient(135deg, rgba(59,122,247,0.16), rgba(139,125,247,0.12))',
          border: '1px solid var(--border-default)',
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'rgba(59,122,247,0.18)', color: 'var(--blue, #3b7af7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Globe size={22}/></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Explore Web3</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Browse the full Lithosphere ecosystem on ecosystem.litho.ai
          </div>
        </div>
      </button>

      {groups.map(({ section, apps: secApps }) => (
        <div key={section} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.4, marginBottom: 8, textTransform: 'uppercase' }}>{section}</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {secApps.map(a => <DiscoverAppRow key={a.id} app={a}/>)}
          </div>
        </div>
      ))}
      {groups.length === 0 && !isLink && (
        <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>No apps match “{q}”.</div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14,
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
      }}>
        <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--green, #10b981)', display: 'inline-flex' }}>
          <Shield size={14}/>
        </span>
        <span>
          These are Lithosphere ecosystem apps. Always check the URL in your browser
          before connecting your wallet or signing a transaction.
        </span>
      </div>
    </div>
  );
}

function NftsView() {
  return (
    <div className="view-wrap" style={{ maxWidth: 760, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 16px' }}>NFTs</h1>
      <div style={{
        padding: '36px 16px', textAlign: 'center', background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)', borderRadius: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>No NFTs yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380, lineHeight: 1.5 }}>
          NFTs you receive on Lithosphere (LEP-721 / LEP-1155) will appear here.
          The indexing pipeline ships with the next backend slice — until then,
          browse and mint on the Lithosphere marketplace.
        </div>
        <button className="settings-btn" style={{ marginTop: 4 }} onClick={() => openExternal('https://makalu.litho.ai/nfts')}>
          Open marketplace <ChevRight2 size={14}/>
        </button>
      </div>
    </div>
  );
}

/* Trust Wallet-style vocabulary. 'swap' opens the swap modal rather than
   switching views; Settings lives in the account menu. */
const NAV: { key: View | 'swap'; label: string }[] = [
  { key: 'dashboard',    label: 'Home'     },
  { key: 'swap',         label: 'Swap'     },
  { key: 'staking',      label: 'Earn'     },
  { key: 'nfts',         label: 'NFTs'     },
  { key: 'portfolio',    label: 'Assets'   },
  { key: 'market',       label: 'Market'   },
  { key: 'discover',     label: 'Discover' },
  { key: 'transactions', label: 'Activity' },
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
  // Multi-account state — mirrors web. Storage helpers live in vault.ts.
  const [activeIdx, setActiveIdx]            = useState(0);
  const [accountCount, setAccountCountState] = useState(1);
  useEffect(() => {
    if (!unlocked) return;
    setActiveIdx(getActiveAccountIndex());
    setAccountCountState(getAccountCount());
  }, [unlocked]);

  const addrs = walletSeed.length > 0
    ? deriveAddressesFromSeed(walletSeed, activeIdx)
    : { evm: ACCOUNT.address, btc: 'bc1q…', sol: '11111…', short: ACCOUNT.address };

  const switchAccount = (idx: number) => {
    if (idx < 0 || idx >= accountCount) return;
    setActiveAccountIndex(idx);
    setActiveIdx(idx);
  };
  const addAccount = () => {
    if (accountCount >= MAX_ACCOUNTS) return;
    const next = accountCount;
    setAccountCount(next + 1);
    setAccountCountState(next + 1);
    setActiveAccountIndex(next);
    setActiveIdx(next);
  };
  const walletAddr = addrs.evm;
  const shortAddr  = addrs.short;
  const portfolio  = usePortfolio(walletAddr, walletSeed);

  useEffect(() => {
    if (!unlocked || walletSeed.length === 0) return;
    let cancelled = false;
    fetchEthBalance(walletAddr).then(b => { if (!cancelled) setLiveEth(b); });
    return () => { cancelled = true; };
  }, [unlocked, walletAddr, walletSeed.length]);

  // Derive contact-encryption key from the unlocked seed so the address book
  // can encrypt name + notes before pushing to /contacts. Cleared on lock.
  useEffect(() => {
    void setContactEncryptionKey(unlocked && walletSeed.length ? walletSeed : null);
    return () => { void setContactEncryptionKey(null); };
  }, [unlocked, walletSeed]);

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
        // Push the seed into the main process so subsequent signing
        // happens there, not in the renderer. Best-effort — older shells
        // without the bridge just keep using the renderer signer.
        try { await window.thanosDesktop?.signer?.setSeed(mnemonic); } catch { /* no bridge */ }
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
          // Mirror the seed into the main-process signer cache.
          void window.thanosDesktop?.signer?.setSeed(seed.join(' ')).catch(() => { /* no bridge */ });
        }}
      />
    );
  }

  const lock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    clearSessionKey();
    void window.thanosDesktop?.signer?.clearSeed().catch(() => { /* no bridge */ });
  };

  return (
    <WalletSeedContext.Provider value={walletSeed}>
    <PortfolioContext.Provider value={portfolio}>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Auto-update banner — mounts above the topnav so it's seen first
          but never blocks app interaction. Renders null when there's
          nothing to show. */}
      <UpdateBanner/>

      {/* Top navigation */}
      <nav className="topnav">
        <div className="topnav-logo">
          <div className="logo-mark">
            <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos" style={{ width: 34, height: 34, objectFit: 'contain', display: 'block' }}/>
          </div>
          <span style={{ marginLeft: 8, fontSize: 18, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>THANOS</span>
        </div>

        <div className="nav-tabs">
          {NAV.map(n => (
            <button
              key={n.key}
              className={`nav-tab ${view === n.key ? 'active' : ''}`}
              onClick={() => n.key === 'swap' ? setModal('swap') : setView(n.key)}
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
                <span className="chip-name">{walletSeed.length > 0 ? `Account ${activeIdx + 1}` : ACCOUNT.name}</span>
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
                      <div className="menu-name">{walletSeed.length > 0 ? `Account ${activeIdx + 1}` : ACCOUNT.name}</div>
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

                  {/* Multi-account switcher — mnemonic wallets only.
                      Reads from + writes to localStorage so a refresh
                      preserves the selection. */}
                  {walletSeed.length > 0 && (
                    <>
                      <div className="menu-divider"/>
                      {Array.from({ length: accountCount }, (_, i) => (
                        <button
                          key={i}
                          className="menu-item"
                          onClick={() => { switchAccount(i); setAccountMenu(false); }}
                          style={i === activeIdx ? { fontWeight: 700 } : undefined}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <circle cx="12" cy="8" r="4"/>
                            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                          </svg>
                          Account {i + 1}
                          {i === activeIdx && <span style={{ marginLeft: 'auto', color: 'var(--blue)' }}>●</span>}
                        </button>
                      ))}
                      {accountCount < MAX_ACCOUNTS && (
                        <button
                          className="menu-item"
                          onClick={() => { addAccount(); setAccountMenu(false); }}
                        >
                          <span style={{ width: 16, textAlign: 'center', fontSize: 18, lineHeight: '16px' }}>+</span>
                          Add account
                        </button>
                      )}
                    </>
                  )}

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
          {view === 'dashboard'    && <DashboardView onAction={setModal} liveEth={liveEth} onOpenSettings={() => setView('settings')}/>}
          {view === 'market'       && <MarketView/>}
          {view === 'portfolio'    && <PortfolioView/>}
          {view === 'transactions' && <TransactionsView/>}
          {view === 'staking'      && <StakingView/>}
          {view === 'discover'     && <DiscoverView/>}
          {view === 'nfts'         && <NftsView/>}
          {view === 'settings'     && <SettingsView toggleTheme={toggleTheme} isDark={isDark} walletAddr={walletAddr}/>}
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
    </PortfolioContext.Provider>
    </WalletSeedContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
