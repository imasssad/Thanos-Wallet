'use client';
/**
 * Quantt Agents — native wallet sign-in + the full agent lifecycle for the
 * web wallet.
 *
 * "Connect with Thanos" runs the EIP-712 wallet login through the signing
 * worker (lib/quantt.ts → sdk-core QuanttClient); the mnemonic never leaves
 * the worker and Quantt only ever sees a signature. Once connected, the
 * live portfolio + agents load from /v1/dashboard/overview, and this file
 * adds the rest of the lifecycle on top of that read-only summary: create
 * an agent, inspect it (wallet/decisions/trades/positions), start/pause/
 * stop it, analyze it on demand, fund it (a real on-chain send + a
 * separate "tell Quantt about it" call), withdraw from it, and delete it.
 *
 * NO SANDBOX: every create/deposit/withdraw/state-change call below hits
 * production from the first click — see client.ts's file header. There is
 * no fake test mode here; the UI leans on explicit confirms and real-money
 * warnings instead.
 *
 * DEFENSIVE PARSING: every Quantt response type is `unknown` — the OpenAPI
 * spec documents request shapes but marks every response "Default
 * Response". The coerce* helpers below probe several plausible key
 * spellings and fall back to rendering raw key/value pairs rather than
 * assuming a fixed shape, mirroring lib/lax.ts's coerceCardList/
 * coerceDetails pattern in this same codebase.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Plus, Copy, Check as CheckIcon, RefreshCw, Play, Pause,
  Square, Trash2, ArrowUpRight, AlertTriangle,
} from 'lucide-react';
import { quantt, quanttSignIn, quanttBindWithdrawalAddress } from '../lib/quantt';
import { useWallet } from './shell/AppShell';
import { SendModal } from './modals';
import type {
  QuanttSession, QuanttOverview, QuanttAgent, QuanttRuntimeState,
  CreateAgentInput, WithdrawInput, QuanttStrategy, QuanttChain, QuanttDexPreference,
} from '@thanos/sdk-core';

const QUANTT_AGENTS_URL = 'https://quantts.ai';

/* ── loose parse helpers (mirrors lib/lax.ts's coerce* philosophy) ────── */

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const LIST_CONTAINER_KEYS = ['agents', 'items', 'data', 'results', 'list', 'decisions', 'trades', 'positions', 'withdrawals', 'balances'];
function asArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const o = asObj(v);
  if (!o) return [];
  for (const k of LIST_CONTAINER_KEYS) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}
function pickStr(o: Record<string, unknown> | null | undefined, ...keys: string[]): string | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}
function pickNum(o: Record<string, unknown> | null | undefined, ...keys: string[]): number | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
/** Plain key/value pairs for any primitive top-level fields — the
 *  degrade-gracefully fallback used everywhere a response shape isn't
 *  pinned down (decisions, trades, positions, withdrawals, …). */
function primitiveEntries(o: unknown, exclude: string[] = []): Array<[string, string]> {
  const obj = asObj(o);
  if (!obj) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (exclude.includes(k) || v == null || typeof v === 'object') continue;
    out.push([k, String(v)]);
  }
  return out;
}

/* ── agent list coercion ───────────────────────────────────────────────── */

interface AgentRow {
  id: string;
  name: string;
  status?: string;
  strategy?: string;
  chain?: string;
  exposureUsd?: number;
  pnlPercent?: number;
  raw: Record<string, unknown>;
}
function coerceAgent(raw: unknown): AgentRow | null {
  const o = asObj(raw);
  if (!o) return null;
  const id = pickStr(o, 'id', '_id', 'agentId', 'agent_id');
  if (!id) return null;
  const chainsArr = Array.isArray(o.chains) ? (o.chains as unknown[]) : undefined;
  return {
    id,
    name: pickStr(o, 'name', 'agentName') ?? `Agent ${id.slice(0, 6)}`,
    status: pickStr(o, 'status', 'state'),
    strategy: pickStr(o, 'strategy'),
    chain: pickStr(o, 'chain') ?? (typeof chainsArr?.[0] === 'string' ? (chainsArr[0] as string) : undefined),
    exposureUsd: pickNum(o, 'exposureUsd', 'exposure', 'capitalUsd', 'balanceUsd', 'equityUsd'),
    pnlPercent: pickNum(o, 'pnlPercent30d', 'pnlPercent', 'pnl30d', 'pnlPercentage'),
    raw: o,
  };
}
function coerceAgentList(raw: unknown): AgentRow[] {
  return asArr(raw).map(coerceAgent).filter((a): a is AgentRow => a !== null);
}

