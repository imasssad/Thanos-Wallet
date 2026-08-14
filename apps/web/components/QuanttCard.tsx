'use client';
/**
 * Quantt Agents card — native wallet sign-in for the web wallet.
 *
 * "Connect with Thanos" runs the EIP-712 wallet login through the signing
 * worker (lib/quantt.ts → sdk-core QuanttClient); the mnemonic never leaves the
 * worker and Quantt only ever sees a signature. Once connected, the live
 * portfolio + agents load from /v1/mobile/overview. A secondary link still opens
 * quantts.ai in a new tab.
 *
 * (Replaces the earlier open-in-tab card: because the web wallet signs the
 * challenge itself, it no longer needs a wallet at the quantts.ai destination.)
 */
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { quantt, quanttSignIn } from '../lib/quantt';
import type { QuanttSession, QuanttOverview } from '@thanos/sdk-core';

const QUANTT_AGENTS_URL = 'https://quantts.ai';

/* Live portfolio + agents summary once connected (/v1/mobile/overview). */
function QuanttPanel({ overview }: { overview: QuanttOverview }) {
  const p = overview?.dashboard?.portfolio;
  const agents = overview?.dashboard?.agents ?? [];
  if (!p) return null;
  const fmtUsd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const pct = (n: number) => (n >= 0 ? '+' : '') + (n ?? 0).toFixed(1) + '%';
  const posColor = (n: number) => (n >= 0 ? '#22c55e' : '#ef4444');
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtUsd(p.equity)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: posColor(p.pnl30d) }}>{pct(p.pnl30d)} · 30d</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
        {p.activeAgents} active agents · <span style={{ color: posColor(p.pnl24h) }}>{pct(p.pnl24h)} 24h</span>
      </div>
      {agents.slice(0, 3).map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginTop: 7 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{a.chain}{a.status ? ' · ' + a.status : ''}</span>
        </div>
      ))}
    </div>
  );
}

export function QuanttCard() {
  const [session, setSession] = useState<QuanttSession | null>(null);
  const [overview, setOverview] = useState<QuanttOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadOverview = () => { quantt.getOverview().then(setOverview).catch(() => setOverview(null)); };
  useEffect(() => {
    let live = true;
    quantt.session().then((s) => { if (live) { setSession(s); if (s) loadOverview(); } }).catch(() => {});
    return () => { live = false; };
  }, []);

  const connect = async () => {
    setBusy(true); setErr(null);
    try { setSession(await quanttSignIn()); loadOverview(); }
    catch (e) { setErr((e as Error)?.message || 'Sign-in failed'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => { try { await quantt.signOut(); } finally { setSession(null); setOverview(null); } };

  const btnBase: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 10,
    cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  };
  const ghost: React.CSSProperties = {
    ...btnBase, background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid var(--border-default)',
  };
  const primary: React.CSSProperties = { ...btnBase, background: 'var(--blue)', color: '#fff', border: 'none' };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg, 16px)', padding: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>AI Assistant</span>
        {session && <span style={{ color: 'var(--blue)', fontSize: 12, fontWeight: 700 }}>● Connected</span>}
      </div>
      <div className="ai-body">
        <div className="ai-icon"><Sparkles size={16}/></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-title">Quantt Agents</div>
          <div className="ai-sub">
            {session
              ? 'Signed in with your wallet — your AI trading agents.'
              : 'AI agents that optimize your portfolio across chains. Sign in with your wallet — no password.'}
          </div>
          {session && overview && <QuanttPanel overview={overview} />}
          {err && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {session ? (
              <>
                <a href={QUANTT_AGENTS_URL} target="_blank" rel="noopener noreferrer" style={primary}>Open Quantt ↗</a>
                <button onClick={disconnect} style={ghost}>Disconnect</button>
              </>
            ) : (
              <>
                <button onClick={connect} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
                  {busy ? 'Connecting…' : 'Connect with Thanos'}
                </button>
                <a href={QUANTT_AGENTS_URL} target="_blank" rel="noopener noreferrer" style={ghost}>Open ↗</a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
