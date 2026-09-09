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
import { Sparkles, X as XIcon } from 'lucide-react';
import { quantt, quanttSignIn } from '../lib/quantt';
import type { QuanttSession, QuanttOverview, QuanttAgent, QuanttRuntimeState } from '@thanos/sdk-core';

const QUANTT_AGENTS_URL = 'https://quantts.ai';

/* Live portfolio + agents summary once connected (/v1/mobile/overview). */
function QuanttPanel({ overview, onSelectAgent }: { overview: QuanttOverview; onSelectAgent: (a: QuanttAgent) => void }) {
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
        <button
          key={a.id}
          onClick={() => onSelectAgent(a)}
          style={{
            display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginTop: 7,
            width: '100%', background: 'transparent', border: 'none', padding: '4px 0', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{a.chain}{a.status ? ' · ' + a.status : ''}</span>
        </button>
      ))}
    </div>
  );
}

const AGENT_DETAIL_LABELS: Record<string, string> = {
  chain: 'Network', status: 'Status', exposureUsd: 'Exposure', pnlPercent30d: '30d P&L',
  confidence: 'Confidence', strategy: 'Strategy',
};

/** Renders any key the summary row doesn't already cover, from whatever
 *  `getAgent` actually returns — its response shape isn't documented (the
 *  OpenAPI leaves it as a "Default Response"), so this degrades to plain
 *  key/value pairs instead of assuming a fixed schema. */
function extraDetailEntries(agent: QuanttAgent, raw: unknown): Array<[string, string]> {
  if (!raw || typeof raw !== 'object') return [];
  const known = new Set(['id', 'name', ...Object.keys(AGENT_DETAIL_LABELS)]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(k) || v == null) continue;
    if (typeof v === 'object') continue; // nested objects/arrays — skip rather than dump raw JSON
    out.push([k, String(v)]);
  }
  return out;
}

/** Only these two runtime states are shown as a toggle — 'idle' (an agent
 *  that hasn't been assigned a running state yet) isn't something this
 *  control drives into; that's a lifecycle state, not a pause/resume one. */
const TOGGLE_STATES = new Set(['active', 'paused']);

/** Agent detail — the summary fields are always shown (they come from the
 *  verified-live /v1/mobile/overview response); anything extra from
 *  getAgent(id) is best-effort, since that endpoint's response shape has
 *  never been confirmed against a real session (the OpenAPI spec only
 *  documents its request side). Pause/resume calls POST /v1/agents/{id}/state
 *  — a real, confirmed, fund-adjacent action against production with no
 *  sandbox to rehearse in, so it's a deliberate one-tap toggle with a clear
 *  busy/error state, not silently auto-retried or assumed to have worked. */
function QuanttAgentDetailModal({ agent, onClose, onStateChanged }: {
  agent: QuanttAgent; onClose: () => void; onStateChanged: () => void;
}) {
  const [raw, setRaw] = useState<unknown>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [wallet, setWallet] = useState<unknown>(null);
  const [status, setStatus] = useState(agent.status);
  const [toggling, setToggling] = useState(false);
  const [toggleErr, setToggleErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    quantt.getAgent(agent.id)
      .then((r) => { if (live) setRaw(r); })
      .catch(() => { if (live) setLoadErr(true); });
    // Read-only — the on-chain + Magma-ledger balance behind this agent's
    // exposure figure. Fails silently: the wallet section just doesn't
    // render rather than adding a second error message next to loadErr.
    quantt.getAgentWallet(agent.id)
      .then((r) => { if (live) setWallet(r); })
      .catch(() => {});
    return () => { live = false; };
  }, [agent.id]);

  const toggleState = async () => {
    if (!status || !TOGGLE_STATES.has(status) || toggling) return;
    const next: QuanttRuntimeState = status === 'active' ? 'paused' : 'active';
    setToggling(true);
    setToggleErr(null);
    try {
      await quantt.setAgentState(agent.id, next);
      setStatus(next);
      onStateChanged(); // refresh the parent's overview list so the summary row's status matches
    } catch (e) {
      setToggleErr(e instanceof Error ? e.message : 'Could not update the agent — try again.');
    } finally {
      setToggling(false);
    }
  };

  const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const rows: Array<[string, string]> = [
    ['chain',         agent.chain ?? '—'],
    ['status',        status ?? '—'],
    ['exposureUsd',   agent.exposureUsd != null ? '$' + Math.round(agent.exposureUsd).toLocaleString('en-US') : '—'],
    ['pnlPercent30d', agent.pnlPercent30d != null ? pct(agent.pnlPercent30d) : '—'],
    ['confidence',    agent.confidence != null ? Math.round(agent.confidence * 100) / 100 + '' : '—'],
    ['strategy',      agent.strategy ?? '—'],
  ].filter(([, v]) => v !== '—') as Array<[string, string]>;
  const extra = extraDetailEntries(agent, raw);
  const walletRows = extraDetailEntries(agent, wallet);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        style={{ width: '100%', maxWidth: 380, background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 18, padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Quantt Agent</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{agent.name}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <XIcon size={18}/>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{AGENT_DETAIL_LABELS[k] ?? k}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>

        {extra.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {extra.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {loadErr && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
            Couldn&apos;t load additional details from Quantt — showing what&apos;s already known.
          </div>
        )}

        {walletRows.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-default)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
              Agent wallet
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {walletRows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {status && TOGGLE_STATES.has(status) && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-default)' }}>
            <button
              onClick={toggleState}
              disabled={toggling}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                background: status === 'active' ? 'transparent' : 'var(--blue)',
                color: status === 'active' ? '#ef4444' : '#fff',
                border: status === 'active' ? '1px solid rgba(239,68,68,0.4)' : 'none',
                fontSize: 13.5, fontWeight: 700, cursor: toggling ? 'default' : 'pointer',
                opacity: toggling ? 0.6 : 1,
              }}
            >
              {toggling ? 'Working…' : status === 'active' ? 'Pause agent' : 'Resume agent'}
            </button>
            {toggleErr && <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{toggleErr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function QuanttCard() {
  const [session, setSession] = useState<QuanttSession | null>(null);
  const [overview, setOverview] = useState<QuanttOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<QuanttAgent | null>(null);

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
          {session && overview && <QuanttPanel overview={overview} onSelectAgent={setDetailAgent} />}
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
      {detailAgent && <QuanttAgentDetailModal agent={detailAgent} onClose={() => setDetailAgent(null)} onStateChanged={loadOverview} />}
    </div>
  );
}