interface AgentWalletInfo {
  address?: string;
  balances: Array<{ symbol: string; amount: string }>;
}
function coerceWallet(raw: unknown): AgentWalletInfo {
  const o = asObj(raw);
  const src = asObj(o?.wallet) ?? o;
  const address = pickStr(src, 'address', 'walletAddress', 'wallet_address');
  const balances: Array<{ symbol: string; amount: string }> = [];
  const balSrc: unknown = src?.balances ?? src?.balance ?? o?.balances;
  if (Array.isArray(balSrc)) {
    for (const b of balSrc) {
      const bo = asObj(b);
      if (!bo) continue;
      balances.push({
        symbol: pickStr(bo, 'symbol', 'token', 'currency', 'asset') ?? '—',
        amount: pickStr(bo, 'amount', 'balance', 'value') ?? '0',
      });
    }
  } else {
    const bo = asObj(balSrc);
    if (bo) {
      for (const [k, v] of Object.entries(bo)) {
        if (v == null || typeof v === 'object') continue;
        balances.push({ symbol: k, amount: String(v) });
      }
    }
  }
  return { address, balances };
}
function coerceWithdrawalAddress(raw: unknown): string | undefined {
  const o = asObj(raw);
  return pickStr(o, 'address', 'withdrawalAddress', 'withdrawal_address') ?? pickStr(asObj(o?.data), 'address');
}
function coerceCursorList(raw: unknown): { items: Record<string, unknown>[]; nextCursor?: string } {
  const o = asObj(raw);
  const items = asArr(raw).map(x => asObj(x)).filter((x): x is Record<string, unknown> => x !== null);
  const nextCursor = pickStr(o, 'nextCursor', 'next_cursor', 'cursor');
  return { items, nextCursor };
}
function withdrawalId(o: Record<string, unknown>): string | undefined {
  return pickStr(o, 'id', 'attemptId', 'attempt_id', 'withdrawalId', 'withdrawal_id');
}
function isResumable(o: Record<string, unknown>): boolean {
  const status = (pickStr(o, 'status', 'state') ?? '').toLowerCase();
  return /pending|processing|queued|retry|incomplete/.test(status);
}

/* ── strategy / chain catalogs ─────────────────────────────────────────── */

const STRATEGIES: Array<{ value: QuanttStrategy; label: string }> = [
  { value: 'buy_hold',        label: 'Buy & Hold' },
  { value: 'macd',            label: 'MACD' },
  { value: 'kdj_rsi',         label: 'KDJ + RSI' },
  { value: 'zmr',             label: 'ZMR' },
  { value: 'sma',             label: 'SMA' },
  { value: 'momentum',        label: 'Momentum' },
  { value: 'mean_reversion',  label: 'Mean Reversion' },
  { value: 'arbitrage',       label: 'Arbitrage' },
  { value: 'trend_following', label: 'Trend Following' },
  { value: 'hedging',         label: 'Hedging' },
  { value: 'fundamental',     label: 'Fundamental' },
  { value: 'technical',       label: 'Technical' },
  { value: 'custom',          label: 'Custom (prompt-guided)' },
];
const CHAINS: Array<{ value: QuanttChain; label: string }> = [
  { value: 'arbitrum',    label: 'Arbitrum' },
  { value: 'base',        label: 'Base' },
  { value: 'lithosphere', label: 'Lithosphere' },
  { value: 'bnb',         label: 'BNB Chain' },
];

/** Route "send to this agent's wallet" into the existing Send modal on a
 *  plausible network for the agent's chain. Falls back to Lithosphere
 *  Makalu (the modal's own default) for an unrecognised chain string. */
type SendNetId = NonNullable<Parameters<typeof SendModal>[0]['initialNetwork']>;
const CHAIN_TO_SEND_NETWORK: Partial<Record<string, SendNetId>> = {
  arbitrum:    'evm:42161',
  base:        'evm:8453',
  bnb:         'evm:56',
  lithosphere: 'makalu',
};

/* ── tiny shared bits ──────────────────────────────────────────────────── */

