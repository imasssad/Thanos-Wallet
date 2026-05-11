'use client';
import React, { useEffect, useState } from 'react';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { discoverTokens } from '../lib/token-discovery';
import {
  Wallet as WalletIcon, ChevronLeft, Eye, EyeOff, Copy, Check,
  AlertTriangle, Lock,
} from 'lucide-react';

const STORAGE = {
  hasVault:  'thanos.has_vault',
  mnemonic:  'thanos.mnemonic',
  password:  'thanos.password',
  /* Persisted unlocked flag — set on successful onComplete / unlock, cleared
     only by an explicit Lock or Reset. Lets a page refresh skip the password
     prompt (per client spec: auth stays valid until user signs out or app
     is deleted). */
  unlocked:  'thanos.unlocked',
};

/** Generate a fresh BIP39 phrase of the requested length.
 *  12 words = 128 bits of entropy (default, recommended).
 *  24 words = 256 bits of entropy (higher security, longer phrase to back up). */
function generateMnemonic(wordCount: 12 | 24 = 12): string[] {
  // ethers entropy: 16 bytes -> 12 words, 32 bytes -> 24 words
  const entropyBytes = wordCount === 24 ? 32 : 16;
  const entropy = new Uint8Array(entropyBytes);
  crypto.getRandomValues(entropy);
  const hex = '0x' + Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join('');
  return Mnemonic.fromEntropy(hex).phrase.split(' ');
}
function isValidMnemonic(phrase: string): boolean {
  try { Mnemonic.fromPhrase(phrase.trim().toLowerCase()); return true; }
  catch { return false; }
}
function deriveEvmAddress(seed: string[]): string {
  try {
    return HDNodeWallet.fromPhrase(seed.join(' '), undefined, "m/44'/60'/0'/0/0").address;
  } catch { return '0x0000000000000000000000000000000000000000'; }
}

type Step = 'welcome' | 'create-length' | 'create-warn' | 'create-show' | 'create-confirm' | 'create-pwd'
          | 'import' | 'import-pwd' | 'unlock';

