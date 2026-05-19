'use client';
/**
 * Connect-a-Ledger modal — multi-coin (ETH / BTC / SOL).
 *
 * Each coin gets its own tab, its own discovery path, and its own
 * remembered "active account" in localStorage. The user opens the
 * matching Ledger app on the device for each tab (Ethereum / Bitcoin /
 * Solana — they cannot be open simultaneously). When an active account
 * is set, the Send modal routes that coin's broadcast through Ledger
 * instead of the in-vault key.
 *
 * Saved keys:
 *   thanos.ledger_account     → EVM (set by setActiveLedgerAccount)
 *   thanos.ledger.btc         → Bitcoin (setActiveLedgerBtcAccount)
 *   thanos.ledger.sol         → Solana  (setActiveLedgerSolAccount)
 */
import React, { useState } from 'react';
import { discoverAccounts, disconnect, LedgerError, type LedgerAccount } from '../lib/ledger';
import { discoverBtcAccounts, type LedgerBtcAccount } from '../lib/ledger-btc';
import { discoverSolAccounts, type LedgerSolAccount } from '../lib/ledger-sol';
import {
  getActiveLedgerBtcAccount, setActiveLedgerBtcAccount,
  getActiveLedgerSolAccount, setActiveLedgerSolAccount,
} from '../lib/ledger-accounts';
import { closeLedgerTransport } from '../lib/ledger-transport';
import { Wallet as WalletIcon } from 'lucide-react';

const STORAGE_KEY = 'thanos.ledger_account';

/* ─── ETH active-account helpers (legacy single-account API) ─────── */

export function getActiveLedgerAccount(): LedgerAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LedgerAccount) : null;
  } catch { return null; }
}
export function setActiveLedgerAccount(acc: LedgerAccount | null): void {
  if (typeof window === 'undefined') return;
  if (acc) localStorage.setItem(STORAGE_KEY, JSON.stringify(acc));
  else     localStorage.removeItem(STORAGE_KEY);
}

/* ─── Coin tabs ──────────────────────────────────────────────────── */

type Coin = 'eth' | 'btc' | 'sol';
const TABS: { id: Coin; label: string; subtitle: string }[] = [
  { id: 'eth', label: 'Lithosphere / Ethereum / EVM',  subtitle: 'Open the Ethereum app' },
  { id: 'btc', label: 'Bitcoin',   subtitle: 'Open the Bitcoin app'  },
  { id: 'sol', label: 'Solana',    subtitle: 'Open the Solana app'   },
];

type Stage = 'idle' | 'connecting' | 'picker' | 'done';

