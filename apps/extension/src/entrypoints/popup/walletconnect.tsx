/**
 * WalletConnect popup UI — message bridge to the persistent offscreen
 * host. The popup no longer initializes its own kit, so a paired
 * session survives the popup closing: the offscreen document keeps the
 * relay socket alive across browser sessions.
 *
 * Bridge:
 *   popup → background → offscreen kit (chrome.runtime.sendMessage)
 *   offscreen → popup    via event broadcasts (wc.event.*)
 *
 * Hydration: a session_proposal that lands while the popup is closed is
 * stashed in chrome.storage.session by the offscreen; the popup reads
 * it on mount and shows the approval sheet immediately.
 */
import React, { useEffect, useState } from 'react';
import { Globe, ChevronLeft } from 'lucide-react';
import { useWalletSeed } from './send';
import { executeWcRequest, summariseRequest, WcSignerError } from './wc-signer';

interface SessionRow { topic: string; name: string; url: string }
interface ProposalRow { id: number; name: string; url?: string }
interface PendingRequest {
  id:     number;
  topic:  string;
  method: string;
  params: unknown[];
  name:   string;
}

function send<T = unknown>(message: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      const reply = browser.runtime.sendMessage(message) as unknown;
      // webextension-polyfill returns a promise; chrome.runtime returns
      // a value via callback. Handle both.
      if (reply && typeof (reply as Promise<unknown>).then === 'function') {
        (reply as Promise<T>).then(resolve, reject);
      } else {
        resolve(reply as T);
      }
    } catch (e) {
      reject(e);
    }
  });
}

