'use client';
/**
 * Connect-a-Trezor modal — multi-coin (ETH / BTC / SOL).
 *
 * Parallel to LedgerModal. Trezor drives its own trusted popup, so
 * there's no transport to manage — each tab just discovers 5
 * derivations and the user picks one as the active account. Once set,
 * the Send modal routes that coin's broadcast through the device.
 *
 * Saved keys (lib/trezor-accounts.ts):
 *   thanos.trezor.evm / .btc / .sol
 */
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  discoverEvmAccounts, discoverBtcAccounts, discoverSolAccounts,
  TrezorError, type TrezorAccount,
} from '../lib/trezor';
import {
  getActiveTrezorEvmAccount, setActiveTrezorEvmAccount,
  getActiveTrezorBtcAccount, setActiveTrezorBtcAccount,
  getActiveTrezorSolAccount, setActiveTrezorSolAccount,
} from '../lib/trezor-accounts';

type Coin  = 'evm' | 'btc' | 'sol';
type Stage = 'idle' | 'connecting' | 'picker' | 'done';

const TABS: { id: Coin; label: string; hint: string }[] = [
  { id: 'evm', label: 'Lithosphere / Ethereum / EVM', hint: 'Lithosphere Makalu + every EVM chain — Ethereum, BNB, Polygon, etc.' },
  { id: 'btc', label: 'Bitcoin',        hint: 'Native segwit (BIP84) accounts' },
  { id: 'sol', label: 'Solana',         hint: 'Solana accounts' },
];

export function TrezorModal({ onClose }: { onClose: () => void }) {
  const [coin, setCoin] = useState<Coin>('evm');
  const [stage, setStage] = useState<Record<Coin, Stage>>({ evm: 'idle', btc: 'idle', sol: 'idle' });
  const [error, setError] = useState<Record<Coin, string | null>>({ evm: null, btc: null, sol: null });
  const [accs, setAccs]   = useState<Record<Coin, TrezorAccount[]>>({ evm: [], btc: [], sol: [] });

  const [evmActive, setEvmActive] = useState<TrezorAccount | null>(typeof window === 'undefined' ? null : getActiveTrezorEvmAccount());
  const [btcActive, setBtcActive] = useState<TrezorAccount | null>(typeof window === 'undefined' ? null : getActiveTrezorBtcAccount());
  const [solActive, setSolActive] = useState<TrezorAccount | null>(typeof window === 'undefined' ? null : getActiveTrezorSolAccount());

  const setStg = (c: Coin, v: Stage) => setStage(s => ({ ...s, [c]: v }));
  const setErr = (c: Coin, v: string | null) => setError(e => ({ ...e, [c]: v }));

  const onConnect = async () => {
    setErr(coin, null);
    setStg(coin, 'connecting');
    try {
      const discovered =
        coin === 'evm' ? await discoverEvmAccounts(5) :
        coin === 'btc' ? await discoverBtcAccounts(5) :
                         await discoverSolAccounts(5);
      setAccs(a => ({ ...a, [coin]: discovered }));
      setStg(coin, 'picker');
    } catch (e) {
      const msg = e instanceof TrezorError ? e.message : (e as Error).message || 'Failed to connect';
      setErr(coin, msg);
      setStg(coin, 'idle');
    }
  };

  const onPick = (acc: TrezorAccount) => {
    if (coin === 'evm') { setActiveTrezorEvmAccount(acc); setEvmActive(acc); }
    if (coin === 'btc') { setActiveTrezorBtcAccount(acc); setBtcActive(acc); }
    if (coin === 'sol') { setActiveTrezorSolAccount(acc); setSolActive(acc); }
    setStg(coin, 'done');
  };

  const onDisconnect = () => {
    if (coin === 'evm') { setActiveTrezorEvmAccount(null); setEvmActive(null); }
    if (coin === 'btc') { setActiveTrezorBtcAccount(null); setBtcActive(null); }
    if (coin === 'sol') { setActiveTrezorSolAccount(null); setSolActive(null); }
    setAccs(a => ({ ...a, [coin]: [] }));
    setStg(coin, 'idle');
  };

  const active = coin === 'evm' ? evmActive : coin === 'btc' ? btcActive : solActive;
  const list   = accs[coin];
  const s      = stage[coin];
  const err    = error[coin];
  const tab    = TABS.find(t => t.id === coin)!;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Trezor</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Coin tabs */}
          <div style={{
            display: 'inline-flex', gap: 4, padding: 4, marginBottom: 14, width: 'fit-content',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 12,
          }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setCoin(t.id)}
                style={{
                  padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600,
                  background: coin === t.id ? 'var(--bg-surface)' : 'transparent',
                  color: coin === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: coin === t.id ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Active account */}
          {active && s !== 'picker' && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: 'var(--text-muted)' }}>
                CONNECTED · {tab.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Trezor · m/{active.path}</div>
              <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                {active.address}
              </div>
              <button className="btn-outline" style={{ width: '100%', marginTop: 10 }} onClick={onDisconnect}>
                Forget account
              </button>
            </div>
          )}

          {/* Idle */}
          {s === 'idle' && !active && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '14px 0 6px' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.30)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ShieldCheck size={26} color="var(--green)"/>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Connect your Trezor</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, maxWidth: 290 }}>
                  Plug in the Trezor and unlock it. A trusted Trezor popup will
                  open to confirm the connection — {tab.hint}.
                </div>
              </div>
              {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
              <button className="btn-primary" style={{ marginTop: 18 }} onClick={onConnect}>
                Connect Trezor
              </button>
            </>
          )}

          {/* Connecting */}
          {s === 'connecting' && (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Confirm on the Trezor popup…
            </div>
          )}

          {/* Picker */}
          {s === 'picker' && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 8 }}>
                CHOOSE AN ACCOUNT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((acc, i) => (
                  <button
                    key={acc.address}
                    onClick={() => onPick(acc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 10, background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, background: 'var(--bg-card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace',
                    }}>{i}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {acc.address}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>m/{acc.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Done */}
          {s === 'done' && (
            <div style={{ padding: '20px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 22, color: 'var(--green)' }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>Connected</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Send flows for {tab.label} will route through this Trezor.
              </div>
              <button className="btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
