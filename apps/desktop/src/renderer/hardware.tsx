/**
 * Hardware-wallet connect modal (desktop).
 *
 * Uses @ledgerhq/hw-transport-webhid in the renderer — Electron's
 * Chromium supports navigator.hid once the main process allows the
 * vendor IDs (see apps/desktop/src/main/index.ts setDevicePermissionHandler).
 *
 * For now this confirms the device + derives the first EVM account at
 * m/44'/60'/0'/0/0 and surfaces the address. Wiring it into the Send
 * flow (sign + broadcast) is the next slice — the transport is the gate
 * for everything that follows.
 */
import React, { useState } from 'react';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';

const HD_PATH = "44'/60'/0'/0/0";

interface Props { onClose: () => void; isDark: boolean }

export function HardwareModal({ onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  const connect = async () => {
    setBusy(true); setErr(null); setAddr(null);
    let transport: Awaited<ReturnType<typeof TransportWebHID.create>> | null = null;
    try {
      // Triggers the Electron HID picker (auto-selected on the main side
      // by select-hid-device → vendor allowlist).
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

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Connect Ledger</div>
          <button onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
          Plug in your Ledger, unlock it, and open the <b>Ethereum</b> app. Then click <b>Connect</b>
          and confirm on the device. Trezor support uses the same allowlist (vendor ID 0x534c / 0x1209)
          and lands once the renderer's Trezor flow is wired.
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
