'use client';
import React, { useState } from 'react';

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
  const [coin, setCoin] = useState('BTC');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState(false);
  const balMap: Record<string, string> = { BTC: '5.050', ETH: '94.30', SOL: '148.2', USDC: '840.00' };

  if (sent) return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-success">
        <div className="success-icon">✓</div>
        <div className="success-title">Transaction Sent</div>
        <div className="success-sub">{amount} {coin} sent to {to.slice(0,8)}…</div>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">Asset</label>
        <select className="field-select" value={coin} onChange={e => setCoin(e.target.value)}>
          {['BTC','ETH','SOL','USDC'].map(s => <option key={s}>{s}</option>)}
        </select>
        <label className="field-label" style={{ marginTop: 14 }}>Recipient address</label>
        <input className="field-input" placeholder="0x… or wallet address" value={to} onChange={e => setTo(e.target.value)}/>
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
        <button className="btn-primary" style={{ marginTop: 18 }} disabled={!to || !amount} onClick={() => setSent(true)}>
          Send {coin}
        </button>
      </div>
    </Modal>
  );
}

export function ReceiveModal({ onClose }: { onClose: () => void }) {
  const addr = '0x70cA2F2B7E3d9F1a4C8b5D2e6A0f3C9B7E1d4F2a';
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(addr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="qr-box">
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
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Your wallet address</div>
        <div className="addr-box">{addr.slice(0,20)}…{addr.slice(-8)}</div>
        <button className="btn-primary" onClick={copy} style={{ marginTop: 14, width: '100%' }}>
          {copied ? '✓ Copied!' : 'Copy Address'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
          Only send assets on the supported networks to this address.
        </div>
      </div>
    </Modal>
  );
}

export function SwapModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState('BTC');
  const [to, setTo]     = useState('ETH');
  const [amt, setAmt]   = useState('0.1');
  const rates: Record<string, Record<string, number>> = {
    BTC: { ETH: 16.22, SOL: 543.2, USDC: 63200 },
    ETH: { BTC: 0.0617, SOL: 33.49, USDC: 3892 },
    SOL: { BTC: 0.00184, ETH: 0.0299, USDC: 116.2 },
  };
  const out = (rates[from]?.[to] ?? 1) * parseFloat(amt || '0');

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={from} onChange={e => setFrom(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['BTC','ETH','SOL'].map(s => <option key={s}>{s}</option>)}
          </select>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
        </div>
        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="field-select" value={to} onChange={e => setTo(e.target.value)} style={{ flex: '0 0 100px' }}>
            {['ETH','BTC','SOL','USDC'].map(s => <option key={s}>{s}</option>)}
          </select>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {out.toFixed(4)}
          </div>
        </div>
        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {(rates[from]?.[to] ?? 0).toLocaleString()} {to}</span>
        </div>
        <div className="fee-row"><span>Network fee</span><span>~$2.10</span></div>
        <button className="btn-primary" style={{ marginTop: 18 }}>Swap {from} → {to}</button>
      </div>
    </Modal>
  );
}
