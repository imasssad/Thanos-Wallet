'use client';
import React, { useState, useMemo } from 'react';
import { TOKENS } from '../lib/tokens';
import { useWallet } from './shell/AppShell';
import {
  validateAddressForChain, resolveToEvm, truncateLithoAddress,
  MAKALU_CHAIN_ID,
} from '../lib/address';

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

export function SendModal({ onClose }: { onClose: () => void }) {
  const [coin, setCoin] = useState('LITHO');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState(false);
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

  if (sent) return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-success">
        <div className="success-icon">✓</div>
        <div className="success-title">Transaction Sent</div>
        <div className="success-sub">{amount} {coin} sent to {truncateLithoAddress(to.trim(), 10, 6)}</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

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
        {/* Address feedback: show format detected + canonical EVM equivalent */}
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
        <div className="fee-row"><span>Network fee</span><span>~$1.24 (Fast)</span></div>
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!recipientValidation.valid || !amount}
          onClick={() => setSent(true)}
        >
          Send {coin}
        </button>
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

  // Derive swap rates from the canonical USD prices in lib/tokens.ts.
  // Real swap routing goes through MultX (https://bridge.litho.ai) — this
  // is just the indicative quote used in the mock modal until that's wired.
  const priceOf = (sym: string) => TOKENS.find(t => t.sym === sym)?.priceUsd ?? 1;
  const rate = priceOf(from) / priceOf(to);
  const out = rate * parseFloat(amt || '0');

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
            {out.toFixed(4)}
          </div>
        </div>
        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</span>
        </div>
        <div className="fee-row"><span>Network fee</span><span>~$2.10</span></div>
        <button className="btn-primary" style={{ marginTop: 18 }}>Swap {from} → {to}</button>
      </div>
    </Modal>
  );
}
