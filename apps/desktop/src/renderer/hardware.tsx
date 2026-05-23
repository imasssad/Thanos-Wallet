/**
 * Hardware-wallet connect modal (desktop) — Ledger + Trezor.
 *
 * Ledger uses @ledgerhq/hw-transport-webhid; Trezor uses
 * @trezor/connect-web (iframe → connect.trezor.io). Both succeed once
 * the Electron main allow-lists their USB vendor IDs (see
 * apps/desktop/src/main/index.ts setDevicePermissionHandler).
 *
 * This modal is a connectivity check: it derives the first EVM account
 * at m/44'/60'/0'/0/0 and surfaces the address. The Send flow has its
 * own per-tx connect (SendModal "Sign with → Ledger/Trezor") and uses
 * the same underlying ledger-sign / trezor-sign helpers.
 */
import React, { useState } from 'react';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';
import { connectTrezor } from './trezor-sign';

const HD_PATH = "44'/60'/0'/0/0";

type Tab = 'ledger' | 'trezor';
interface Props { onClose: () => void; isDark: boolean }

export function HardwareModal({ onClose }: Props) {
  const [tab,  setTab]  = useState<Tab>('ledger');
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  const connectLedger = async () => {
    setBusy(true); setErr(null); setAddr(null);
    let transport: Awaited<ReturnType<typeof TransportWebHID.create>> | null = null;
    try {
      transport = await TransportWebHID.create();
      const eth = new Eth(transport);
      const { address } = await eth.getAddress(HD_PATH, /* boolDisplay */ true);
      setAddr(address);
    } catch (e) {
      const msg = (e as Error)?.message || 'Could not reach the device';
      setErr(msg.includes('0x6985') ? 'Rejected on device' : msg);
    } finally {
      try { await transport?.close(); } catch { /* best-effort */ }
      setBusy(false);
    }
  };

  const connectTrezorDevice = async () => {
    setBusy(true); setErr(null); setAddr(null);
    try {
      const conn = await connectTrezor();
      setAddr(conn.address);
    } catch (e) {
      const msg = (e as Error)?.message || 'Could not reach the Trezor';
      setErr(/cancelled|denied|rejected/i.test(msg) ? 'Rejected on device' : msg);
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next); setAddr(null); setErr(null);
  };

  const isLedger = tab === 'ledger';
  const connect  = isLedger ? connectLedger : connectTrezorDevice;

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Connect hardware wallet</div>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>

        {/* Device tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {(['ledger', 'trezor'] as const).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchTab(k)}
                disabled={busy}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
                  fontSize: 13, fontWeight: 700,
                  background: active ? 'var(--blue, #3b7af7)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                }}
              >
                {k === 'ledger' ? 'Ledger' : 'Trezor'}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
          {isLedger
            ? <>Plug in your Ledger, unlock it, and open the <b>Ethereum</b> app. Click <b>Connect</b>, then approve on the device.</>
            : <>Plug in your Trezor and click <b>Connect</b>. Approve the address request in the Trezor Connect window when it appears.</>}
        </div>

        {addr && (
          <div style={successBox}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Connected — first account</div>
            <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 13, wordBreak: 'break-all' }}>{addr}</div>
          </div>
        )}
        {err && <div style={errBox}>{err}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ ...btn, background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={connect} disabled={busy} style={{ ...btn, background: 'var(--blue, #3b7af7)', color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Connecting…' : addr ? 'Reconnect' : 'Connect'}
          </button>
        </div>
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
  padding: 22, width: 'min(460px, 92vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1,
};
const btn: React.CSSProperties = {
  flex: 1, padding: '11px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
};
const successBox: React.CSSProperties = {
  padding: 12, borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', marginBottom: 12,
};
const errBox: React.CSSProperties = {
  padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)',
  color: 'var(--red, #f87171)', fontSize: 13, marginBottom: 12,
};
