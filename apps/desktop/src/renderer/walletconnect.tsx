/**
 * WalletConnect pairing on desktop. Reuses @reown/walletkit + the public
 * Reown relay — the same code path the web app uses, ported into the
 * Electron renderer.
 *
 * Paste a `wc:` URI from the dApp's connect button → kit.pair() →
 * incoming session_proposal triggers an approve sheet. Lists active
 * sessions with disconnect.
 *
 * The signing side (session_request → user approval → sign with the
 * unlocked seed) is the next slice: this module gets the pairing live
 * end-to-end against any production dApp's WalletConnect button.
 */
import React, { useEffect, useState } from 'react';
import type { IWalletKit } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';
import { useWalletSeed } from './send';
import { executeWcRequest, summariseRequest, WcSignerError } from './wc-signer';

interface PendingRequest {
  id:     number;
  topic:  string;
  method: string;
  params: unknown[];
  name:   string;
}

const MAKALU = 700777;
// SAFETY: advertise ONLY the chains the signing path actually honours.
// Every request handler in this client broadcasts via the MAKALU
// provider regardless of the namespace the dApp asked on - advertising
// mainnet/Polygon/etc. let a dApp think it was getting an eip155:1 tx
// while the wallet broadcast on 700777 (chain-mismatch hazard, flagged
// by the 2026-06 security audit). Re-add ids here ONLY together with
// per-chain provider routing in the request handler.
const SUPPORTED_EVM = [MAKALU];
const NS_CHAINS  = SUPPORTED_EVM.map((id) => `eip155:${id}`);
const METHODS    = [
  'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

let kitPromise: Promise<IWalletKit> | null = null;

export async function listActiveSessions(): Promise<Record<string, SessionTypes.Struct>> {
  const kit = await getKit();
  return kit.getActiveSessions();
}

export async function disconnectSession(topic: string): Promise<void> {
  const kit = await getKit();
  await kit.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected' } });
}

async function getKit(): Promise<IWalletKit> {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const { Core } = await import('@walletconnect/core');
    const { WalletKit } = await import('@reown/walletkit');
    const projectId =
      (typeof process !== 'undefined' && (process.env?.NEXT_PUBLIC_REOWN_PROJECT_ID || process.env?.REOWN_PROJECT_ID)) ||
      '6d05d9a84112ca2f7c1bb77a76a18c81'; // shared with CI; replace with your own
    const core = new Core({ projectId });
    return WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet (Desktop)',
        description: 'Lithosphere-first multi-chain wallet',
        url:         'https://thanos.fi',
        icons:       ['https://thanos.fi/images/Thanos_Logo.png'],
      },
    });
  })();
  return kitPromise;
}

interface SessionRow { topic: string; name: string; url: string }

function projectSession(s: SessionTypes.Struct): SessionRow {
  return {
    topic: s.topic,
    name:  s.peer?.metadata?.name ?? 'Unknown dApp',
    url:   s.peer?.metadata?.url  ?? '',
  };
}