export function WalletConnectModal({ evmAddress, onClose }: { evmAddress: string; onClose: () => void }) {
  const seed = useWalletSeed();
  const [uri, setUri]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [err,  setErr]          = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [pending, setPending]   = useState<PendingRequest | null>(null);

  const refresh = async () => {
    try {
      const r = await send<{ ok: boolean; sessions?: SessionRow[] }>({ type: 'wc.list' });
      if (r?.ok && r.sessions) setSessions(r.sessions);
    } catch { /* offscreen still booting */ }
  };

  // On mount: pull active sessions + any pending proposal / pending
  // signing request stashed while the popup was closed. Subscribe to
  // live events for the rest.
  useEffect(() => {
    void refresh();
    (async () => {
      try {
        const r = await send<{ ok: boolean; proposal?: ProposalRow | null }>({ type: 'wc.get-proposal' });
        if (r?.ok && r.proposal) setProposal(r.proposal);
      } catch { /* fine */ }
      try {
        const r = await send<{ ok: boolean; request?: PendingRequest | null }>({ type: 'wc.get-request' });
        if (r?.ok && r.request) setPending(r.request);
      } catch { /* fine */ }
    })();

    const listener = (raw: unknown) => {
      const m = raw as { type?: string; id?: number; topic?: string; method?: string; params?: unknown[]; name?: string; url?: string };
      if (m?.type === 'wc.event.proposal') {
        setProposal({ id: m.id!, name: m.name ?? 'dApp', url: m.url });
      } else if (m?.type === 'wc.event.request' && m.topic && m.method) {
        setPending({
          id:     m.id!,
          topic:  m.topic,
          method: m.method,
          params: (m.params ?? []) as unknown[],
          name:   m.name ?? 'dApp',
        });
      } else if (m?.type === 'wc.event.session_delete') {
        void refresh();
      }
    };
    browser.runtime.onMessage.addListener(listener as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
    return () => browser.runtime.onMessage.removeListener(listener as Parameters<typeof browser.runtime.onMessage.removeListener>[0]);
  }, []);

  const approveRequest = async () => {
    if (!pending) return;
    setBusy(true); setErr(null);
    try {
      const result = await executeWcRequest(seed, { request: { method: pending.method, params: pending.params } });
      await send({ type: 'wc.respond', topic: pending.topic, id: pending.id, result });
      setPending(null);
    } catch (e) {
      const code = e instanceof WcSignerError ? e.code : -32603;
      const message = (e as Error)?.message || 'Sign failed';
      try {
        await send({ type: 'wc.respond', topic: pending.topic, id: pending.id, error: { code, message } });
      } catch { /* ignore */ }
      setPending(null);
      setErr(message);
    } finally {
      setBusy(false);
    }
  };

  const rejectRequest = async () => {
    if (!pending) return;
    try {
      await send({ type: 'wc.respond', topic: pending.topic, id: pending.id, error: { code: 5000, message: 'User rejected' } });
    } finally { setPending(null); }
  };

  const pair = async () => {
    if (!uri.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'wc.pair', uri: uri.trim() });
      if (!r?.ok) throw new Error(r?.error || 'Pairing failed');
      setUri('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!proposal || !evmAddress) return;
    setBusy(true); setErr(null);
    try {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'wc.approve', id: proposal.id, evmAddress });
      if (!r?.ok) throw new Error(r?.error || 'Approve failed');
      setProposal(null);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!proposal) return;
    try { await send({ type: 'wc.reject', id: proposal.id }); } finally { setProposal(null); }
  };

  const disconnect = async (topic: string) => {
    try { await send({ type: 'wc.disconnect', topic }); } finally { await refresh(); }
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: 4, display: 'inline-flex' }}>
          <ChevronLeft size={20}/>
        </button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>WalletConnect</div>
      </div>

      <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
        {pending ? (
          <>
            <div className="row-sub" style={{ marginBottom: 4 }}>
              {pending.method === 'eth_sendTransaction' ? 'Transaction request from' : 'Signature request from'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{pending.name}</div>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              borderRadius: 8, padding: 10, maxHeight: 180, overflowY: 'auto', marginBottom: 12,
            }}>
              {summariseRequest(pending.method, pending.params)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={rejectRequest}  disabled={busy} className="btn-secondary" style={{ flex: 1, opacity: busy ? 0.6 : 1 }}>Reject</button>
              <button onClick={approveRequest} disabled={busy || !seed.length} className="btn-primary" style={{ flex: 1, opacity: (busy || !seed.length) ? 0.6 : 1 }}>
                {busy ? 'Signing…' : pending.method === 'eth_sendTransaction' ? 'Approve & Send' : 'Approve & Sign'}
              </button>
            </div>
            {!seed.length && <div className="row-sub" style={{ marginTop: 8, fontSize: 10 }}>Unlock the wallet to sign.</div>}
          </>
        ) : proposal ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="row-avatar" style={{ background: 'rgba(59,122,247,0.18)', color: '#3b7af7' }}><Globe size={16}/></div>
              <div className="row-mid">
                <div className="row-name">{proposal.name}</div>
                <div className="row-sub">Wants to connect on Makalu + 8 EVM chains</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={reject}  className="btn-secondary" style={{ flex: 1 }}>Reject</button>
              <button onClick={approve} disabled={busy} className="btn-primary" style={{ flex: 1, opacity: busy ? 0.6 : 1 }}>{busy ? 'Connecting…' : 'Approve'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="row-sub" style={{ marginBottom: 8 }}>Paste the wc: link from the dApp's connect button.</div>
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="wc:..."
              spellCheck={false}
              className="field-input"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 10 }}
            />
            <button onClick={pair} disabled={busy || !uri.trim()} className="btn-primary" style={{ width: '100%', opacity: (busy || !uri.trim()) ? 0.6 : 1 }}>
              {busy ? 'Pairing…' : 'Pair'}
            </button>

            <div className="row-sub" style={{ marginTop: 12, fontSize: 10, lineHeight: 1.5 }}>
              Sessions are kept alive in the background — the relay socket runs in an offscreen document
              so closing this popup no longer ends the connection.
            </div>

            {sessions.length > 0 && (
              <>
                <div className="section-header" style={{ marginTop: 16 }}>Connected</div>
                <div className="card list">
                  {sessions.map((s, i) => (
                    <div key={s.topic} className={`row ${i < sessions.length - 1 ? 'row-border' : ''}`}>
                      <div className="row-avatar" style={{ background: 'rgba(59,122,247,0.18)', color: '#3b7af7' }}><Globe size={14}/></div>
                      <div className="row-mid">
                        <div className="row-name">{s.name}</div>
                        <div className="row-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                      </div>
                      <button onClick={() => disconnect(s.topic)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }}>Disconnect</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {err && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(248,113,113,0.10)', color: '#f87171', fontSize: 12 }}>{err}</div>}
      </div>
    </div>
  );
}