export function LedgerModal({ onClose }: { onClose: () => void }) {
  const [coin, setCoin] = useState<Coin>('eth');

  // Per-coin state — kept in three records so switching tabs preserves
  // discovery results (USB connection is idempotent across tabs too).
  const [stage, setStage] = useState<Record<Coin, Stage>>({ eth: 'idle', btc: 'idle', sol: 'idle' });
  const [error, setError] = useState<Record<Coin, string | null>>({ eth: null, btc: null, sol: null });

  const [ethAccs,   setEthAccs]   = useState<LedgerAccount[]>([]);
  const [btcAccs,   setBtcAccs]   = useState<LedgerBtcAccount[]>([]);
  const [solAccs,   setSolAccs]   = useState<LedgerSolAccount[]>([]);

  const [ethActive, setEthActive] = useState<LedgerAccount | null>(getActiveLedgerAccount());
  const [btcActive, setBtcActive] = useState<LedgerBtcAccount | null>(typeof window === 'undefined' ? null : getActiveLedgerBtcAccount());
  const [solActive, setSolActive] = useState<LedgerSolAccount | null>(typeof window === 'undefined' ? null : getActiveLedgerSolAccount());

  const setStg = (c: Coin, v: Stage) => setStage(s => ({ ...s, [c]: v }));
  const setErr = (c: Coin, v: string | null) => setError(e => ({ ...e, [c]: v }));

  const onConnect = async () => {
    setErr(coin, null);
    setStg(coin, 'connecting');
    try {
      if (coin === 'eth') {
        const accs = await discoverAccounts(5);
        setEthAccs(accs);
      } else if (coin === 'btc') {
        const accs = await discoverBtcAccounts(5);
        setBtcAccs(accs);
      } else {
        const accs = await discoverSolAccounts(5);
        setSolAccs(accs);
      }
      setStg(coin, 'picker');
    } catch (e) {
      const msg = e instanceof LedgerError ? e.message : (e as Error).message || 'Failed to connect';
      setErr(coin, msg);
      setStg(coin, 'idle');
    }
  };

  const onPickEth = (acc: LedgerAccount) => {
    setActiveLedgerAccount(acc); setEthActive(acc); setStg('eth', 'done');
  };
  const onPickBtc = (acc: LedgerBtcAccount) => {
    setActiveLedgerBtcAccount(acc); setBtcActive(acc); setStg('btc', 'done');
  };
  const onPickSol = (acc: LedgerSolAccount) => {
    setActiveLedgerSolAccount(acc); setSolActive(acc); setStg('sol', 'done');
  };

  const onDisconnect = async () => {
    if (coin === 'eth') { setActiveLedgerAccount(null);    setEthActive(null); setEthAccs([]); }
    if (coin === 'btc') { setActiveLedgerBtcAccount(null); setBtcActive(null); setBtcAccs([]); }
    if (coin === 'sol') { setActiveLedgerSolAccount(null); setSolActive(null); setSolAccs([]); }
    // EVM path uses lib/ledger.ts's own transport singleton; the new BTC +
    // SOL libs share lib/ledger-transport.ts. Close both for safety.
    await disconnect().catch(() => {});
    await closeLedgerTransport().catch(() => {});
    setStg(coin, 'idle');
  };

  /* Per-coin shared bits — active account card, idle, picker, done. */
  const active =
    coin === 'eth' ? ethActive :
    coin === 'btc' ? btcActive :
    solActive;
  const accs: Array<{ address: string; path: string }> =
    coin === 'eth' ? ethAccs :
    coin === 'btc' ? btcAccs.map(a => ({ address: a.address, path: a.path })) :
    solAccs.map(a => ({ address: a.address, path: a.path }));
  const s   = stage[coin];
  const err = error[coin];
  const tab = TABS.find(t => t.id === coin)!;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Ledger</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Coin tabs */}
          <div style={{
            display: 'inline-flex', gap: 4, padding: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 12, marginBottom: 14, width: 'fit-content',
          }}>
            {TABS.map(t => {
              const isActive = coin === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setCoin(t.id)}
                  style={{
                    padding: '6px 12px', borderRadius: 8,
                    border: 'none', cursor: 'pointer',
                    background: isActive ? 'var(--bg-surface)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600,
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Active account card */}
          {active && s !== 'picker' && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: 'var(--text-muted)' }}>
                CONNECTED · {tab.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Ledger · m/{active.path}</div>
              <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
                {active.address}
              </div>
              <button className="btn-outline" style={{ width: '100%', marginTop: 10 }} onClick={onDisconnect}>
                Disconnect
              </button>
            </div>
          )}

          {/* Idle */}
          {s === 'idle' && !active && (
            <>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 10, padding: '14px 0 6px',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'rgba(59,122,247,0.14)',
                  border: '1px solid rgba(59,122,247,0.30)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <WalletIcon size={26} color="var(--blue)"/>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Connect your Ledger</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, maxWidth: 280 }}>
                  Plug in the device, unlock it, and <b>{tab.subtitle.toLowerCase()}</b>.
                  The browser will prompt you to choose the device.
                </div>
              </div>
              {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
              <button className="btn-primary" style={{ marginTop: 18 }} onClick={onConnect}>
                Connect {tab.label}
              </button>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                Requires Chrome / Edge / Brave (WebUSB).
                Firefox &amp; Safari users: use the desktop app.
              </div>
            </>
          )}

          {/* Connecting */}
          {s === 'connecting' && (
            <div style={{ padding: '28px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading from device…</div>
            </div>
          )}

          {/* Picker */}
          {s === 'picker' && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 8 }}>
                CHOOSE AN ACCOUNT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accs.map((acc, i) => (
                  <button
                    key={acc.address}
                    onClick={() => {
                      if (coin === 'eth') onPickEth(ethAccs[i]!);
                      else if (coin === 'btc') onPickBtc(btcAccs[i]!);
                      else onPickSol(solAccs[i]!);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: 6,
                      background: 'var(--bg-card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                      fontFamily: 'Geist Mono, monospace',
                    }}>
                      {i}
                    </div>
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
                Send flows for {tab.label} will route through this Ledger.
              </div>
              <button className="btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
