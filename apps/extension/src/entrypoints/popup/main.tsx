import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, HDNodeWallet, Mnemonic, randomBytes } from 'ethers';
// NOTE: bridgeMakaluToKamet (heavy — MultX SDK + ethers v5) is lazy-imported at
// its call site so it stays OUT of the popup cold-start bundle. Only the light
// bridge metadata is eager.
import { BRIDGE_TOKENS, BRIDGE_ROUTE, type BridgeStep } from '../../lib/bridge-meta';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, Plus,
  Home, Clock, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  Copy, Check, Eye, EyeOff, Lock, Moon, Sun, User, Search, Pencil, Trash2,
  Fingerprint, Key, AlertTriangle, Globe, Zap, Bell, Shield,
  Sparkles, CreditCard,
} from 'lucide-react';
import {
  createVault, openVault, openVaultWithKey,
  saveVault, loadVault, clearVault,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
  isSeedBackedUp, setSeedBackedUp,
  getActiveAccountIndex, setActiveAccountIndex,
  getAccountCount,       setAccountCount,
  getAccountName, getCustomAccountName, setAccountName,
  getVisibleAccountIndices, hideAccount,
  MAX_ACCOUNTS,
} from '../../lib/vault';
import {
  persistSessionKey, loadPersistedSessionKey, clearPersistedSessionKey,
  getSessionDuration, setSessionDuration,
  SESSION_DURATION_OPTIONS, type SessionDuration,
} from './session-store';
import {
  usePortfolio, PortfolioContext, usePortfolioCtx, formatUsd,
} from './portfolio';
import { WalletSeedContext, useWalletSeed, resolveRecipient, sendAsset } from './send';
import {
  evmToLitho, ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp,
  groupBySection, looksLikeUrl, normalizeUrl,
  fetchPortfolioHistory, type Holding, type PortfolioHistory, type Range,
  TransactionSimulator, type SimulationReport,
  fetchTokenHistory, fetchTokenMarketDetails,
  type TokenHistory, type TokenMarketDetails, type TokenRange,
  fetchEcosystemPrices,
  initDisplayCurrency, applyDisplayCurrency, getDisplayCurrency,
  subscribeFx, FX_CURRENCIES, type DisplayCurrency,
  convertFromUsd, withCurrencyAffix,
} from '@thanos/sdk-core';
import { WalletConnectModal } from './walletconnect';
import { executeWcRequest, summariseRequest, WcSignerError, activeChain } from './wc-signer';
import { dappChainByHex } from '../../lib/dapp-chains';
import {
  loadContacts, addContact, deleteContact,
  syncContactsFromServer, onContactsChanged,
  type Contact as AbContact,
} from '../../lib/address-book';
import { setContactEncryptionKey } from '../../lib/contact-crypto';
import { addLocalActivity } from '../../lib/local-activity';

/* ──────────────────────── Storage / Wallet helpers ──────────────────────── */

// Storage keys for the popup. Mnemonic / has_vault / unlocked live in
// vault.ts; only the theme preference stays here.
const STORAGE = {
  theme: 'thanos-theme',
};

/* Dark-first, applied synchronously at module load — BEFORE React mounts
   — so the popup never flashes white for dark users. Matches the web +
   desktop apps, which are dark-first; the extension was the odd one out
   (light unless the user had explicitly stored 'dark', and the theme
   only landed after the async vault load). Explicit 'light' still wins. */
document.documentElement.dataset.theme =
  localStorage.getItem(STORAGE.theme) === 'light' ? 'light' : 'dark';

/** Address with highlighted head + tail — visual-confirmation pattern
 *  (client request 2026-06-12). Poisoning scams match the start/end of
 *  an address, so those are exactly the characters to draw the eye to.
 *  `head`/`tail` count ADDRESS-SPECIFIC chars; the constant prefix
 *  (0x/litho1/cosmos1/bc1) is always shown but never eats the budget. */
function hiPrefixLen(v: string): number {
  if (v.startsWith('0x') || v.startsWith('0X')) return 2;
  if (v.startsWith('litho1'))  return 6;
  if (v.startsWith('cosmos1')) return 7;
  if (v.startsWith('bc1'))     return 3;
  return 0;
}
function HiAddr({ value, head = 6, tail = 6, full = false }: {
  value: string; head?: number; tail?: number; full?: boolean;
}) {
  const v = (value || '').trim();
  if (!v) return null;
  const headEnd = hiPrefixLen(v) + head;
  if (v.length <= headEnd + tail) return <span style={{ fontFamily: 'Geist Mono, monospace' }}>{v}</span>;
  const h = v.slice(0, headEnd), t = v.slice(-tail);
  const mid = full ? v.slice(headEnd, v.length - tail) : '…';
  return (
    <span style={{ fontFamily: 'Geist Mono, monospace' }}>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{h}</span>
      <span style={{ opacity: 0.6 }}>{mid}</span>
      <span style={{ color: 'var(--green, #10b981)', fontWeight: 600 }}>{t}</span>
    </span>
  );
}

/* Discover dApp tile icons — public/images/dapps/<id>.png. Without this
   the tiles showed a letter on a colour block and the client-supplied
   ATUA mark never appeared in the extension. */
const DAPP_ICONS: Record<string, string> = {
  agii: '/images/dapps/agii.png', colle: '/images/dapps/colle.png',
  mansa: '/images/dapps/mansa.png', furgpt: '/images/dapps/furgpt.png',
  imagen: '/images/dapps/imagen.png', ignite: '/images/dapps/ignite.png',
  atua: '/images/dapps/atua.png',
};

/* Swappable assets — the verified Makalu token set (matches the web
   SwapModal's canonical TOKENS list). The previous hardcoded dropdowns
   offered LitETH and USDC, neither of which exists on Makalu, and
   omitted seven real LEP100s. */
const SWAP_SYMBOLS = [
  'LITHO', 'wLITHO', 'LitBTC', 'LAX', 'JOT',
  'COLLE', 'IMAGE', 'AGII', 'BLDR', 'FGPT', 'MUSA',
] as const;

