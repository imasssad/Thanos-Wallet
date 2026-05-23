import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, HDNodeWallet, Mnemonic } from 'ethers';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, Plus,
  Home, Clock, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  Copy, Check, Eye, EyeOff, Lock, Moon, Sun, User, Search,
  Fingerprint, Key, AlertTriangle, Globe, Zap, Bell, Shield,
} from 'lucide-react';
import {
  createVault, openVault, openVaultWithKey,
  saveVault, loadVault, clearVault,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
  isSeedBackedUp, setSeedBackedUp,
} from '../../lib/vault';
import {
  usePortfolio, PortfolioContext, usePortfolioCtx, formatUsd,
} from './portfolio';
import { WalletSeedContext, useWalletSeed, resolveRecipient, sendAsset } from './send';
import {
  evmToLitho, ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp,
  groupBySection, looksLikeUrl, normalizeUrl,
  fetchPortfolioHistory, type Holding, type PortfolioHistory, type Range,
  TransactionSimulator, type SimulationReport,
} from '@thanos/sdk-core';
import { WalletConnectModal } from './walletconnect';
import { executeWcRequest, summariseRequest, WcSignerError } from './wc-signer';

/* ──────────────────────── Storage / Wallet helpers ──────────────────────── */

// Storage keys for the popup. Mnemonic / has_vault / unlocked live in
// vault.ts; only the theme preference stays here.
const STORAGE = {
  theme: 'thanos-theme',
};

function generateMnemonic(): string[] {
  return Wallet.createRandom().mnemonic!.phrase.split(' ');
}
function isValidMnemonic(p: string) {
  try { Mnemonic.fromPhrase(p.trim().toLowerCase()); return true; }
  catch { return false; }
}
function deriveEvm(seed: string[]): string {
  try { return HDNodeWallet.fromPhrase(seed.join(' '), undefined, "m/44'/60'/0'/0/0").address; }
  catch { return '0x0000000000000000000000000000000000000000'; }
}

/* ──────────────────────── Token icon ──────────────────────── */

/* Bundled client icon pack lives in public/images/tokens/ (served at
   the extension root). Mainstream coins fall through to a CoinGecko
   CDN logo. Mirrors the web TokenIcon + mobile token-icons resolver. */
const BUNDLED_ICONS: Record<string, string> = {
  litho:  '/images/tokens/litho.jpg',
  jot:    '/images/tokens/jot.png',
  lax:    '/images/tokens/lax.png',
  colle:  '/images/tokens/colle.png',
  furgpt: '/images/tokens/furgpt.png',
  ignite: '/images/tokens/ignite.png',
  quantt: '/images/tokens/quantt.png',
};
const REMOTE_ICONS: Record<string, string> = {
  btc:    'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  litbtc: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  eth:    'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  sol:    'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  usdc:   'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
};
function iconFor(sym: string): string | null {
  const k = (sym || '').toLowerCase();
  return BUNDLED_ICONS[k] ?? REMOTE_ICONS[k] ?? null;
}

/** Coin avatar — icon composited over the brand-colour circle, with the
 *  ticker initial as the fallback when no icon resolves or it errors. */
