'use client';
import React, { useEffect, useState } from 'react';
import { HDNodeWallet, Mnemonic, Wallet, getAddress, isHexString } from 'ethers';
import { discoverTokens } from '../lib/token-discovery';
import {
  Wallet as WalletIcon, ChevronLeft, Eye, EyeOff, Copy, Check,
  AlertTriangle, Lock,
} from 'lucide-react';
import {
  createVault, openVault, openVaultWithKey,
  saveVault, loadVault, clearVault,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
  setSeedBackedUp,
} from '../lib/vault';
import { serializeSource, deserializeSource, type WalletSource } from '../lib/wallet-source';
import { initSigner, lockSigner } from '../lib/signer-client';

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
          | 'import-choose' | 'import' | 'import-pk' | 'import-pwd' | 'import-pk-pwd' | 'unlock';

/** Validate a 0x-prefixed 32-byte hex string. Returns the canonical 0x-form
 *  (lower-case body, no whitespace) and the derived checksummed address,
 *  or null on parse failure. */
function validatePrivateKey(input: string): { privateKey: string; address: string } | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!raw.startsWith('0x')) raw = '0x' + raw;
  if (!isHexString(raw, 32)) return null;
  try {
    const w = new Wallet(raw);
    return { privateKey: raw.toLowerCase(), address: getAddress(w.address) };
  } catch {
    return null;
  }
}