function generateMnemonic(words: 12 | 24 = 12): string[] {
  // 12 words = 128-bit entropy; 24 words = 256-bit (32 bytes). ethers'
  // Wallet.createRandom() only ever yields 12, so derive 24 from entropy.
  if (words === 24) return Mnemonic.fromEntropy(randomBytes(32)).phrase.split(' ');
  return Wallet.createRandom().mnemonic!.phrase.split(' ');
}
function isValidMnemonic(p: string) {
  try { Mnemonic.fromPhrase(p.trim().toLowerCase()); return true; }
  catch { return false; }
}
function deriveEvm(seed: string[], idx = 0): string {
  try { return HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${idx}`).address; }
  catch { return '0x0000000000000000000000000000000000000000'; }
}

/* ──────────────────────── Token icon ──────────────────────── */

/* Bundled client icon pack lives in public/images/tokens/ (served at
   the extension root). Mainstream coins fall through to a CoinGecko
   CDN logo. Mirrors the web TokenIcon + mobile token-icons resolver. */
const BUNDLED_ICONS: Record<string, string> = {
  // 2026-06 client icon pack — pre-sized for parity with BTC/ETH marks.
  litho:  '/images/tokens/litho.png',
  jot:    '/images/tokens/jot.png',
  lax:    '/images/tokens/lax.png',
  colle:  '/images/tokens/colle.png',
  image:  '/images/tokens/image.png',
  agii:   '/images/tokens/agii.png',
  fgpt:   '/images/tokens/fgpt.png',
  musa:   '/images/tokens/musa.png',
  atua:   '/images/tokens/atua.png',
  ignite: '/images/tokens/ignite.png',
  quantt: '/images/tokens/quantt.png',
  atom:   '/images/tokens/atom.png',
  eth:    '/images/tokens/eth.png',
  trx:    '/images/tokens/trx.png',
  hype:   '/images/tokens/hype.png',
  sol:    '/images/tokens/sol.png',  // official solana.com/branding logomark
  // Bundled locally — these were fetched from assets.coingecko.com at runtime,
  // a remote image request on every popup open that MV3 review flags (and that
  // the privacy policy didn't disclose). Now zero external image loads: the
  // CoinGecko logomarks are downsized into the token pack at /images/tokens/.
  btc:    '/images/tokens/btc.png',
  litbtc: '/images/tokens/btc.png',
  usdc:   '/images/tokens/usdc.png',
  usdt:   '/images/tokens/usdt.png',
  bnb:    '/images/tokens/bnb.png',
  xrp:    '/images/tokens/xrp.png',
  pol:    '/images/tokens/pol.png',    // Polygon (POL, ex-MATIC)
  matic:  '/images/tokens/pol.png',    // legacy ticker alias
  avax:   '/images/tokens/avax.png',   // Avalanche C-Chain
};
function iconFor(sym: string): string | null {
  const k = (sym || '').toLowerCase();
  return BUNDLED_ICONS[k] ?? null;
}

/** Coin avatar — icon composited over the brand-colour circle, with the
 *  ticker initial as the fallback when no icon resolves or it errors. */
/** Shimmer placeholder rows shaped like a real asset/activity row. Rendered
 *  only on a true cold load (loading && no cached data) so the popup never
 *  paints a bare "Loading…" line. */
function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk-row">
          <div className="sk sk-avatar" />
          <div className="sk-row-mid">
            <div className="sk sk-line" style={{ width: '52%' }} />
            <div className="sk sk-line" style={{ width: '32%' }} />
          </div>
          <div className="sk-row-right">
            <div className="sk sk-line" style={{ width: 52 }} />
            <div className="sk sk-line" style={{ width: 36 }} />
          </div>
        </div>
      ))}
    </>
  );
}

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
  const [wordCount, setWordCount] = useState<12 | 24>(12);
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
  const [formErr, setFormErr]     = useState('');
  /** Two-step destructive confirm for Reset wallet (replaces window.confirm). */
  const [confirmReset, setConfirmReset] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);
  /* Seed auto-mask — same defense as the web wallet. 30 s after the
     create-show step mounts the words blur out + the user has to tap to
     re-reveal. Guards against shoulder-surf + the "left laptop open"
     case while the popup is the active window. */
  const [seedHidden, setSeedHidden] = useState(false);
  useEffect(() => {
    if (step !== 'create-show') { setSeedHidden(false); return; }
    if (seedHidden) return;
    const t = setTimeout(() => setSeedHidden(true), 30_000);
    return () => clearTimeout(t);
  }, [step, seedHidden]);

  /* ob2 minimal-luxe value-prop carousel — auto-advances in the cramped popup. */
  const OB2_SLIDES = [
    { head: ['Own your keys.', 'Own your future.'], sub: 'True self-custody — your recovery phrase never leaves this device.' },
    { head: ['One wallet.', 'Every chain.'], sub: 'Lithosphere · Bitcoin · EVM, unified in a single Web4 wallet.' },
    { head: ['Move value', 'without friction.'], sub: 'Hold, swap and bridge across chains — with quiet, total control.' },
  ];
  const [ob2Slide, setOb2Slide] = useState(0);
  useEffect(() => {
    if (step !== 'welcome') return;
    const t = setInterval(() => setOb2Slide(s => (s + 1) % OB2_SLIDES.length), 4000);
    return () => clearInterval(t);
  }, [step]);
  const ob2OpenExternal = (url: string) => { browser.tabs.create({ url }); };

  const startCreate = () => { setSeed(generateMnemonic(wordCount)); setStep('create-warn'); };
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
      if (opened) { cacheSessionKey(opened.key); void persistSessionKey(opened.key); }
      onComplete(seed);
    } finally { setBusy(false); }
  };
  const finishImport = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    const words = importInput.trim().toLowerCase().split(/\s+/);
    // Inline errors — alert() in an MV3 popup opens an OS dialog that
    // visually detaches from the 360px popup and looks broken.
    if (![12, 15, 18, 21, 24].includes(words.length)) { setFormErr('Phrase must be 12, 15, 18, 21 or 24 words'); return; }
    if (!isValidMnemonic(words.join(' '))) { setFormErr('Invalid recovery phrase — check for typos'); return; }
    setFormErr('');
    setBusy(true);
    try {
      const vault = await createVault(words.join(' '), password);
      saveVault(vault);
      setSeedBackedUp(true); // imported — user already holds the phrase
      const opened = await openVault(vault, password);
      if (opened) { cacheSessionKey(opened.key); void persistSessionKey(opened.key); }
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
      void persistSessionKey(opened.key);
      onComplete(opened.mnemonic.split(' '));
    } finally { setBusy(false); }
  };
  const resetWallet = () => {
    // Two-step inline confirm — first click arms, second click erases.
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5_000);
      return;
    }
    setConfirmReset(false);
    clearVault();
    setStep('welcome'); setUnlockPwd(''); setUnlockErr('');
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
        {step !== 'welcome' && step !== 'unlock' && (
          <div className="onb-logo">
            <img src="/icons/icon128.png" alt="Thanos" width="48" height="48"/>
          </div>
        )}

        {step === 'welcome' && <>
          <div className="ob2-welcome">
            <div className="ob2-mark">
              <img src="/icons/icon128.png" alt="Thanos Wallet"/>
            </div>

            <div className="ob2-carousel">
              <div className="ob2-slide" key={ob2Slide}>
                <h1 className="ob2-slide-head">
                  {OB2_SLIDES[ob2Slide].head[0]}<br/>{OB2_SLIDES[ob2Slide].head[1]}
                </h1>
                <p className="ob2-slide-sub">{OB2_SLIDES[ob2Slide].sub}</p>
              </div>
              <div className="ob2-dots">
                {OB2_SLIDES.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`ob2-dot${i === ob2Slide ? ' ob2-dot-active' : ''}`}
                    aria-label={`Slide ${i + 1}`}
                    onClick={() => setOb2Slide(i)}
                  />
                ))}
              </div>
            </div>

            <div className="ob2-actions">
              <button className="ob2-pill" onClick={startCreate}>Create a new wallet</button>
              <button className="ob2-ghost" onClick={() => setStep('import')}>I already have a wallet</button>
            </div>

            <p className="ob2-legal">
              By continuing you agree to our{' '}
              <a onClick={() => ob2OpenExternal('https://thanos.fi/terms')}>Terms</a>{' '}
              &amp;{' '}
              <a onClick={() => ob2OpenExternal('https://thanos.fi/privacy')}>Privacy Policy</a>.
            </p>
          </div>
        </>}

        {step === 'create-warn' && <>
          <h1 className="onb-title">Save your phrase</h1>
          <p className="onb-sub">{seed.length} words = your wallet's only backup. Anyone with them has full access.</p>
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
          <p className="onb-sub">Write all {seed.length} words down in order.</p>
          <div className="seed-grid" style={{ position: 'relative' }}>
            {seed.map((w, i) => (
              <div key={i} className="seed-cell">
                <span className="seed-num">{i + 1}.</span>
                <span style={{ userSelect: 'text', filter: seedHidden ? 'blur(8px)' : 'none', transition: 'filter 0.2s' }}>{w}</span>
              </div>
            ))}
            {seedHidden && (
              <button
                type="button"
                onClick={() => setSeedHidden(false)}
                style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)',
                  borderRadius: 8, border: 'none',
                  color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                Tap to reveal
              </button>
            )}
          </div>
          <button className="btn-link" onClick={copySeed} disabled={seedHidden}>
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
          {formErr && <div className="onb-err">{formErr}</div>}
          <div className="row-btns">
            <button className="btn-outline" onClick={() => { setFormErr(''); setStep(step === 'create-pwd' ? 'create-confirm' : 'import'); }}>Back</button>
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
          <div className="ob2-unlock">
            <div className="ob2-mark ob2-mark-sm">
              <img src="/icons/icon128.png" alt="Thanos Wallet"/>
            </div>
            <h1 className="ob2-unlock-title">Welcome back</h1>
            <p className="ob2-unlock-sub">Enter your password to unlock Thanos Wallet.</p>

            <div className="ob2-unlock-form">
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
              <button className="ob2-pill" onClick={tryUnlock} disabled={!unlockPwd || busy} style={{ marginTop: 12 }}>
                {busy ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>

            <div className="ob2-reset">
              <p className="ob2-reset-text">
                {confirmReset
                  ? 'This permanently erases the wallet from this browser. Restore needs your recovery phrase.'
                  : 'Forgot password? Wallet can be restored with the recovery phrase.'}
              </p>
              <button
                className={`ob2-reset-link${confirmReset ? ' ob2-reset-armed' : ''}`}
                onClick={resetWallet}
              >
                {confirmReset ? 'Click again to erase wallet' : 'Reset wallet'}
              </button>
            </div>
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

/* LAX virtual card + Quantt Agents — same offer the web/desktop clients show.
   Native LAX issuance is gated on the partner API, so "Get Started" opens the
   LAX application (lax.money) in a real tab. QUANTT_AGENTS_URL points at the
   live Quantt product site. */
// LAX application page (dashboard register — supports ?address=<0x…> prefill;
// address plumbing to this card is a queued follow-up).
// Public site only until the LAX integration is approved (client request
// 2026-07-19) — the dashboard.lax.money register link is pre-approval.
const LAX_APPLY_URL = 'https://lax.money';
const QUANTT_AGENTS_URL = 'https://quantts.ai';
const LAX_BENEFITS = [
  'Get a LAX Debit Card for free',
  'Unlimited top-ups with 0 fees',
  'Accepted worldwide where Visa™ is accepted',
];

/* CSS recreation of the LAX Visa card art (self-contained — no image asset). */
function LaxCardArt() {
  return (
    <div style={{
      position: 'relative', width: '100%', aspectRatio: '1.586 / 1',
      borderRadius: 12, overflow: 'hidden',
      background: 'radial-gradient(130% 130% at 50% -10%, #141a2e 0%, #0a0d18 55%, #05070f 100%)',
      border: '1px solid rgba(59,122,247,0.28)', boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
    }}>
      {/* faded emblem — same centre art as web's LaxCardArt */}
      <img src="/images/tokens/lax.png" alt="" aria-hidden style={{
        position: 'absolute', top: '50%', left: '52%', transform: 'translate(-50%,-50%)',
        width: '42%', opacity: 0.45, filter: 'drop-shadow(0 0 26px rgba(59,122,247,0.45))',
      }}/>
      <div style={{
        position: 'absolute', top: '9%', left: '7%', fontSize: 20, fontWeight: 800, letterSpacing: '0.32em',
        background: 'linear-gradient(90deg,#5b8cff,#9bb0ff)', WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>LAX</div>
      <div style={{ position: 'absolute', bottom: '10%', right: '7%', textAlign: 'right', lineHeight: 1 }}>
        <div style={{
          fontSize: 23, fontWeight: 800, fontStyle: 'italic',
          background: 'linear-gradient(90deg,#1a3fd6,#3b7af7)', WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>VISA</div>
        <div style={{ fontSize: 9, fontWeight: 500, color: '#5b8cff', marginTop: 2 }}>Algorithmic</div>
      </div>
    </div>
  );
}

function LaxCard() {
  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>
        <CreditCard size={14} color="var(--blue)"/> Virtual Card
      </div>
      <LaxCardArt/>
      <div style={{ fontSize: 14.5, fontWeight: 800, margin: '13px 0 9px', color: 'var(--text-primary)' }}>
        Own Your Crypto Virtual Card
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {LAX_BENEFITS.map(b => (
          <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.4 }}>
            <Check size={15} color="var(--blue)" strokeWidth={2.6} style={{ marginTop: 1, flexShrink: 0 }}/>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button className="btn-primary" onClick={() => browser.tabs.create({ url: LAX_APPLY_URL })}>
        Get Started
      </button>
    </div>
  );
}

/* Quantt Agents — the AI assistant card (mirrors desktop). Opens the product
   in a real tab. */
function AIAssistant() {
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={() => browser.tabs.create({ url: QUANTT_AGENTS_URL })}
      style={{ padding: 16, marginTop: 12, cursor: 'pointer' }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 11 }}>AI Assistant</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: 'var(--blue-dim)', color: 'var(--blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={16}/>
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Quantt Agents ↗</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: 2 }}>
            Your AI assistant — optimize your portfolio balance across chains.
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  onAction, onLock, onOpenSettings, onOpenToken,
  activeIdx, accountCount, onSwitch, onAddAccount, onRenameAccount, onDeleteAccount,
}: {
  onAction:      (m: 'send'|'receive'|'swap') => void;
  onLock:        () => void;
  onOpenSettings: () => void;
  onOpenToken:   (sym: string) => void;
  activeIdx:     number;
  accountCount:  number;
  onSwitch:      (idx: number) => void;
  onAddAccount:  () => void;
  onRenameAccount: (idx: number) => void;
  onDeleteAccount: (idx: number) => void;
}) {
  const { coins, totalUsd, loading, offline } = usePortfolioCtx();
  const [backedUp, setBackedUp] = useState<boolean | null>(null);
  const [acctMenu, setAcctMenu] = useState(false);
  useEffect(() => { setBackedUp(isSeedBackedUp()); }, []);
  const holdings: Holding[] = useMemo(
    () => coins.filter(c => c.balance > 0 && c.usdValue > 0).map(c => ({ sym: c.sym, qty: c.balance, usd: c.usdValue })),
    [coins],
  );
  return (
    <div className="screen">
      <div className="screen-header">
        {/* Account chip + switcher menu. Tap = open switcher; the lock
            action moves to the menu so a misclick doesn't lock the
            wallet. */}
        <div style={{ position: 'relative' }}>
          <div className="acct-chip" onClick={() => setAcctMenu(v => !v)}>
            <div className="acct-avatar"><User size={13}/></div>
            <div>
              <div className="acct-name">Account {activeIdx + 1}</div>
              <div className="acct-addr">{offline ? 'Makalu · offline' : 'Makalu'}</div>
            </div>
          </div>
          {acctMenu && (
            <>
              <div
                onClick={() => setAcctMenu(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 10 }}
              />
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 6,
                  zIndex: 11, minWidth: 180,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 10, padding: 4,
                  boxShadow: '0 10px 28px rgba(0,0,0,0.24)',
                }}
              >
                {getVisibleAccountIndices().map((i) => {
                  // A wallet must keep one account, so the last one can't go.
                  // Rendered disabled rather than hidden — hiding it made the
                  // feature look absent to anyone with a single account.
                  const lastAccount = getVisibleAccountIndices().length <= 1;
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 4,
                        padding: '4px 6px', borderRadius: 6,
                        background: i === activeIdx ? 'var(--bg-hover)' : 'transparent',
                      }}
                    >
                      <button
                        onClick={() => { onSwitch(i); setAcctMenu(false); }}
                        style={{
                          display: 'flex', flex: 1, alignItems: 'center', gap: 8, minWidth: 0,
                          padding: '4px 4px', border: 'none', borderRadius: 6, background: 'transparent',
                          color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                          fontSize: 12, fontWeight: i === activeIdx ? 700 : 500,
                        }}
                      >
                        <User size={12}/>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getAccountName(i)}
                        </span>
                        {i === activeIdx && <span style={{ marginLeft: 'auto', color: 'var(--blue)' }}>●</span>}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRenameAccount(i); setAcctMenu(false); }}
                        title="Rename account"
                        aria-label={`Rename ${getAccountName(i)}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3, display: 'flex' }}
                      >
                        <Pencil size={11}/>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!lastAccount) { onDeleteAccount(i); setAcctMenu(false); } }}
                        disabled={lastAccount}
                        title={lastAccount ? 'Your wallet must keep at least one account' : 'Delete account'}
                        aria-label={`Delete ${getAccountName(i)}`}
                        style={{
                          background: 'none', border: 'none', padding: 3, display: 'flex',
                          cursor: lastAccount ? 'not-allowed' : 'pointer',
                          color: lastAccount ? 'var(--text-muted)' : '#f87171',
                          opacity: lastAccount ? 0.45 : 1,
                        }}
                      >
                        <Trash2 size={11}/>
                      </button>
                    </div>
                  );
                })}
                {accountCount < MAX_ACCOUNTS && (
                  <button
                    onClick={() => { onAddAccount(); setAcctMenu(false); }}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                      padding: '8px 10px', border: 'none', borderRadius: 6,
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer', textAlign: 'left',
                      fontSize: 12,
                      borderTop: accountCount > 0 ? '1px solid var(--border-default)' : 'none',
                      marginTop: 4, paddingTop: 10,
                    }}
                  >
                    + Add account
                  </button>
                )}
                <button
                  onClick={() => { onLock(); setAcctMenu(false); }}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '8px 10px', border: 'none', borderRadius: 6,
                    background: 'transparent', color: 'var(--red)',
                    cursor: 'pointer', textAlign: 'left', fontSize: 12,
                    borderTop: '1px solid var(--border-default)',
                    marginTop: 4, paddingTop: 10,
                  }}
                >
                  Lock wallet
                </button>
              </div>
            </>
          )}
        </div>
        <button className="icon-btn"><Bell size={15}/></button>
      </div>

      <div className="balance-card">
        <div className="balance-label">TOTAL BALANCE</div>
        {loading && coins.length === 0
          ? <div className="sk sk-line" style={{ width: 150, height: 28, marginTop: 4 }} />
          : <div className="balance-amt">{formatUsd(totalUsd)}</div>}
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
        {/* TGE — opens the Ignite token-generation event in a new tab. The
            extension injects window.thanos into every page, so the TGE site
            auto-connects to this wallet with no extra step (replaces the old
            dead "Buy" placeholder button). */}
        <button className="qa-btn" onClick={() => browser.tabs.create({ url: 'https://tge.ignite.trade/' })}>
          <div className="qa-icon"><Plus size={14}/></div>
          <span>TGE</span>
        </button>
      </div>

      <div className="section-header">
        <span>Assets</span>
        <span className="count-pill">{coins.length}</span>
      </div>
      <div className="card list">
        {loading && coins.length === 0 && <SkeletonRows count={4} />}
        {!loading && offline && <div className="row-sub" style={{ padding: 12 }}>Couldn’t reach the indexer</div>}
        {!loading && !offline && coins.length === 0 && <div className="row-sub" style={{ padding: 12 }}>No assets yet</div>}
        {coins.map((a, i) => (
          <div key={a.sym} className={`row ${i < coins.length - 1 ? 'row-border' : ''}`} onClick={() => onOpenToken(a.sym)} style={{ cursor: 'pointer' }}>
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

      <LaxCard/>
      <AIAssistant/>
    </div>
  );
}

function ActivityScreen() {
  const { activity, loading, offline } = usePortfolioCtx();
  const [filter, setFilter] = useState<'All' | 'Sent' | 'Received' | 'Swap'>('All');
  const shown = filter === 'All' ? activity : activity.filter((t) => t.label === filter);
  return (
    <div className="screen">
      <h1 className="page-title">Activity</h1>
      <div className="filter-row">
        {(['All', 'Sent', 'Received', 'Swap'] as const).map((f) => (
          <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="section-header">Recent</div>
      <div className="card list">
        {loading && activity.length === 0 && <SkeletonRows count={4} />}
        {!loading && offline && <div className="row-sub" style={{ padding: 12 }}>Couldn’t reach the indexer</div>}
        {!loading && !offline && shown.length === 0 && (
          <div className="row-sub" style={{ padding: 12 }}>
            {activity.length === 0 ? 'No transactions yet' : `No ${filter.toLowerCase()} transactions`}
          </div>
        )}
        {shown.map((t, i) => {
          const Ic = t.label === 'Sent' ? ArrowUpRight : t.label === 'Received' ? ArrowDownLeft : Repeat;
          return (
            <div key={t.id} className={`row ${i < shown.length - 1 ? 'row-border' : ''}`}>
              <div className="row-avatar" style={{ background: t.pos ? 'rgba(16,185,129,0.18)' : 'rgba(59,122,247,0.18)', color: t.pos ? '#10b981' : '#3b7af7' }}>
                <Ic size={14} strokeWidth={2.4}/>
              </div>
              <div className="row-mid">
                <div className="row-name">{t.label} {t.sym}{t.pending && <span className="pending-pill">Pending</span>}</div>
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
            <div className="row-name">Explore Web4</div>
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
                <div className="row-avatar" style={{ background: a.color, color: '#fff', fontWeight: 700, position: 'relative', overflow: 'hidden' }}>
                  <span style={{ position: 'absolute' }}>{a.name.charAt(0)}</span>
                  {DAPP_ICONS[a.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={DAPP_ICONS[a.id]} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}/>
                  )}
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

function SettingsScreen({
  isDark, onToggleTheme, onLock, onOpenWalletConnect, onOpenAddressBook, onOpenPermissions,
  address, accountName, onOpenChangePassword, onOpenRecoveryPhrase, onDeleteWallet,
}: {
  onDeleteWallet: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onLock: () => void;
  onOpenWalletConnect: () => void;
  onOpenAddressBook:   () => void;
  onOpenPermissions:   () => void;
  address: string;
  accountName: string;
  onOpenChangePassword: () => void;
  onOpenRecoveryPhrase: () => void;
}) {
  // LIVE display currency — the pick reformats every price in the popup via
  // the shared sdk-core fx engine (falls back to USD if a rate is missing).
  const [fiat, setFiat] = useState<DisplayCurrency>(getDisplayCurrency());
  const [copiedAddr, setCopiedAddr] = useState(false);
  const copyAddr = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); } catch { /* clipboard blocked */ }
    setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 1500);
  };

  // Session duration (auto-lock) — how long the wallet stays unlocked across
  // popup closes. Persisted in extension storage; default 1h.
  const [sessionDur, setSessionDur] = useState<SessionDuration>('1h');
  useEffect(() => { getSessionDuration().then(setSessionDur).catch(() => {}); }, []);
  const onChangeDuration = async (d: SessionDuration) => {
    setSessionDur(d);
    await setSessionDuration(d);
    // Re-persist the live key so the new window takes effect immediately.
    const k = getSessionKey();
    if (k) await persistSessionKey(k);
  };
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="acct-header-name">{accountName}</div>
          <div className="acct-header-addr">{address ? `${address.slice(0, 8)}…${address.slice(-5)}` : '—'}</div>
        </div>
        <button className="copy-chip" onClick={copyAddr} disabled={!address}>{copiedAddr ? 'Copied' : 'Copy'}</button>
      </div>

      <SectionHead Icon={Globe} title="General" sub="Display and locale"/>
      <div className="card list">
        <div className="set-row">
          <div className="set-icon"><Globe size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Currency</div>
            <div className="set-sub">Display prices in</div>
          </div>
          <select
            className="set-select"
            value={fiat}
            onChange={(e) => {
              const pick = e.target.value as DisplayCurrency;
              setFiat(pick);
              // Resolves to what ACTUALLY took effect (USD fallback when the
              // rate is unavailable) — reflect that in the control.
              void applyDisplayCurrency(pick).then(setFiat);
            }}
            style={{ background: 'var(--bg-elev, #1a1a1f)', color: 'var(--text-primary)', border: '1px solid var(--border, #2a2a30)', borderRadius: 8, padding: '5px 8px', fontSize: 12 }}
          >
            {FX_CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
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
          <div className="set-icon"><Clock size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Auto-lock</div>
            <div className="set-sub">Stay unlocked for</div>
          </div>
          <select
            className="set-select"
            value={sessionDur}
            onChange={(e) => { void onChangeDuration(e.target.value as SessionDuration); }}
            style={{ background: 'var(--bg-elev, #1a1a1f)', color: 'var(--text-primary)', border: '1px solid var(--border, #2a2a30)', borderRadius: 8, padding: '5px 8px', fontSize: 12 }}
          >
            {SESSION_DURATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button className="set-row row-border" onClick={onOpenChangePassword} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon"><Key size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Change password</div>
            <div className="set-sub">Update wallet password</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
        <button className="set-row" onClick={onOpenRecoveryPhrase} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon" style={{ color: 'var(--red)' }}><AlertTriangle size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label" style={{ color: 'var(--red)' }}>Recovery phrase</div>
            <div className="set-sub">View your 12 / 24-word seed</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
      </div>

      <SectionHead Icon={User} title="Address book" sub="Saved contacts, cloud-synced when signed in"/>
      <div className="card list">
        <button className="set-row" onClick={onOpenAddressBook} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon"><User size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Contacts</div>
            <div className="set-sub">Add, remove, and sync recipients across devices</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
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

      <SectionHead Icon={Shield} title="Permissions" sub="Token allowances + connected apps"/>
      <div className="card list">
        <button className="set-row" onClick={onOpenPermissions} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
          <div className="set-icon"><Shield size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Manage permissions</div>
            <div className="set-sub">Audit + revoke token approvals; disconnect dApps</div>
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

      {/* Legal + transparency — opens in a new tab since the popup is
          a tiny surface and a 360px policy render would be unreadable.
          browser.tabs API is preferred over <a target="_blank"> because
          MV3 popups close on focus loss; using tabs.create guarantees
          the new tab actually opens and the user sees content. */}
      <SectionHead Icon={Shield} title="Legal" sub="Privacy policy and security disclosures"/>
      <div className="card list">
        <button
          className="set-row row-border"
          style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
          onClick={() => { browser.tabs.create({ url: 'https://thanos.fi/privacy' }); }}
        >
          <div className="set-icon"><Shield size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Privacy policy</div>
            <div className="set-sub">What data leaves your device, and where it goes</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
        <button
          className="set-row"
          style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
          onClick={() => { browser.tabs.create({ url: 'https://thanos.fi/.well-known/security.txt' }); }}
        >
          <div className="set-icon"><AlertTriangle size={15}/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label">Security disclosures</div>
            <div className="set-sub">Report a vulnerability + PGP key</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
      </div>

      {/* Danger zone — "Reset wallet" already existed on the unlock screen,
          but users look for it here. Two-step confirm, and the warning depends
          on whether the recovery phrase was actually backed up: that's the
          difference between "restorable" and "gone forever". */}
      <SectionHead Icon={AlertTriangle} title="Danger zone" sub="Irreversible — read before you click"/>
      <div className="card list">
        <button
          className="set-row"
          style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
          onClick={onDeleteWallet}
        >
          <div className="set-icon"><Trash2 size={15} color="#f87171"/></div>
          <div style={{ flex: 1 }}>
            <div className="set-label" style={{ color: '#f87171' }}>Delete wallet</div>
            <div className="set-sub">Erase this wallet from this browser</div>
          </div>
          <ChevronRight size={15} color="var(--text-muted)"/>
        </button>
      </div>

      <div className="x-set-version">Thanos Wallet · v{browser.runtime.getManifest().version}</div>
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

/* First-run welcome — introduces the Lithosphere Makalu home network the
   first time a user reaches the unlocked popup. Self-gates on a localStorage
   flag (written the moment it shows) so it appears at most once. Compact for
   the popup viewport. Client request (Esha, 2026-06-15). */
const MAKALU_WELCOME_FLAG = 'thanos.makalu_welcome.v1';
function MakaluWelcomeModal() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(MAKALU_WELCOME_FLAG) === '1') return;
      setVisible(true);
      localStorage.setItem(MAKALU_WELCOME_FLAG, '1');
    } catch { /* storage disabled — skip */ }
  }, []);
  if (!visible) return null;
  return (
    <div className="modal-back" onClick={() => setVisible(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: 22 }}>
        <img src="/icons/icon128.png" alt="Thanos" width={56} height={56} style={{ display: 'block', margin: '0 auto 14px', objectFit: 'contain' }}/>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 6px' }}>Welcome to Thanos Wallet</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 6px' }}>
          Your wallet is on the <strong>Lithosphere Makalu</strong> network (chain&nbsp;700777) — the Web4 home chain. The native coin is <strong>LITHO</strong>; Bitcoin, Solana, Cosmos and EVM are built in too.
        </p>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 16px' }}>
          Explorer: makalu.litho.ai · RPC: rpc.litho.ai
        </p>
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setVisible(false)}>Got it</button>
      </div>
    </div>
  );
}

