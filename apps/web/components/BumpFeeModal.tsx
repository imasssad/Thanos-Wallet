'use client';
/**
 * Replace-by-fee modal — bump a pending BTC tx's fee.
 *
 * Reads the snapshot stored on the PendingTx (inputs/outputs/old feeRate),
 * accepts a new sat/vB rate, builds a replacement PSBT via
 * replaceBitcoinTx, broadcasts, and updates the tx store so the original
 * is marked 'replaced' and the new one becomes the live pending tx.
 *
 * UX rules:
 *   - new rate must be strictly greater than the original (BIP125 §6)
 *   - default suggestion = original rate + max(2 sat/vB, 25%)
 *   - if the bump would consume more than the change output allows, the
 *     replaceBitcoinTx call throws 'insufficient' and the user sees it
 */
import React, { useMemo, useState } from 'react';
import { useWallet } from './shell/AppShell';
import { replaceBitcoinTx, BitcoinSendError, bitcoinExplorerUrl } from '../lib/bitcoin';
import { recordPendingTx, markReplaced, type PendingTx } from '../lib/tx-store';

interface Props {
  pending: PendingTx;
  onClose: () => void;
}

export function BumpFeeModal({ pending, onClose }: Props) {
  const wallet = useWallet();

  // Original snapshot is required to bump.
  const snap = pending.btc;

  const suggestedRate = useMemo(() => {
    if (!snap) return 0;
    return Math.max(snap.feeRateSatPerVb + 2, Math.ceil(snap.feeRateSatPerVb * 1.25));
  }, [snap]);

  const [rate, setRate] = useState(String(suggestedRate));
  const [stage, setStage] = useState<'compose' | 'broadcasting' | 'done' | 'failed'>('compose');
  const [newHash, setNewHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!snap) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-box" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-title">Bump fee</span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <div style={{ fontSize: 13, color: 'var(--red)' }}>
              This pending tx has no replaceable snapshot. Older entries pre-dating
              the RBF rollout can't be bumped from the wallet.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const newRate = Math.max(0, parseInt(rate || '0', 10));
  const tooLow = newRate <= snap.feeRateSatPerVb;
  const estVbytes = snap.vbytes;
  const newFeeSats = estVbytes * newRate;
  const bumpSats = Math.max(0, newFeeSats - snap.feeSats);

  const onSubmit = async () => {
    if (!wallet?.seed?.length && !wallet?.privateKey) {
      setErr('Wallet is locked. Please refresh and unlock.');
      setStage('failed');
      return;
    }
    if (tooLow) {
      setErr(`New rate must be greater than ${snap.feeRateSatPerVb} sat/vB`);
      return;
    }
    const source = wallet.privateKey
      ? { kind: 'privateKey' as const, privateKey: wallet.privateKey }
      : { kind: 'mnemonic'   as const, mnemonic: wallet.seed.join(' ') };

    setStage('broadcasting');
    setErr(null);
    try {
      const { hash, snapshot: newSnap } = await replaceBitcoinTx({
        source,
        snapshot:           snap,
        newFeeRateSatPerVb: newRate,
      });
      // Bookkeeping: original becomes 'replaced', new tx becomes the live
      // pending one (and is itself bumpable).
      markReplaced(pending.id, hash);
      recordPendingTx({
        id:          hash,
        chain:       'bitcoin',
        symbol:      'BTC',
        recipient:   snap.recipient,
        amount:      pending.amount,
        status:      'broadcast',
        broadcastAt: Date.now(),
        updatedAt:   Date.now(),
        btc:         newSnap,
      });
      setNewHash(hash);
      setStage('done');
    } catch (e) {
      const msg = e instanceof BitcoinSendError ? e.message : (e as Error).message || 'Bump failed';
      setErr(msg);
      setStage('failed');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Bump fee</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {stage === 'done' && newHash ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 0' }}>
              <div style={{ fontSize: 28, color: 'var(--green)' }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Replacement broadcast</div>
              <a
                href={bitcoinExplorerUrl(newHash)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace' }}
              >
                {newHash}
              </a>
              <button className="btn-primary" style={{ marginTop: 10 }} onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <div className="fee-row">
                <span>Recipient</span>
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>
                  {snap.recipient.slice(0, 10)}…{snap.recipient.slice(-6)}
                </span>
              </div>
              <div className="fee-row">
                <span>Amount</span>
                <span>{(snap.amountSats / 1e8).toFixed(8)} BTC</span>
              </div>
              <div className="fee-row">
                <span>Original rate</span>
                <span>{snap.feeRateSatPerVb} sat/vB</span>
              </div>
              <div className="fee-row">
                <span>Original fee</span>
                <span>{(snap.feeSats / 1e8).toFixed(8)} BTC</span>
              </div>

              <label className="field-label" style={{ marginTop: 14 }}>New fee rate (sat/vB)</label>
              <input
                className="field-input"
                type="number"
                value={rate}
                onChange={e => setRate(e.target.value)}
                placeholder={String(suggestedRate)}
              />
              {tooLow && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                  Must be greater than {snap.feeRateSatPerVb} sat/vB
                </div>
              )}

              <div className="fee-row" style={{ marginTop: 14 }}>
                <span>New fee</span>
                <span>{(newFeeSats / 1e8).toFixed(8)} BTC</span>
              </div>
              <div className="fee-row">
                <span>Cost of bump</span>
                <span>{(bumpSats / 1e8).toFixed(8)} BTC</span>
              </div>

              {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{err}</div>}

              <button
                className="btn-primary"
                style={{ marginTop: 18 }}
                disabled={tooLow || stage === 'broadcasting'}
                onClick={onSubmit}
              >
                {stage === 'broadcasting' ? 'Broadcasting…' : 'Replace with higher fee'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
