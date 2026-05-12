'use client';
/**
 * WalletConnect pairing + session-proposal approval modal.
 *
 * Flow:
 *   1. User pastes a wc:... URI from the dApp (or scans the QR — scanner
 *      integration is mobile-only for now).
 *   2. We call pair(uri); the WalletKit relay fires a `session_proposal`
 *      event with the dApp metadata + requested namespaces.
 *   3. We show the approval card: dApp name, origin, chains, methods.
 *   4. On approve, the dApp gets the wallet account; future signing
 *      requests come in via session_request events handled in the parent
 *      WalletConnectHost.
 */
import React, { useEffect, useState } from 'react';
import { useWallet } from './shell/AppShell';
import {
  approveSession, rejectSession, pair, onSessionProposal,
} from '../lib/walletconnect';
import type { WalletKitTypes } from '@reown/walletkit';
import { Globe } from 'lucide-react';

export function WalletConnectModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const evm    = wallet?.evmAddress || '';

  const [uri, setUri]               = useState('');
  const [pairing, setPairing]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [proposal, setProposal]     = useState<WalletKitTypes.SessionProposal | null>(null);

  // Subscribe to incoming proposals while this modal is mounted.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    onSessionProposal((p) => { setProposal(p); setPairing(false); })
      .then(fn => { unsub = fn; })
      .catch(() => {});
    return () => { if (unsub) unsub(); };
  }, []);

  const onPair = async () => {
    if (!uri.trim()) return;
    setError(null);
    setPairing(true);
    try {
      await pair(uri);
      // The session_proposal listener above will fire shortly afterwards.
    } catch (e) {
      setError((e as Error).message || 'Failed to pair');
      setPairing(false);
    }
  };

  const onApprove = async () => {
    if (!proposal || !evm) return;
    try {
      await approveSession(proposal.id, evm);
      setProposal(null);
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Approval failed');
    }
  };

  const onReject = async () => {
    if (!proposal) return;
    try { await rejectSession(proposal.id); } catch {}
    setProposal(null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{proposal ? 'Connection request' : 'WalletConnect'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Step 1: URI input */}
        {!proposal && (
          <div className="modal-body">
            <label className="field-label">Pairing URI</label>
            <input
              className="field-input"
              placeholder="wc:..."
              value={uri}
              onChange={e => setUri(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}
              autoFocus
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Copy the wc:... URI from the dApp's WalletConnect modal, or scan
              its QR code with your phone and paste here.
            </div>
            {error && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>
            )}
            <button
              className="btn-primary"
              style={{ marginTop: 18 }}
              disabled={!uri.trim() || pairing}
              onClick={onPair}
            >
              {pairing ? 'Pairing…' : 'Pair'}
            </button>
          </div>
        )}

        {/* Step 2: Proposal approval */}
        {proposal && (
          <div className="modal-body">
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 8, padding: '4px 0 12px',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: 'rgba(59,122,247,0.14)',
                border: '1px solid rgba(59,122,247,0.30)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Globe size={26} color="var(--blue)"/>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {proposal.params.proposer.metadata.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', textAlign: 'center', wordBreak: 'break-all' }}>
                {proposal.params.proposer.metadata.url}
              </div>
            </div>

            <div className="card" style={{ padding: 12, marginTop: 6, fontSize: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: 'var(--text-muted)', marginBottom: 6 }}>
                THIS APP WILL BE ABLE TO
              </div>
              <div style={{ lineHeight: 1.55 }}>
                • View your wallet address &amp; balance<br/>
                • Request approvals for transactions &amp; signatures<br/>
                • Send LITHO &amp; LEP100 transfers (only when you approve each one)
              </div>
            </div>

            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              padding: '8px 10px', marginTop: 10,
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              fontFamily: 'Geist Mono, monospace',
              wordBreak: 'break-all',
            }}>
              {evm}
            </div>

            {error && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={onReject}>Reject</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={onApprove}>Connect</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