/* ─── Token detail screen (compact, popup-sized) ─────────────────────── */
const TD_PROXY: Record<string, string> = { LitBTC: 'Bitcoin (BTC) — LitBTC is its wrapped form' };
const TD_RANGES: Array<{ key: TokenRange; label: string }> = [
  { key: '1d', label: '1D' }, { key: '1w', label: '1W' }, { key: '1m', label: '1M' },
  { key: '3m', label: '3M' }, { key: '1y', label: '1Y' },
];
function tdPath(prices: Array<[number, number]>, w: number, h: number): string | null {
  if (prices.length < 2) return null;
  const vals = prices.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  const dx = w / (prices.length - 1);
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * dx).toFixed(1)},${(span === 0 ? h / 2 : h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`).join(' ');
}
// Convert USD → active display currency so market cap / volume match the rest
// of the screen (one currency everywhere).
function tdCompact(nUsd: number | null): string {
  if (typeof nUsd !== 'number' || !isFinite(nUsd)) return '—';
  const n = convertFromUsd(nUsd);
  if (n >= 1e9) return withCurrencyAffix(`${(n / 1e9).toFixed(2)}B`);
  if (n >= 1e6) return withCurrencyAffix(`${(n / 1e6).toFixed(2)}M`);
  if (n >= 1e3) return withCurrencyAffix(`${(n / 1e3).toFixed(2)}K`);
  return withCurrencyAffix(n.toFixed(2));
}
/* Precision-aware per-unit price — the shared formatUsd floors to 2dp, so
   sub-cent tokens (IMAGE ~$0.0000115) would show "$0.00". */
function tdPrice(n: number): string {
  if (!isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
  if (n < 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TokenDetailModal({ sym, onClose, onSend, onReceive, onSwap }: {
  sym: string; onClose: () => void; onSend: () => void; onReceive: () => void; onSwap: () => void;
}) {
  const { coins, activity } = usePortfolioCtx();
  const coin = coins.find(c => c.sym.toLowerCase() === sym.toLowerCase());
  const price = coin?.priceUsd ?? 0;
  // Same fix as mobile/desktop: external-EVM coins must show their REAL chain
  // and must not offer the Makalu-only swap (Makalu rows carry no chainId).
  const isMakalu = !!coin && !coin.native && !!coin.tokenAddress && (coin.chainId == null || coin.chainId === 700777);
  const network = coin?.sym === 'BTC' ? 'Bitcoin' : coin?.sym === 'SOL' ? 'Solana' : coin?.sym === 'ATOM' ? 'Cosmos Hub'
    : coin?.chainId === 900523 ? 'Lithosphere Kamet'
    : coin?.chainId != null && coin.chainId !== 700777 && EXT_EVM_CHAIN_NAME[coin.chainId]
      ? EXT_EVM_CHAIN_NAME[coin.chainId]
      : 'Lithosphere Makalu';
  const [range, setRange] = useState<TokenRange>('1d');
  const [hist, setHist] = useState<TokenHistory | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    let cancel = false; setHistLoading(true);
    fetchTokenHistory(sym, range).then(h => { if (!cancel) { setHist(h); setHistLoading(false); } }).catch(() => { if (!cancel) { setHist(null); setHistLoading(false); } });
    return () => { cancel = true; };
  }, [sym, range]);
  const [market, setMarket] = useState<TokenMarketDetails | null>(null);
  useEffect(() => {
    let cancel = false;
    fetchTokenMarketDetails(sym).then(d => { if (!cancel) setMarket(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [sym]);
  const rows = (activity ?? []).filter(t => t.sym.toLowerCase() === sym.toLowerCase()).slice(0, 6);
  const W = 312, H = 120;
  const line = hist?.hasRealData ? tdPath(hist.prices, W, H) : null;
  const up = (hist?.changePct ?? 0) >= 0;
  const stroke = up ? '#10b981' : '#f87171';
  const proxy = TD_PROXY[sym];
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{children}</span>
    </div>
  );
  return (
    <Modal title={`${coin?.name ?? sym} (${sym})`} onClose={onClose}>
      <div className="modal-body">
        <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Geist Mono, monospace' }}>{price > 0 ? tdPrice(price) : '—'}</div>
        {proxy && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Price &amp; market data track {proxy}.</div>}
        <div style={{ margin: '12px 0', minHeight: H }}>
          {histLoading && <div style={{ height: H, borderRadius: 10, background: 'var(--bg-elevated)' }}/>}
          {!histLoading && line && (
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
              <path d={`${line} L${W},${H} L0,${H} Z`} fill={stroke} fillOpacity="0.14"/>
              <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round"/>
            </svg>
          )}
          {!histLoading && !line && (
            <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '0 16px', lineHeight: 1.5 }}>
              {hist?.failed ? 'Chart temporarily unavailable. Try again shortly.' : `No price history for ${sym} yet.`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {TD_RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              flex: 1, padding: '5px 0', borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: range === r.key ? 'var(--bg-elevated)' : 'transparent',
              color: range === r.key ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{r.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={onSend}>Send</button>
          <button className="btn-outline" style={{ flex: 1 }} onClick={onReceive}>Receive</button>
          {isMakalu && <button className="btn-outline" style={{ flex: 1 }} onClick={onSwap}>Swap</button>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>Your balance</div>
        <Row label={coin?.name ?? sym}><span style={{ fontFamily: 'Geist Mono, monospace' }}>{coin?.balanceText ?? '0'} {sym}</span></Row>
        <div style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 2px' }}>Token details</div>
        <Row label="Network">{network}</Row>
        {coin?.tokenAddress
          ? <Row label="Contract"><HiAddr value={coin.tokenAddress} head={6} tail={6}/></Row>
          : <Row label="Contract">{coin?.native ? 'Native' : '—'}</Row>}
        <Row label="Decimals">{coin?.decimals ?? 18}</Row>
        <div style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 2px' }}>Market details</div>
        {proxy && <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0' }}>Figures are for {proxy}.</div>}
        <Row label="Market cap">{tdCompact(market?.marketCapUsd ?? null)}</Row>
        <Row label="Volume">{tdCompact(market?.totalVolumeUsd ?? null)}</Row>
        <Row label="All-time high">{market?.athUsd != null ? tdPrice(market.athUsd) : '—'}</Row>
        <div style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>Your activity</div>
        {rows.length === 0 && <div style={{ padding: '10px 0', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>No {sym} activity yet.</div>}
        {rows.map(t => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
            <div><div style={{ fontWeight: 600 }}>{t.label}{t.pending && <span className="pending-pill">Pending</span>}</div><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.time}</div></div>
            <span style={{ fontFamily: 'Geist Mono, monospace', color: t.pos ? '#10b981' : 'var(--text-secondary)' }}>{t.amount}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

type ExtSendChain = 'evm' | 'bitcoin' | 'solana' | 'cosmos';
const EXT_CHAIN_META: Record<ExtSendChain, { label: string; sym: string; decimals: number; placeholder: string }> = {
  evm:     { label: 'Lithosphere', sym: 'LITHO', decimals: 18, placeholder: '0x… , litho1… or name.litho' },
  bitcoin: { label: 'Bitcoin',     sym: 'BTC',   decimals: 8,  placeholder: 'bc1q… / 1… / 3…' },
  solana:  { label: 'Solana',      sym: 'SOL',   decimals: 9,  placeholder: 'Base58 Solana address' },
  cosmos:  { label: 'Cosmos Hub',  sym: 'ATOM',  decimals: 6,  placeholder: 'cosmos1…' },
};

/** chainIds + names of the external EVM chains (mirror lib/evm-external). */
const EXT_EVM_CHAIN_IDS = [1, 56, 137, 8453, 42161, 59144, 10, 43114];
const EXT_EVM_CHAIN_NAME: Record<number, string> = {
  1: 'Ethereum', 56: 'BNB Chain', 137: 'Polygon', 8453: 'Base',
  42161: 'Arbitrum', 59144: 'Linea', 10: 'Optimism', 43114: 'Avalanche',
};
/** Unique key per holding — a bare symbol is ambiguous (ETH on 5 chains, etc.). */
const coinKey = (c: { sym: string; chainId?: number; tokenAddress?: string }): string =>
  `${c.sym}@${c.chainId ?? 'litho'}${c.tokenAddress ? ':' + c.tokenAddress : ''}`;

function SendModal({ onClose, initialChain, initialCoin, address }: {
  onClose: () => void;
  initialChain?: ExtSendChain;
  initialCoin?: string;
  address?: string;
}) {
  const { coins, reload } = usePortfolioCtx();
  const seed = useWalletSeed();
  const [chain, setChain] = useState<ExtSendChain>(initialChain ?? 'evm');
  const [selectedKey, setSelectedKey] = useState('');
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [memo, setMemo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const coin =
    (selectedKey ? coins.find(c => coinKey(c) === selectedKey) : undefined)
    ?? (initialCoin ? coins.find(c => c.sym === initialCoin) : undefined)
    ?? coins[0] ?? null;
  const amtNum = parseFloat(amt || '0');
  const overBalance = chain === 'evm' && !!coin && amtNum > coin.balance;
  const recipientOk = (() => {
    const v = to.trim();
    if (!v) return false;
    if (chain === 'bitcoin') return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,}$/.test(v);
    if (chain === 'solana')  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
    if (chain === 'cosmos')  return /^cosmos1[0-9a-z]{38,}$/.test(v);
    return true;
  })();
  const canSend =
    chain === 'evm'
      ? !!coin && amtNum > 0 && !overBalance && !!to.trim() && !sending
      : amtNum > 0 && recipientOk && !sending;

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
      const meta = EXT_CHAIN_META[chain];

      // External EVM (Ethereum/BNB/Polygon/…): route through that chain's RPC
      // directly from the popup (host_permissions cover the RPCs), NOT the
      // Makalu-only offscreen path. Litho assets fall through to sendAsset.
      if (chain === 'evm' && coin?.chainId && EXT_EVM_CHAIN_IDS.includes(coin.chainId)) {
        const m = await import('../../lib/evm-external');
        const hash = await m.sendExtEvm({
          seed,
          accountIdx:   getActiveAccountIndex(),
          chainId:      coin.chainId,
          recipient:    to.trim(),
          amount:       amt,
          decimals:     coin.decimals,
          tokenAddress: coin.native ? undefined : coin.tokenAddress,
        });
        setTxHash(hash);
        if (address) addLocalActivity(address, { hash, chain, sym: coin?.sym ?? 'LITHO', amount: amt, label: 'Sent', ts: Date.now() });
        reload();
        setSending(false);
        return;
      }

      const recipient = chain === 'evm' ? await resolveRecipient(to) : to.trim();
      const hash = await sendAsset({
        seed,
        chain,
        to:           recipient,
        amount:       amt,
        decimals:     chain === 'evm' && coin ? coin.decimals : meta.decimals,
        tokenAddress: chain === 'evm' && coin && !coin.native ? coin.tokenAddress : undefined,
        memo:         chain === 'cosmos' ? memo : undefined,
      });
      setTxHash(hash);
      if (address) addLocalActivity(address, { hash, chain, sym: chain === 'evm' ? (coin?.sym ?? 'LITHO') : meta.sym, amount: amt, label: 'Sent', ts: Date.now() });
      reload();
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
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {amt} {chain === 'evm' ? (coin?.sym ?? '') : EXT_CHAIN_META[chain].sym} broadcast on {chain === 'evm' ? (coin?.chainId && EXT_EVM_CHAIN_NAME[coin.chainId] ? EXT_EVM_CHAIN_NAME[coin.chainId] : 'Makalu') : EXT_CHAIN_META[chain].label}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all', margin: '8px 0' }}>{txHash}</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        {/* Chain selector */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(Object.keys(EXT_CHAIN_META) as ExtSendChain[]).map(c => {
            const selected = c === chain;
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setChain(c); setTo(''); setAmt(''); setMemo(''); }}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 10, fontWeight: 700,
                  background: selected ? 'var(--blue, #3b7af7)' : 'transparent',
                  color: selected ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${selected ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                }}
              >
                {EXT_CHAIN_META[c].sym}
              </button>
            );
          })}
        </div>

        {chain === 'evm' ? (
          <>
            <label className="field-label">ASSET</label>
            <select className="field" value={coin ? coinKey(coin) : ''} onChange={e => setSelectedKey(e.target.value)}>
              {coins.length === 0 && <option value="">No assets available</option>}
              {coins.map(c => <option key={coinKey(c)} value={coinKey(c)}>{c.sym} — {c.name}</option>)}
            </select>
          </>
        ) : (
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-elevated)', fontSize: 12 }}>
            Native <strong>{EXT_CHAIN_META[chain].sym}</strong> on {EXT_CHAIN_META[chain].label}
          </div>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>RECIPIENT</label>
        <input className="field" placeholder={EXT_CHAIN_META[chain].placeholder} value={to} onChange={e => setTo(e.target.value)}/>
        {!!to.trim() && !recipientOk && chain !== 'evm' && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>Not a valid {EXT_CHAIN_META[chain].label} address</div>
        )}

        {chain === 'cosmos' && (
          <>
            <label className="field-label" style={{ marginTop: 14 }}>MEMO (optional)</label>
            <input className="field" placeholder="Exchange tag, transfer note…" value={memo} onChange={e => setMemo(e.target.value)}/>
          </>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>AMOUNT</label>
        <input className="field" placeholder="0.00" type="number" value={amt} onChange={e => setAmt(e.target.value)}/>
        {chain === 'evm' && (
          <div style={{ fontSize: 11, color: overBalance ? '#dc2626' : 'var(--text-muted)', marginTop: 6 }}>
            {overBalance ? 'Amount exceeds balance' : `Balance: ${coin?.balanceText ?? '—'} ${coin?.sym ?? ''}`}
            {coin && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }}
                onClick={() => setAmt(String(coin.balance))}
              >MAX</button>
            )}
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 8 }}>{error}</div>}
        <button className="btn-primary" disabled={!canSend} style={{ marginTop: 16 }} onClick={doSend}>
          {sending ? 'Sending…' : `Send ${chain === 'evm' ? (coin?.sym ?? '') : EXT_CHAIN_META[chain].sym}`}
        </button>
      </div>
    </Modal>
  );
}

/* SafePal receive: pick network -> pick asset -> address + QR. */
type ExtChain =
  | 'evm' | 'btc' | 'sol' | 'atom'
  | 'ethereum' | 'bsc' | 'polygon' | 'base' | 'arbitrum' | 'linea' | 'optimism' | 'avalanche';
const EXT_NETWORKS: Array<{ id: ExtChain; name: string; sym: string }> = [
  { id: 'evm',  name: 'Lithosphere Makalu', sym: 'LITHO' },
  { id: 'btc',  name: 'Bitcoin',            sym: 'BTC'   },
  { id: 'sol',  name: 'Solana',             sym: 'SOL'   },
  { id: 'atom', name: 'Cosmos Hub',         sym: 'ATOM'  },
  // External EVM — all share the wallet's single 0x address.
  { id: 'ethereum',  name: 'Ethereum',  sym: 'ETH'  },
  { id: 'bsc',       name: 'BNB Chain', sym: 'BNB'  },
  { id: 'polygon',   name: 'Polygon',   sym: 'POL'  },
  { id: 'base',      name: 'Base',      sym: 'ETH'  },
  { id: 'arbitrum',  name: 'Arbitrum',  sym: 'ETH'  },
  { id: 'optimism',  name: 'Optimism',  sym: 'ETH'  },
  { id: 'linea',     name: 'Linea',     sym: 'ETH'  },
  { id: 'avalanche', name: 'Avalanche', sym: 'AVAX' },
];
const EXT_ASSETS: Record<ExtChain, Array<{ sym: string; name: string }>> = {
  evm:  [
    { sym: 'LITHO',  name: 'Lithosphere' },
    { sym: 'LAX',    name: 'Lithosphere Algorithmic' },
    { sym: 'LitBTC', name: 'Bitcoin (wrapped)' },
    { sym: 'JOT',    name: 'Jot Art' },
    { sym: 'COLLE',  name: 'Colle AI' },
    { sym: 'IMAGE',  name: 'Imagen Network' },
    { sym: 'MUSA',   name: 'Mansa AI' },
  ],
  btc:  [{ sym: 'BTC',  name: 'Bitcoin' }],
  sol:  [{ sym: 'SOL',  name: 'Solana' }],
  atom: [{ sym: 'ATOM', name: 'Cosmos Hub' }],
  ethereum:  [{ sym: 'ETH',  name: 'Ethereum' },     { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
  bsc:       [{ sym: 'BNB',  name: 'BNB' },           { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
  polygon:   [{ sym: 'POL',  name: 'Polygon' },       { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
  base:      [{ sym: 'ETH',  name: 'Ether (Base)' },  { sym: 'USDC', name: 'USD Coin' }],
  arbitrum:  [{ sym: 'ETH',  name: 'Ether (Arbitrum)' }, { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
  linea:     [{ sym: 'ETH',  name: 'Ether (Linea)' }],
  optimism:  [{ sym: 'ETH',  name: 'Ether (Optimism)' }, { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
  avalanche: [{ sym: 'AVAX', name: 'Avalanche' },     { sym: 'USDT', name: 'Tether USD' }, { sym: 'USDC', name: 'USD Coin' }],
};

function ReceiveModal({ onClose, address }: { onClose: () => void; address: string }) {
  const seed = useWalletSeed();
  const [chain, setChain] = useState<ExtChain>('evm');
  const [step, setStep]   = useState<'network' | 'asset' | 'qr'>('network');
  const [asset, setAsset] = useState<{ sym: string; name: string } | null>(null);
  const [copied, setCopied]   = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const [btcAddr,  setBtcAddr]  = useState('');
  const [solAddr,  setSolAddr]  = useState('');
  const [atomAddr, setAtomAddr] = useState('');
  const [chainBalance, setChainBalance] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const lithoAddr = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return '';
    try { return evmToLitho(address); } catch { return ''; }
  }, [address]);

  // Lazy chain-address derivation — only run when the tab is opened.
  useEffect(() => {
    // Guard every setState behind a cancelled flag: the dynamic import can
    // resolve after the Receive sheet closes or the chain switches, and a
    // post-unmount setState is both a React warning and a wasted derivation.
    let cancelled = false;
    if (chain === 'btc' && !btcAddr && seed.length) {
      void import('../../lib/bitcoin').then(m => { if (!cancelled) setBtcAddr(m.getBitcoinAddress(seed.join(' '))); })
        .catch(() => { if (!cancelled) setBtcAddr(''); });
    }
    if (chain === 'sol' && !solAddr && seed.length) {
      void import('../../lib/solana').then(m => { if (!cancelled) setSolAddr(m.getSolanaAddress(seed.join(' '))); })
        .catch(() => { if (!cancelled) setSolAddr(''); });
    }
    if (chain === 'atom' && !atomAddr && seed.length) {
      void import('../../lib/cosmos').then(m => m.getCosmosAddress(seed.join(' ')))
        .then(a => { if (!cancelled) setAtomAddr(a); }).catch(() => { if (!cancelled) setAtomAddr(''); });
    }
    return () => { cancelled = true; };
  }, [chain, seed, btcAddr, solAddr, atomAddr]);

  // Reset dual-format toggle when switching chains.
  useEffect(() => { setShowAlt(false); }, [chain]);

  // Live balance for the active non-EVM chain.
  useEffect(() => {
    setChainBalance('');
    if (chain === 'evm') return;
    // External EVM chains are shown on the dashboard; the Receive sheet just
    // shows the 0x address + QR (don't mis-route to the cosmos reader).
    if (chain !== 'btc' && chain !== 'sol' && chain !== 'atom') return;
    const addr = chain === 'btc' ? btcAddr : chain === 'sol' ? solAddr : atomAddr;
    if (!addr) return;
    let cancelled = false;
    void (async () => {
      try {
        if (chain === 'btc') {
          const m = await import('../../lib/bitcoin');
          const b = await m.getBitcoinBalance(addr);
          if (!cancelled) setChainBalance(`${b} BTC`);
        } else if (chain === 'sol') {
          const m = await import('../../lib/solana');
          const b = await m.getSolanaBalance(addr);
          if (!cancelled) setChainBalance(`${b} SOL`);
        } else {
          const m = await import('../../lib/cosmos');
          const b = await m.getCosmosBalance(addr);
          if (!cancelled) setChainBalance(`${b} ATOM`);
        }
      } catch { if (!cancelled) setChainBalance('—'); }
    })();
    return () => { cancelled = true; };
  }, [chain, btcAddr, solAddr, atomAddr]);

  const displayed =
    chain === 'evm'  ? (lithoAddr && !showAlt ? lithoAddr : address)
    : chain === 'btc'  ? btcAddr
    : chain === 'sol'  ? solAddr
    : chain === 'atom' ? atomAddr
    : address;  // external EVM (Ethereum/BNB/Polygon/…) → the 0x address

  // Real QR — drawn lazily for whatever address is in view.
  useEffect(() => {
    if (!displayed) { setQrDataUrl(''); return; }
    let cancelled = false;
    void import('qrcode').then(qr => qr.toDataURL(displayed, { width: 180, margin: 1 }))
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [displayed]);

  const copy = async () => {
    if (!displayed) return;
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

  const rowBtn = (border: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 6px',
    background: 'transparent', border: 'none', borderBottom: border ? '1px solid var(--border-subtle)' : 'none',
    cursor: 'pointer', color: 'inherit',
  });
  const backLink: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
    fontSize: 12, fontWeight: 600, padding: '4px 2px', marginBottom: 4, alignSelf: 'flex-start',
  };

  /* Step 1: pick network */
  if (step === 'network') {
    return (
      <Modal title="Select network" onClose={onClose}>
        <div className="modal-body" style={{ padding: '4px 0' }}>
          {EXT_NETWORKS.map((n, i) => (
            <button key={n.id} onClick={() => { setChain(n.id); setShowAlt(false); setAsset(null); setStep('asset'); }} style={rowBtn(i < EXT_NETWORKS.length - 1)}>
              <TokenAvatar sym={n.sym} color="var(--blue, #3b7af7)" />
              <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>{n.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  /* Step 2: pick asset */
  if (step === 'asset') {
    const assets = EXT_ASSETS[chain];
    const netName = EXT_NETWORKS.find(n => n.id === chain)?.name ?? '';
    return (
      <Modal title="Select asset" onClose={onClose}>
        <div className="modal-body" style={{ padding: '4px 0' }}>
          <button onClick={() => setStep('network')} style={backLink}>‹ Back</button>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 4px 6px' }}>Receiving on {netName}</div>
          {assets.map((a, i) => (
            <button key={a.sym} onClick={() => { setAsset(a); setStep('qr'); }} style={rowBtn(i < assets.length - 1)}>
              <TokenAvatar sym={a.sym} color="var(--blue, #3b7af7)" />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{a.sym}</span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>{a.name}</span>
              </span>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  /* Step 3: address + QR for the chosen asset */
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <button onClick={() => setStep('asset')} style={{ ...backLink, marginBottom: 8 }}>‹ Back</button>
        {/* Asset header — what you're receiving + the network. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <TokenAvatar sym={asset?.sym ?? EXT_NETWORKS.find(n => n.id === chain)!.sym} color="var(--blue, #3b7af7)" />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{asset?.name} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>({asset?.sym})</span></div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>on {EXT_NETWORKS.find(n => n.id === chain)?.name}</div>
          </div>
        </div>

        {/* Lithosphere dual-format toggle — only on EVM tab. */}
        {chain === 'evm' && lithoAddr && (
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
                <button key={o.label} onClick={() => setShowAlt(o.isAlt)} style={{
                  background: selected ? 'var(--bg-card)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  padding: '5px 14px', borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>{o.label}</button>
              );
            })}
          </div>
        )}

        {/* Real QR */}
        <div className="qr-box" style={{ background: '#fff', borderRadius: 8, padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 180, height: 180 }}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt={displayed} width={168} height={168}/>
            : <span style={{ fontSize: 11, color: '#666' }}>{displayed ? 'Generating QR…' : 'Loading…'}</span>}
        </div>

        {chain !== 'evm' && chainBalance && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginTop: 8 }}>
            Balance: {chainBalance}
          </div>
        )}
        <div className="addr-box" style={{ wordBreak: 'break-all', marginTop: 8, fontSize: 10 }}>
          {displayed ? <HiAddr value={displayed} full/> : '—'}
        </div>
        <button className="btn-primary" onClick={copy} disabled={!displayed}>{copied ? '✓ Copied' : 'Copy address'}</button>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
          Only send <strong style={{ color: 'var(--text-secondary)' }}>{asset?.sym ?? 'supported'}</strong> on {EXT_NETWORKS.find(n => n.id === chain)?.name} to this address. Sending another asset or chain may result in lost funds.
        </div>
      </div>
    </Modal>
  );
}

/* ─── Address book modal ───────────────────────────────────────────── */
function AddressBookModal({ onClose }: { onClose: () => void }) {
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
    const off = onContactsChanged(() => setContacts(loadContacts()));
    return off;
  }, []);

  const onAdd = async () => {
    setErr(null);
    const trimmedName = name.trim();
    const trimmedAddr = address.trim();
    if (!trimmedName || !trimmedAddr) return;

    // Optimistic insert — show the contact instantly, then reconcile with
    // the server row (or roll back on failure). The temp id lets us find &
    // remove this exact entry if the API call rejects.
    const tempId = `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: AbContact = {
      id:          tempId,
      name:        trimmedName,
      evm:         trimmedAddr,
      updatedAt:   Date.now(),
      pendingSync: true,
    };
    setContacts(prev => [...prev, optimistic]);
    setName(''); setAddress('');
    setBusy(true);
    try {
      // addContact persists the canonical row to local storage on success;
      // loadContacts() then reflects the reconciled entry (real id/checksum).
      await addContact({ name: trimmedName, address: trimmedAddr });
      setContacts(loadContacts());
    } catch (e) {
      // Roll back: drop only the optimistic entry, and surface the error.
      setContacts(prev => prev.filter(c => c.id !== tempId));
      setName(trimmedName); setAddress(trimmedAddr);
      setErr(e instanceof Error ? e.message : 'Could not add contact');
    } finally {
      setBusy(false);
    }
  };
  const onDelete = async (id: string) => {
    setErr(null);
    // Snapshot the exact prior state so we can restore position on failure.
    const prev = contacts;
    const idx  = prev.findIndex(c => c.id === id);
    if (idx === -1) return;
    const removed = prev[idx];

    // Optimistic removal — vanish instantly, then confirm with the API.
    setContacts(prev.filter(c => c.id !== id));
    try {
      if (await deleteContact(id)) {
        setContacts(loadContacts());
      } else {
        // Nothing was deleted server-side — restore the exact prior state.
        setContacts(cur => {
          if (cur.some(c => c.id === removed.id)) return cur;
          const next = [...cur];
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      }
    } catch (e) {
      // Restore the removed contact at its original position + show error.
      setContacts(cur => {
        if (cur.some(c => c.id === removed.id)) return cur;
        const next = [...cur];
        next.splice(Math.min(idx, next.length), 0, removed);
        return next;
      });
      setErr(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <Modal title="Address book" onClose={onClose}>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="field"
          placeholder="Name (e.g. Sora)"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="field"
          placeholder="0x… or litho1…"
          value={address}
          onChange={e => setAddress(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          style={{ fontFamily: address ? 'Geist Mono, monospace' : undefined, fontSize: address ? 11 : undefined }}
        />
        {err && <div style={{ fontSize: 11, color: 'var(--red)' }}>{err}</div>}
        <button
          className="btn-primary"
          onClick={onAdd}
          disabled={busy || !name.trim() || !address.trim()}
        >
          {busy ? 'Saving…' : 'Save contact'}
        </button>

        {contacts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {contacts.map(c => (
              <div key={c.id} className="set-row" style={{ alignItems: 'center', padding: '8px 10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="set-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}{c.pendingSync && <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>· not synced</span>}
                  </div>
                  <div className="set-sub" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.evm.slice(0,6)}…{c.evm.slice(-4)}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(c.id)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--red)',
                    fontSize: 11, cursor: 'pointer', padding: '4px 6px',
                  }}
                  title="Delete contact"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        {contacts.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            No saved contacts yet. Add one above to send faster next time.
          </div>
        )}
      </div>
    </Modal>
  );
}

/* Cross-chain swap (extension) — mirrors the web Cross-chain/Bridge tabs. */
const EXT_CROSS_CHAINS: Array<{ id: string; name: string; tokens: string[] }> = [
  { id: 'ethereum',  name: 'Ethereum',    tokens: ['ETH', 'USDC', 'USDT', 'DAI'] },
  { id: 'polygon',   name: 'Polygon',     tokens: ['POL', 'USDC', 'USDT', 'DAI'] },
  { id: 'bsc',       name: 'BNB Chain',   tokens: ['BNB', 'USDC', 'USDT'] },
  { id: 'avalanche', name: 'Avalanche',   tokens: ['AVAX', 'USDC', 'USDT'] },
  { id: 'makalu',    name: 'Lithosphere', tokens: ['LITHO', 'LAX', 'LitBTC'] },
];

function ExtCrossChainSwap({ bridge }: { bridge: boolean }) {
  const [fromId, setFromId] = useState('ethereum');
  const [toId, setToId]     = useState('polygon');
  const fromChain = EXT_CROSS_CHAINS.find(c => c.id === fromId) ?? EXT_CROSS_CHAINS[0];
  const toChain   = EXT_CROSS_CHAINS.find(c => c.id === toId)   ?? EXT_CROSS_CHAINS[1];
  const [fromTok, setFromTok] = useState(fromChain.tokens[0]);
  const [toTok, setToTok]     = useState(toChain.tokens[0]);
  const [amt, setAmt]         = useState('1');
  const [recipientOn, setRecipientOn] = useState(false);
  const [recipient, setRecipient]     = useState('');
  const [prices, setPrices]   = useState<Record<string, number>>({});

  useEffect(() => {
    // fetchEcosystemPrices() never rejects (it swallows network errors and
    // returns the hard/placeholder map), but it IS async — guard setPrices so
    // a late resolve after the swap modal closes doesn't touch a dead component.
    let cancelled = false;
    fetchEcosystemPrices().then(p => { if (!cancelled) setPrices(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (!fromChain.tokens.includes(fromTok)) setFromTok(fromChain.tokens[0]); /* eslint-disable-next-line */ }, [fromId]);
  useEffect(() => { if (!toChain.tokens.includes(toTok)) setToTok(toChain.tokens[0]); /* eslint-disable-next-line */ }, [toId]);

  const stable = (s: string) => s === 'USDC' || s === 'USDT' || s === 'DAI';
  const price = (s: string) => prices[s] ?? (stable(s) ? 1 : 0);
  const amtNum = parseFloat(amt) || 0;
  const rate = price(fromTok) && price(toTok) ? price(fromTok) / price(toTok) : 0;
  const outv = rate * amtNum;

  return (
    <div className="modal-body">
      <label className="field-label">FROM</label>
      <select className="field" value={fromId} onChange={e => setFromId(e.target.value)}>
        {EXT_CROSS_CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <select className="field" style={{ width: 92 }} value={fromTok} onChange={e => setFromTok(e.target.value)}>
          {fromChain.tokens.map(t => <option key={t}>{t}</option>)}
        </select>
        <input className="field" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ flex: 1 }}/>
      </div>
      <div style={{ textAlign: 'center', margin: '8px 0' }}>↓</div>
      <label className="field-label">TO</label>
      <select className="field" value={toId} onChange={e => setToId(e.target.value)}>
        {EXT_CROSS_CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <select className="field" style={{ width: 92 }} value={toTok} onChange={e => setToTok(e.target.value)}>
          {toChain.tokens.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="field" style={{ flex: 1, display: 'flex', alignItems: 'center', fontWeight: 700 }}>{outv > 0 ? outv.toFixed(6) : '—'}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {rate > 0 ? `1 ${fromTok} ≈ ${rate.toFixed(6)} ${toTok}` : 'Fetching rate…'} · {fromChain.name} → {toChain.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Recipient · optional</span>
        <button type="button" onClick={() => setRecipientOn(v => !v)} style={{ width: 38, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: recipientOn ? 'var(--blue, #3b7af7)' : 'var(--border-default)' }}>
          <span style={{ position: 'absolute', top: 2, left: recipientOn ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff' }}/>
        </button>
      </div>
      {recipientOn && <input className="field" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x… recipient" spellCheck={false} style={{ marginTop: 6 }}/>}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
        ⚠ Cross-chain routing runs on the MultX bridge, currently offline — showing an indicative rate. Execution unlocks when the bridge is live.
      </div>
      <button className="btn-primary" style={{ marginTop: 10, opacity: 0.6 }} disabled>{bridge ? 'Bridge offline' : 'Cross-chain swap · bridge offline'}</button>
    </div>
  );
}

/* MultX bridge — Makalu -> Kamet (LIVE). Real execution via lib/multx-bridge (ethers v6, no ESM SDK):
   approve -> lock on Makalu -> validators sign -> relayer releases on Kamet.
   Funds land at the same address on Kamet (no recipient field). */
function ExtMakaluKametBridge({ seed }: { seed: string[] }) {
  const [tokenSym, setTokenSym] = useState(BRIDGE_TOKENS[0].symbol);
  const [amt, setAmt]   = useState('');
  const [step, setStep] = useState<BridgeStep>('idle');
  const [txHash, setTxHash] = useState('');
  const [err, setErr]   = useState('');

  const token  = BRIDGE_TOKENS.find(t => t.symbol === tokenSym) ?? BRIDGE_TOKENS[0];
  const amtNum = parseFloat(amt) || 0;
  const ready  = seed.length > 0;
  const busy   = step === 'approving' || step === 'locking' || step === 'signing';
  const done   = step === 'completed';

  useEffect(() => { if (step === 'completed' || step === 'error') { setStep('idle'); setErr(''); setTxHash(''); } /* eslint-disable-next-line */ }, [tokenSym, amt]);

  const label: Record<BridgeStep, string> = {
    idle: 'Bridge to Kamet', approving: 'Approving…', locking: 'Locking on Makalu…',
    signing: 'Validators signing…', completed: 'Bridged ✓', error: 'Try again',
  };

  async function run() {
    if (!ready || amtNum <= 0) return;
    setErr(''); setTxHash(''); setStep('approving');
    try {
      const { bridgeMakaluToKamet } = await import('../../lib/multx-bridge');
      const res = await bridgeMakaluToKamet({
        source: { seed, accountIdx: getActiveAccountIndex() }, token, amount: amt,
        onStep: (s, info) => { setStep(s); if (info?.txHash) setTxHash(info.txHash); },
      });
      if (res.status !== 'completed') { setStep('error'); setErr('Locked on Makalu — release is pending. Check bridge history shortly.'); }
    } catch (e) {
      setStep('error');
      setErr(e instanceof Error ? e.message : 'Bridge failed');
    }
  }

  return (
    <div className="modal-body">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Route</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b7af7' }}/>{BRIDGE_ROUTE.source.name}
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1' }}/>{BRIDGE_ROUTE.dest.name}
        </span>
      </div>
      <label className="field-label">ASSET</label>
      <select className="field" value={tokenSym} onChange={e => setTokenSym(e.target.value)}>
        {BRIDGE_TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
      </select>
      <label className="field-label" style={{ marginTop: 8 }}>AMOUNT</label>
      <input className="field" type="number" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00"/>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
        Locks {token.symbol} on Makalu; a relayer releases the same amount to your address on Kamet — hands-off.
      </div>
      {txHash && (
        <div style={{ fontSize: 11, marginTop: 8 }}>
          <a href={`https://makalu.litho.ai/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue, #3b7af7)' }}>
            Lock tx: {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </a>
        </div>
      )}
      {busy && <div style={{ fontSize: 11, color: 'var(--blue, #3b7af7)', marginTop: 6 }}>{label[step]}</div>}
      {done && <div style={{ fontSize: 11, color: 'var(--green, #10b981)', marginTop: 6 }}>✓ Bridged to Kamet</div>}
      {err  && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{err}</div>}
      <button className="btn-primary" style={{ marginTop: 10, opacity: (ready && amtNum > 0 && !busy) ? 1 : 0.6 }} disabled={!ready || amtNum <= 0 || busy} onClick={run}>
        {!ready ? 'Unlock to bridge' : busy ? label[step] : done ? 'Bridge more' : label.idle}
      </button>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
        Makalu → Kamet is live. Kamet → Makalu and external chains are coming soon.
      </div>
    </div>
  );
}

function SwapModal({ onClose, initialFrom }: { onClose: () => void; initialFrom?: string }) {
  const [mode, setMode] = useState<'swap' | 'cross' | 'bridge'>('swap');
  const seed = useWalletSeed();
  const [from, setFrom] = useState(initialFrom ?? 'LITHO');
  const [to,   setTo]   = useState(initialFrom === 'LitBTC' ? 'LITHO' : 'LitBTC');
  const [amt,  setAmt]  = useState('100');
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

  // Debounced parallel quote across MultX + Ignite — keep the better output.
  useEffect(() => {
    const v = amt.trim();
    if (!v || parseFloat(v) <= 0 || from === to) {
      setQuote(null); setProvider(null); setErr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const [mux, ign] = await Promise.allSettled([
        import('../../lib/multx').then(m => m.getQuote(from, to, v)),
        import('../../lib/ignite').then(m => m.getQuote(from, to, v)),
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
      const mod = await import(provider === 'multx' ? '../../lib/multx' : '../../lib/ignite');

      // Dual-mode dispatch — same pattern as the web SwapModal:
      //   - If the quote came back with an `unsignedTx`, sign + broadcast
      //     it locally via the popup's offscreen-isolated signer, then
      //     forward the resulting tx hash as `signedTx`.
      //   - Otherwise, post quoteId alone and let the bridge/DEX run the
      //     source-chain tx server-side.
      let signedTxHash = '';
      const utx = (quote as { unsignedTx?: {
        to: string; value?: string; data?: string;
        gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      } }).unsignedTx;
      if (utx && seed.length) {
        const { signAndBroadcastTx } = await import('./offscreen-sign');
        signedTxHash = await signAndBroadcastTx({
          seed,
          tx: {
            to: utx.to, value: utx.value, data: utx.data,
            gas: utx.gas,
            // popup signer accepts maxFee* via the EIP-1559 keys.
            gasPrice: undefined,
          },
        });
        setPollMsg(`Source tx: ${signedTxHash.slice(0, 10)}…`);
      }

      const exec = await mod.execute(quote.quoteId, signedTxHash);
      const id = exec.executionId;
      if (exec.sourceHash) setPollMsg(`Source tx: ${exec.sourceHash.slice(0, 10)}…`);

      // Poll status with linear backoff up to 30 attempts (~5min).
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
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 10, margin: '4px 0' }}>
        {(['swap', 'cross', 'bridge'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: mode === m ? 'var(--blue, #3b7af7)' : 'transparent',
            color: mode === m ? '#fff' : 'var(--text-secondary)',
          }}>{m === 'swap' ? 'Swap' : m === 'cross' ? 'Cross-chain' : 'Bridge'}</button>
        ))}
      </div>
      {mode === 'bridge' ? <ExtMakaluKametBridge seed={seed}/> : mode === 'cross' ? <ExtCrossChainSwap bridge={false}/> : (
      <div className="modal-body">
        <label className="field-label">FROM</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="field" style={{ width: 80 }} value={from} onChange={e => setFrom(e.target.value)}>
            {SWAP_SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '8px 0' }}>↓</div>
        <label className="field-label">TO</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="field" style={{ width: 80 }} value={to} onChange={e => setTo(e.target.value)}>
            {SWAP_SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field" style={{ flex: 1, display: 'flex', alignItems: 'center', fontWeight: 700 }}>{out}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {quote ? (
            <>1 {from} ≈ {quote.rate.toFixed(6)} {to} · Route: <strong style={{ color: 'var(--text-primary)' }}>{provider}</strong> · Fee {quote.feeFrom} {from}</>
          ) : err ? <span style={{ color: 'var(--red)' }}>{err}</span>
          : 'Quoting…'}
        </div>

        {/* Slippage selector + min received line — same surface as the
            web SwapModal so behaviour stays consistent. */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 8, fontSize: 11 }}>
          <span style={{ color: 'var(--text-muted)' }}>Slippage</span>
          {[0.1, 0.5, 1, 2].map(s => {
            const active = slippagePct === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSlippagePct(s)}
                style={{
                  padding: '2px 6px', fontSize: 10, fontWeight: 700,
                  borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                  background: active ? 'var(--blue, #3b7af7)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                }}
              >{s}%</button>
            );
          })}
        </div>
        {quote && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Min received: <strong style={{ color: 'var(--text-primary)' }}>{minReceived.toFixed(6)} {to}</strong>
          </div>
        )}
        {quote?.expiresAt && (
          <div style={{ fontSize: 11, color: quoteExpired ? 'var(--red)' : 'var(--text-muted)', marginTop: 2 }}>
            {quoteExpired ? 'Quote expired — refresh to retry' : `Quote expires in ${quoteSecsLeft}s`}
          </div>
        )}
        {pollMsg && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>{pollMsg}</div>}
        <button
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={!quote || busy || quoteExpired}
          onClick={onSwap}
        >
          {busy ? 'Swapping…' : quoteExpired ? 'Quote expired' : 'Swap'}
        </button>
      </div>
      )}
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Permissions modal — token allowances + connected dApps
   ────────────────────────────────────────────────────────────────────── */

function PermissionsModal({ onClose }: { onClose: () => void }) {
  const seed = useWalletSeed();
  const [tab, setTab] = useState<'allowances' | 'sessions'>('allowances');

  return (
    <Modal title="Permissions" onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 10, marginBottom: 10 }}>
        <button onClick={() => setTab('allowances')} style={{
          flex: 1, padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: tab === 'allowances' ? 'var(--bg-surface)' : 'transparent',
          color: tab === 'allowances' ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: 600,
        }}>Token allowances</button>
        <button onClick={() => setTab('sessions')} style={{
          flex: 1, padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: tab === 'sessions' ? 'var(--bg-surface)' : 'transparent',
          color: tab === 'sessions' ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: 600,
        }}>Connected apps</button>
      </div>
      {tab === 'allowances' ? <AllowancesPanel seed={seed}/> : <SessionsPanel/>}
    </Modal>
  );
}

function AllowancesPanel({ seed }: { seed: string[] }) {
  const [rows, setRows]   = useState<Array<{
    tokenAddress: string; symbol: string; spender: string;
    amount: string; unlimited: boolean; decimals: number;
  }> | null>(null);
  const [err, setErr]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [{ fetchMakaluAllowances }, { getMakaluProvider }, { HDNodeWallet, Mnemonic }] = await Promise.all([
        import('@thanos/sdk-core'),
        import('@thanos/sdk-core'),
        import('ethers'),
      ]);
      // Derive the active address from the seed to query — uses the same
      // path as the active-account TopNav switcher.
      const idx = getActiveAccountIndex();
      const m = Mnemonic.fromPhrase(seed.join(' '));
      const w = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${idx}`);
      const list = await fetchMakaluAllowances({
        walletAddress: w.address, provider: getMakaluProvider(),
      });
      setRows(list);
    } catch (e) {
      setErr((e as Error).message || 'Failed to load allowances');
      setRows([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const revoke = async (row: { tokenAddress: string; spender: string }) => {
    if (!seed.length) { setErr('Wallet is locked'); return; }
    const key = `${row.tokenAddress}|${row.spender}`;
    setBusyKey(key); setErr(null);
    try {
      const { revokeAllowance, getMakaluProvider } = await import('@thanos/sdk-core');
      const { HDNodeWallet, Mnemonic } = await import('ethers');
      const idx = getActiveAccountIndex();
      const m = Mnemonic.fromPhrase(seed.join(' '));
      const w = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${idx}`).connect(getMakaluProvider());
      const tx = await revokeAllowance({ signer: w, tokenAddress: row.tokenAddress, spender: row.spender });
      await tx.wait();
      void load();
    } catch (e) {
      setErr((e as Error).message || 'Revoke failed');
    } finally { setBusyKey(null); }
  };

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>Scanning approvals…</div>;
  if (err) return <div style={{ color: 'var(--red)', fontSize: 12, padding: 10 }}>{err}</div>;
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>No active allowances on Makalu.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflow: 'auto' }}>
      {rows.map(r => {
        const k = `${r.tokenAddress}|${r.spender}`;
        const busy = busyKey === k;
        return (
          <div key={k} style={{ display: 'flex', gap: 8, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {r.symbol}
                {r.unlimited && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 5px', background: 'rgba(245,158,11,0.16)', color: '#f59e0b', borderRadius: 4, fontWeight: 800 }}>UNLIMITED</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.spender}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {r.unlimited ? 'Unlimited' : `${r.amount} ${r.symbol}`}
              </div>
            </div>
            <button
              onClick={() => revoke(r)}
              disabled={busy}
              style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)',
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SessionsPanel() {
  const [rows, setRows] = useState<Array<{ topic: string; name: string; url: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const { listActiveSessions } = await import('./walletconnect');
      setRows(await listActiveSessions());
    } catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { void load(); }, []);

  const disconnect = async (topic: string) => {
    setBusy(topic); setErr(null);
    try {
      const { disconnectSession } = await import('./walletconnect');
      await disconnectSession(topic);
      setRows(prev => prev?.filter(r => r.topic !== topic) ?? prev);
    } catch (e) {
      setErr((e as Error).message || 'Disconnect failed');
    } finally { setBusy(null); }
  };

  if (!rows) return <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>;
  if (rows.length === 0) return <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No active dApp connections.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {err && <div style={{ color: 'var(--red)', fontSize: 11 }}>{err}</div>}
      {rows.map(r => (
        <div key={r.topic} style={{ display: 'flex', gap: 10, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.url}</div>
          </div>
          <button onClick={() => disconnect(r.topic)} disabled={busy === r.topic} style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)',
            cursor: busy === r.topic ? 'not-allowed' : 'pointer', opacity: busy === r.topic ? 0.6 : 1,
          }}>
            {busy === r.topic ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────── App shell ──────────────────────── */

type Tab = 'home' | 'discover' | 'activity' | 'settings';
type Modal = 'send' | 'receive' | 'swap' | 'walletconnect' | 'address-book' | 'permissions' | 'recovery' | 'change-password' | null;

/* Reveal the secret recovery phrase — re-prompts the password (defense in
   depth) and decrypts the STORED vault before showing the words, rather than
   trusting the in-memory copy. Words stay blurred until tapped. */
function RecoveryPhraseModal({ onClose }: { onClose: () => void }) {
  const [pwd, setPwd] = useState('');
  const [words, setWords] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [copied, setCopied] = useState(false);
  const reveal = async () => {
    setBusy(true); setErr('');
    try {
      const v = loadVault();
      if (!v) { setErr('No wallet found on this device.'); return; }
      const r = await openVault(v, pwd);
      if (!r) { setErr('Wrong password.'); return; }
      setWords(r.mnemonic.trim().split(/\s+/));
    } catch { setErr('Could not open the vault.'); }
    finally { setBusy(false); }
  };
  const copyPhrase = async () => {
    if (!words) return;
    try { await navigator.clipboard.writeText(words.join(' ')); } catch { /* blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal title="Recovery phrase" onClose={onClose}>
      <div className="modal-body" style={{ padding: 14 }}>
        {!words ? (
          <>
            <p className="onb-sub" style={{ marginBottom: 10 }}>Enter your password to reveal your secret recovery phrase. Anyone with these words has full access to your wallet — never share them.</p>
            <input className="field" type="password" placeholder="Password" autoFocus value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pwd && !busy) reveal(); }} />
            {err && <div className="onb-err">{err}</div>}
            <button className="btn-primary" style={{ marginTop: 10 }} disabled={!pwd || busy} onClick={reveal}>{busy ? 'Verifying…' : 'Reveal phrase'}</button>
          </>
        ) : (
          <>
            <div className="seed-grid" style={{ position: 'relative' }}>
              {words.map((w, i) => (
                <div key={i} className="seed-cell">
                  <span className="seed-num">{i + 1}.</span>
                  <span style={{ userSelect: 'text', filter: hidden ? 'blur(8px)' : 'none', transition: 'filter 0.2s' }}>{w}</span>
                </div>
              ))}
              {hidden && (
                <button type="button" onClick={() => setHidden(false)}
                  style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)', borderRadius: 8, border: 'none', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  Tap to reveal
                </button>
              )}
            </div>
            <button className="btn-link" disabled={hidden} onClick={copyPhrase}>
              {copied ? <><Check size={13}/> Copied</> : <><Copy size={13}/> Copy phrase</>}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* Change the wallet password: verify the current one, re-encrypt the SAME seed
   under the new password, and re-cache the session key so the popup stays
   unlocked. */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [cf, setCf] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (nw.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (nw !== cf)     { setErr('New passwords don’t match.'); return; }
    setBusy(true); setErr('');
    try {
      const v = loadVault();
      if (!v) { setErr('No wallet found on this device.'); return; }
      const r = await openVault(v, cur);
      if (!r) { setErr('Current password is incorrect.'); return; }
      const nv = await createVault(r.mnemonic, nw);
      saveVault(nv);
      const re = await openVault(nv, nw);
      if (re) { cacheSessionKey(re.key); void persistSessionKey(re.key); }
      setDone(true);
    } catch { setErr('Could not change the password.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Change password" onClose={onClose}>
      <div className="modal-body" style={{ padding: 14 }}>
        {done ? (
          <>
            <p className="onb-sub">Your password has been updated. Use the new password next time you unlock.</p>
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <input className="field" type="password" placeholder="Current password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className="field" type="password" placeholder="New password (min 8)" value={nw} onChange={(e) => setNw(e.target.value)} style={{ marginTop: 8 }} />
            <input className="field" type="password" placeholder="Confirm new password" value={cf} onChange={(e) => setCf(e.target.value)} style={{ marginTop: 8 }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }} />
            {err && <div className="onb-err">{err}</div>}
            <button className="btn-primary" style={{ marginTop: 10 }} disabled={!cur || !nw || !cf || busy} onClick={submit}>{busy ? 'Updating…' : 'Update password'}</button>
          </>
        )}
      </div>
    </Modal>
  );
}

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
  // Display currency — restore the persisted pick on boot; the fx engine
  // notifies on change and this tick re-renders the popup so every
  // formatUsd() call picks up the new rate.
  const [, setFxTick] = useState(0);
  useEffect(() => {
    void initDisplayCurrency().then(() => setFxTick(t => t + 1));
    return subscribeFx(() => setFxTick(t => t + 1));
  }, []);
  const [seed, setSeed] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  /** Token-detail screen — opened by tapping a token row. */
  const [detailSym, setDetailSym] = useState<string | null>(null);
  /** Asset carried from detail into Send/Swap so they open pre-seeded. */
  const [seedSym, setSeedSym] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);  // dark-first — matches web/desktop
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingRpc, setPendingRpc] = useState<PendingRpcRequest | null>(null);
  const [rpcBusy, setRpcBusy]       = useState(false);
  const [rpcErr, setRpcErr]         = useState<string | null>(null);
  // Which network the pending request executes on — shown on the approval so
  // a mainnet tx can't be mistaken for a Makalu one. Switch shows its TARGET
  // chain; sign/tx show the wallet's ACTIVE chain (the one the tx broadcasts on).
  const [rpcChainName, setRpcChainName] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    if (!pendingRpc) { setRpcChainName(''); return; }
    if (pendingRpc.method === 'wallet_switchEthereumChain') {
      const target = ((pendingRpc.params?.[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
      setRpcChainName(dappChainByHex(target)?.name ?? 'Unknown network');
      return;
    }
    activeChain().then((c) => { if (!cancelled) setRpcChainName(c.name); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pendingRpc]);
  // Pre-sign simulation — populated when a pending eth_sendTransaction
  // arrives. Other methods (personal_sign, eth_signTypedData_v4) don't
  // touch on-chain state so we skip the simulator for them.
  const [simReport, setSimReport]   = useState<SimulationReport | null>(null);
  // Multi-account state. activeIdx is the HD-path index the popup signs
  // from (m/44'/60'/0'/0/{idx}); accountCount is how many accounts the
  // user has provisioned. Both read from storage on mount and persist
  // back on change. Default 0 / 1 for a fresh vault.
  const [activeIdx,    setActiveIdx]    = useState(0);
  const [accountCount, setAccountCountState] = useState(1);
  useEffect(() => {
    setActiveIdx(getActiveAccountIndex());
    setAccountCountState(getAccountCount());
  }, [unlocked]);

  const evmAddr   = seed.length ? deriveEvm(seed, activeIdx) : '';
  const lithoAddr = useMemo(() => { try { return evmAddr ? evmToLitho(evmAddr) : ''; } catch { return evmAddr; } }, [evmAddr]);
  const portfolio = usePortfolio(evmAddr, seed);

  /** Switch to a different derived account. Updates storage so the
   *  next popup open + the signer paths pick up the same index. */
  const switchAccount = (idx: number) => {
    if (idx < 0 || idx >= accountCount) return;
    setActiveAccountIndex(idx);
    setActiveIdx(idx);
  };

  /** Add a new derived account at the next index. Bumps accountCount
   *  + activates the new one immediately. */
  const addAccount = () => {
    if (accountCount >= MAX_ACCOUNTS) return;
    const next = accountCount;
    setAccountCount(next + 1);
    setAccountCountState(next + 1);
    setActiveAccountIndex(next);
    setActiveIdx(next);
  };

  /* ─── Rename / delete account ─────────────────────────────────────────
     Removal hides the HD index (lib/vault.ts hideAccount) so no address ever
     shifts. Guarded: an account over $1 can't go, and if the balance can't be
     VERIFIED we refuse rather than risk hiding funds. The popup has no modal
     system for this, so rename uses a compact inline prompt row and delete
     surfaces its outcome in acctMsg. */
  const [acctMsg, setAcctMsg] = useState<string | null>(null);
  const [nameTick, setNameTick] = useState(0);

  const renameAccount = (idx: number) => {
    const current = getCustomAccountName(idx) ?? '';
    // eslint-disable-next-line no-alert
    const next = window.prompt(`Rename ${getAccountName(idx)}`, current);
    if (next == null) return;               // cancelled
    setAccountName(idx, next);
    setNameTick(t => t + 1);
  };

  /* Delete wallet — erases the vault from this browser. Two confirms, and the
     first states the actual consequence based on whether the recovery phrase
     was backed up: without a backup this is permanent loss, and the user
     deserves to know that BEFORE the destructive click. */
  const deleteWallet = () => {
    const backedUp = isSeedBackedUp();
    const first = backedUp
      ? 'Delete this wallet from this browser?\n\nYou can restore it later with your recovery phrase.'
      : 'You have NOT backed up your recovery phrase.\n\nIf you delete this wallet now, these funds are gone permanently — nobody can recover them.';
    if (!window.confirm(first)) return;
    if (!window.confirm('Are you sure? This cannot be undone.')) return;
    clearVault();
    clearSessionKey();
    void clearPersistedSessionKey();
    setSeed([]);
    setUnlocked(false);
    setHasVault(false);
  };

  const deleteAccount = async (idx: number) => {
    setAcctMsg(null);
    if (getVisibleAccountIndices().length <= 1) {
      setAcctMsg('Your wallet must keep at least one account.');
      return;
    }
    const addr = seed.length ? deriveEvm(seed, idx) : '';
    if (!addr) { setAcctMsg('Unlock your wallet to delete an account.'); return; }
    setAcctMsg('Checking balance…');
    const m = await import('../../lib/account-balance');
    const usd = await m.accountUsdValue(addr);
    if (usd == null) {
      setAcctMsg("Couldn't verify this account's balance — it wasn't deleted.");
      return;
    }
    if (usd > m.DELETE_MAX_USD) {
      setAcctMsg(`That account holds about $${usd.toFixed(2)}. Move the funds out first.`);
      return;
    }
    if (!window.confirm(`Delete ${getAccountName(idx)}? The same recovery phrase can restore it later.`)) {
      setAcctMsg(null);
      return;
    }
    if (!hideAccount(idx)) { setAcctMsg('That account can\'t be removed.'); return; }
    setActiveIdx(getActiveAccountIndex());
    setNameTick(t => t + 1);
    setAcctMsg(null);
  };

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
    // Narrow `to` for TS — the type guard above already proves it's set
    // but the closure below loses that flow info under strict mode.
    const toAddr = tx.to;
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
          to:      toAddr,
          amount:  amountEth,
        });
        if (!cancelled) setSimReport(report);
      } catch { if (!cancelled) setSimReport(null); }
    })();
    return () => { cancelled = true; };
  }, [pendingRpc]);

  useEffect(() => {
    (async () => {
      // Legacy plaintext migration (one-shot) — best-effort. It must NEVER
      // block the popup from resolving its gate: a throw/hang here used to
      // leave hasVault=null → a permanently blank popup ("no data loading").
      try {
        if (hasLegacyPlaintext()) {
          const mig = await migrateLegacyPlaintext();
          if (mig.ok && mig.key) cacheSessionKey(mig.key);
        }
      } catch { /* ignore — fall through to render onboarding/unlock */ }

      let vault: ReturnType<typeof loadVault> = null;
      try { vault = loadVault(); } catch { vault = null; }
      setHasVault(!!vault);   // ALWAYS resolves the gate (onboarding or wallet)

      if (vault) {
        try {
          // sessionStorage first (same-popup refresh), then the persisted key
          // (chrome.storage.session/local) which SURVIVES popup close for the
          // user's chosen session duration — this is what stops the constant
          // password re-prompts. Expiry is enforced inside loadPersistedSessionKey.
          let key = getSessionKey();
          if (!key) key = await loadPersistedSessionKey();
          if (key) {
            const mnemonic = await openVaultWithKey(vault, key);
            if (mnemonic) {
              const words = mnemonic.split(' ');
              setSeed(words); setUnlocked(true);
              cacheSessionKey(key); // reseed the fast in-page cache
              // Re-announce the active address so dApps / eth_accounts work on an
              // auto-unlock (mirrors onComplete), and refresh the persisted key so
              // the sliding window reflects this use.
              try {
                const addr = deriveEvm(words, getActiveAccountIndex());
                browser?.runtime?.sendMessage({ type: 'thanos-active-address', address: addr });
              } catch { /* background may be asleep; it hydrates on next message */ }
            } else {
              clearSessionKey(); await clearPersistedSessionKey();
            }
          }
        } catch { /* session unlock is best-effort; the unlock screen still works */ }
      }

      // Dark-first: only an explicit stored 'light' opts out (the module-
      // level snippet above already painted the right theme pre-mount —
      // this just syncs React state for the Settings toggle label).
      const stored = localStorage.getItem(STORAGE.theme);
      const dark = stored !== 'light';
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    })().catch(() => setHasVault((v) => (v === null ? false : v)));
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
    void clearPersistedSessionKey(); // drop the survives-popup-close key too
    // Tell the background SW the wallet is locked so dApps see accountsChanged([]).
    try { browser?.runtime?.sendMessage({ type: 'thanos-lock' }); } catch {}
  };
  const onComplete = (s: string[]) => {
    setSeed(s);
    setHasVault(true);
    setUnlocked(true);
    // Announce the unlocked address so the background can answer eth_accounts.
    // Reads the stored active index so re-unlock returns the same account
    // the user last had selected, not always Account 1.
    try {
      const addr = deriveEvm(s, getActiveAccountIndex());
      browser?.runtime?.sendMessage({ type: 'thanos-active-address', address: addr });
    } catch {}
  };

  /* Whenever the active account changes (switch or add), push the new
     address to the background so dApps see the change via eth_accounts
     and the existing connections re-emit the accountsChanged event. */
  useEffect(() => {
    if (!seed.length || !evmAddr) return;
    try {
      browser?.runtime?.sendMessage({ type: 'thanos-active-address', address: evmAddr });
    } catch {}
  }, [evmAddr, seed.length]);

  /* Derive + cache the contact-encryption key from the unlocked seed.
     Cleared on lock. AddressBookModal uses this to encrypt name + notes
     before POSTing to /contacts. */
  useEffect(() => {
    void setContactEncryptionKey(unlocked && seed.length ? seed : null);
    return () => { void setContactEncryptionKey(null); };
  }, [unlocked, seed]);

  const approveRpc = async () => {
    if (!pendingRpc) return;
    setRpcBusy(true); setRpcErr(null);
    try {
      const result = await executeWcRequest(seed, {
        request: { method: pendingRpc.method, params: pendingRpc.params },
      });
      // Contract guard: signing/tx methods MUST resolve to a 0x-prefixed
      // string (personal_sign/eth_sign/eth_signTypedData_v4 → 65-byte
      // signature; eth_sendTransaction → tx hash). If the signer ever
      // returned undefined or a non-string, posting it as `result` would
      // reach the dApp as a successful-but-empty {} — the exact failure a
      // SIWE integrator reported. Reject with a real error instead so the
      // page's catch fires rather than silently resolving to nothing.
      const SIGN_METHODS = ['personal_sign', 'eth_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'];
      if (SIGN_METHODS.includes(pendingRpc.method) &&
          !(typeof result === 'string' && result.startsWith('0x'))) {
        throw new WcSignerError(-32603, `Signer returned no ${pendingRpc.method === 'eth_sendTransaction' ? 'transaction hash' : 'signature'}`);
      }
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
          {rpcChainName && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8,
              fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              borderRadius: 999, padding: '4px 12px',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--blue)' }}/>
              {pendingRpc.method === 'wallet_switchEthereumChain' ? 'Switch to ' : 'Network: '}{rpcChainName}
            </div>
          )}
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
      {/* First-run Lithosphere Makalu welcome — self-gates, shows once. */}
      <MakaluWelcomeModal/>
      {modal === 'send'          && <SendModal          onClose={() => { setModal(null); setSeedSym(null); }} address={evmAddr}
        initialChain={seedSym && ['BTC','SOL','ATOM'].includes(seedSym) ? (seedSym === 'BTC' ? 'bitcoin' : seedSym === 'SOL' ? 'solana' : 'cosmos') : (seedSym ? 'evm' : undefined)}
        initialCoin={seedSym && !['BTC','SOL','ATOM'].includes(seedSym) ? seedSym : undefined}/>}
      {modal === 'receive'       && <ReceiveModal       onClose={() => setModal(null)} address={evmAddr}/>}
      {modal === 'swap'          && <SwapModal          onClose={() => { setModal(null); setSeedSym(null); }} initialFrom={seedSym ?? undefined}/>}
      {modal === 'walletconnect' && <WalletConnectModal onClose={() => setModal(null)} evmAddress={evmAddr}/>}
      {modal === 'address-book' && <AddressBookModal    onClose={() => setModal(null)}/>}
      {modal === 'permissions'  && <PermissionsModal    onClose={() => setModal(null)}/>}
      {modal === 'recovery'        && <RecoveryPhraseModal onClose={() => setModal(null)}/>}
      {modal === 'change-password' && <ChangePasswordModal onClose={() => setModal(null)}/>}
      {detailSym && (
        <TokenDetailModal
          sym={detailSym}
          onClose={() => setDetailSym(null)}
          onSend={() => { setSeedSym(detailSym); setDetailSym(null); setModal('send'); }}
          onReceive={() => { setDetailSym(null); setModal('receive'); }}
          onSwap={() => { setSeedSym(detailSym); setDetailSym(null); setModal('swap'); }}
        />
      )}

      <div className="app">
        <div className="app-body">
          {tab === 'home'     && <HomeScreen
            key={nameTick}
            onAction={setModal} onLock={lock} onOpenSettings={() => setTab('settings')}
            onOpenToken={setDetailSym}
            activeIdx={activeIdx} accountCount={accountCount}
            onSwitch={switchAccount} onAddAccount={addAccount}
            onRenameAccount={renameAccount}
            onDeleteAccount={(i) => { void deleteAccount(i); }}
          />}
          {tab === 'discover' && <DiscoverScreen/>}
          {tab === 'activity' && <ActivityScreen/>}
          {tab === 'settings' && <SettingsScreen isDark={isDark} onToggleTheme={toggleTheme} onLock={lock} onOpenWalletConnect={() => setModal('walletconnect')} onOpenAddressBook={() => setModal('address-book')} onOpenPermissions={() => setModal('permissions')} address={lithoAddr || evmAddr} accountName={getAccountName(activeIdx)} onOpenChangePassword={() => setModal('change-password')} onOpenRecoveryPhrase={() => setModal('recovery')} onDeleteWallet={deleteWallet}/>}
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

/* Popup-wide crash guard. Without this, ANY render error unmounts the whole
 * tree → a blank popup, which reads as "no data is loading" (the Chrome Web
 * Store rejection reason for 0.2.0). Now a render error shows a reload card
 * instead of a blank screen. */
class PopupErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[Thanos popup] render error:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, minHeight: 360, display: 'flex', flexDirection: 'column',
          gap: 12, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 26 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            The wallet hit an unexpected error. Your funds are safe — reload to continue.
          </div>
          <button className="btn-primary" style={{ marginTop: 4 }} onClick={() => { try { location.reload(); } catch {} }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Layered crash guards — the popup must NEVER show a blank screen ──────
 * The React <PopupErrorBoundary> only catches errors AFTER React mounts. These
 * cover the cases it can't: a bundle/module-load error, a mount failure, or a
 * hang before first paint. Combined with the dark #root fallback in
 * index.html, the worst case is a "reload" card on a dark background — never
 * a blank/white popup (the Chrome Web Store rejection symptom). */
let __thanosMounted = false;
function showFatalCard(): void {
  if (__thanosMounted) return;            // React owns #root — let the ErrorBoundary handle it
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;'
    + 'width:360px;height:600px;background:#080809;color:#e6e6ea;text-align:center;padding:24px;box-sizing:border-box;'
    + "font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;\">"
    + '<div style="font-size:26px;">⚠️</div>'
    + '<div style="font-weight:700;font-size:15px;">Something went wrong</div>'
    + '<div style="color:#9a9aa5;line-height:1.5;">The wallet hit an unexpected error. Your funds are safe — reload to continue.</div>'
    + '<button id="thanos-reload" style="margin-top:6px;padding:9px 18px;border:none;border-radius:10px;'
    + 'background:#3b7af7;color:#fff;font-weight:700;cursor:pointer;">Reload</button>'
    + '</div>';
  document.getElementById('thanos-reload')?.addEventListener('click', () => { try { location.reload(); } catch { /* noop */ } });
}
// Uncaught JS errors (bubble phase only catches real errors, not resource
// loads) → reload card if the app never came up.
window.addEventListener('error', (ev) => {
  // eslint-disable-next-line no-console
  console.error('[Thanos popup] uncaught error:', ev.error ?? ev.message);
  showFatalCard();
});
// Unhandled rejections are logged but NOT surfaced as fatal — many are benign
// (aborted fetches, optional chains). A true hang is caught by the watchdog.
window.addEventListener('unhandledrejection', (ev) => {
  // eslint-disable-next-line no-console
  console.error('[Thanos popup] unhandled rejection:', ev.reason);
});
// Watchdog: if React still hasn't taken over #root after 8s, show the card.
setTimeout(() => { if (!__thanosMounted) showFatalCard(); }, 8_000);

try {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root element missing');
  createRoot(el).render(<PopupErrorBoundary><App/></PopupErrorBoundary>);
  __thanosMounted = true;
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[Thanos popup] failed to mount:', err);
  showFatalCard();
}

/* ── Click-blocker self-heal — the popup must NEVER be un-clickable ────────
 * Companion to the crash guards above. Those cover a popup that won't render;
 * this covers one that renders fine but can't be clicked — the "all buttons
 * dead" symptom. That has exactly one cause: some element is hit-tested over
 * the buttons (a stuck/transparent overlay, a layer with the wrong
 * z-index/pointer-events) so the clicks never reach them. React can't see it
 * (the tree mounted correctly); only a geometric hit-test can.
 *
 * A few times after mount, probe each visible <button> at its own centre. If —
 * and ONLY if — EVERY visible button hit-tests to a foreign element, it's a
 * genuine global blocker (a real full-screen modal can't trigger this: its own
 * buttons hit-test to themselves, so "all buttons blocked" is impossible while
 * any reachable button exists). Then heal it: a layer painted ON TOP gets
 * pointer-events:none; a button the click falls THROUGH (its own/an ancestor's
 * pointer-events:none) gets pointer-events restored. Healthy popup → no-op. */
function describeEl(el: Element): string {
  const h = el as HTMLElement;
  const cls = typeof h.className === 'string' && h.className.trim()
    ? '.' + h.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
}
function healClickBlockers(): void {
  if (!__thanosMounted) return;
  const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.bottom > 2 && r.top < window.innerHeight - 2;
  });
  if (btns.length === 0) return;
  const fixes: Array<() => void> = [];
  const culprits = new Set<string>();
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || hit === b || b.contains(hit)) continue;          // reachable → fine
    if (hit.contains(b)) {                                        // click falls THROUGH the button
      culprits.add(describeEl(b) + ' (pointer-events fell through)');
      fixes.push(() => { (b as HTMLElement).style.pointerEvents = 'auto'; });
    } else {                                                      // foreign layer painted on top
      culprits.add(describeEl(hit));
      fixes.push(() => { (hit as HTMLElement).style.pointerEvents = 'none'; });
    }
  }
  if (fixes.length < btns.length) return;                        // some button is reachable → not global
  fixes.forEach((f) => { try { f(); } catch { /* noop */ } });
  // eslint-disable-next-line no-console
  console.warn('[Thanos popup] every button was intercepted — healed:', Array.from(culprits).join(', '));
}
[250, 800, 2000].forEach((d) => setTimeout(healClickBlockers, d));
