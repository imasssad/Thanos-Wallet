'use client';
/**
 * Permissions Manager — the wallet's connected dApps: every active
 * WalletConnect v2 session, with the dApp's metadata (name, origin, icon) and
 * a Disconnect button that calls walletkit.disconnectSession(topic).
 *
 * Token allowances used to be a second tab, but the scan only knew Makalu's
 * tokens and spenders — gone with Makalu (2026-09-29). Allowances on
 * Lithosphere Mainnet and the EVM chains are a follow-up: they need a
 * known-spender list per chain or an explorer-side API.
 */
import React, { useEffect, useState } from 'react';
import {
  Globe, RefreshCw, ExternalLink, AlertTriangle, Loader2,
  Power, Plug,
} from 'lucide-react';
import {
  getActiveSessions, disconnectSession,
} from '../lib/walletconnect';
import type { SessionTypes } from '@walletconnect/types';

function truncate(addr: string, head = 10, tail = 6): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function PermissionsView() {
  return (
    <div className="main-area settings-view">
      <div className="settings-wrap">
        <header className="settings-hero">
          <h1 className="settings-hero-title">Permissions</h1>
          <p className="settings-hero-sub">
            Every app connected to your wallet. Disconnect anything you no
            longer use.
          </p>
        </header>

        <SessionsPanel/>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Connected dApps panel
   ────────────────────────────────────────────────────────────────────── */

interface DAppRow {
  topic:    string;
  name:     string;
  url:      string;
  icon:     string | null;
  /** Comma-separated EIP-155 chain ids the session covers. */
  chains:   string;
  /** ISO timestamp of session expiry. */
  expires:  string | null;
}

/* dApp `url` + `icon` come from UNTRUSTED WalletConnect session metadata (an
 * attacker's dApp sets them). Sanitize them at this projection boundary:
 *  - url: only http(s) may reach the rendered <a href>. A malicious dApp could
 *    set url = "javascript:…"; because the app CSP allows script-src
 *    'unsafe-inline', clicking such an anchor WOULD execute in the wallet origin
 *    (a stored-then-clicked XSS with access to localStorage/session). We drop
 *    any non-http(s) scheme (javascript:, data:, vbscript:, file:, …).
 *  - icon: only https may reach the <img src> (blocks data:/blob:/javascript:).
 *    An <img> can't execute script, but this stops it being used as a tracking
 *    beacon or an inert-but-spoofed data: payload — defense-in-depth. */
function safeHttpUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const proto = new URL(url).protocol;
    return proto === 'http:' || proto === 'https:' ? url : '';
  } catch { return ''; }
}
function safeHttpsIcon(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; }
  catch { return null; }
}

function projectSession(s: SessionTypes.Struct): DAppRow {
  const peer = s.peer?.metadata ?? { name: 'Unknown dApp', url: '', icons: [] as string[] };
  const chains = s.namespaces?.eip155?.chains ?? [];
  const ts = typeof s.expiry === 'number' ? new Date(s.expiry * 1000).toISOString() : null;
  return {
    topic:   s.topic,
    name:    peer.name || 'Unknown dApp',
    url:     safeHttpUrl(peer.url),
    icon:    safeHttpsIcon(Array.isArray(peer.icons) ? peer.icons[0] : null),
    chains:  chains.join(', ') || '—',
    expires: ts,
  };
}

function SessionsPanel() {
  const [rows, setRows]       = useState<DAppRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyTopic, setBusy]  = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const map = await getActiveSessions();
      const projected = Object.values(map).map(projectSession);
      setRows(projected);
    } catch (e) {
      setError((e as Error).message || 'Failed to load WalletConnect sessions');
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const disconnect = async (topic: string) => {
    setBusy(topic); setError(null);
    try {
      await disconnectSession(topic);
      setRows(prev => prev?.filter(r => r.topic !== topic) ?? prev);
    } catch (e) {
      setError((e as Error).message || 'Disconnect failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <div className="settings-section-icon"><Globe size={18} strokeWidth={2}/></div>
        <div>
          <h2 className="settings-section-title">Connected apps</h2>
          <p className="settings-section-sub">
            Active WalletConnect sessions. Disconnect anything you don't recognise.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined}/>
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      <div className="settings-card" style={{ padding: 0 }}>
        {error && (
          <div style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--red)', fontSize: 12, borderBottom: '1px solid var(--border-subtle)',
          }}>
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        {loading && !rows && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }}/>
            <div style={{ marginTop: 6 }}>Loading sessions…</div>
          </div>
        )}

        {!loading && rows && rows.length === 0 && (
          <EmptyState
            icon={Plug}
            title="No connected apps"
            message="Open a dApp's Connect Wallet button and choose WalletConnect to pair."
            tight
          />
        )}

        {rows && rows.length > 0 && rows.map((row) => (
          <div key={row.topic} style={rowStyle}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, overflow: 'hidden',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {row.icon
                ? <img src={row.icon} alt="" width={36} height={36} style={{ objectFit: 'cover' }}/>
                : <Globe size={18} color="var(--text-muted)"/>}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</span>
              </div>
              {row.url && (
                <a
                  href={row.url}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none', wordBreak: 'break-all' }}
                >
                  {row.url}
                </a>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Chains: <span style={{ fontFamily: 'Geist Mono, monospace' }}>{row.chains}</span>
                {row.expires && (
                  <> · Expires {new Date(row.expires).toLocaleDateString()}</>
                )}
              </div>
            </div>
            <button
              onClick={() => disconnect(row.topic)}
              disabled={busyTopic === row.topic}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 8,
                background: busyTopic === row.topic ? 'var(--bg-elevated)' : 'transparent',
                border: '1px solid var(--red)',
                color: 'var(--red)', fontSize: 12, fontWeight: 700,
                cursor: busyTopic === row.topic ? 'not-allowed' : 'pointer',
                opacity: busyTopic === row.topic ? 0.6 : 1,
                minWidth: 110, justifyContent: 'center',
              }}
              title="End this WalletConnect session"
            >
              {busyTopic === row.topic
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> Disconnecting</>
                : <><Power size={13}/> Disconnect</>}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Shared bits
   ────────────────────────────────────────────────────────────────────── */

function EmptyState({
  icon: Icon, title, message, tight,
}: { icon: React.ElementType; title: string; message: string; tight?: boolean }) {
  return (
    <div style={{
      padding: tight ? '30px 20px' : '60px 20px',
      textAlign: 'center', color: 'var(--text-muted)',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 48, height: 48, borderRadius: 12, marginBottom: 10,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      }}>
        <Icon size={20} color="var(--text-muted)"/>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 4, maxWidth: 320, marginInline: 'auto' }}>{message}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '14px 16px',
  borderBottom: '1px solid var(--border-subtle)',
};

const pillUnlimited: React.CSSProperties = {
  fontSize: 9, letterSpacing: 1, padding: '2px 6px',
  background: 'rgba(245, 158, 11, 0.15)',
  color: 'var(--orange, #f59e0b)',
  borderRadius: 4, fontWeight: 700,
};