function Spinner({ size = 22 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', border: '3px solid var(--border-default)',
      borderTopColor: 'var(--blue)', animation: 'spin 0.8s linear infinite',
    }} />
  );
}
function SpinKeyframes() { return <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>; }

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12,
      padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <AlertTriangle size={15} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function ConfirmDialog({
  title, message, confirmLabel, danger, busy, onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 340 }}>
        <div className="modal-body" style={{ gap: 14 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 800 }}>{title}</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{message}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn-outline" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              className="btn-primary" style={{ flex: 1, background: danger ? '#ef4444' : undefined }}
              onClick={onConfirm} disabled={busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PillToggle<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>; value: T[] | T; onChange: (v: T) => void;
}) {
  const active = Array.isArray(value) ? value : [value];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const isActive = active.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: '7px 12px', borderRadius: 999,
              border: `1px solid ${isActive ? 'var(--blue)' : 'var(--border-default)'}`,
              background: isActive ? 'rgba(59,122,247,0.14)' : 'transparent',
              color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── record list (decisions / trades / positions / withdrawals) ───────── */

function RecordCard({ obj, exclude = [], action }: { obj: Record<string, unknown>; exclude?: string[]; action?: React.ReactNode }) {
  const entries = primitiveEntries(obj, exclude);
  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No details available.</span>
      ) : entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
        </div>
      ))}
      {action}
    </div>
  );
}

/* ── Wallet + Deposit tab ──────────────────────────────────────────────── */

