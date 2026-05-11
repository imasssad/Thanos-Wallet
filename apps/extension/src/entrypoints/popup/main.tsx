import React, { useEffect, useState } from 'react';
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
} from '../../lib/vault';

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

/* ──────────────────────── Mock data ──────────────────────── */

const ASSETS = [
  { sym: 'LITHO',  name: 'Lithosphere',         bal: '50,000',   usd: '$15,000.00', price: '$0.300',  chg: 18.40, color: '#8b7df7' },
  { sym: 'BTC',    name: 'Bitcoin',             bal: '0.04821',  usd: '$2,891.00',  price: '$59,962', chg: -1.17, color: '#f7931a' },
  { sym: 'wLITHO', name: 'Wrapped Lithosphere', bal: '5,000',    usd: '$1,500.00',  price: '$0.300',  chg: 18.40, color: '#a395f8' },
  { sym: 'ETH',    name: 'Ethereum',            bal: '0.6142',   usd: '$2,210.00',  price: '$3,598',  chg:  0.54, color: '#627eea' },
  { sym: 'FGPT',   name: 'FractalGPT',          bal: '80,000',   usd: '$1,200.00',  price: '$0.015',  chg: 42.30, color: '#10b981' },
  { sym: 'USDC',   name: 'USD Coin',            bal: '840.00',   usd: '$840.00',    price: '$1.00',   chg:  0.01, color: '#2775ca' },
];

const TXS = [
  { type: 'Received', sym: 'LITHO',  amt: '+1,200', time: '2 min ago', pos: true,  color: '#8b7df7' },
  { type: 'Sent',     sym: 'BTC',    amt: '-0.012', time: '1 hr ago',  pos: false, color: '#f7931a' },
  { type: 'Swap',     sym: 'wLITHO', amt: '+500',   time: '3 hr ago',  pos: true,  color: '#a395f8' },
  { type: 'Sent',     sym: 'FGPT',   amt: '-2,000', time: '5 hr ago',  pos: false, color: '#10b981' },
  { type: 'Received', sym: 'USDC',   amt: '+840',   time: 'Yesterday', pos: true,  color: '#2775ca' },
];

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

function HomeScreen({ onAction, onLock }: { onAction: (m: 'send'|'receive'|'swap') => void; onLock: () => void }) {
  return (
    <div className="screen">
      <div className="screen-header">
        <div className="acct-chip" onClick={onLock} title="Long-press to lock">
          <div className="acct-avatar"><User size={13}/></div>
          <div>
            <div className="acct-name">Account 1</div>
            <div className="acct-addr">litho1…o9z4v</div>
          </div>
        </div>
        <button className="icon-btn"><Bell size={15}/></button>
      </div>

      <div className="balance-card">
        <div className="balance-label">TOTAL BALANCE</div>
        <div className="balance-amt">$9,357.00</div>
        <div className="balance-row">
          <div className="change-pill">▲ 2.34%</div>
          <span className="balance-sub">+$214.32 today</span>
        </div>
      </div>

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
        <span className="count-pill">{ASSETS.length}</span>
      </div>
      <div className="card list">
        {ASSETS.map((a, i) => (
          <div key={a.sym} className={`row ${i < ASSETS.length - 1 ? 'row-border' : ''}`}>
            <div className="row-avatar" style={{ background: a.color }}>{a.sym.slice(0,1)}</div>
            <div className="row-mid">
              <div className="row-name">{a.name}</div>
              <div className="row-sub">{a.price} <span className={a.chg >= 0 ? 'pos' : 'neg'}>{a.chg >= 0 ? '+' : ''}{a.chg}%</span></div>
            </div>
            <div className="row-right">
              <div className="row-amt">{a.usd}</div>
              <div className="row-bal">{a.bal} {a.sym}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityScreen() {
  return (
    <div className="screen">
      <h1 className="page-title">Activity</h1>
      <div className="filter-row">
        {['All', 'Sent', 'Received', 'Swap'].map((f, i) => (
          <button key={f} className={`filter-pill ${i === 0 ? 'active' : ''}`}>{f}</button>
        ))}
      </div>
      <div className="section-header">Today</div>
      <div className="card list">
        {TXS.map((t, i) => {
          const Ic = t.type === 'Sent' ? ArrowUpRight : t.type === 'Received' ? ArrowDownLeft : Repeat;
          return (
            <div key={i} className={`row ${i < TXS.length - 1 ? 'row-border' : ''}`}>
              <div className="row-avatar" style={{ background: t.pos ? 'rgba(16,185,129,0.18)' : 'rgba(59,122,247,0.18)', color: t.pos ? '#10b981' : '#3b7af7' }}>
                <Ic size={14} strokeWidth={2.4}/>
              </div>
              <div className="row-mid">
                <div className="row-name">{t.type} {t.sym}</div>
                <div className="row-sub">{t.time}</div>
              </div>
              <div className="row-right">
                <div className={`row-amt ${t.pos ? 'pos' : ''}`}>{t.amt} {t.sym}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsScreen({ isDark, onToggleTheme, onLock }: { isDark: boolean; onToggleTheme: () => void; onLock: () => void }) {
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
  const [to, setTo] = useState(''); const [amt, setAmt] = useState('');
  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">RECIPIENT</label>
        <input className="field" placeholder="0x… or name.litho" value={to} onChange={e => setTo(e.target.value)}/>
        <label className="field-label" style={{ marginTop: 14 }}>AMOUNT</label>
        <input className="field" placeholder="0.00" type="number" value={amt} onChange={e => setAmt(e.target.value)}/>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Balance: 4,280.00 LITHO · ~$0.04 fee</div>
        <button className="btn-primary" disabled={!to || !amt} style={{ marginTop: 16 }}>Review</button>
      </div>
    </Modal>
  );
}

function ReceiveModal({ onClose, address }: { onClose: () => void; address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(address); ok = true; } catch {}
    if (!ok) {
      const ta = document.createElement('textarea'); ta.value = address;
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
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
        <div className="addr-box">{address.slice(0, 16)}…{address.slice(-6)}</div>
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

type Tab = 'home' | 'activity' | 'settings';
type Modal = 'send' | 'receive' | 'swap' | null;

function App() {
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [seed, setSeed] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [isDark, setIsDark] = useState(false);

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
  };
  const onComplete = (s: string[]) => {
    setSeed(s);
    setHasVault(true);
    setUnlocked(true);
    // Session key was cached inside finishCreate / finishImport / tryUnlock.
  };

  if (hasVault === null) return <div className="root-loading"/>;
  if (!unlocked) return <Onboarding hasVault={hasVault} onComplete={onComplete}/>;

  const evmAddr = seed.length ? deriveEvm(seed) : 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v';

  return (
    <>
      {modal === 'send'    && <SendModal    onClose={() => setModal(null)}/>}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)} address={evmAddr}/>}
      {modal === 'swap'    && <SwapModal    onClose={() => setModal(null)}/>}

      <div className="app">
        <div className="app-body">
          {tab === 'home'     && <HomeScreen onAction={setModal} onLock={lock}/>}
          {tab === 'activity' && <ActivityScreen/>}
          {tab === 'settings' && <SettingsScreen isDark={isDark} onToggleTheme={toggleTheme} onLock={lock}/>}
        </div>
        <div className="tabbar">
          {([
            { k: 'home',     l: 'Home',     I: Home },
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
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
