'use client';
/**
 * Connect-a-Ledger modal.
 *
 * Walks the user through:
 *   1. Plug in + unlock the Ledger, open the Ethereum app
 *   2. Click "Connect" — browser prompts for USB device picker
 *   3. Show the derived account address (and a small set of derivations
 *      the user can pick from)
 *   4. Save the chosen account to localStorage as the active Ledger
 *      account — the wallet can then use it as a signing path instead
 *      of the in-vault mnemonic.
 *
 * Saved key: 'thanos.ledger_account' → { address, path, publicKey }.
 * The send/swap flows read this to decide whether to use the vault or
 * the hardware signer (wiring of that branch happens in the follow-up).
 */
import React, { useState } from 'react';
import { discoverAccounts, disconnect, LedgerError, type LedgerAccount } from '../lib/ledger';
import { Wallet as WalletIcon } from 'lucide-react';

const STORAGE_KEY = 'thanos.ledger_account';

export function getActiveLedgerAccount(): LedgerAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LedgerAccount) : null;
  } catch {
    return null;
  }
}

export function setActiveLedgerAccount(acc: LedgerAccount | null): void {
  if (typeof window === 'undefined') return;
  if (acc) localStorage.setItem(STORAGE_KEY, JSON.stringify(acc));
  else     localStorage.removeItem(STORAGE_KEY);
}

export function LedgerModal({ onClose }: { onClose: () => void }) {
  const [stage, setStage]     = useState<'idle' | 'connecting' | 'picker' | 'done'>('idle');
  const [error, setError]     = useState<string | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [active, setActive]   = useState<LedgerAccount | null>(getActiveLedgerAccount());

  const onConnect = async () => {
    setError(null);
    setStage('connecting');
    try {
      const accs = await discoverAccounts(5);
      setAccounts(accs);
      setStage('picker');
    } catch (e) {
      const msg = e instanceof LedgerError ? e.message : (e as Error).message || 'Failed to connect';
      setError(msg);
      setStage('idle');
    }
  };

  const onPick = (acc: LedgerAccount) => {
    setActiveLedgerAccount(acc);
    setActive(acc);
    setStage('done');
  };

  const onDisconnect = async () => {
    setActiveLedgerAccount(null);
    setActive(null);
    setAccounts([]);
    await disconnect().catch(() => {});
    setStage('idle');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Ledger</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Active account, if any */}
          {active && stage !== 'picker' && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: 'var(--text-muted)' }}>CONNECTED</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Ledger · {active.path}</div>
              <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                {active.address}
              </div>
              <button className="btn-outline" style={{ width: '100%', marginTop: 10 }} onClick={onDisconnect}>
                Disconnect
              </button>
            </div>
          )}

          {/* Stage: idle */}
          {stage === 'idle' && !active && (
            <>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 10, padding: '14px 0 6px',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'rgba(59,122,247,0.14)',
                  border: '1px solid rgba(59,122,247,0.30)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <WalletIcon size={26} color="var(--blue)"/>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Connect your Ledger</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, maxWidth: 280 }}>
                  Plug in the device, unlock it, and open the <b>Ethereum</b> app.
                  The browser will prompt you to choose the device.
                </div>
              </div>
              {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
              <button className="btn-primary" style={{ marginTop: 18 }} onClick={onConnect}>
                Connect Ledger
              </button>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                Requires Chrome / Edge / Brave (WebUSB).
                Firefox &amp; Safari users: use the desktop app.
              </div>
            </>
          )}

          {/* Stage: connecting */}
          {stage === 'connecting' && (
            <div style={{ padding: '28px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading from device…</div>
            </div>
          )}

          {/* Stage: picker */}
          {stage === 'picker' && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 8 }}>
                CHOOSE AN ACCOUNT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accounts.map((acc, i) => (
                  <button
                    key={acc.address}
                    onClick={() => onPick(acc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: 6,
                      background: 'var(--bg-card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                      fontFamily: 'Geist Mono, monospace',
                    }}>
                      {i}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {acc.address}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>m/{acc.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Stage: done */}
          {stage === 'done' && (
            <div style={{ padding: '20px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 22, color: 'var(--green)' }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Connected</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Send / swap flows will use this Ledger to sign.
              </div>
              <button className="btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