function TokenAvatar({ sym, color }: { sym: string; color: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : iconFor(sym);
  return (
    <div className="row-avatar" style={{ background: color, position: 'relative', overflow: 'hidden' }}>
      <span>{sym.slice(0, 1)}</span>
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

/* ──────────────────────── Onboarding ──────────────────────── */

type OnboardStep = 'welcome' | 'create-warn' | 'create-show' | 'create-confirm' | 'create-pwd'
                 | 'import' | 'import-pwd' | 'unlock';

function Onboarding({ hasVault, onComplete }: { hasVault: boolean; onComplete: (s: string[]) => void }) {
  const [step, setStep] = useState<OnboardStep>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
  /* Verify-phrase: only N indices missing, user fills them from a pool */
  const VERIFY_MISSING = 4;
  const [missingIdxs,  setMissingIdxs] = useState<number[]>([]);
  const [verifyPicks,  setVerifyPicks] = useState<Record<number, string>>({});
  const [verifyPool,   setVerifyPool]  = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);

  const startCreate = () => { setSeed(generateMnemonic()); setStep('create-warn'); };
  const goToVerify = () => {
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

  const [busy, setBusy] = useState(false);

  const finishCreate = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    setBusy(true);
    try {
      const vault = await createVault(seed.join(' '), password);
      saveVault(vault);
      setSeedBackedUp(true); // create flow includes seed verification
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(seed);
    } finally { setBusy(false); }
  };
  const finishImport = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) { alert('Phrase must be 12/15/18/21/24 words'); return; }
    if (!isValidMnemonic(words.join(' '))) { alert('Invalid recovery phrase'); return; }
    setBusy(true);
    try {
      const vault = await createVault(words.join(' '), password);
      saveVault(vault);
      setSeedBackedUp(true); // imported — user already holds the phrase
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(words);
    } finally { setBusy(false); }
  };
  const tryUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setUnlockErr('');
    try {
      const vault = loadVault();
      if (!vault) { setUnlockErr('No wallet on this browser.'); return; }
      const opened = await openVault(vault, unlockPwd);
      if (!opened) { setUnlockErr('Incorrect password'); setUnlockPwd(''); return; }
      cacheSessionKey(opened.key);
      onComplete(opened.mnemonic.split(' '));
    } finally { setBusy(false); }
  };
  const resetWallet = () => {
    if (window.confirm('Erase wallet from this browser? You can restore with your recovery phrase.')) {
      clearVault();
      setStep('welcome'); setUnlockPwd(''); setUnlockErr('');
    }
  };
  const copySeed = async () => {
    const text = seed.join(' ');
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    if (ok) { setCopiedSeed(true); setTimeout(() => setCopiedSeed(false), 2000); }
  };

  return (
    <div className="onb-wrap">
      <div className="onb-card">
        <div className="onb-logo">
          <img src="/icons/icon128.png" alt="Thanos" width="48" height="48"/>
        </div>

        {step === 'welcome' && <>
          <h1 className="onb-title">Welcome to Thanos</h1>
          <p className="onb-sub">Multi-chain Web4 wallet</p>
          <button className="btn-primary" onClick={startCreate}>Create new wallet</button>
          <button className="btn-outline" onClick={() => setStep('import')}>Import existing</button>
        </>}

        {step === 'create-warn' && <>
          <h1 className="onb-title">Save your phrase</h1>
          <p className="onb-sub">12 words = your wallet's only backup. Anyone with them has full access.</p>
          <ul className="warn-list">
            <li>Write them down on paper</li>
            <li>Keep them safe and private</li>
            <li>Never share with anyone</li>
          </ul>
          <div className="row-btns">
            <button className="btn-outline" onClick={() => setStep('welcome')}>Back</button>
            <button className="btn-primary" onClick={() => setStep('create-show')}>I understand</button>
          </div>
        </>}

        {step === 'create-show' && <>
          <h1 className="onb-title">Recovery phrase</h1>
          <p className="onb-sub">Write all 12 words down in order.</p>
          <div className="seed-grid">
            {seed.map((w, i) => (
              <div key={i} className="seed-cell">
                <span className="seed-num">{i + 1}.</span>
                <span style={{ userSelect: 'text' }}>{w}</span>
              </div>
            ))}
          </div>
          <button className="btn-link" onClick={copySeed}>
            {copiedSeed ? <><Check size={13}/> Copied</> : <><Copy size={13}/> Copy phrase</>}
          </button>
          <div className="row-btns">
            <button className="btn-outline" onClick={() => setStep('create-warn')}>Back</button>
            <button className="btn-primary" onClick={goToVerify}>Saved it</button>
          </div>
        </>}

        {step === 'create-confirm' && <>
          <h1 className="onb-title">Verify phrase</h1>
          <p className="onb-sub">Fill in the {VERIFY_MISSING} missing words from the pool below. Tap a slot to undo.</p>
          <div className="seed-grid">
            {seed.map((word, i) => {
              const isMissing = missingIdxs.includes(i);
              const picked = verifyPicks[i];
              const filled = picked !== undefined;
              const wrong = orderMismatch && filled && seed[i] !== picked;
              if (!isMissing) {
                return (
                  <div key={i} className="seed-cell seed-faded">
                    <span className="seed-num">{i + 1}.</span>
                    <span>{word}</span>
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`seed-cell seed-slot${filled ? ' filled' : ''}${wrong ? ' wrong' : ''}`}
                  onClick={() => filled && unpickAt(i)}
                >
                  <span className="seed-num">{i + 1}.</span>
                  <span>{picked ?? ' '}</span>
                </div>
              );
            })}
          </div>
          <div className="seed-pool">
            {verifyPool.map((w, i) => (
              <button key={`${w}-${i}`} type="button" className="seed-pool-chip" onClick={() => pickWord(w)}>{w}</button>
            ))}
          </div>
          {orderMismatch && <div className="onb-err">Order doesn't match. Tap slots to undo.</div>}
          <div className="row-btns">
            <button className="btn-outline" onClick={() => setStep('create-show')}>Back</button>
            <button className="btn-primary" disabled={!allConfirmed} onClick={() => setStep('create-pwd')}>Continue</button>
          </div>
        </>}

        {(step === 'create-pwd' || step === 'import-pwd') && <>
          <h1 className="onb-title">Set password</h1>
          <p className="onb-sub">Min 8 characters. Used to unlock on this device.</p>
          <input className="field" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}/>
          <input className="field" type="password" placeholder="Confirm" value={password2} onChange={e => setPassword2(e.target.value)} style={{ marginTop: 8 }}/>
          {password && password.length < 8 && <div className="onb-err">Min 8 characters</div>}
          {password && password2 && password !== password2 && <div className="onb-err">Passwords don't match</div>}
          <div className="row-btns">
            <button className="btn-outline" onClick={() => setStep(step === 'create-pwd' ? 'create-confirm' : 'import')}>Back</button>
            <button className="btn-primary" disabled={password.length < 8 || password !== password2 || busy} onClick={step === 'create-pwd' ? finishCreate : finishImport}>
              {busy ? 'Encrypting…' : (step === 'create-pwd' ? 'Create' : 'Import')}
            </button>
          </div>
        </>}

        {step === 'import' && <>
          <h1 className="onb-title">Import wallet</h1>
          <p className="onb-sub">Paste your recovery phrase (12-24 words).</p>
          <textarea className="field field-textarea" placeholder="word1 word2…" value={importInput} onChange={e => setImportInput(e.target.value)}/>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {importInput.trim().split(/\s+/).filter(Boolean).length} words
          </div>
          <div className="row-btns">
            <button className="btn-outline" onClick={() => setStep('welcome')}>Back</button>
            <button className="btn-primary"
              disabled={![12,15,18,21,24].includes(importInput.trim().split(/\s+/).filter(Boolean).length)}
              onClick={() => setStep('import-pwd')}>Continue</button>
          </div>
        </>}

        {step === 'unlock' && <>
          <h1 className="onb-title">Welcome back</h1>
          <p className="onb-sub">Enter password to unlock</p>
          <div className="input-wrap">
            <input
              className="field"
              type={showPwd ? 'text' : 'password'}
              placeholder="Password"
              value={unlockPwd}
              onChange={e => { setUnlockPwd(e.target.value); setUnlockErr(''); }}
              onKeyDown={e => e.key === 'Enter' && tryUnlock()}
              autoFocus
            />
            <button className="input-eye" onClick={() => setShowPwd(s => !s)} type="button" tabIndex={-1}>
              {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
            </button>
          </div>
          {unlockErr && <div className="onb-err">{unlockErr}</div>}
          <button className="btn-primary btn-pill" onClick={tryUnlock} disabled={!unlockPwd || busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          <div className="onb-footer">
            <p className="onb-footer-text">Forgot password? Wallet can be restored with the recovery phrase.</p>
            <button className="onb-footer-link" onClick={resetWallet}>Reset wallet</button>
          </div>
        </>}
      </div>
    </div>
  );
}

/* ──────────────────────── Main app screens ──────────────────────── */

/* Compact portfolio sparkline for the popup. Real CoinGecko history for
   tracked coins; flat for placeholder-priced ecosystem tokens. */
function MiniChart({ holdings }: { holdings: Holding[] }) {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<PortfolioHistory | null>(null);
  const W = 320, H = 56;
  const key = useMemo(() => holdings.map(h => `${h.sym}:${h.qty.toFixed(6)}`).join('|'), [holdings]);
  useEffect(() => {
    let cancel = false;
    fetchPortfolioHistory(holdings, range).then(d => { if (!cancel) setData(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [key, range]);

  const pts = data?.points ?? [];
  const up = (data?.changePct ?? 0) >= 0;
  const stroke = up ? '#10b981' : '#f87171';
  let line = '', area = '';
  if (pts.length >= 2) {
    const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1, dx = W / (pts.length - 1);
    const coords = pts.map((p, i) => [i * dx, H - 4 - ((p - min) / span) * (H - 8)] as const);
    line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    area = `${line} L${W},${H} L0,${H} Z`;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="mc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22"/>
            <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#mc-fill)"/>}
        {line && <path d={line} fill="none" stroke={stroke} strokeWidth={1.6}/>}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
        {(['7d', '30d'] as Range[]).map(r => (
          <button key={r} onClick={() => setRange(r)} className={`filter-pill ${range === r ? 'active' : ''}`} style={{ fontSize: 10, padding: '2px 8px' }}>
            {r.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function HomeScreen({ onAction, onLock, onOpenSettings }: { onAction: (m: 'send'|'receive'|'swap') => void; onLock: () => void; onOpenSettings: () => void }) {
  const { coins, totalUsd, loading, offline } = usePortfolioCtx();
  const [backedUp, setBackedUp] = useState<boolean | null>(null);
  useEffect(() => { setBackedUp(isSeedBackedUp()); }, []);
  const holdings: Holding[] = useMemo(
    () => coins.filter(c => c.balance > 0 && c.usdValue > 0).map(c => ({ sym: c.sym, qty: c.balance, usd: c.usdValue })),
    [coins],
  );
  return (
    <div className="screen">
      <div className="screen-header">
        <div className="acct-chip" onClick={onLock} title="Long-press to lock">
          <div className="acct-avatar"><User size={13}/></div>
          <div>
            <div className="acct-name">Account 1</div>
            <div className="acct-addr">{offline ? 'Makalu · offline' : 'Makalu'}</div>
          </div>
        </div>
        <button className="icon-btn"><Bell size={15}/></button>
      </div>

      <div className="balance-card">
        <div className="balance-label">TOTAL BALANCE</div>
        <div className="balance-amt">{loading ? '···' : formatUsd(totalUsd)}</div>
      </div>

      {holdings.length > 0 && <MiniChart holdings={holdings}/>}

      {backedUp === false && (
        <button
          onClick={onOpenSettings}
          className="row"
          style={{
            width: '100%', cursor: 'pointer', textAlign: 'left', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 12, marginBottom: 12, background: 'rgba(245,158,11,0.08)',
          }}
        >
          <div className="row-avatar" style={{ background: 'rgba(245,158,11,0.16)', color: '#f59e0b' }}><Shield size={15}/></div>
          <div className="row-mid">
            <div className="row-name">Back up your recovery phrase</div>
            <div className="row-sub">Export and store it safely in Settings.</div>
          </div>
          <ChevronRight size={16} className="row-right"/>
        </button>
      )}

      <div className="qa-row">
        <button className="qa-btn" onClick={() => onAction('send')}>
          <div className="qa-icon"><ArrowUpRight size={14}/></div>
          <span>Send</span>
        </button>
        <button className="qa-btn" onClick={() => onAction('receive')}>
          <div className="qa-icon"><ArrowDownLeft size={14}/></div>
          <span>Receive</span>
        </button>
        <button className="qa-btn" onClick={() => onAction('swap')}>
          <div className="qa-icon"><Repeat size={14}/></div>
          <span>Swap</span>
        </button>
        <button className="qa-btn">
          <div className="qa-icon"><Plus size={14}/></div>
          <span>Buy</span>
        </button>
      </div>

      <div className="section-header">
        <span>Assets</span>
        <span className="count-pill">{coins.length}</span>
      </div>
      <div className="card list">
        {loading && <div className="row-sub" style={{ padding: 12 }}>Loading balances…</div>}
        {!loading && offline && <div className="row-sub" style={{ padding: 12 }}>Couldn’t reach the indexer</div>}
        {!loading && !offline && coins.length === 0 && <div className="row-sub" style={{ padding: 12 }}>No assets yet</div>}
        {coins.map((a, i) => (
          <div key={a.sym} className={`row ${i < coins.length - 1 ? 'row-border' : ''}`}>
            <TokenAvatar sym={a.sym} color={a.color}/>
            <div className="row-mid">
              <div className="row-name">{a.name}</div>
              <div className="row-sub">{a.priceUsd > 0 ? formatUsd(a.priceUsd) : '—'}</div>
            </div>
            <div className="row-right">
              <div className="row-amt">{formatUsd(a.usdValue)}</div>
              <div className="row-bal">{a.balanceText} {a.sym}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityScreen() {
  const { activity, loading, offline } = usePortfolioCtx();
  return (
    <div className="screen">
      <h1 className="page-title">Activity</h1>
      <div className="filter-row">
        {['All', 'Sent', 'Received', 'Swap'].map((f, i) => (
          <button key={f} className={`filter-pill ${i === 0 ? 'active' : ''}`}>{f}</button>
        ))}
      </div>
      <div className="section-header">Recent</div>
      <div className="card list">
        {loading && <div className="row-sub" style={{ padding: 12 }}>Loading activity…</div>}
        {!loading && offline && <div className="row-sub" style={{ padding: 12 }}>Couldn’t reach the indexer</div>}
        {!loading && !offline && activity.length === 0 && <div className="row-sub" style={{ padding: 12 }}>No transactions yet</div>}
        {activity.map((t, i) => {
          const Ic = t.label === 'Sent' ? ArrowUpRight : t.label === 'Received' ? ArrowDownLeft : Repeat;
          return (
            <div key={t.id} className={`row ${i < activity.length - 1 ? 'row-border' : ''}`}>
              <div className="row-avatar" style={{ background: t.pos ? 'rgba(16,185,129,0.18)' : 'rgba(59,122,247,0.18)', color: t.pos ? '#10b981' : '#3b7af7' }}>
                <Ic size={14} strokeWidth={2.4}/>
              </div>
              <div className="row-mid">
                <div className="row-name">{t.label} {t.sym}</div>
                <div className="row-sub">{t.time}</div>
              </div>
              <div className="row-right">
                <div className={`row-amt ${t.pos ? 'pos' : ''}`}>{t.amount} {t.sym}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Discover — Lithosphere ecosystem apps, grouped SafePal-style; the
   search box doubles as an address bar (Enter opens a typed link). */
function DiscoverScreen() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const isLink = looksLikeUrl(q);
  const filtered: EcosystemApp[] = query && !isLink
    ? ECOSYSTEM_APPS.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.category.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.section.toLowerCase().includes(query))
    : ECOSYSTEM_APPS;
  const groups = groupBySection(filtered);
  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const submit = () => { const u = normalizeUrl(q); if (u) open(u); };

  return (
    <div className="screen">
      <h1 className="page-title">Discover</h1>
      <div className="row-sub" style={{ marginBottom: 10 }}>
        Lithosphere ecosystem apps — open in your browser.
      </div>

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'inline-flex' }}>
          <Search size={14}/>
        </span>
        <input
          className="field-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Search DApp or enter a link"
          style={{ paddingLeft: 32, width: '100%' }}
        />
      </div>

      {isLink && (
        <button className="row" onClick={submit} style={{ width: '100%', cursor: 'pointer', textAlign: 'left', border: '1px solid var(--blue, #3b7af7)', borderRadius: 12, marginBottom: 12, background: 'rgba(59,122,247,0.10)' }}>
          <div className="row-avatar" style={{ background: 'rgba(59,122,247,0.18)', color: '#3b7af7' }}><Globe size={16}/></div>
          <div className="row-mid">
            <div className="row-name">Open link</div>
            <div className="row-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normalizeUrl(q)}</div>
          </div>
          <ChevronRight size={16} className="row-right"/>
        </button>
      )}

      {!query && (
        <button
          className="row"
          onClick={() => open(ECOSYSTEM_HUB)}
          style={{
            width: '100%', cursor: 'pointer', textAlign: 'left', border: 'none',
            borderRadius: 12, marginBottom: 12,
            background: 'linear-gradient(135deg, rgba(59,122,247,0.16), rgba(139,125,247,0.12))',
          }}
        >
          <div className="row-avatar" style={{ background: 'rgba(59,122,247,0.18)', color: '#3b7af7' }}>
            <Globe size={16}/>
          </div>
          <div className="row-mid">
            <div className="row-name">Explore Web3</div>
            <div className="row-sub">Browse the full ecosystem on ecosystem.litho.ai</div>
          </div>
          <ChevronRight size={16} className="row-right"/>
        </button>
      )}

      {groups.map(({ section, apps }) => (
        <div key={section}>
          <div className="section-header">{section}</div>
          <div className="card list">
            {apps.map((a, i) => (
              <button
                key={a.id}
                className={`row ${i < apps.length - 1 ? 'row-border' : ''}`}
                onClick={() => open(a.url)}
                style={{ width: '100%', cursor: 'pointer', textAlign: 'left', border: 'none', background: 'transparent' }}
              >
                <div className="row-avatar" style={{ background: a.color, color: '#fff', fontWeight: 700 }}>
                  {a.name.charAt(0)}
                </div>
                <div className="row-mid">
                  <div className="row-name">{a.name}</div>
                  <div className="row-sub">{a.description}</div>
                </div>
                <ChevronRight size={16} className="row-right"/>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && !isLink && <div className="row-sub" style={{ padding: 12 }}>No apps match “{q}”.</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 10, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <span style={{ flexShrink: 0, marginTop: 1, color: '#10b981', display: 'inline-flex' }}><Shield size={12}/></span>
        <span>Always check the URL in your browser before connecting your wallet.</span>
      </div>
    </div>
  );
}

function SettingsScreen({ isDark, onToggleTheme, onLock, onOpenWalletConnect }: { isDark: boolean; onToggleTheme: () => void; onLock: () => void; onOpenWalletConnect: () => void }) {
  // Premium-pattern settings: icon-led section headers + a gradient title hero.
  // Adapted for the 360px popup — smaller paddings + tighter spacing.
  const SectionHead = ({ Icon, title, sub }: { Icon: React.ElementType; title: string; sub: string }) => (
    <div className="x-set-section-head">
      <div className="x-set-section-icon"><Icon size={14}/></div>
      <div>
        <div className="x-set-section-title">{title}</div>
        <div className="x-set-section-sub">{sub}</div>
      </div>
    </div>
  );

  return (
    <div className="screen x-settings">
      <div className="x-set-hero">
        <h1 className="x-set-hero-title">Settings</h1>
        <p className="x-set-hero-sub">Account, security, and appearance.</p>
      </div>

      <div className="acct-header-card">
        <img src="/icons/icon128.png" alt="" width="32" height="32"/>
        <div style={{ flex: 1 }}>
          <div className="acct-header-name">Account 1</div>
          <div className="acct-header-addr">litho1a7…o9z4v</div>
        </div>
        <button className="copy-chip">Copy</button>
      </div>

      <SectionHead Icon={Shield} title="Security" sub="Protect access to your wallet"/>
      <div className="card list">
        <div className="set-row row-border">
          <div className="set-icon"><Fingerprint size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Biometric unlock</div>
            <div className="set-sub">Coming soon</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </div>
        <div className="set-row row-border">
          <div className="set-icon"><Key size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Change password</div>
            <div className="set-sub">Update wallet password</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </div>
        <div className="set-row">
          <div className="set-icon" style={{ color: 'var(--red)' }}><AlertTriangle size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label" style={{ color: 'var(--red)' }}>Recovery phrase</div>
            <div className="set-sub">View your 12 / 24-word seed</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </div>
      </div>

      <SectionHead Icon={Globe} title="Connections" sub="WalletConnect-paired dApps"/>
      <div className="card list">
        <button className="set-row" onClick={onOpenWalletConnect} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon"><Globe size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">WalletConnect</div>
            <div className="set-sub">Pair via wc: link (popup-scoped session)</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
      </div>

      <SectionHead Icon={isDark ? Moon : Sun} title="Appearance" sub="Theme and display"/>
      <div className="card list">
        <button className="set-row" onClick={onToggleTheme} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
          <div className="set-icon">{isDark ? <Moon size={15}/> : <Sun size={15}/>}</div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Theme</div>
            <div className="set-sub">{isDark ? 'Dark mode' : 'Light mode'}</div>
          </div>
          <div className={`toggle ${isDark ? 'on' : ''}`}><div className="toggle-thumb"/></div>
        </button>
      </div>

      <SectionHead Icon={Lock} title="Session" sub="Sign out on this device"/>
      <div className="card list">
        <button className="set-row" onClick={onLock} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon" style={{ color: 'var(--red)' }}><Lock size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label" style={{ color: 'var(--red)' }}>Lock wallet</div>
            <div className="set-sub">Require password to access</div>
          </div>
        </button>
      </div>

      <div className="x-set-version">Thanos Wallet · v0.8.1</div>
    </div>
  );
}

/* ──────────────────────── Modals ──────────────────────── */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <button className="modal-back-btn" onClick={onClose}><ChevronLeft size={18}/></button>
          <span className="modal-title">{title}</span>
          <div style={{ width: 28 }}/>
        </div>
        {children}
      </div>
    </div>
  );
}

function SendModal({ onClose }: { onClose: () => void }) {
  const { coins } = usePortfolioCtx();
  const seed = useWalletSeed();
  const [selectedSym, setSelectedSym] = useState('');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const coin = coins.find(c => c.sym === selectedSym) ?? coins[0] ?? null;
  const amtNum = parseFloat(amt || '0');
  const overBalance = !!coin && amtNum > coin.balance;
  const canSend = !!coin && amtNum > 0 && !overBalance && !!to.trim() && !sending;

  const doSend = async () => {
    if (!coin) return;
    if (!coin.native && !coin.tokenAddress) {
      setError(`${coin.sym} has no contract address available.`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const recipient = await resolveRecipient(to);
      const hash = await sendAsset({
        seed,
        to:           recipient,
        amount:       amt,
        decimals:     coin.decimals,
        tokenAddress: coin.native ? undefined : coin.tokenAddress,
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
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 28 }}>✓</div>
        <div style={{ fontWeight: 700 }}>Transaction sent</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{amt} {coin?.sym} broadcast on Makalu</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', margin: '8px 0' }}>{txHash}</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">ASSET</label>
        <select className="field" value={coin?.sym ?? ''} onChange={e => setSelectedSym(e.target.value)}>
          {coins.length === 0 && <option value="">No assets available</option>}
          {coins.map(c => <option key={c.sym} value={c.sym}>{c.sym} — {c.name}</option>)}
        </select>
        <label className="field-label" style={{ marginTop: 14 }}>RECIPIENT</label>
        <input className="field" placeholder="0x… , litho1… or name.litho" value={to} onChange={e => setTo(e.target.value)}/>
        <label className="field-label" style={{ marginTop: 14 }}>AMOUNT</label>
        <input className="field" placeholder="0.00" type="number" value={amt} onChange={e => setAmt(e.target.value)}/>
        <div style={{ fontSize: 11, color: overBalance ? '#dc2626' : 'var(--text-muted)', marginTop: 6 }}>
          {overBalance ? 'Amount exceeds balance' : `Balance: ${coin?.balanceText ?? '—'} ${coin?.sym ?? ''}`}
          {coin && (
            <button
              style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}
              onClick={() => setAmt(String(coin.balance))}
            >MAX</button>
          )}
        </div>
        {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{error}</div>}
        <button className="btn-primary" disabled={!canSend} style={{ marginTop: 16 }} onClick={doSend}>
          {sending ? 'Sending…' : `Send ${coin?.sym ?? ''}`}
        </button>
      </div>
    </Modal>
  );
}

function ReceiveModal({ onClose, address }: { onClose: () => void; address: string }) {
  const [copied, setCopied]     = useState(false);
  const [showAlt, setShowAlt]   = useState(false);   // false = litho1, true = 0x

  const lithoAddr = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return '';
    try { return evmToLitho(address); } catch { return ''; }
  }, [address]);

  const displayed = lithoAddr && !showAlt ? lithoAddr : address;

  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(displayed); ok = true; } catch {}
    if (!ok) {
      const ta = document.createElement('textarea'); ta.value = displayed;
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {/* Lithosphere dual-format toggle — same wallet, two formats. */}
        {lithoAddr && (
          <div style={{
            display: 'inline-flex', marginBottom: 12,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 999, padding: 3,
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
        <div className="qr-box">
          <svg viewBox="0 0 100 100" width="160" height="160">
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
        <div className="addr-box">{displayed.slice(0, 16)}…{displayed.slice(-6)}</div>
        <button className="btn-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy address'}</button>
      </div>
    </Modal>
  );
}

function SwapModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('LITHO'); const [to, setTo] = useState('ETH'); const [amt, setAmt] = useState('100');
  const rates: Record<string, Record<string, number>> = {
    LITHO:  { wLITHO: 1.0,    FGPT: 20.0,   ETH: 0.0000832, BTC: 0.0000050, USDC: 0.30 },
    wLITHO: { LITHO: 1.0,     FGPT: 20.0,   ETH: 0.0000832, BTC: 0.0000050, USDC: 0.30 },
    FGPT:   { LITHO: 0.05,    wLITHO: 0.05, ETH: 0.00000416, BTC: 0.00000025, USDC: 0.015 },
    BTC:    { LITHO: 199867,  wLITHO: 199867, FGPT: 4213333, ETH: 16.22, USDC: 63200 },
    ETH:    { LITHO: 12018,   wLITHO: 12018,  FGPT: 259467,  BTC: 0.0617, USDC: 3892 },
  };
  const out = ((rates[from]?.[to] ?? 1) * parseFloat(amt || '0')).toFixed(4);
  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">FROM</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="field" style={{ width: 80 }} value={from} onChange={e => setFrom(e.target.value)}>
            {['LITHO','wLITHO','FGPT','BTC','ETH'].map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '8px 0' }}>↓</div>
        <label className="field-label">TO</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="field" style={{ width: 80 }} value={to} onChange={e => setTo(e.target.value)}>
            {['wLITHO','LITHO','FGPT','ETH','BTC','USDC'].map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field" style={{ flex: 1, display: 'flex', alignItems: 'center', fontWeight: 700 }}>{out}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>1 {from} ≈ 16.22 {to}</div>
        <button className="btn-primary" style={{ marginTop: 12 }}>Swap</button>
      </div>
    </Modal>
  );
}

/* ──────────────────────── App shell ──────────────────────── */

type Tab = 'home' | 'discover' | 'activity' | 'settings';
type Modal = 'send' | 'receive' | 'swap' | 'walletconnect' | null;

/* ─── EIP-1193 connection approval screen ──────────────────────────────── */
function ApprovalScreen({
  approval, address, onApprove, onReject,
}: {
  approval: { origin: string; method: string };
  address:  string;
  onApprove: () => void;
  onReject:  () => void;
}) {
  // origin = 'https://app.example.com'. Strip protocol for nicer display.
  const host = (() => {
    try { return new URL(approval.origin).host; } catch { return approval.origin; }
  })();
  return (
    <div className="screen" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(59,122,247,0.14)',
          border: '1px solid rgba(59,122,247,0.30)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 10,
        }}>
          <Globe size={26} color="var(--blue)"/>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>Connect this site?</div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'Geist Mono, monospace',
          wordBreak: 'break-all',
        }}>
          {host}
        </div>
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>This site will be able to</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          • See your wallet address &amp; balance<br/>
          • Request approvals for transactions &amp; signatures
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          padding: '8px 10px',
          background: 'var(--bg-elevated)',
          borderRadius: 8,
          fontFamily: 'Geist Mono, monospace',
          wordBreak: 'break-all',
        }}>
          {address}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button className="btn-outline" style={{ flex: 1 }} onClick={onReject}>Reject</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={onApprove}>Connect</button>
      </div>
    </div>
  );
}

interface PendingApproval {
  id:     string;
  origin: string;
  method: string;
  params: unknown[];
}

/* EIP-1193 sign/tx request waiting on user approval. Stashed by the
 * background SW into chrome.storage.session.pending_rpc_request. */
interface PendingRpcRequest {
  id:      string;
  origin:  string;
  method:  string;
  params:  unknown[];
  address: string;
}

function App() {
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [seed, setSeed] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [isDark, setIsDark] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingRpc, setPendingRpc] = useState<PendingRpcRequest | null>(null);
  const [rpcBusy, setRpcBusy]       = useState(false);
  const [rpcErr, setRpcErr]         = useState<string | null>(null);
  // Pre-sign simulation — populated when a pending eth_sendTransaction
  // arrives. Other methods (personal_sign, eth_signTypedData_v4) don't
  // touch on-chain state so we skip the simulator for them.
  const [simReport, setSimReport]   = useState<SimulationReport | null>(null);

  const evmAddr   = seed.length ? deriveEvm(seed) : '';
  const portfolio = usePortfolio(evmAddr);

  // Watch chrome.storage.session for incoming dApp approval / signing
  // requests so the popup can render the right sheet without polling.
  useEffect(() => {
    let cancelled = false;
    const checkPending = async () => {
      try {
        const stored = await browser.storage.session.get(['pending_approval', 'pending_rpc_request']);
        if (cancelled) return;
        setPendingApproval((stored.pending_approval as PendingApproval | undefined) ?? null);
        setPendingRpc((stored.pending_rpc_request as PendingRpcRequest | undefined) ?? null);
      } catch {}
    };
    checkPending();
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'session') return;
      if ('pending_approval' in changes) {
        setPendingApproval((changes.pending_approval.newValue as PendingApproval | undefined) ?? null);
      }
      if ('pending_rpc_request' in changes) {
        setPendingRpc((changes.pending_rpc_request.newValue as PendingRpcRequest | undefined) ?? null);
      }
    };
    browser.storage.onChanged.addListener(listener as never);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(listener as never);
    };
  }, []);

  /* Pre-sign simulation for incoming eth_sendTransaction requests. Runs
     in parallel with the approval UI mount — the user sees the report
     as soon as the simulator returns. Lazy singleton: TransactionSimulator
     caches RPC providers internally so re-renders don't churn them. */
  useEffect(() => {
    if (!pendingRpc || pendingRpc.method !== 'eth_sendTransaction') {
      setSimReport(null); return;
    }
    const tx = pendingRpc.params?.[0] as { to?: string; value?: string; from?: string } | undefined;
    if (!tx?.to) { setSimReport(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const sim    = new TransactionSimulator();
        // EIP-1193 hex value → decimal ether (caller may send "0x0" or "0xde0b6b3a7640000").
        const valueHex = tx.value || '0x0';
        const valueWei = BigInt(valueHex);
        const amountEth = (Number(valueWei) / 1e18).toString();
        const report = await sim.simulateSend({
          chainId: 700777,                       // Makalu — the only chain this wallet talks to today
          from:    tx.from || pendingRpc.address,
          to:      tx.to,
          amount:  amountEth,
        });
        if (!cancelled) setSimReport(report);
      } catch { if (!cancelled) setSimReport(null); }
    })();
    return () => { cancelled = true; };
  }, [pendingRpc]);

  useEffect(() => {
    (async () => {
      // Legacy plaintext migration (one-shot).
      if (hasLegacyPlaintext()) {
        const mig = await migrateLegacyPlaintext();
        if (mig.ok && mig.key) cacheSessionKey(mig.key);
      }
      const vault = loadVault();
      setHasVault(!!vault);
      if (vault) {
        const key = getSessionKey();
        if (key) {
          const mnemonic = await openVaultWithKey(vault, key);
          if (mnemonic) {
            setSeed(mnemonic.split(' '));
            setUnlocked(true);
          } else {
            clearSessionKey();
          }
        }
      }
      const stored = localStorage.getItem(STORAGE.theme);
      const dark = stored === 'dark';
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    })().catch(() => {});
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE.theme, next ? 'dark' : 'light');
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      return next;
    });
  };

  const lock = () => {
    setUnlocked(false);
    setSeed([]);
    clearSessionKey();
    // Tell the background SW the wallet is locked so dApps see accountsChanged([]).
    try { browser?.runtime?.sendMessage({ type: 'thanos-lock' }); } catch {}
  };
  const onComplete = (s: string[]) => {
    setSeed(s);
    setHasVault(true);
    setUnlocked(true);
    // Announce the unlocked address so the background can answer eth_accounts.
    try {
      const addr = deriveEvm(s);
      browser?.runtime?.sendMessage({ type: 'thanos-active-address', address: addr });
    } catch {}
  };

  const approveRpc = async () => {
    if (!pendingRpc) return;
    setRpcBusy(true); setRpcErr(null);
    try {
      const result = await executeWcRequest(seed, {
        request: { method: pendingRpc.method, params: pendingRpc.params },
      });
      await browser.runtime.sendMessage({
        type:      'thanos-rpc-result',
        requestId: pendingRpc.id,
        result,
      });
      setPendingRpc(null);
    } catch (e) {
      const code    = e instanceof WcSignerError ? e.code : -32603;
      const message = (e as Error)?.message || 'Sign failed';
      try {
        await browser.runtime.sendMessage({
          type:      'thanos-rpc-result',
          requestId: pendingRpc.id,
          error:     { code, message },
        });
      } catch { /* ignore */ }
      setPendingRpc(null);
      setRpcErr(message);
    } finally {
      setRpcBusy(false);
    }
  };

  const rejectRpc = async () => {
    if (!pendingRpc) return;
    try {
      await browser.runtime.sendMessage({
        type:      'thanos-rpc-result',
        requestId: pendingRpc.id,
        error:     { code: 4001, message: 'User rejected the request' },
      });
    } finally { setPendingRpc(null); }
  };

  if (hasVault === null) return <div className="root-loading"/>;
  if (!unlocked) return <Onboarding hasVault={hasVault} onComplete={onComplete}/>;

  /* A direct EIP-1193 sign/tx request (window.ethereum.request) takes
     priority — the dApp is blocked on us answering. The WalletConnect
     path is handled by the WalletConnectModal opened from Settings; this
     branch is only the injected-provider path. */
  if (pendingRpc) {
    const host = (() => { try { return new URL(pendingRpc.origin).host; } catch { return pendingRpc.origin; } })();
    const isTx = pendingRpc.method === 'eth_sendTransaction';
    return (
      <div className="screen" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: isTx ? 'rgba(245,158,11,0.14)' : 'rgba(59,122,247,0.14)',
            border:    `1px solid ${isTx ? 'rgba(245,158,11,0.30)' : 'rgba(59,122,247,0.30)'}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10,
          }}>
            <Globe size={26} color={isTx ? '#f59e0b' : 'var(--blue)'}/>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {isTx ? 'Confirm transaction' : 'Signature request'}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-muted)', marginTop: 4,
            fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all',
          }}>
            {host}
          </div>
        </div>

        <div className="card" style={{ padding: 14, gap: 8, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {pendingRpc.method}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--bg-elevated)', borderRadius: 8, padding: 10, maxHeight: 180, overflowY: 'auto',
          }}>
            {summariseRequest(pendingRpc.method, pendingRpc.params)}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all',
          }}>
            Signing as {pendingRpc.address}
          </div>
        </div>

        {rpcErr && <div style={{ padding: 10, borderRadius: 8, background: 'rgba(248,113,113,0.10)', color: '#f87171', fontSize: 12 }}>{rpcErr}</div>}

        {/* Pre-sign simulation — only meaningful for eth_sendTransaction;
            the effect that populates simReport already gates on that. */}
        {simReport && simReport.issues.filter(i => i.level !== 'info').length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {simReport.issues.filter(i => i.level !== 'info').map((issue, i) => {
              const isCritical = issue.level === 'critical';
              return (
                <div
                  key={`${issue.code}-${i}`}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: isCritical ? 'rgba(248,113,113,0.10)' : 'rgba(245,158,11,0.10)',
                    border:     isCritical ? '1px solid #f87171' : 'none',
                    color:      isCritical ? '#f87171' : '#f59e0b',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {issue.message}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button onClick={rejectRpc}  disabled={rpcBusy} className="btn-secondary" style={{ flex: 1, opacity: rpcBusy ? 0.6 : 1 }}>Reject</button>
          <button
            onClick={approveRpc}
            disabled={rpcBusy || (simReport?.issues.some(i => i.level === 'critical') ?? false)}
            className="btn-primary"
            style={{ flex: 1, opacity: (rpcBusy || (simReport?.issues.some(i => i.level === 'critical') ?? false)) ? 0.6 : 1 }}
            title={(simReport?.issues.some(i => i.level === 'critical') ?? false) ? 'Simulator found a critical issue — approval blocked.' : undefined}
          >
            {rpcBusy ? 'Signing…' : isTx ? 'Approve & Send' : 'Approve & Sign'}
          </button>
        </div>
      </div>
    );
  }

  /* If a dApp is asking to connect, show the approval screen instead of the
     normal wallet UI. The user has to handle it (approve / reject) before
     they can do anything else — typical wallet-extension behaviour. */
  if (pendingApproval && pendingApproval.method === 'eth_requestAccounts') {
    return (
      <ApprovalScreen
        approval={pendingApproval}
        address={evmAddr}
        onApprove={() => {
          browser.runtime.sendMessage({
            type:       'thanos-approval-result',
            approvalId: pendingApproval.id,
            approved:   true,
            address:    evmAddr,
          });
          setPendingApproval(null);
        }}
        onReject={() => {
          browser.runtime.sendMessage({
            type:       'thanos-approval-result',
            approvalId: pendingApproval.id,
            approved:   false,
          });
          setPendingApproval(null);
        }}
      />
    );
  }

  return (
    <WalletSeedContext.Provider value={seed}>
    <PortfolioContext.Provider value={portfolio}>
      {modal === 'send'          && <SendModal          onClose={() => setModal(null)}/>}
      {modal === 'receive'       && <ReceiveModal       onClose={() => setModal(null)} address={evmAddr}/>}
      {modal === 'swap'          && <SwapModal          onClose={() => setModal(null)}/>}
      {modal === 'walletconnect' && <WalletConnectModal onClose={() => setModal(null)} evmAddress={evmAddr}/>}

      <div className="app">
        <div className="app-body">
          {tab === 'home'     && <HomeScreen onAction={setModal} onLock={lock} onOpenSettings={() => setTab('settings')}/>}
          {tab === 'discover' && <DiscoverScreen/>}
          {tab === 'activity' && <ActivityScreen/>}
          {tab === 'settings' && <SettingsScreen isDark={isDark} onToggleTheme={toggleTheme} onLock={lock} onOpenWalletConnect={() => setModal('walletconnect')}/>}
        </div>
        <div className="tabbar">
          {([
            { k: 'home',     l: 'Home',     I: Home },
            { k: 'discover', l: 'Discover', I: Globe },
            { k: 'activity', l: 'Activity', I: Clock },
            { k: 'settings', l: 'Settings', I: SettingsIcon },
          ] as const).map(t => (
            <button key={t.k} className={`tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>
              <t.I size={18} strokeWidth={tab === t.k ? 2.4 : 2}/>
              <span>{t.l}</span>
            </button>
          ))}
        </div>
      </div>
    </PortfolioContext.Provider>
    </WalletSeedContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