function WalletTab({ agent, onSendClick }: { agent: AgentRow; onSendClick: (address: string) => void }) {
  const [wallet, setWallet] = useState<AgentWalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setErr(null);
    quantt.getAgentWallet(agent.id)
      .then(r => { if (live) setWallet(coerceWallet(r)); })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Could not load the agent wallet.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [agent.id]);

  const copy = () => {
    if (!wallet?.address) return;
    navigator.clipboard?.writeText(wallet.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const confirmDeposit = async () => {
    setDepositBusy(true); setDepositMsg(null);
    try {
      await quantt.depositToAgent(agent.id);
      setDepositMsg('Deposit confirmed with Quantt. It may take a moment to reflect in the balance below.');
    } catch (e) {
      setDepositMsg(e instanceof Error ? e.message : 'Could not confirm the deposit — try again.');
    } finally { setDepositBusy(false); }
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Spinner/></div>;
  if (err) return <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>;
  if (!wallet?.address) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>This agent has no wallet yet.</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="field-label">Agent wallet address</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {wallet.address}
          </span>
          <button onClick={copy} aria-label="Copy address" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#22c55e' : 'var(--text-muted)', flexShrink: 0 }}>
            {copied ? <CheckIcon size={15}/> : <Copy size={15}/>}
          </button>
        </div>
      </div>

      {wallet.balances.length > 0 && (
        <div>
          <div className="field-label">Balances</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {wallet.balances.map(b => (
              <div key={b.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{b.symbol}</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{b.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Step 1 — send funds
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
          Send from your own Thanos wallet to the address above. This is a real on-chain transfer.
        </p>
        <button className="btn-outline" onClick={() => onSendClick(wallet.address!)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ArrowUpRight size={15}/> Send to this address
        </button>
      </div>

      <div style={{ background: 'rgba(59,122,247,0.08)', border: '1px solid rgba(59,122,247,0.25)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Step 2 — tell Quantt
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
          Only after the transfer above has actually gone through: confirm it so Quantt recognizes and credits the deposit. No sandbox — this is a real request against your live account.
        </p>
        <button className="btn-primary" onClick={confirmDeposit} disabled={depositBusy}>
          {depositBusy ? 'Confirming…' : "I've sent the funds — confirm deposit"}
        </button>
        {depositMsg && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{depositMsg}</span>}
      </div>
    </div>
  );
}

/* ── Withdraw tab ──────────────────────────────────────────────────────── */

function WithdrawTab({ agent }: { agent: AgentRow }) {
  const wallet = useWallet();
  const [boundAddress, setBoundAddress] = useState<string | null | undefined>(undefined); // undefined = loading
  const [bindBusy, setBindBusy] = useState(false);
  const [bindErr, setBindErr] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [totp, setTotp] = useState('');
  const [wdBusy, setWdBusy] = useState(false);
  const [wdErr, setWdErr] = useState<string | null>(null);
  const [wdOk, setWdOk] = useState<string | null>(null);

  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const loadAddress = () => {
    setBoundAddress(undefined);
    quantt.getWithdrawalAddress()
      .then(r => setBoundAddress(coerceWithdrawalAddress(r) ?? null))
      .catch(() => setBoundAddress(null));
  };
  const loadHistory = () => {
    setHistoryLoading(true);
    quantt.getAgentWithdrawals(agent.id)
      .then(r => setHistory(coerceCursorList(r).items))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };
  useEffect(() => { loadAddress(); loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id]);

  const bind = async () => {
    setBindBusy(true); setBindErr(null);
    try {
      await quanttBindWithdrawalAddress();
      loadAddress();
    } catch (e) {
      setBindErr(e instanceof Error ? e.message : 'Could not bind the withdrawal address — try again.');
    } finally { setBindBusy(false); }
  };

  const submitWithdraw = async () => {
    setWdErr(null); setWdOk(null);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setWdErr('Enter an amount.'); return; }
    setWdBusy(true);
    try {
      const body: WithdrawInput = { amount: amt };
      if (totp.trim()) body.totpCode = totp.trim();
      await quantt.withdrawFromAgent(agent.id, body);
      setWdOk('Withdrawal submitted.');
      setAmount(''); setTotp('');
      loadHistory();
    } catch (e) {
      setWdErr(e instanceof Error ? e.message : 'Withdrawal failed — try again.');
    } finally { setWdBusy(false); }
  };

  const resume = async (id: string) => {
    setResumingId(id);
    try {
      await quantt.resumeWithdrawal(agent.id, id);
      loadHistory();
    } catch { /* the row's own state / a future refresh will reflect the outcome */ }
    finally { setResumingId(null); }
  };

  const evmAddr = wallet?.addresses?.evm;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {boundAddress === undefined ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}><Spinner size={18}/></div>
      ) : boundAddress ? (
        <div>
          <div className="field-label">Verified withdrawal address</div>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {boundAddress}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <WarningBanner>
            No withdrawal address is verified yet. Withdrawals only ever pay out to a verified address — bind your own wallet address below before you can withdraw.
          </WarningBanner>
          {evmAddr ? (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {evmAddr}
            </div>
          ) : null}
          <button className="btn-primary" onClick={bind} disabled={bindBusy || !evmAddr}>
            {bindBusy ? 'Verifying…' : 'Verify & bind this address'}
          </button>
          {bindErr && <span style={{ color: '#ef4444', fontSize: 12 }}>{bindErr}</span>}
        </div>
      )}

      {boundAddress && (
        <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Amount</label>
          <input className="field-input" type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
          <label className="field-label">2FA code (only if TOTP is enabled)</label>
          <input className="field-input" type="text" inputMode="numeric" placeholder="Optional" value={totp} onChange={e => setTotp(e.target.value)} />
          {wdErr && <span style={{ color: '#ef4444', fontSize: 12 }}>{wdErr}</span>}
          {wdOk && <span style={{ color: '#22c55e', fontSize: 12 }}>{wdOk}</span>}
          <button className="btn-primary" onClick={submitWithdraw} disabled={wdBusy}>
            {wdBusy ? 'Submitting…' : 'Withdraw'}
          </button>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14 }}>
        <div className="field-label">Withdrawal history</div>
        {historyLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}><Spinner size={18}/></div>
        ) : history.length === 0 ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No withdrawals yet.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((h, i) => {
              const id = withdrawalId(h);
              return (
                <RecordCard
                  key={id ?? i}
                  obj={h}
                  action={id && isResumable(h) ? (
                    <button className="btn-outline" style={{ marginTop: 4, fontSize: 12, padding: '6px 10px' }} onClick={() => resume(id)} disabled={resumingId === id}>
                      {resumingId === id ? 'Resuming…' : 'Resume'}
                    </button>
                  ) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Decisions / Trades / Positions tabs ──────────────────────────────── */

function DecisionsTab({ agent }: { agent: AgentRow }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = (opts?: { cursor?: string }) => {
    const setBusy = opts?.cursor ? setLoadingMore : setLoading;
    setBusy(true);
    quantt.getAgentDecisions(agent.id, { cursor: opts?.cursor, limit: 20 })
      .then(r => {
        const { items: newItems, nextCursor } = coerceCursorList(r);
        setItems(prev => (opts?.cursor ? [...prev, ...newItems] : newItems));
        setCursor(nextCursor);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Could not load decisions.'))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Spinner/></div>;
  if (err) return <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>;
  if (items.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No AI decisions yet — try &quot;Analyze now&quot; above.</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => <RecordCard key={pickStr(it, 'id') ?? i} obj={it} />)}
      {cursor && (
        <button className="btn-outline" onClick={() => load({ cursor })} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function SimpleListTab({ loadFn }: { loadFn: () => Promise<unknown> }) {
  const [items, setItems] = useState<Record<string, unknown>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null); setErr(null);
    loadFn()
      .then(r => { if (live) setItems(coerceCursorList(r).items); })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : 'Could not load.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (err) return <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>;
  if (!items) return <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Spinner/></div>;
  if (items.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Nothing here yet.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => <RecordCard key={pickStr(it, 'id') ?? i} obj={it} />)}
    </div>
  );
}

/* ── Agent detail modal ───────────────────────────────────────────────── */

type DetailTab = 'overview' | 'wallet' | 'withdraw' | 'decisions' | 'trades' | 'positions';
const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'overview',  label: 'Overview' },
  { id: 'wallet',    label: 'Wallet' },
  { id: 'withdraw',  label: 'Withdraw' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'trades',    label: 'Trades' },
  { id: 'positions', label: 'Positions' },
];
const TARGET_STATE_LABEL: Record<QuanttRuntimeState, string> = { active: 'Start', paused: 'Pause', idle: 'Stop' };

function AgentDetailModal({ agentStub, onClose, onChanged }: {
  agentStub: { id: string; name: string };
  onClose: () => void;
  /** Refresh whatever list this was opened from (overview or the agents list). */
  onChanged: () => void;
}) {
  const [agent, setAgent] = useState<AgentRow>({ id: agentStub.id, name: agentStub.name, raw: {} });
  const [loadErr, setLoadErr] = useState(false);
  const [tab, setTab] = useState<DetailTab>('overview');
  const [sendAddress, setSendAddress] = useState<string | null>(null);

  const [pendingState, setPendingState] = useState<QuanttRuntimeState | null>(null);
  const [stateBusy, setStateBusy] = useState(false);
  const [stateErr, setStateErr] = useState<string | null>(null);

  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const reload = () => {
    quantt.getAgent(agentStub.id)
      .then(r => { const a = coerceAgent(r); if (a) setAgent(a); })
      .catch(() => setLoadErr(true));
  };
  useEffect(reload, [agentStub.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runStateChange = async () => {
    if (!pendingState) return;
    setStateBusy(true); setStateErr(null);
    try {
      await quantt.setAgentState(agent.id, pendingState);
      setAgent(a => ({ ...a, status: pendingState }));
      onChanged();
    } catch (e) {
      setStateErr(e instanceof Error ? e.message : 'Could not update the agent — try again.');
    } finally { setStateBusy(false); setPendingState(null); }
  };

  const analyze = async () => {
    setAnalyzeBusy(true); setAnalyzeMsg(null);
    try {
      await quantt.analyzeAgent(agent.id);
      setAnalyzeMsg('Analysis triggered — check the Decisions tab shortly.');
    } catch (e) {
      setAnalyzeMsg(e instanceof Error ? e.message : 'Could not trigger analysis.');
    } finally { setAnalyzeBusy(false); }
  };

  const doDelete = async () => {
    setDeleteBusy(true); setDeleteErr(null);
    try {
      await quantt.deleteAgent(agent.id);
      onChanged();
      onClose();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Could not delete the agent — try again.');
      setDeleteBusy(false);
    }
  };

  const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const overviewRows: Array<[string, string]> = [
    ['Status',   agent.status ?? '—'],
    ['Chain',    agent.chain ?? '—'],
    ['Strategy', agent.strategy ?? '—'],
    ['Exposure', agent.exposureUsd != null ? '$' + Math.round(agent.exposureUsd).toLocaleString('en-US') : '—'],
    ['30d P&L',  agent.pnlPercent != null ? pct(agent.pnlPercent) : '—'],
  ];
  const extra = primitiveEntries(agent.raw, ['id', '_id', 'agentId', 'agent_id', 'name', 'agentName', 'status', 'state', 'strategy', 'chain', 'chains']);

  const sendNet = agent.chain ? CHAIN_TO_SEND_NETWORK[agent.chain] : undefined;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="modal-box modal-popup" style={{ width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span />
          <span className="modal-title">{agent.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '0 20px 10px', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flexShrink: 0, padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${tab === t.id ? 'var(--blue)' : 'var(--border-default)'}`,
                background: tab === t.id ? 'rgba(59,122,247,0.14)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 18, paddingTop: 4 }}>
            {tab === 'overview' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {overviewRows.map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                {extra.length > 0 && (
                  <div style={{ paddingTop: 12, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {extra.map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {loadErr && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Couldn&apos;t refresh full details from Quantts — showing what&apos;s already known.
                  </div>
                )}

                <div style={{ paddingTop: 14, borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(['active', 'paused', 'idle'] as QuanttRuntimeState[]).map(s => (
                      <button
                        key={s}
                        className="btn-outline"
                        style={{ flex: '1 1 96px', minWidth: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, opacity: agent.status === s ? 0.5 : 1 }}
                        disabled={agent.status === s}
                        onClick={() => setPendingState(s)}
                      >
                        {s === 'active' ? <Play size={13}/> : s === 'paused' ? <Pause size={13}/> : <Square size={13}/>}
                        {TARGET_STATE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  {stateErr && <span style={{ color: '#ef4444', fontSize: 12 }}>{stateErr}</span>}

                  <button className="btn-outline" onClick={analyze} disabled={analyzeBusy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <RefreshCw size={14}/> {analyzeBusy ? 'Analyzing…' : 'Analyze now'}
                  </button>
                  {analyzeMsg && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{analyzeMsg}</span>}

                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <Trash2 size={14}/> Delete agent
                  </button>
                  {deleteErr && <span style={{ color: '#ef4444', fontSize: 12 }}>{deleteErr}</span>}
                </div>
              </>
            )}

            {tab === 'wallet'    && <WalletTab agent={agent} onSendClick={addr => setSendAddress(addr)} />}
            {tab === 'withdraw'  && <WithdrawTab agent={agent} />}
            {tab === 'decisions' && <DecisionsTab agent={agent} />}
            {tab === 'trades'    && <SimpleListTab loadFn={() => quantt.getAgentTrades(agent.id, 50)} />}
            {tab === 'positions' && <SimpleListTab loadFn={() => quantt.getAgentPositions(agent.id)} />}
          </div>
        </div>
      </div>

      {pendingState && (
        <ConfirmDialog
          title={`${TARGET_STATE_LABEL[pendingState]} this agent?`}
          message={
            pendingState === 'active'
              ? 'The agent will resume trading autonomously with its allocated capital.'
              : pendingState === 'paused'
                ? 'The agent will stop opening new positions until resumed.'
                : 'The agent will stop entirely. This is a real state change against production — no sandbox.'
          }
          confirmLabel={TARGET_STATE_LABEL[pendingState]}
          busy={stateBusy}
          onConfirm={runStateChange}
          onCancel={() => setPendingState(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this agent?"
          message="This permanently removes the agent. Make sure you've withdrawn any funds first — deleting the agent does not automatically return them."
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {sendAddress && (
        <SendModal
          onClose={() => setSendAddress(null)}
          initialAddress={sendAddress}
          initialNetwork={sendNet}
          // Agents trade a quoteAsset (default USDC per CreateAgentInput) —
          // no create-agent form in any client exposes a picker for it, so
          // every agent created through Thanos today IS USDC. Without this,
          // the button defaulted to native LITHO, so tapping "Send to this
          // address" would send the wrong asset to the agent with no
          // verification the deposit-confirm step catches it (no sandbox).
          initialCoin="USDC"
        />
      )}
    </div>
  );
}

/* ── Create Agent modal ───────────────────────────────────────────────── */

const DEFAULT_MAX_POSITION_PCT = 25;
const DEFAULT_STOP_LOSS = 5;
const DEFAULT_TAKE_PROFIT = 10;
const DEFAULT_MAX_DAILY_LOSS = 3.5;

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState<QuanttStrategy>('buy_hold');
  const [strategyPrompt, setStrategyPrompt] = useState('');
  const [chains, setChains] = useState<QuanttChain[]>(['lithosphere']);
  const [tokens, setTokens] = useState('');
  const [dexPreference, setDexPreference] = useState<QuanttDexPreference>('kamet');
  const [capitalUsd, setCapitalUsd] = useState('');

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [maxPositionPct, setMaxPositionPct] = useState(String(DEFAULT_MAX_POSITION_PCT));
  const [stopLoss, setStopLoss] = useState(String(DEFAULT_STOP_LOSS));
  const [takeProfit, setTakeProfit] = useState(String(DEFAULT_TAKE_PROFIT));
  const [maxDailyLoss, setMaxDailyLoss] = useState(String(DEFAULT_MAX_DAILY_LOSS));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleChain = (c: QuanttChain) => {
    setChains(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  };

  const submit = async () => {
    setErr(null);
    const trimmedName = name.trim();
    const tokenList = tokens.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    const capital = parseFloat(capitalUsd);
    if (!trimmedName) { setErr('Name your agent.'); return; }
    if (chains.length === 0) { setErr('Select at least one chain.'); return; }
    if (tokenList.length === 0) { setErr('Enter at least one token (comma-separated).'); return; }
    if (!Number.isFinite(capital) || capital <= 0) { setErr('Enter a starting capital amount.'); return; }

    const body: CreateAgentInput = {
      name: trimmedName,
      strategy,
      strategyPrompt: strategyPrompt.trim() || undefined,
      chains,
      tokens: tokenList,
      dexPreference,
      capitalUsd: capital,
      maxPositionPct: Number(maxPositionPct) || DEFAULT_MAX_POSITION_PCT,
      stopLoss: Number(stopLoss) || DEFAULT_STOP_LOSS,
      takeProfit: Number(takeProfit) || DEFAULT_TAKE_PROFIT,
      maxDailyLoss: Number(maxDailyLoss) || DEFAULT_MAX_DAILY_LOSS,
    };

    setBusy(true);
    try {
      await quantt.createAgent(body);
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the agent — try again.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="modal-box modal-popup" style={{ width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span />
          <span className="modal-title">Create Agent</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 16 }}>
            <WarningBanner>
              There is no sandbox for Quantt agents. This creates a real agent, and once funded it trades with real capital from the first click.
            </WarningBanner>

            <div>
              <label className="field-label">Name</label>
              <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My momentum agent" />
            </div>

            <div>
              <label className="field-label">Strategy</label>
              <PillToggle options={STRATEGIES} value={strategy} onChange={setStrategy} />
            </div>

            {strategy === 'custom' && (
              <div>
                <label className="field-label">Strategy prompt</label>
                <textarea
                  className="field-input" rows={3} value={strategyPrompt}
                  onChange={e => setStrategyPrompt(e.target.value)}
                  placeholder="Describe how the agent should trade…"
                  style={{ resize: 'vertical' }}
                />
              </div>
            )}

            <div>
              <label className="field-label">Chains</label>
              <PillToggle options={CHAINS} value={chains} onChange={toggleChain} />
            </div>

            <div>
              <label className="field-label">Tokens</label>
              <input className="field-input" value={tokens} onChange={e => setTokens(e.target.value)} placeholder="e.g. USDC, WETH" />
            </div>

            <div>
              <label className="field-label">DEX preference</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['kamet', 'magma'] as QuanttDexPreference[]).map(d => (
                  <button
                    key={d} type="button" onClick={() => setDexPreference(d)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${dexPreference === d ? 'var(--blue)' : 'var(--border-default)'}`,
                      background: dexPreference === d ? 'rgba(59,122,247,0.14)' : 'transparent',
                      color: 'var(--text-primary)', textTransform: 'capitalize',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label">Starting capital (USD)</label>
              <input className="field-input" type="text" inputMode="decimal" value={capitalUsd} onChange={e => setCapitalUsd(e.target.value)} placeholder="0.00" />
            </div>

            <button
              type="button" onClick={() => setAdvancedOpen(o => !o)}
              style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0, textAlign: 'left' }}
            >
              {advancedOpen ? 'Hide advanced settings' : 'Show advanced settings'}
            </button>

            {advancedOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg-elevated)', borderRadius: 12, padding: 14 }}>
                <div>
                  <label className="field-label">Max position size (%)</label>
                  <input className="field-input" type="text" inputMode="decimal" value={maxPositionPct} onChange={e => setMaxPositionPct(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Stop loss (%)</label>
                  <input className="field-input" type="text" inputMode="decimal" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Take profit (%)</label>
                  <input className="field-input" type="text" inputMode="decimal" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Max daily loss (%)</label>
                  <input className="field-input" type="text" inputMode="decimal" value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)} />
                </div>
              </div>
            )}

            {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}

            <button className="btn-primary" onClick={submit} disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Creating…' : 'Create Agent (real funds)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Agents list modal ────────────────────────────────────────────────── */

function AgentsListModal({ onClose, onSelectAgent, onCreateAgent }: {
  onClose: () => void;
  onSelectAgent: (a: { id: string; name: string }) => void;
  onCreateAgent: () => void;
}) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setAgents(null); setErr(null);
    quantt.listAgents()
      .then(r => setAgents(coerceAgentList(r)))
      .catch(e => setErr(e instanceof Error ? e.message : 'Could not load your agents.'));
  };
  useEffect(load, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span />
          <span className="modal-title">Your Agents</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          <div className="modal-body" style={{ gap: 12 }}>
            <button className="btn-primary" onClick={onCreateAgent} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Plus size={16}/> Create Agent
            </button>

            {err && <span style={{ color: '#ef4444', fontSize: 13 }}>{err}</span>}
            {!agents && !err && <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><Spinner/></div>}
            {agents && agents.length === 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No agents yet — create your first one above.</span>
            )}
            {agents?.map(a => {
              const posColor = a.pnlPercent != null ? (a.pnlPercent >= 0 ? '#22c55e' : '#ef4444') : 'var(--text-secondary)';
              return (
                <button
                  key={a.id}
                  onClick={() => onSelectAgent(a)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4, width: '100%', textAlign: 'left',
                    background: 'var(--bg-elevated)', border: 'none', borderRadius: 12, padding: 14, cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 14 }}>{a.name}</span>
                    {a.status && <span style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>{a.status}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {[a.strategy, a.chain].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      {a.exposureUsd != null && <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>${Math.round(a.exposureUsd).toLocaleString('en-US')}</span>}
                      {a.pnlPercent != null && <span style={{ color: posColor, fontWeight: 700 }}>{(a.pnlPercent >= 0 ? '+' : '') + a.pnlPercent.toFixed(1)}%</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── home-card summary panel (unchanged read-only preview) ────────────── */

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

/* ── main card ─────────────────────────────────────────────────────────── */

export function QuanttCard() {
  const [session, setSession] = useState<QuanttSession | null>(null);
  const [overview, setOverview] = useState<QuanttOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [detailAgent, setDetailAgent] = useState<{ id: string; name: string } | null>(null);
  const [showList, setShowList] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // If the overview fetch fails, it might be because the refresh token
  // itself expired (QuanttClient clears its internal session when that
  // happens) — re-check ground truth so the "● Connected" badge doesn't
  // stay stuck on while the portfolio panel silently disappears with no
  // explanation. Previously `session` was only ever set once on mount /
  // explicit sign-in/out, so a background token-refresh failure left the
  // UI permanently out of sync with the client's real auth state.
  const loadOverview = () => {
    quantt.getOverview().then(setOverview).catch(() => {
      setOverview(null);
      void quantt.session().then(setSession).catch(() => setSession(null));
    });
  };
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
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg, 16px)', padding: 'clamp(14px, 3.5vw, 18px)' }}>
      <SpinKeyframes/>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>AI Assistant</span>
        {session && <span style={{ color: 'var(--blue)', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>● Connected</span>}
      </div>
      <div className="ai-body">
        <div className="ai-icon"><Sparkles size={16}/></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-title">Quantts Agents</div>
          <div className="ai-sub">
            {session
              ? 'Signed in with your wallet — your AI trading agents.'
              : 'AI trading agents you fund and monitor across chains. Sign in with your wallet — no password.'}
          </div>
          {session && overview && <QuanttPanel overview={overview} onSelectAgent={a => setDetailAgent({ id: a.id, name: a.name })} />}
          {err && <div style={{ fontSize: 12, color: '#ff6b6b', marginTop: 8, wordBreak: 'break-word' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {session ? (
              <>
                <button onClick={() => setShowList(true)} style={primary}>Manage Agents</button>
                <button onClick={() => setShowCreate(true)} style={ghost}>+ New Agent</button>
                <a href={QUANTT_AGENTS_URL} target="_blank" rel="noopener noreferrer" style={ghost}>Open Quantts ↗</a>
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

      {showList && (
        <AgentsListModal
          onClose={() => setShowList(false)}
          onSelectAgent={a => setDetailAgent(a)}
          onCreateAgent={() => { setShowList(false); setShowCreate(true); }}
        />
      )}
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadOverview(); setShowList(true); }}
        />
      )}
      {detailAgent && (
        <AgentDetailModal
          agentStub={detailAgent}
          onClose={() => setDetailAgent(null)}
          onChanged={loadOverview}
        />
      )}
    </div>
  );
}