export function WalletConnectModal({ evmAddress, onClose }: { evmAddress: string; onClose: () => void }) {
  const seed = useWalletSeed();
  const [uri, setUri]               = useState('');
  const [busy, setBusy]             = useState(false);
  const [err,  setErr]              = useState<string | null>(null);
  const [sessions, setSessions]     = useState<SessionRow[]>([]);
  const [proposal, setProposal]     = useState<{ id: number; name: string } | null>(null);
  const [pending, setPending]       = useState<PendingRequest | null>(null);

  // Keep the active-sessions list in sync.
  const refresh = async () => {
    try {
      const kit = await getKit();
      setSessions(Object.values(kit.getActiveSessions()).map(projectSession));
    } catch { /* relay not ready yet */ }
  };

  useEffect(() => {
    let cancel = false;
    (async () => {
      const kit = await getKit();
      if (cancel) return;
      kit.on('session_proposal', (p) => {
        const name = p.params.proposer.metadata?.name ?? 'dApp';
        setProposal({ id: p.id, name });
        void window.thanosDesktop?.notify?.('Connection request', `${name} wants to connect to your wallet.`);
      });
      kit.on('session_delete', () => void refresh());
      kit.on('session_request', (event) => {
        const session = kit.getActiveSessions()[event.topic];
        const method = event.params.request.method;
        const name = session?.peer?.metadata?.name ?? 'dApp';
        setPending({
          id:     event.id,
          topic:  event.topic,
          method,
          params: (event.params.request.params as unknown[]) ?? [],
          name,
        });
        const title = method === 'eth_sendTransaction' || method === 'eth_signTransaction'
          ? 'Transaction request' : 'Signature request';
        void window.thanosDesktop?.notify?.(title, `${name} is requesting your approval.`);
      });
      void refresh();
    })().catch((e) => setErr((e as Error).message));
    return () => { cancel = true; };
  }, []);

  const approveRequest = async () => {
    if (!pending) return;
    setBusy(true); setErr(null);
    try {
      const kit = await getKit();
      const result = await executeWcRequest(seed, { request: { method: pending.method, params: pending.params } });
      await kit.respondSessionRequest({
        topic:    pending.topic,
        response: { id: pending.id, jsonrpc: '2.0', result },
      });
      setPending(null);
    } catch (e) {
      const code = e instanceof WcSignerError ? e.code : -32603;
      const message = (e as Error)?.message || 'Sign failed';
      // Respond with an RPC error so the dApp sees a clean rejection.
      try {
        const kit = await getKit();
        await kit.respondSessionRequest({
          topic:    pending.topic,
          response: { id: pending.id, jsonrpc: '2.0', error: { code, message } },
        });
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
      const kit = await getKit();
      await kit.respondSessionRequest({
        topic:    pending.topic,
        response: { id: pending.id, jsonrpc: '2.0', error: { code: 5000, message: 'User rejected' } },
      });
    } finally { setPending(null); }
  };

  const pair = async () => {
    if (!uri.trim()) return;
    setBusy(true); setErr(null);
    try {
      const kit = await getKit();
      await kit.pair({ uri: uri.trim() });
      setUri('');
    } catch (e) {
      setErr((e as Error).message || 'Pairing failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!proposal || !evmAddress) return;
    setBusy(true); setErr(null);
    try {
      const kit = await getKit();
      const accounts = NS_CHAINS.map((c) => `${c}:${evmAddress}`);
      await kit.approveSession({
        id: proposal.id,
        namespaces: { eip155: { chains: NS_CHAINS, methods: METHODS, events: EVENTS, accounts } },
      });
      setProposal(null);
      await refresh();
    } catch (e) {
      setErr((e as Error).message || 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!proposal) return;
    try {
      const kit = await getKit();
      await kit.rejectSession({ id: proposal.id, reason: { code: 5000, message: 'User rejected' } });
    } finally { setProposal(null); }
  };

  const disconnect = async (topic: string) => {
    try {
      const kit = await getKit();
      await kit.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected' } });
    } finally { await refresh(); }
  };

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>WalletConnect</div>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>

        {pending ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              {pending.method === 'eth_sendTransaction' ? 'Transaction request' : 'Signature request'} from
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{pending.name}</div>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              borderRadius: 10, padding: 12, maxHeight: 200, overflowY: 'auto', marginBottom: 14,
            }}>
              {summariseRequest(pending.method, pending.params)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={rejectRequest}  disabled={busy} style={{ ...btn, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-primary)', opacity: busy ? 0.6 : 1 }}>Reject</button>
              <button onClick={approveRequest} disabled={busy || !seed.length} style={{ ...btn, background: 'var(--blue, #3b7af7)', color: '#fff', opacity: (busy || !seed.length) ? 0.6 : 1 }}>
                {busy ? 'Signing…' : pending.method === 'eth_sendTransaction' ? 'Approve & Send' : 'Approve & Sign'}
              </button>
            </div>
            {!seed.length && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Wallet is locked — unlock to sign.</div>}
          </>
        ) : proposal ? (
          <>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>
              <b>{proposal.name}</b> wants to connect to your wallet on Makalu + 8 EVM chains.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={reject}  style={{ ...btn, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>Reject</button>
              <button onClick={approve} disabled={busy} style={{ ...btn, background: 'var(--blue, #3b7af7)', color: '#fff', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Connecting…' : 'Approve'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Paste the wc: link from the dApp's connect button.</div>
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="wc:..."
              spellCheck={false}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border-default)',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'Geist Mono, monospace',
                marginBottom: 10,
              }}
            />
            <button onClick={pair} disabled={busy || !uri.trim()} style={{ ...btn, background: 'var(--blue, #3b7af7)', color: '#fff', width: '100%', opacity: (busy || !uri.trim()) ? 0.6 : 1 }}>
              {busy ? 'Pairing…' : 'Pair'}
            </button>

            {sessions.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.4, marginBottom: 8, textTransform: 'uppercase' }}>Connected</div>
                {sessions.map((s) => (
                  <div key={s.topic} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.url}</div>
                    </div>
                    <button onClick={() => disconnect(s.topic)} style={{ ...btn, padding: '6px 12px', fontSize: 12, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>Disconnect</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {err && <div style={errBox}>{err}</div>}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const sheet: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-default)',
  padding: 22, width: 'min(480px, 92vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1,
};
const btn: React.CSSProperties = {
  flex: 1, padding: '11px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
};
const errBox: React.CSSProperties = {
  marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.10)',
  border: '1px solid rgba(248,113,113,0.35)', color: 'var(--red, #f87171)', fontSize: 13,
};
