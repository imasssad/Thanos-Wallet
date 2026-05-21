'use client';
/**
 * Security signals for the dashboard — backup status + connected dApps.
 *
 * Both rows read REAL state: the backup flag from the vault (set after
 * the create-flow verification step / on import), and the live
 * WalletConnect session count when the kit is already initialised this
 * session (we never boot WalletConnect just to render this).
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ShieldAlert, Link2, ChevronRight } from 'lucide-react';
import { isSeedBackedUp } from '../lib/vault';
import { getActiveSessionCountIfReady } from '../lib/walletconnect';

export function SecurityPanel() {
  const router = useRouter();
  const [backedUp, setBackedUp] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<number | null>(null);

  useEffect(() => {
    setBackedUp(isSeedBackedUp());
    getActiveSessionCountIfReady().then(setSessions).catch(() => setSessions(null));
  }, []);

  // Don't flash the panel before we know the backup state.
  if (backedUp === null) return null;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
        color: 'var(--text-muted)', padding: '12px 16px 4px',
      }}>
        Security
      </div>

      {/* Backup status */}
      <button
        onClick={() => router.push('/app/settings')}
        style={rowStyle(true)}
      >
        <div style={iconWrap(backedUp ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)')}>
          {backedUp
            ? <ShieldCheck size={18} color="var(--green, #10b981)"/>
            : <ShieldAlert size={18} color="#f59e0b"/>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {backedUp ? 'Recovery phrase backed up' : 'Back up your recovery phrase'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {backedUp
              ? 'Your wallet can be restored from your phrase.'
              : 'Export and store it safely — it’s the only way to restore.'}
          </div>
        </div>
        {!backedUp && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            padding: '3px 7px', borderRadius: 6,
            background: 'rgba(245,158,11,0.16)', color: '#f59e0b',
          }}>ACTION</span>
        )}
        <ChevronRight size={18} color="var(--text-muted)"/>
      </button>

      {/* Connected apps */}
      <button
        onClick={() => router.push('/app/permissions')}
        style={rowStyle(false)}
      >
        <div style={iconWrap('rgba(59,122,247,0.14)')}>
          <Link2 size={18} color="var(--blue)"/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Connected apps</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {sessions === null
              ? 'Manage dApps that can request signatures.'
              : sessions === 0
                ? 'No apps connected.'
                : `${sessions} app${sessions === 1 ? '' : 's'} connected.`}
          </div>
        </div>
        <ChevronRight size={18} color="var(--text-muted)"/>
      </button>
    </div>
  );
}

function rowStyle(hasBorder: boolean): React.CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 16px', background: 'transparent', border: 'none',
    borderBottom: hasBorder ? '1px solid var(--border-subtle)' : 'none',
    cursor: 'pointer', textAlign: 'left', color: 'inherit',
  };
}

function iconWrap(bg: string): React.CSSProperties {
  return {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
