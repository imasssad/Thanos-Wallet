'use client';
import React, { useState, useMemo, useEffect } from 'react';
import { TOKENS } from '../lib/tokens';
import { useWallet } from './shell/AppShell';
import {
  validateAddressForChain, resolveToEvm, truncateLithoAddress,
  MAKALU_CHAIN_ID,
} from '../lib/address';
import { sendTokens, estimateSendFee, SendError } from '../lib/signer';
import { getQuote as multxGetQuote, type Quote as MultXQuote, MultXUnavailable } from '../lib/multx';

const TOKEN_SYMBOLS = TOKENS.map(t => t.sym);
const BAL_MAP: Record<string, string> = Object.fromEntries(TOKENS.map(t => [t.sym, t.balance]));

export type ModalKind = 'send' | 'receive' | 'swap' | null;

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

type SendStage = 'compose' | 'broadcasting' | 'pending' | 'confirmed' | 'failed';

export function SendModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [coin, setCoin]     = useState('LITHO');
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');

  const [stage, setStage]   = useState<SendStage>('compose');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [feeStr, setFeeStr] = useState<string | null>(null);

  const balMap = BAL_MAP;

  /* Validate the recipient against the chain. For LITHO / wLITHO / FGPT
     etc. on Makalu, accept litho1… or 0x…; for anything else, EVM only. */
  const recipientValidation = useMemo(() => {
    const trimmed = to.trim();
    if (!trimmed) return { valid: false, format: null as 'evm' | 'litho' | null, reason: '' };
    return validateAddressForChain(trimmed, MAKALU_CHAIN_ID);
  }, [to]);

  /* Canonical EVM form — what we'd actually broadcast to the chain. */
  const canonicalEvm = useMemo(() => resolveToEvm(to.trim()), [to]);

  /* Live fee estimate. Re-runs (debounced) when the inputs change. Read-only,
     never broadcasts — safe to call repeatedly. */
  useEffect(() => {
    if (!wallet?.seed?.length || !recipientValidation.valid || !amount) {
      setFeeStr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const est = await estimateSendFee(wallet.seed, { symbol: coin, recipient: to, amount });
        if (!cancelled) setFeeStr(est ? `${Number(est.totalLitho).toFixed(6)} LITHO` : null);
      } catch {
        if (!cancelled) setFeeStr(null);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amount, recipientValidation.valid, wallet?.seed]);

  const onSubmit = async () => {
    if (!wallet?.seed?.length) {
      setError('Wallet is locked. Please refresh and unlock.');
      setStage('failed');
      return;
    }
    setStage('broadcasting');
    setError(null);
    try {
      const result = await sendTokens(wallet.seed, { symbol: coin, recipient: to, amount });
      setTxHash(result.hash);
      setStage('pending');
      // Background: wait for confirmation. Doesn't block the UI; user can dismiss.
      result.wait()
        .then(r => {
          setStage(r.status === 1 ? 'confirmed' : 'failed');
          if (r.status !== 1) setError('Transaction reverted on-chain');
        })
        .catch(() => setStage('failed'));
    } catch (e) {
      const msg = e instanceof SendError ? e.message : (e as Error).message || 'Failed to send';
      setError(msg);
      setStage('failed');
    }
  };

  /* ─── Result states (broadcast / pending / confirmed / failed) ───── */

  if (stage !== 'compose') {
    const explorer = txHash ? `https://makalu.litho.ai/tx/${txHash}` : null;
    return (
      <Modal title="Send" onClose={onClose}>
        <div className="modal-success">
          {stage === 'broadcasting' && <>
            <div className="success-icon" style={{ animation: 'lpScrollHint 1.4s ease-in-out infinite' }}>…</div>
            <div className="success-title">Signing &amp; broadcasting</div>
            <div className="success-sub">Sending {amount} {coin} to {truncateLithoAddress(to.trim(), 10, 6)}</div>
          </>}
          {stage === 'pending' && <>
            <div className="success-icon">✓</div>
            <div className="success-title">Submitted</div>
            <div className="success-sub">Waiting for confirmation…</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              {truncateLithoAddress(txHash, 14, 10)}
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'confirmed' && <>
            <div className="success-icon" style={{ color: 'var(--green)' }}>✓</div>
            <div className="success-title">Confirmed</div>
            <div className="success-sub">{amount} {coin} sent to {truncateLithoAddress(to.trim(), 10, 6)}</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              View on explorer →
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'failed' && <>
            <div className="success-icon" style={{ color: 'var(--red)' }}>✕</div>
            <div className="success-title">Transaction failed</div>
            <div className="success-sub" style={{ color: 'var(--red)' }}>{error || 'Unknown error'}</div>
            <button className="btn-primary" onClick={() => { setStage('compose'); setError(null); setTxHash(null); }}
              style={{ marginTop: 12 }}>Try again</button>
          </>}
        </div>
      </Modal>
    );
  }

  /* ─── Compose state ──────────────────────────────────────────────── */

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">Asset</label>
        <select className="field-select" value={coin} onChange={e => setCoin(e.target.value)}>
          {TOKEN_SYMBOLS.map(s => <option key={s}>{s}</option>)}
        </select>

        <label className="field-label" style={{ marginTop: 14 }}>Recipient address</label>
        <input
          className="field-input"
          placeholder="litho1… or 0x…"
          value={to}
          onChange={e => setTo(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{ fontFamily: to ? 'Geist Mono, monospace' : undefined, fontSize: to ? 12 : undefined }}
        />
        {to.trim() && recipientValidation.valid && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            ✓ Valid {recipientValidation.format === 'litho' ? 'litho1' : 'EVM'} address
            {recipientValidation.format === 'litho' && canonicalEvm && (
              <span style={{ color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                · {truncateLithoAddress(canonicalEvm, 8, 6)}
              </span>
            )}
          </div>
        )}
        {to.trim() && !recipientValidation.valid && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
            {recipientValidation.reason || 'Invalid address'}
          </div>
        )}

        <label className="field-label" style={{ marginTop: 14 }}>Amount</label>
        <div style={{ position: 'relative' }}>
          <input className="field-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} type="number" style={{ paddingRight: 60 }}/>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{coin}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Balance: {balMap[coin] ?? '—'} {coin}
          <button style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11, cursor: 'pointer', marginLeft: 8, fontWeight: 600 }} onClick={() => setAmount(balMap[coin] ?? '')}>MAX</button>
        </div>
        <div className="fee-row"><span>Network fee</span><span>{feeStr ? `≈ ${feeStr}` : '—'}</span></div>
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!recipientValidation.valid || !amount || !wallet?.seed?.length}
          onClick={onSubmit}
        >
          Send {coin}
        </button>
        {!wallet?.seed?.length && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>
            Wallet locked — refresh to unlock
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ReceiveModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [fmt, setFmt] = useState<'litho' | 'evm'>('litho');
  const [copied, setCopied] = useState(false);

  // Fallback used only if the gate hasn't resolved (defensive — shouldn't happen).
  const litho = wallet?.addresses?.litho ?? '';
  const evm   = wallet?.addresses?.evm   ?? '';
  const activeAddr = fmt === 'litho' ? litho : evm;

  const copy = () => {
    if (!activeAddr) return;
    navigator.clipboard?.writeText(activeAddr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        {/* Format toggle */}
        <div className="addr-fmt-toggle" role="tablist">
          <button
            className={`addr-fmt-pill ${fmt === 'litho' ? 'active' : ''}`}
            onClick={() => setFmt('litho')}
            role="tab"
          >
            litho1…
          </button>
          <button
            className={`addr-fmt-pill ${fmt === 'evm' ? 'active' : ''}`}
            onClick={() => setFmt('evm')}
            role="tab"
          >
            EVM 0x…
          </button>
        </div>

        <div className="qr-box" aria-label={`QR for ${activeAddr}`}>
          {/* Placeholder QR — replaced by a real qrcode-generated SVG in the
              follow-up commit that wires receive end-to-end. */}
          <svg viewBox="0 0 100 100" width="140" height="140">
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
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          {fmt === 'litho' ? 'Lithosphere bech32 address' : 'EVM hex address'}
        </div>
        <div className="addr-box" title={activeAddr}>
          {activeAddr ? truncateLithoAddress(activeAddr, 14, 8) : '—'}
        </div>
        <button className="btn-primary" onClick={copy} style={{ marginTop: 14, width: '100%' }} disabled={!activeAddr}>
          {copied ? '✓ Copied!' : 'Copy address'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          Both forms resolve to the same account. Only send assets on supported networks.
        </div>
      </div>
    </Modal>
  );
}

export function SwapModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('LITHO');
  const [to, setTo]     = useState('LitBTC');
  const [amt, setAmt]   = useState('100');

  /** Live MultX quote (or null while loading / unavailable). */
  const [quote, setQuote]               = useState<MultXQuote | null>(null);
  const [quoteError, setQuoteError]     = useState<string | null>(null);
  const [bridgeOffline, setBridgeOffline] = useState(false);

  // Fallback indicative rate from the canonical USD prices — used only when
  // the MultX endpoint isn't reachable, so the UI still has something to show.
  const priceOf = (sym: string) => TOKENS.find(t => t.sym === sym)?.priceUsd ?? 1;
  const fallbackRate = priceOf(from) / priceOf(to);
  const fallbackOut  = fallbackRate * parseFloat(amt || '0');

  /* Debounced quote fetch. Cancels in-flight fetches when the inputs change. */
  useEffect(() => {
    const trimmed = amt.trim();
    if (!trimmed || parseFloat(trimmed) <= 0 || from === to) {
      setQuote(null); setQuoteError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = await multxGetQuote(from, to, trimmed);
        if (!cancelled) {
          setQuote(q); setQuoteError(null); setBridgeOffline(false);
        }
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          if (e instanceof MultXUnavailable) {
            setBridgeOffline(true);
            setQuoteError('Bridge offline — showing indicative rate');
          } else {
            setQuoteError((e as Error).message || 'Quote failed');
          }
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amt]);

  const displayedRate = quote ? quote.rate : fallbackRate;
  const displayedOut  = quote ? Number(quote.toAmount) : fallbackOut;
  const feeLine = quote ? `${quote.feeFrom} ${quote.from}` : 'Rate-only preview';

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: '0 0 100px' }}>
            {TOKEN_SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
        </div>
        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={to} onChange={e => setTo(e.target.value)} style={{ flex: '0 0 100px' }}>
            {TOKEN_SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {isFinite(displayedOut) ? displayedOut.toFixed(6) : '—'}
          </div>
        </div>
        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {displayedRate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</span>
        </div>
        <div className="fee-row">
          <span>Bridge fee</span>
          <span>{feeLine}</span>
        </div>
        {(quoteError || bridgeOffline) && (
          <div style={{ fontSize: 11, color: bridgeOffline ? 'var(--text-muted)' : 'var(--red)', marginTop: 6 }}>
            {bridgeOffline ? '⚠ ' : ''}{quoteError}
          </div>
        )}
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!quote && !bridgeOffline}
          title={bridgeOffline ? 'Bridge offline — cannot execute' : ''}
        >
          {quote ? `Swap ${from} → ${to}` : (bridgeOffline ? 'Bridge offline' : 'Fetching quote…')}
        </button>
      </div>
    </Modal>
  );
}
