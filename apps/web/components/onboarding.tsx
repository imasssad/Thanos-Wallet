'use client';
import React, { useEffect, useState } from 'react';
import { Wallet, HDNodeWallet, Mnemonic } from 'ethers';
import {
  Wallet as WalletIcon, ChevronLeft, Eye, EyeOff, Copy, Check,
  AlertTriangle, Lock,
} from 'lucide-react';

const STORAGE = {
  hasVault:  'thanos.has_vault',
  mnemonic:  'thanos.mnemonic',
  password:  'thanos.password',
};

function generateMnemonic(): string[] {
  return Wallet.createRandom().mnemonic!.phrase.split(' ');
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

type Step = 'welcome' | 'create-warn' | 'create-show' | 'create-confirm' | 'create-pwd'
          | 'import' | 'import-pwd' | 'unlock';

export function OnboardingFlow({ hasVault, onComplete }: { hasVault: boolean; onComplete: (seed: string[]) => void }) {
  const [step, setStep] = useState<Step>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
  const [verifyOrder, setVerifyOrder] = useState<string[]>([]);
  const [verifyPool, setVerifyPool]   = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);

  const startCreate = () => { setSeed(generateMnemonic()); setStep('create-warn'); };
  const goToVerify = () => {
    setVerifyOrder([]);
    setVerifyPool([...seed].sort(() => Math.random() - 0.5));
    setStep('create-confirm');
  };
  const pickWord = (w: string) => {
    setVerifyOrder(prev => [...prev, w]);
    setVerifyPool(prev => {
      const i = prev.indexOf(w);
      return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)];
    });
  };
  const unpickAt = (slotIdx: number) => {
    const w = verifyOrder[slotIdx];
    if (w === undefined) return;
    setVerifyOrder(prev => prev.filter((_, i) => i !== slotIdx));
    setVerifyPool(prev => [...prev, w]);
  };
  const allConfirmed = verifyOrder.length === seed.length
                     && verifyOrder.every((w, i) => w === seed[i]);
  const orderMismatch = verifyOrder.length === seed.length && !allConfirmed;

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

        {step === 'create-warn' && <>
          <h1 className="onboard-title">Save your recovery phrase</h1>
          <p className="onboard-sub">12 words below are the only way to restore your wallet. Anyone with these words has full access. Never share them, never store online.</p>
          <ul className="warn-list">
            <li>Write them down on paper</li>
            <li>Keep them somewhere safe and private</li>
            <li>Thanos team will never ask for this phrase</li>
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('welcome')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => setStep('create-show')}>I understand</button>
          </div>
        </>}

        {step === 'create-show' && <>
          <h1 className="onboard-title">Your recovery phrase</h1>
          <p className="onboard-sub">Write these 12 words down in order. You'll confirm them next.</p>
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
          <p className="onboard-sub">Tap the words in the correct order. Tap a filled slot to undo.</p>
          <div className="seed-grid">
            {Array.from({ length: seed.length }).map((_, i) => {
              const w = verifyOrder[i];
              const filled = w !== undefined;
              const wrong = orderMismatch && filled && seed[i] !== w;
              return (
                <div
                  key={i}
                  className={`seed-word seed-slot${filled ? ' filled' : ''}${wrong ? ' wrong' : ''}`}
                  onClick={() => filled && unpickAt(i)}
                >
                  <span className="seed-num">{i + 1}.</span>
                  <span className="seed-slot-word">{filled ? w : ' '}</span>
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
    setHasVault(localStorage.getItem(STORAGE.hasVault) === '1');
  }, []);

  const lock = () => { setUnlocked(false); setWalletSeed([]); };
  const onComplete = (seed: string[]) => {
    setWalletSeed(seed);
    setHasVault(true);
    setUnlocked(true);
  };
  const evmAddress = walletSeed.length ? deriveEvmAddress(walletSeed) : '0x0000…0000';

  return { unlocked, hasVault, walletSeed, evmAddress, lock, onComplete };
}
