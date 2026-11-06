'use client';
/**
 * Native Lithic LAX on Makalu — the detail screen for its row (lib/native-lax).
 * Read through the native gateway and view-only: no Send/Receive/Swap, and no
 * price chart or market data (the LAX feeds belong to the older EVM token, a
 * different asset). Same full-screen layout as TokenDetailModal.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { NATIVE_LAX, NATIVE_LITHIC_GATEWAY } from '@thanos/sdk-core';
import type { NativeLaxState } from '../lib/native-lax';
import { TokenIcon } from './TokenIcon';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</span>
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function NativeAssetModal({ state, onClose }: { state: NativeLaxState | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const body = (
    <div className="token-detail-screen" data-testid="native-asset">
      <div className="token-detail-topbar">
        <button className="token-detail-back" onClick={onClose} aria-label="Back">
          <ArrowLeft size={20}/>
        </button>
        <TokenIcon sym={NATIVE_LAX.symbol} color="#a3e635" size={28}/>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {NATIVE_LAX.name} ({NATIVE_LAX.symbol})
        </span>
      </div>
      <div className="token-detail-scroll">
        <div className="token-detail-inner">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Your balance</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'Geist Mono, monospace' }}>
            {state?.ok ? `${state.text} ${NATIVE_LAX.symbol}` : state ? 'Unavailable' : '…'}
          </div>
          {state && !state.ok && (
            <div style={{ fontSize: 12, color: 'var(--red, #f87171)', marginTop: 4 }}>Couldn’t read the balance: {state.error}</div>
          )}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 18px', lineHeight: 1.5 }}>
            A native Lithic token on Makalu (testnet). View only — sending native LAX isn’t available in Thanos yet.
            This is not the older LAX token on Makalu (0x1Cde…4B8d).
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Token details</div>
          <DetailRow label="Network">Lithosphere Makalu</DetailRow>
          <DetailRow label="Native contract"><span style={{ fontFamily: 'Geist Mono, monospace' }}>{short(NATIVE_LAX.nativeTarget)}</span></DetailRow>
          <DetailRow label="Read through"><span style={{ fontFamily: 'Geist Mono, monospace' }}>Native gateway {short(NATIVE_LITHIC_GATEWAY)}</span></DetailRow>
          <DetailRow label="Token decimal">{NATIVE_LAX.decimals}</DetailRow>
          {state?.ok && <DetailRow label="Read at block">{Number(state.read.blockHeight).toLocaleString('en-US')}</DetailRow>}
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}
