'use client';
/**
 * First-run Lithosphere Makalu prompts (web).
 *
 * Two surfaces, per client request (Esha, 2026-06-15) — "prompt first-time
 * users to add the Lithosphere network":
 *
 *   1. <AddNetworkNudge>  — if the visitor has an EXTERNAL injected wallet
 *      (MetaMask etc.), a one-time bottom banner offers a one-click
 *      "Add Lithosphere Makalu" via EIP-3085 wallet_addEthereumChain. This
 *      is the proactive version of @thanos/connect's ensureMakaluNetwork(),
 *      which only fires at dApp sign-in.
 *
 *   2. <MakaluWelcomeCard> — the first time a user lands in the unlocked
 *      Thanos wallet, a one-time card introduces the Lithosphere Makalu
 *      home network (chain 700777). Informational; no external wallet.
 *
 * Both self-gate: they read a localStorage flag on mount and render null
 * once it's set, so mounting them unconditionally in the shell is safe.
 * The "shown" flag is written the moment the prompt is displayed, so each
 * appears at most once per browser even across reloads.
 */
import React, { useEffect, useState } from 'react';

/* Canonical Makalu params — identical to @thanos/connect ensureMakaluNetwork
   and the WalletConnect signer, so every surface adds the same chain. */
const MAKALU_CHAIN_ID = 700777;
const MAKALU_PARAMS = {
  chainId: `0x${MAKALU_CHAIN_ID.toString(16)}`, // 0xab169
  chainName: 'Lithosphere Makalu',
  rpcUrls: ['https://rpc.litho.ai'],
  blockExplorerUrls: ['https://makalu.litho.ai/'],
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
} as const;

const NUDGE_FLAG   = 'thanos.makalu_addnet_nudge.v1';
const WELCOME_FLAG = 'thanos.makalu_welcome.v1';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isThanos?: boolean;
  isMetaMask?: boolean;
}
function getInjected(): InjectedProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as any).ethereum as InjectedProvider | undefined;
  if (!eth) return null;
  // Don't nudge our own wallet to add its own home network.
  if (eth.isThanos) return null;
  return eth;
}

function readFlag(key: string): boolean {
  try { return typeof window !== 'undefined' && localStorage.getItem(key) === '1'; }
  catch { return false; }
}
function writeFlag(key: string) {
  try { localStorage.setItem(key, '1'); } catch { /* storage disabled — show once per session at worst */ }
}

/* ─── 1. Injected-wallet nudge ─────────────────────────────────────────── */

export function AddNetworkNudge() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus]   = useState<'idle' | 'adding' | 'added' | 'error'>('idle');

  useEffect(() => {
    // Defer one tick so injected providers (which announce asynchronously)
    // have a chance to attach to window.ethereum before we check.
    const t = setTimeout(() => {
      if (readFlag(NUDGE_FLAG)) return;
      if (!getInjected()) return;
      setVisible(true);
      writeFlag(NUDGE_FLAG); // strictly once per browser
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const addNetwork = async () => {
    const eth = getInjected();
    if (!eth) { setVisible(false); return; }
    setStatus('adding');
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [MAKALU_PARAMS] });
      setStatus('added');
      setTimeout(() => setVisible(false), 1400);
    } catch {
      // User declined or wallet unsupported — non-fatal. Let them dismiss.
      setStatus('error');
    }
  };

  return (
    <div style={{
      position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60,
      maxWidth: 440, margin: '0 auto',
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 14, padding: '14px 16px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: '#3b7af7', color: '#fff', fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
      }}>L</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Add Lithosphere Makalu</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {status === 'added'
            ? 'Network added to your wallet ✓'
            : status === 'error'
              ? 'Could not add — open your wallet and try again.'
              : 'One click to add the Lithosphere network to your wallet.'}
        </div>
      </div>
      {status !== 'added' && (
        <>
          <button
            type="button" className="btn-primary"
            style={{ padding: '7px 12px', fontSize: 12 }}
            disabled={status === 'adding'}
            onClick={addNetwork}
          >
            {status === 'adding' ? 'Adding…' : 'Add network'}
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setVisible(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}
          >✕</button>
        </>
      )}
    </div>
  );
}

/* ─── 2. In-wallet welcome card ────────────────────────────────────────── */

export function MakaluWelcomeCard() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readFlag(WELCOME_FLAG)) return;
    setVisible(true);
    writeFlag(WELCOME_FLAG);
  }, []);

  if (!visible) return null;

  return (
    <div className="modal-backdrop" onClick={() => setVisible(false)}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '100%', textAlign: 'center', padding: 28 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
          background: '#3b7af7', color: '#fff', fontWeight: 800, fontSize: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>L</div>
        <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 6px' }}>Welcome to Thanos</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 6px' }}>
          Your wallet is on the <strong>Lithosphere Makalu</strong> network
          (chain&nbsp;{MAKALU_CHAIN_ID}) — the Web4 home chain. The native coin
          is <strong>LITHO</strong>; Bitcoin, Solana, Cosmos and EVM networks
          are built in too.
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 18px' }}>
          Explorer: makalu.litho.ai · RPC: rpc.litho.ai
        </p>
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setVisible(false)}>
          Got it
        </button>
      </div>
    </div>
  );
}
