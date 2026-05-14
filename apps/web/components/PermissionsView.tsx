'use client';
/**
 * Permissions Manager — single page that lets the user audit and revoke
 * every external permission their wallet has granted.
 *
 * Two facets, exposed as tabs:
 *
 *   1. Token Allowances — every non-zero ERC-20 / LEP-100 spend approval
 *      the wallet has granted on Lithosphere Makalu. Each row shows the
 *      spender + amount (or "Unlimited"), with a one-click Revoke that
 *      submits an approve(spender, 0) tx. Sourced from the indexer when
 *      available, with a live RPC scan fallback (see lib/allowances.ts).
 *
 *   2. Connected dApps — every active WalletConnect v2 session. Each row
 *      shows the dApp's metadata (name, origin, icon) and a Disconnect
 *      button that calls walletkit.disconnectSession(topic).
 *
 * External-EVM-chain allowances (Ethereum mainnet etc.) are a follow-up
 * — they need a known-spender list per chain or an explorer-side API.
 */
import React, { useEffect, useState } from 'react';
import {
  Shield, Globe, RefreshCw, X, ExternalLink, AlertTriangle, Loader2,
  Power, Plug,
} from 'lucide-react';
import { useWallet } from './shell/AppShell';
import { TokenIcon } from './TokenIcon';
import { fetchTokenAllowances, type AllowanceRow } from '../lib/allowances';
import { revokeAllowance, SendError } from '../lib/signer';
import {
  getActiveSessions, disconnectSession,
} from '../lib/walletconnect';
import type { SessionTypes } from '@walletconnect/types';

const MAKALU_EXPLORER = 'https://makalu.litho.ai';

type Tab = 'allowances' | 'sessions';

function truncate(addr: string, head = 10, tail = 6): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function PermissionsView() {
  const [tab, setTab] = useState<Tab>('allowances');

  return (
    <div className="main-area settings-view">
      <div className="settings-wrap">
        <header className="settings-hero">
          <h1 className="settings-hero-title">Permissions</h1>
          <p className="settings-hero-sub">
            Audit every token allowance and connected app. Revoke anything
            you no longer use — unused approvals are the #1 source of
            wallet drain attacks.
          </p>
        </header>

        <div style={{
          display: 'inline-flex', gap: 4, padding: 4,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 12, marginBottom: 18,
        }}>
          <TabButton active={tab === 'allowances'} onClick={() => setTab('allowances')}
                     icon={Shield} label="Token allowances"/>
          <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')}
                     icon={Globe} label="Connected apps"/>
        </div>

        {tab === 'allowances' ? <AllowancesPanel/> : <SessionsPanel/>}
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, label,
}: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 8,
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--bg-surface)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 13, fontWeight: 600,
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        transition: 'background .12s ease',
      }}
    >
      <Icon size={14}/>
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Token-allowance panel
   ────────────────────────────────────────────────────────────────────── */

function AllowancesPanel() {
  const wallet = useWallet();
  const evm = wallet?.evmAddress ?? '';

  const [rows, setRows]       = useState<AllowanceRow[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    if (!evm) return;
    setLoading(true); setError(null);
    try {
      const data = await fetchTokenAllowances(evm);
      setRows(data);
    } catch (e) {
      setError((e as Error).message || 'Failed to load allowances');
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [evm]);

  const revoke = async (row: AllowanceRow) => {
    if (!wallet?.seed?.length && !wallet?.privateKey) {
      setError('Wallet is locked. Refresh and unlock to revoke.');
      return;
    }
    const key = `${row.tokenAddress}|${row.spender}`;
    setBusyKey(key); setError(null);
    try {
      const result = await revokeAllowance(
        wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
        { tokenAddress: row.tokenAddress, spender: row.spender },
      );
      // Optimistically drop the row from the list — the wait() below will
      // re-fetch the canonical state so the UI converges either way.
      setRows(prev => prev?.filter(r => !(r.tokenAddress === row.tokenAddress && r.spender === row.spender)) ?? prev);
      await result.wait();
      void load();
    } catch (e) {
      const msg = e instanceof SendError ? e.message : (e as Error).message || 'Revoke failed';
      setError(msg);
      void load();      // restore the row if we dropped it optimistically
    } finally {
      setBusyKey(null);
    }
  };

  if (!evm) {
    return <EmptyState icon={Shield} title="No wallet" message="Unlock your wallet to view allowances."/>;
  }

  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <div className="settings-section-icon"><Shield size={18} strokeWidth={2}/></div>
        <div>
          <h2 className="settings-section-title">Token allowances</h2>
          <p className="settings-section-sub">
            On Lithosphere Makalu · Tap Revoke to set the allowance to zero.
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
            <div style={{ marginTop: 6 }}>Scanning approvals…</div>
          </div>
        )}

        {!loading && rows && rows.length === 0 && (
          <EmptyState
            icon={Shield}
            title="No active allowances"
            message="Your wallet hasn't approved any contract to spend tokens on Makalu."
            tight
          />
        )}

        {rows && rows.length > 0 && rows.map((row) => {
          const key = `${row.tokenAddress}|${row.spender}`;
          const busy = busyKey === key;
          return (
            <div key={key} style={rowStyle}>
              <TokenIcon sym={row.symbol} size={36}/>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{row.symbol}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.name}</span>
                  {row.unlimited && (
                    <span style={pillUnlimited}>UNLIMITED</span>
                  )}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: 'var(--text-muted)',
                  fontFamily: 'Geist Mono, monospace',
                }}>
                  <span>Spender:</span>
                  <a
                    href={`${MAKALU_EXPLORER}/address/${row.spender}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--blue)', textDecoration: 'none' }}
                    title={row.spender}
                  >
                    {truncate(row.spender, 10, 8)}
                  </a>
                  <ExternalLink size={10} style={{ color: 'var(--text-muted)' }}/>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Approved: {row.unlimited
                    ? <span style={{ color: 'var(--orange, #f59e0b)', fontWeight: 600 }}>Unlimited</span>
                    : <span style={{ fontWeight: 600 }}>{row.amount} {row.symbol}</span>}
                </div>
              </div>
              <button
                onClick={() => revoke(row)}
                disabled={busy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8,
                  background: busy ? 'var(--bg-elevated)' : 'transparent',
                  border: '1px solid var(--red)',
                  color: 'var(--red)', fontSize: 12, fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  minWidth: 86, justifyContent: 'center',
                }}
                title="Set allowance to zero"
              >
                {busy
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> Revoking</>
                  : <><X size={13}/> Revoke</>}
              </button>
            </div>
          );
        })}
      </div>
    </section>
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

function projectSession(s: SessionTypes.Struct): DAppRow {
  const peer = s.peer?.metadata ?? { name: 'Unknown dApp', url: '', icons: [] as string[] };
  const chains = s.namespaces?.eip155?.chains ?? [];
  const ts = typeof s.expiry === 'number' ? new Date(s.expiry * 1000).toISOString() : null;
  return {
    topic:   s.topic,
    name:    peer.name || 'Unknown dApp',
    url:     peer.url || '',
    icon:    Array.isArray(peer.icons) && peer.icons[0] ? peer.icons[0] : null,
    chains:  chains.join(', ') || 'eip155:700777',
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
