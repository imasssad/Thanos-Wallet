/**
 * WalletConnect pair + approve sheet for the extension popup.
 *
 * MV3 service-workers terminate after ~30s idle, which kills any
 * persistent WC relay socket. So this sheet runs the kit in the POPUP
 * context: the user opens the popup, pastes a wc: URI, approves the
 * incoming session_proposal, and the dApp's connect button completes.
 * Once the popup closes the relay disconnects — the dApp side handles
 * the resulting expiry like any other wallet disconnect.
 *
 * Full background-persistent sessions are the next slice (Chrome
 * offscreen documents or alarms-kept-alive service worker).
 */
import React, { useEffect, useState } from 'react';
import { Globe, ChevronLeft } from 'lucide-react';
import type { IWalletKit } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';

const MAKALU = 700777;
const SUPPORTED_EVM = [MAKALU, 1, 56, 137, 8453, 42161, 59144, 10, 43114];
const NS_CHAINS = SUPPORTED_EVM.map((id) => `eip155:${id}`);
const METHODS = [
  'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

let kitPromise: Promise<IWalletKit> | null = null;
async function getKit(): Promise<IWalletKit> {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const { Core } = await import('@walletconnect/core');
    const { WalletKit } = await import('@reown/walletkit');
    const projectId =
      (typeof process !== 'undefined' && process.env?.WXT_REOWN_PROJECT_ID) ||
      '6d05d9a84112ca2f7c1bb77a76a18c81';
    const core = new Core({ projectId });
    return WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet (Extension)',
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
  const [uri, setUri]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [err,  setErr]          = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [proposal, setProposal] = useState<{ id: number; name: string } | null>(null);

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
      kit.on('session_proposal', (p) => setProposal({ id: p.id, name: p.params.proposer.metadata?.name ?? 'dApp' }));
      kit.on('session_delete', () => void refresh());
      void refresh();
    })().catch((e) => setErr((e as Error).message));
    return () => { cancel = true; };
  }, []);

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
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: 4, display: 'inline-flex' }}>
          <ChevronLeft size={20}/>
        </button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>WalletConnect</div>
      </div>

      <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
        {proposal ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="row-avatar" style={{ background: 'rgba(59,122,247,0.18)', color: '#3b7af7' }}><Globe size={16}/></div>
              <div className="row-mid">
                <div className="row-name">{proposal.name}</div>
                <div className="row-sub">Wants to connect on Makalu + 8 EVM chains</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={reject}  className="btn-secondary"  style={{ flex: 1 }}>Reject</button>
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
              Note: closing this popup ends the live relay connection (MV3 limitation). Sessions are best-effort — the dApp will reconnect when you reopen the popup.
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
