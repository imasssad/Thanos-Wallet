'use client';
/**
 * First-run Lithosphere Mainnet prompts (web).
 *
 * Two surfaces, per client request (Esha, 2026-06-15) — "prompt first-time
 * users to add the Lithosphere network":
 *
 *   1. <AddNetworkNudge>  — if the visitor has an EXTERNAL injected wallet
 *      (MetaMask etc.), a one-time bottom banner offers a one-click
 *      "Add Lithosphere" (Mainnet, chain 9005) via EIP-3085
 *      wallet_addEthereumChain.
 *
 *   2. <MainnetWelcomeCard> — a one-time card introducing Lithosphere
 *      Mainnet, the wallet's home network. Informational; no external wallet.
 *
 * Both used to point at the Makalu testnet, which the wallet no longer
 * includes (2026-09-29); their "shown" flags were renamed so existing users
 * see the Mainnet versions once — the welcome is where they learn a Makalu
 * balance now needs Makalu added back as a custom network.
 *
 * Both self-gate: they read a localStorage flag on mount and render null
 * once it's set, so mounting them unconditionally in the shell is safe.
 * The "shown" flag is written the moment the prompt is displayed, so each
 * appears at most once per browser even across reloads.
 */
import React, { useEffect, useState } from 'react';

/* Lithosphere Mainnet params — the same chain the wallet's registry uses
   (lib/evm-chains.ts, chain 9005). */
const MAINNET_CHAIN_ID = 9005;
const MAINNET_PARAMS = {
  chainId: `0x${MAINNET_CHAIN_ID.toString(16)}`, // 0x232d
  chainName: 'Lithosphere',
  rpcUrls: ['https://rpc-mainnet.litho.ai'],
  blockExplorerUrls: ['https://lithoscan.ai/'],
  nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
} as const;

const NUDGE_FLAG   = 'thanos.mainnet_addnet_nudge.v1';
const WELCOME_FLAG = 'thanos.mainnet_welcome.v1';

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
      await eth.request({ method: 'wallet_addEthereumChain', params: [MAINNET_PARAMS] });
      setStatus('added');
      setTimeout(() => setVisible(false), 1400);
    } catch {
      // User declined or wallet unsupported — non-fatal. Let them dismiss.
      setStatus('error');
    }
  };

  const walletName = getInjected()?.isMetaMask ? 'MetaMask' : 'your browser wallet';
  // .btn-primary/.btn-outline are full-width form buttons; here they're sized
  // to their labels so the text keeps the row (they squeezed it to one word
  // per line before).
  const actionBtn: React.CSSProperties = {
    width: 'auto', height: 36, padding: '0 16px', fontSize: 13, fontWeight: 600,
    borderRadius: 10, whiteSpace: 'nowrap',
  };

  return (
    <div
      role="dialog" aria-label="Add Lithosphere to your wallet"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60,
        maxWidth: 420, margin: '0 auto',
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 16, padding: 16,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apple-touch-icon.png" alt="" width={40} height={40}
             style={{ flexShrink: 0, borderRadius: 10 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
            {status === 'added' ? 'Lithosphere added' : 'Add Lithosphere to your wallet'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 2 }}>
            {status === 'added'
              ? `${walletName === 'MetaMask' ? 'MetaMask' : 'Your wallet'} can now use Lithosphere Mainnet.`
              : status === 'error'
                ? `${walletName === 'MetaMask' ? 'MetaMask' : 'Your wallet'} didn’t add it. Open it and try again.`
                : `Use Lithosphere Mainnet (LITHO) in ${walletName}. It takes one click.`}
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setVisible(false)}
          style={{
            flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4, marginTop: -2,
          }}
        >✕</button>
      </div>
      {status !== 'added' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-outline" style={actionBtn} onClick={() => setVisible(false)}>
            Not now
          </button>
          <button
            type="button" className="btn-primary" style={actionBtn}
            disabled={status === 'adding'}
            onClick={addNetwork}
          >
            {status === 'adding' ? 'Adding…' : 'Add network'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── 2. In-wallet welcome card ────────────────────────────────────────── */

export function MainnetWelcomeCard() {
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos" width={64} height={64}
             style={{ display: 'block', margin: '0 auto 16px', objectFit: 'contain' }}/>
        <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 6px' }}>Welcome to Thanos</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 6px' }}>
          Your wallet is on <strong>Lithosphere Mainnet</strong>
          (chain&nbsp;{MAINNET_CHAIN_ID}). The native coin is <strong>LITHO</strong>;
          Bitcoin, Solana, Cosmos and EVM networks are built in too.
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 18px' }}>
          Testnets such as Makalu aren&apos;t included — add one in Settings → Custom networks &amp; tokens.
        </p>
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => setVisible(false)}>
          Got it
        </button>
      </div>
    </div>
  );
}