export function OnboardingFlow({ hasVault, onComplete }: { hasVault: boolean; onComplete: (seed: string[]) => void }) {
  const [step, setStep] = useState<Step>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
  const [phraseLen, setPhraseLen]     = useState<12 | 24>(12);
  /* Verify-phrase state: only N indices are missing; user fills those slots
     by tapping chips from a pool. The other (seed.length - N) words are pre-filled. */
  const VERIFY_MISSING = 4;
  const [missingIdxs,   setMissingIdxs]  = useState<number[]>([]);
  const [verifyPicks,   setVerifyPicks]  = useState<Record<number, string>>({});
  const [verifyPool,    setVerifyPool]   = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);

  const startCreate = () => { setStep('create-length'); };
  const pickLengthAndGenerate = (n: 12 | 24) => {
    setPhraseLen(n);
    setSeed(generateMnemonic(n));
    setStep('create-warn');
  };
  const goToVerify = () => {
    // Pick N random indices to verify; pool contains those correct words shuffled
    const idxs = Array.from({ length: seed.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5)
      .slice(0, VERIFY_MISSING)
      .sort((a, b) => a - b);
    setMissingIdxs(idxs);
    setVerifyPicks({});
    setVerifyPool(idxs.map(i => seed[i]).sort(() => Math.random() - 0.5));
    setStep('create-confirm');
  };
  const pickWord = (w: string) => {
    // fill the next empty missing slot, in slot order
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
  const allConfirmed = missingIdxs.length > 0
                     && missingIdxs.every(i => verifyPicks[i] === seed[i]);
  const orderMismatch = missingIdxs.length > 0
                     && missingIdxs.every(i => verifyPicks[i] !== undefined)
                     && !allConfirmed;

  const finishCreate = () => {
    if (password !== password2 || password.length < 8) return;
    localStorage.setItem(STORAGE.hasVault, '1');
    localStorage.setItem(STORAGE.mnemonic, seed.join(' '));
    localStorage.setItem(STORAGE.password, password);
    onComplete(seed);
  };
  const finishImport = () => {
    if (password !== password2 || password.length < 8) return;
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) { alert('Phrase must be 12/15/18/21/24 words'); return; }
    if (!isValidMnemonic(words.join(' '))) { alert('Invalid recovery phrase'); return; }
    localStorage.setItem(STORAGE.hasVault, '1');
    localStorage.setItem(STORAGE.mnemonic, words.join(' '));
    localStorage.setItem(STORAGE.password, password);
    onComplete(words);
    // Fire-and-forget: scan the indexer for any LEP100 balances on this
    // address and persist them so the wallet renders them on first paint.
    discoverTokens(deriveEvmAddress(words)).catch(() => {});
  };
  const tryUnlock = () => {
    const stored = localStorage.getItem(STORAGE.password);
    const mnem = localStorage.getItem(STORAGE.mnemonic);
    if (stored && unlockPwd === stored && mnem) {
      onComplete(mnem.split(' '));
    } else {
      setUnlockErr('Incorrect password');
      setUnlockPwd('');
    }
  };
  const resetWallet = () => {
    if (window.confirm('This deletes your wallet from this device. You can restore it with your recovery phrase. Continue?')) {
      localStorage.removeItem(STORAGE.hasVault);
      localStorage.removeItem(STORAGE.mnemonic);
      localStorage.removeItem(STORAGE.password);
      localStorage.removeItem(STORAGE.unlocked);
      setStep('welcome');
      setUnlockPwd('');
      setUnlockErr('');
    }
  };
  const copySeed = async () => {
    const text = seed.join(' ');
    let ok = false;
    // Try modern clipboard API (HTTPS only)
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    }
    // Fallback: legacy execCommand (works on HTTP)
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    if (ok) {
      setCopiedSeed(true);
      setTimeout(() => setCopiedSeed(false), 2200);
    } else {
      alert('Copy unavailable. Long-press / select the words manually.');
    }
  };

  return (
    <div className="onboard-wrap">
      <div className="onboard-card">
        <div className="onboard-logo">
          <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos"/>
        </div>

        {step === 'welcome' && <>
          <h1 className="onboard-title">Welcome to Thanos</h1>
          <p className="onboard-sub">Multi-chain Web4 wallet — Lithosphere · Bitcoin · EVM</p>
          <button className="btn-primary onboard-btn" onClick={startCreate}>Create new wallet</button>
          <button className="btn-outline onboard-btn" style={{ width: '100%' }} onClick={() => setStep('import')}>Import existing wallet</button>
        </>}

        {step === 'create-length' && <>
          <h1 className="onboard-title">Choose phrase length</h1>
          <p className="onboard-sub">How many words do you want your recovery phrase to be? Both are secure — 24 words just adds extra entropy.</p>
          <div className="phrase-len-choice">
            <button className={`phrase-len-tile ${phraseLen === 12 ? 'active' : ''}`} onClick={() => pickLengthAndGenerate(12)}>
              <div className="phrase-len-num">12</div>
              <div className="phrase-len-label">words</div>
              <div className="phrase-len-sub">Recommended · 128-bit entropy</div>
            </button>
            <button className={`phrase-len-tile ${phraseLen === 24 ? 'active' : ''}`} onClick={() => pickLengthAndGenerate(24)}>
              <div className="phrase-len-num">24</div>
              <div className="phrase-len-label">words</div>
              <div className="phrase-len-sub">Advanced · 256-bit entropy</div>
            </button>
          </div>
          <button className="btn-outline" style={{ width: '100%', marginTop: 14 }} onClick={() => setStep('welcome')}>Back</button>
        </>}

        {step === 'create-warn' && <>
          <h1 className="onboard-title">Save your recovery phrase</h1>
          <p className="onboard-sub">The {phraseLen} words below are the only way to restore your wallet. Anyone with these words has full access. Never share them, never store online.</p>
          <ul className="warn-list">
            <li>Write them down on paper</li>
            <li>Keep them somewhere safe and private</li>
            <li>Thanos team will never ask for this phrase</li>
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('create-length')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => setStep('create-show')}>I understand</button>
          </div>
        </>}

        {step === 'create-show' && <>
          <h1 className="onboard-title">Your recovery phrase</h1>
          <p className="onboard-sub">Write these {phraseLen} words down in order. You'll confirm them next.</p>
          <div className="seed-grid">
            {seed.map((w, i) => (
              <div key={i} className="seed-word">
                <span className="seed-num">{i + 1}.</span>
                <span style={{ userSelect: 'text' }}>{w}</span>
              </div>
            ))}
          </div>
          <button className="btn-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={copySeed}>
            {copiedSeed ? <><Check size={14}/> Copied to clipboard</> : <><Copy size={14}/> Copy phrase</>}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('create-warn')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={goToVerify}>I've saved it</button>
          </div>
        </>}

        {step === 'create-confirm' && <>
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
                  <span className="seed-slot-word">{picked ?? ' '}</span>
                </div>
              );
            })}
          </div>
          <div className="seed-pool">
            {verifyPool.map((w, i) => (
              <button
                key={`${w}-${i}`}
                type="button"
                className="seed-pool-chip"
                onClick={() => pickWord(w)}
              >
                {w}
              </button>
            ))}
          </div>
          {orderMismatch && <div className="onboard-err">Order doesn't match. Tap slots to undo and try again.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('create-show')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={!allConfirmed} onClick={() => setStep('create-pwd')}>Continue</button>
          </div>
        </>}

        {(step === 'create-pwd' || step === 'import-pwd') && <>
          <h1 className="onboard-title">Set a password</h1>
          <p className="onboard-sub">Used to unlock your wallet on this device. Min 8 characters.</p>
          <input className="field-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 10 }}/>
          <input className="field-input" type="password" placeholder="Confirm password" value={password2} onChange={e => setPassword2(e.target.value)}/>
          {password && password.length < 8 && <div className="onboard-err">Min 8 characters</div>}
          {password && password2 && password !== password2 && <div className="onboard-err">Passwords don't match</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep(step === 'create-pwd' ? 'create-confirm' : 'import')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={password.length < 8 || password !== password2} onClick={step === 'create-pwd' ? finishCreate : finishImport}>
              {step === 'create-pwd' ? 'Create wallet' : 'Import wallet'}
            </button>
          </div>
        </>}

        {step === 'import' && <>
          <h1 className="onboard-title">Import wallet</h1>
          <p className="onboard-sub">Paste your 12, 15, 18, 21, or 24-word recovery phrase.</p>
          <textarea className="field-input" style={{ height: 100, resize: 'none', fontFamily: 'Geist Mono, monospace', fontSize: 12 }} placeholder="word1 word2 word3 …" value={importInput} onChange={e => setImportInput(e.target.value)}/>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{importInput.trim().split(/\s+/).filter(Boolean).length} words</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('welcome')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={![12,15,18,21,24].includes(importInput.trim().split(/\s+/).filter(Boolean).length)} onClick={() => setStep('import-pwd')}>Continue</button>
          </div>
        </>}

        {step === 'unlock' && <>
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
              placeholder="Enter password"
            />
            <button type="button" className="input-trail-btn" onClick={() => setShowPwd(s => !s)} aria-label={showPwd ? 'Hide' : 'Show'} tabIndex={-1}>
              {showPwd ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          </div>
          {unlockErr && <div className="onboard-err">{unlockErr}</div>}
          <button className="btn-primary onboard-btn btn-pill" onClick={tryUnlock} disabled={!unlockPwd}>Unlock</button>
          <div className="onboard-footer">
            <p className="footer-text">Can't login? You can erase your current wallet and set up a new one</p>
            <button className="footer-link" onClick={resetWallet}>Reset wallet</button>
          </div>
        </>}
      </div>
    </div>
  );
}

export function useWalletGate() {
  const [unlocked, setUnlocked] = useState(false);
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [walletSeed, setWalletSeed] = useState<string[]>([]);

  useEffect(() => {
    const has        = localStorage.getItem(STORAGE.hasVault) === '1';
    const isUnlocked = localStorage.getItem(STORAGE.unlocked) === '1';
    const mnem       = localStorage.getItem(STORAGE.mnemonic);
    setHasVault(has);
    // Auto-unlock on refresh: if the user previously unlocked, restore the
    // seed from localStorage and skip the password prompt. Lock / Reset
    // explicitly clear `unlocked`, so this is safe.
    if (has && isUnlocked && mnem) {
      setWalletSeed(mnem.split(' '));
      setUnlocked(true);
    }
  }, []);

  const lock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    localStorage.removeItem(STORAGE.unlocked);
  };
  const onComplete = (seed: string[]) => {
    setWalletSeed(seed);
    setHasVault(true);
    setUnlocked(true);
    localStorage.setItem(STORAGE.unlocked, '1');
  };
  const evmAddress = walletSeed.length ? deriveEvmAddress(walletSeed) : '0x0000…0000';

  return { unlocked, hasVault, walletSeed, evmAddress, lock, onComplete };
}