export function OnboardingFlow({ hasVault, onComplete }: { hasVault: boolean; onComplete: (source: WalletSource) => void }) {
  const [step, setStep] = useState<Step>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
  const [pkInput,     setPkInput]     = useState('');
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
  /** Inline form-validation error — replaces the old browser alert()s,
   *  which rendered as OS dialogs and looked badly out of place in the
   *  onboarding flow. Cleared whenever the user edits the inputs. */
  const [formErr, setFormErr] = useState('');
  /** Two-step destructive confirm for "Reset wallet" — first click arms
   *  the button, second click erases. Replaces window.confirm(). */
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  /* Seed-phrase masking on the create-show screen — the words are hidden
     30s after the user lands here, requiring a deliberate re-tap to view
     them again. Defends against shoulder-surf + a left-open laptop. */
  const [seedHidden, setSeedHidden] = useState(false);
  /* Value-prop carousel (welcome step): active slide index, synced to the
     scroll-snap position via an onScroll handler. */
  const [slide, setSlide] = useState(0);
  const OB2_SLIDES = [
    { title: 'Own your keys. Own your future.', sub: 'True self-custody — your recovery phrase never leaves this device.' },
    { title: 'One wallet. Every chain.',         sub: 'Lithosphere · Bitcoin · EVM, unified in a single Web4 wallet.' },
    { title: 'Move value without friction.',     sub: 'Hold, swap and bridge across chains — with quiet, total control.' },
  ];

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

  const [busy, setBusy] = useState(false);

  const finishCreate = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    setBusy(true);
    try {
      const source: WalletSource = { kind: 'mnemonic', mnemonic: seed.join(' ') };
      const vault = await createVault(serializeSource(source), password);
      saveVault(vault);
      // The user just passed the recovery-phrase verification step.
      setSeedBackedUp(true);
      // Session-cache the derived key so a refresh skips the password prompt.
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(source);
    } finally {
      setBusy(false);
    }
  };

  const finishImport = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) { setFormErr('Phrase must be 12, 15, 18, 21 or 24 words'); return; }
    if (!isValidMnemonic(words.join(' '))) { setFormErr('Invalid recovery phrase — check for typos'); return; }
    setFormErr('');
    setBusy(true);
    try {
      const source: WalletSource = { kind: 'mnemonic', mnemonic: words.join(' ') };
      const vault = await createVault(serializeSource(source), password);
      saveVault(vault);
      // Imported — the user already holds this recovery phrase.
      setSeedBackedUp(true);
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(source);
      // Fire-and-forget: scan the indexer for any LEP100 balances on this
      // address and persist them so the wallet renders them on first paint.
      discoverTokens(deriveEvmAddress(words)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  /** Import via raw 0x-prefixed private key — single-account wallet. */
  const finishImportPk = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    const pk = validatePrivateKey(pkInput);
    if (!pk) { setFormErr('Invalid private key — must be 0x-prefixed 32-byte hex'); return; }
    setFormErr('');
    setBusy(true);
    try {
      const source: WalletSource = { kind: 'privateKey', privateKey: pk.privateKey };
      const vault = await createVault(serializeSource(source), password);
      saveVault(vault);
      // Imported via private key — nothing to back up beyond what the user holds.
      setSeedBackedUp(true);
      const opened = await openVault(vault, password);
      if (opened) cacheSessionKey(opened.key);
      onComplete(source);
      discoverTokens(pk.address).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const tryUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setUnlockErr('');
    try {
      const vault = loadVault();
      if (!vault) {
        // Vault is missing entirely — treat as fresh install.
        setUnlockErr('No wallet found on this device. Please create or import one.');
        setStep('welcome');
        return;
      }
      const opened = await openVault(vault, unlockPwd);
      if (!opened) {
        setUnlockErr('Incorrect password');
        setUnlockPwd('');
        return;
      }
      cacheSessionKey(opened.key);
      onComplete(deserializeSource(opened.mnemonic));
    } finally {
      setBusy(false);
    }
  };

  const resetWallet = () => {
    // Two-step inline confirm — the first click arms the action and the
    // copy switches to an explicit warning; only a second click within
    // 5s erases. Replaces window.confirm(), which rendered an unstyled
    // OS dialog for the single most destructive action in the app.
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5_000);
      return;
    }
    setConfirmReset(false);
    clearVault();
    setStep('welcome');
    setUnlockPwd('');
    setUnlockErr('');
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
      setCopyErr(true);
      setTimeout(() => setCopyErr(false), 4000);
    }
  };

  return (
    <div className="onboard-wrap">
      <div className="onboard-card">
        {step !== 'welcome' && step !== 'unlock' && (
          <div className="onboard-logo">
            <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos"/>
          </div>
        )}

        {step === 'welcome' && <>
          <div className="ob2-welcome">
            <div className="ob2-mark ob2-hero">
              <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos"/>
            </div>
            <div
              className="ob2-carousel"
              onScroll={e => {
                const el = e.currentTarget;
                setSlide(Math.round(el.scrollLeft / el.clientWidth));
              }}
            >
              {OB2_SLIDES.map((s, i) => (
                <div className="ob2-slide" key={i}>
                  <div className="ob2-slide-title">{s.title}</div>
                  <div className="ob2-slide-sub">{s.sub}</div>
                </div>
              ))}
            </div>
            <div className="ob2-dots">
              {OB2_SLIDES.map((_, i) => (
                <span key={i} className={`ob2-dot${i === slide ? ' ob2-dot-active' : ''}`}/>
              ))}
            </div>
            <div className="ob2-cta">
              <button className="ob2-pill" onClick={startCreate}>Create a new wallet</button>
              <button className="ob2-ghost" onClick={() => setStep('import-choose')}>I already have a wallet</button>
            </div>
            <p className="ob2-legal">
              By continuing you agree to our{' '}
              <a href="https://thanos.fi/terms" target="_blank" rel="noopener noreferrer">Terms</a>{' '}
              and{' '}
              <a href="https://thanos.fi/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </div>
        </>}

        {step === 'import-choose' && <>
          <h1 className="onboard-title">Import wallet</h1>
          <p className="onboard-sub">Choose what you want to import.</p>
          <button
            className="btn-outline onboard-btn"
            style={{ width: '100%', textAlign: 'left', padding: '14px 16px' }}
            onClick={() => setStep('import')}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Recovery phrase</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              12–24 word BIP39 phrase · recommended
            </div>
          </button>
          <button
            className="btn-outline onboard-btn"
            style={{ width: '100%', textAlign: 'left', padding: '14px 16px', marginTop: 8 }}
            onClick={() => setStep('import-pk')}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Private key</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              0x-prefixed 32-byte hex · single account
            </div>
          </button>
          <button className="btn-link" style={{ marginTop: 14 }} onClick={() => setStep('welcome')}>Back</button>
        </>}

        {step === 'import-pk' && <>
          <h1 className="onboard-title">Import private key</h1>
          <p className="onboard-sub">Paste a 0x-prefixed 32-byte hex private key. Single-account wallet — no HD derivation.</p>
          <input
            className="field-input"
            style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}
            placeholder="0xabc123…"
            value={pkInput}
            onChange={e => setPkInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {pkInput && !validatePrivateKey(pkInput) && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>
              Not a valid private key. Must be 0x + 64 hex characters.
            </div>
          )}
          {pkInput && validatePrivateKey(pkInput) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'Geist Mono, monospace' }}>
              → {validatePrivateKey(pkInput)!.address}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('import-choose')}>Back</button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              disabled={!validatePrivateKey(pkInput)}
              onClick={() => setStep('import-pk-pwd')}
            >
              Continue
            </button>
          </div>
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
          <SeedAutoHider hidden={seedHidden} setHidden={setSeedHidden}/>
          <h1 className="onboard-title">Your recovery phrase</h1>
          <p className="onboard-sub">Write these {phraseLen} words down in order. You'll confirm them next.</p>
          <div className="seed-grid" style={{ position: 'relative' }}>
            {seed.map((w, i) => (
              <div key={i} className="seed-word">
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
                  borderRadius: 12, border: 'none',
                  color: 'var(--text-primary)', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Eye size={14}/> Tap to reveal
              </button>
            )}
          </div>
          <button className="btn-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={copySeed} disabled={seedHidden}>
            {copiedSeed ? <><Check size={14}/> Copied to clipboard</>
              : copyErr ? <>Copy unavailable — select the words manually</>
              : <><Copy size={14}/> Copy phrase</>}
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

        {(step === 'create-pwd' || step === 'import-pwd' || step === 'import-pk-pwd') && <>
          <h1 className="onboard-title">Set a password</h1>
          <p className="onboard-sub">Used to unlock your wallet on this device. Min 8 characters.</p>
          <input className="field-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ marginBottom: 10 }}/>
          <input className="field-input" type="password" placeholder="Confirm password" value={password2} onChange={e => setPassword2(e.target.value)}/>
          {password && password.length < 8 && <div className="onboard-err">Min 8 characters</div>}
          {password && password2 && password !== password2 && <div className="onboard-err">Passwords don't match</div>}
          {formErr && <div className="onboard-err">{formErr}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn-outline"
              style={{ flex: 1 }}
              onClick={() => {
                setFormErr('');
                setStep(
                  step === 'create-pwd'      ? 'create-confirm'
                  : step === 'import-pk-pwd' ? 'import-pk'
                  : 'import',
                );
              }}
            >
              Back
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              disabled={password.length < 8 || password !== password2 || busy}
              onClick={
                step === 'create-pwd'      ? finishCreate
                : step === 'import-pk-pwd' ? finishImportPk
                : finishImport
              }
            >
              {busy ? 'Encrypting…' : (
                step === 'create-pwd' ? 'Create wallet' :
                step === 'import-pk-pwd' ? 'Import key' :
                'Import wallet'
              )}
            </button>
          </div>
        </>}

        {step === 'import' && <>
          <h1 className="onboard-title">Import recovery phrase</h1>
          <p className="onboard-sub">Paste your 12, 15, 18, 21, or 24-word recovery phrase.</p>
          <textarea className="field-input" style={{ height: 100, resize: 'none', fontFamily: 'Geist Mono, monospace', fontSize: 12 }} placeholder="word1 word2 word3 …" value={importInput} onChange={e => setImportInput(e.target.value)}/>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{importInput.trim().split(/\s+/).filter(Boolean).length} words</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={() => setStep('import-choose')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={![12,15,18,21,24].includes(importInput.trim().split(/\s+/).filter(Boolean).length)} onClick={() => setStep('import-pwd')}>Continue</button>
          </div>
        </>}

        {step === 'unlock' && <>
          <div className="ob2-unlock">
            <div className="ob2-mark">
              <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos"/>
            </div>
            <h1 className="ob2-unlock-title">Welcome back</h1>
            <p className="ob2-unlock-sub">Enter your password to unlock Thanos Wallet.</p>
            <div className="ob2-unlock-form">
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
              <button className="ob2-pill" style={{ marginTop: 16 }} onClick={tryUnlock} disabled={!unlockPwd || busy}>
                {busy ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
            <div className="ob2-reset">
              <p className="ob2-reset-text">
                {confirmReset
                  ? 'This permanently deletes the wallet from this device. Restore needs your recovery phrase.'
                  : "Can't login? You can erase your current wallet and set up a new one."}
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

/**
 * Auto-hides the seed phrase 30 seconds after the create-show step
 * mounts. Lives as a separate component so it can own its own timer +
 * cleanup without re-running every render of the giant parent.
 */
function SeedAutoHider({ hidden, setHidden }: { hidden: boolean; setHidden: (v: boolean) => void }) {
  React.useEffect(() => {
    if (hidden) return;          // user manually revealed — start the timer again
    const t = setTimeout(() => setHidden(true), 30_000);
    return () => clearTimeout(t);
  }, [hidden, setHidden]);
  return null;
}

export function useWalletGate() {
  const [unlocked,         setUnlocked]         = useState(false);
  const [hasVault,         setHasVault]         = useState<boolean | null>(null);
  const [walletSeed,       setWalletSeed]       = useState<string[]>([]);
  const [walletPrivateKey, setWalletPrivateKey] = useState<string | undefined>(undefined);
  const [walletAddress,    setWalletAddress]    = useState<string>('');

  const applySource = (source: WalletSource) => {
    // Set the address synchronously for the UI.
    if (source.kind === 'mnemonic') {
      const words = source.mnemonic.split(' ');
      setWalletSeed(words);
      setWalletPrivateKey(undefined);
      setWalletAddress(deriveEvmAddress(words));
    } else {
      setWalletSeed([]);
      setWalletPrivateKey(source.privateKey);
      try {
        setWalletAddress(getAddress(new Wallet(source.privateKey).address));
      } catch {
        setWalletAddress('0x0000…0000');
      }
    }
    // Fire-and-forget: hand the secret to the signing worker. After this
    // resolves, signing flows can call signer-client without ever seeing
    // the secret on the main thread again. Failure is non-fatal — callers
    // that need the worker will surface their own error if it's unavailable.
    // Pass the active account index so the worker derives from the same
    // HD path the AppShell uses to show the user's address.
    void import('../lib/vault')
      .then(v => initSigner(source, v.getActiveAccountIndex()))
      .catch(() => { /* worker may be unsupported (SSR / old browser) */ });
  };

  useEffect(() => {
    (async () => {
      // 0) Legacy migration — if the previous plaintext mnemonic is still on
      //    disk, upgrade it to an encrypted vault silently. This runs once
      //    per browser; afterwards the plaintext keys are gone.
      if (hasLegacyPlaintext()) {
        const mig = await migrateLegacyPlaintext();
        if (mig.ok && mig.key) cacheSessionKey(mig.key);
      }

      // 1) Determine vault presence from the new storage shape.
      const vault = loadVault();
      setHasVault(!!vault);
      if (!vault) return;

      // 2) Refresh-survival: if a session-cached AES key is available,
      //    decrypt the vault without prompting. Cold open (no
      //    sessionStorage) -> user must enter password.
      const key = getSessionKey();
      if (!key) return;
      const plaintext = await openVaultWithKey(vault, key);
      if (plaintext) {
        applySource(deserializeSource(plaintext));
        setUnlocked(true);
      } else {
        // Stale / mismatched session key — wipe it so the unlock screen shows.
        clearSessionKey();
      }
    })().catch(() => { /* fail closed = show unlock screen */ });
  }, []);

  const lock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    setWalletPrivateKey(undefined);
    setWalletAddress('');
    clearSessionKey();
    // Wipe the secret from the signing worker too — otherwise it'd keep
    // signing on behalf of the locked wallet.
    void lockSigner().catch(() => { /* worker may already be torn down */ });
  };
  const onComplete = (source: WalletSource) => {
    applySource(source);
    setHasVault(true);
    setUnlocked(true);
    // Note: the session key was cached inside finishCreate / finishImport /
    // tryUnlock right after decryption. No re-cache needed here.
  };
  const evmAddress = walletAddress || '0x0000…0000';

  return { unlocked, hasVault, walletSeed, walletPrivateKey, evmAddress, lock, onComplete };
}
