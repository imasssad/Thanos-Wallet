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
import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from './shell/AppShell';
import {
  approveSession, rejectSession, pair, onSessionProposal,
} from '../lib/walletconnect';
import type { WalletKitTypes } from '@reown/walletkit';
import { Globe } from 'lucide-react';
import { classifyOrigin } from '../lib/phishing';
import { PhishingBanner } from './PhishingBanner';

export function WalletConnectModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const evm    = wallet?.evmAddress || '';

  const [uri, setUri]               = useState('');
  const [pairing, setPairing]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [proposal, setProposal]     = useState<WalletKitTypes.SessionProposal | null>(null);
  const [ackRisk, setAckRisk]       = useState(false);

  // THN-03: WalletConnect's own Verify check (proposal.verifyContext) tells
  // us whether the origin below actually matches the dApp's domain —
  // `proposal.params.proposer.metadata.url` is just a string the dApp
  // supplies and asserts nothing about. Prefer the verified origin for
  // display and for classifyOrigin; a scam-flagged origin blocks outright,
  // with no "connect anyway" override.
  const verified      = proposal?.verifyContext?.verified;
  const displayOrigin = verified?.origin || proposal?.params.proposer.metadata.url || '';
  const isScam        = verified?.isScam === true;

  /* Pre-classify the dApp URL while the user reads the connect screen. */
  const originVerdict = useMemo(() => {
    const base = displayOrigin ? classifyOrigin(displayOrigin) : null;
    if (isScam) {
      return { risk: 'critical' as const, reasons: ["WalletConnect's Verify API flags this origin as a known scam.", ...(base?.reasons ?? [])] };
    }
    if (verified?.validation === 'INVALID') {
      return {
        risk: 'critical' as const,
        reasons: ["WalletConnect could not verify this origin — it does NOT match the domain the dApp claims. Likely spoofed.", ...(base?.reasons ?? [])],
      };
    }
    if (verified?.validation === 'UNKNOWN' && (!base || base.risk === 'safe' || base.risk === 'unknown')) {
      return { risk: 'warning' as const, reasons: ["WalletConnect could not verify this dApp's origin. Treat its identity as unconfirmed.", ...(base?.reasons ?? [])] };
    }
    return base;
  }, [displayOrigin, isScam, verified?.validation]);
  const requiresAck = !isScam && (originVerdict?.risk === 'warning' || originVerdict?.risk === 'critical');

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
                {displayOrigin}
              </div>
              {verified && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {verified.validation === 'VALID' ? 'Origin verified by WalletConnect'
                    : verified.validation === 'INVALID' ? 'Origin FAILED WalletConnect verification'
                    : "Origin not verified by WalletConnect"}
                </div>
              )}
            </div>

            {originVerdict && <PhishingBanner verdict={originVerdict} hideSafe={false}/>}

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

            {requiresAck && (
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={ackRisk}
                  onChange={e => setAckRisk(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I understand the risk and want to connect to this dApp anyway.
                </span>
              </label>
            )}

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
              {/* isScam has no override — WalletConnect's Verify API matched this
                  origin against a known-malicious dApp; there's nothing to "connect
                  anyway" to (THN-03). */}
              {!isScam && (
                <button
                  className="btn-primary"
                  style={{
                    flex: 1,
                    background: originVerdict?.risk === 'critical' ? 'var(--red)' : undefined,
                    opacity: requiresAck && !ackRisk ? 0.45 : 1,
                    cursor:  requiresAck && !ackRisk ? 'not-allowed' : 'pointer',
                  }}
                  disabled={requiresAck && !ackRisk}
                  onClick={onApprove}
                >
                  {originVerdict?.risk === 'critical' ? 'Connect anyway' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
