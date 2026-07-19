'use client';
import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '../providers/ThemeProvider';
import { useWallet } from './AppShell';
import { Addr } from '../Addr';
import {
  Search, Bell, ChevronDown, Sun, Moon, User, Copy, Settings as SettingsIcon, Lock, Menu, KeyRound,
  Pencil, Trash2,
} from 'lucide-react';
import { getAccountName, getVisibleAccountIndices } from '../../lib/vault';

const ACCOUNT_NAME = 'RobbyWallet';

/* Trust Wallet-style vocabulary. Swap opens the existing swap modal and
   NFTs selects the home NFTs tab (both via a query param the dashboard
   reads) since neither has — or needs — a standalone route yet. Settings
   lives in the account menu, not the tab bar. */
const NAV = [
  { href: '/app',            label: 'Home'     },
  { href: '/app?swap=1',     label: 'Swap'     },
  { href: '/app/staking',    label: 'Earn'     },
  { href: '/app?tab=nfts',   label: 'NFTs'     },
  { href: '/app/assets',     label: 'Assets'   },
  { href: '/app/market',     label: 'Market'   },
  { href: '/app/discover',   label: 'Discover' },
  { href: '/app/history',    label: 'Activity' },
];

export function TopNav({
  onLock,
  activeIdx = 0,
  accountCount = 1,
  accountAddresses = [],
  onSwitchAccount,
  onAddAccount,
  onRenameAccount,
  onDeleteAccount,
}: {
  onLock?:          () => void;
  /** Current HD-derivation account (mnemonic wallets only). */
  activeIdx?:       number;
  accountCount?:    number;
  /** EVM address per account index — shown in the switcher so users can
   *  identify which numbered account is which. */
  accountAddresses?: string[];
  /** When set, the menu shows an Account-N switcher + "+ Add account". */
  onSwitchAccount?: (idx: number) => void;
  onAddAccount?:    () => void;
  /** Rename / remove an account. Removal is guarded by balance in AppShell. */
  onRenameAccount?: (idx: number) => void;
  onDeleteAccount?: (idx: number) => void;
}) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, toggleTheme } = useTheme();
  const wallet     = useWallet();
  const isDark = theme === 'dark';
  const [accountMenu, setAccountMenu] = useState(false);
  const [mobileMenu, setMobileMenu]   = useState(false);
  const showSwitcher = !!onSwitchAccount && accountCount >= 1;
  const accountLabel = `Account ${activeIdx + 1}`;
  const [addrFmt,  setAddrFmt]  = useState<'litho' | 'evm'>('litho');
  const [copiedFmt, setCopiedFmt] = useState<'litho' | 'evm' | null>(null);

  /* What the chip + dropdown render. Falls back to a friendly placeholder
     if the gate hasn't resolved yet (shouldn't happen — AppShell only
     mounts TopNav after unlock — but defensive). */
  const litho      = wallet?.addresses?.litho      ?? '';
  const evm        = wallet?.addresses?.evm        ?? '';
  const shortLitho = wallet?.addresses?.shortLitho ?? '—';
  const shortEvm   = wallet?.addresses?.shortEvm   ?? '—';

  const activeAddr   = addrFmt === 'litho' ? litho      : evm;
  const activeShort  = addrFmt === 'litho' ? shortLitho : shortEvm;

  const isActive = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname.startsWith(href);

  const copyAddr = (fmt: 'litho' | 'evm') => {
    const addr = fmt === 'litho' ? litho : evm;
    if (!addr) return;
    navigator.clipboard?.writeText(addr);
    setCopiedFmt(fmt);
    setTimeout(() => setCopiedFmt(null), 1600);
  };

  return (
    <nav className="topnav">
      <div className="topnav-logo">
        <div className="logo-mark">
          <img src="/images/Thanos_Logo.png" alt="Thanos" width={34} height={34} style={{ objectFit: 'contain' }}/>
        </div>
        <span className="logo-word">THANOS</span>
      </div>

      {/* Desktop nav tabs */}
      <div className="nav-tabs nav-tabs-desktop">
        {NAV.map(n => (
          <button
            key={n.href}
            className={`nav-tab ${isActive(n.href) ? 'active' : ''}`}
            onClick={() => router.push(n.href)}
          >
            {n.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }}/>

      <div className="topnav-right">
        <div style={{ position: 'relative' }}>
          <button className="account-chip" onClick={() => setAccountMenu(v => !v)} title={activeAddr}>
            <div className="chip-avatar">
              <User size={18}/>
            </div>
            <div className="chip-info">
              <span className="chip-name">{showSwitcher ? accountLabel : ACCOUNT_NAME}</span>
              <span className="chip-addr"><Addr value={activeAddr} head={8} tail={6}/></span>
            </div>
            <ChevronDown size={13} color="var(--text-muted)"/>
          </button>

          {accountMenu && (
            <>
              <div className="menu-overlay" onClick={() => setAccountMenu(false)}/>
              <div className="account-menu">
                <div className="menu-header">
                  <div className="menu-avatar"><User size={24}/></div>
                  <div>
                    <div className="menu-name">{showSwitcher ? accountLabel : ACCOUNT_NAME}</div>
                    <div className="menu-addr" title={activeAddr}><Addr value={activeAddr} head={8} tail={6}/></div>
                  </div>
                </div>
                <div className="menu-network">
                  <span className="menu-net-dot"/>
                  <span>Makalu</span>
                  <span className="menu-net-status">synced</span>
                </div>

                {/* Dual-address rows. Each shows the full address + a copy
                    affordance. Tapping the row also flips the chip preview
                    to that format. */}
                <div className="menu-divider"/>
                <div className="addr-row" onClick={() => setAddrFmt('litho')}>
                  <div className="addr-row-label">
                    <span className="addr-row-tag">LITHO1</span>
                    {addrFmt === 'litho' && <span className="addr-row-active">●</span>}
                  </div>
                  <div className="addr-row-value" title={litho}><Addr value={litho} head={8} tail={6}/></div>
                  <button
                    className="addr-row-copy"
                    onClick={e => { e.stopPropagation(); copyAddr('litho'); }}
                    title="Copy litho1 address"
                  >
                    {copiedFmt === 'litho' ? '✓' : <Copy size={14}/>}
                  </button>
                </div>
                <div className="addr-row" onClick={() => setAddrFmt('evm')}>
                  <div className="addr-row-label">
                    <span className="addr-row-tag">EVM 0x</span>
                    {addrFmt === 'evm' && <span className="addr-row-active">●</span>}
                  </div>
                  <div className="addr-row-value" title={evm}><Addr value={evm} head={6} tail={4}/></div>
                  <button
                    className="addr-row-copy"
                    onClick={e => { e.stopPropagation(); copyAddr('evm'); }}
                    title="Copy 0x address"
                  >
                    {copiedFmt === 'evm' ? '✓' : <Copy size={14}/>}
                  </button>
                </div>
                {showSwitcher && (
                  <>
                    <div className="menu-divider"/>
                    {getVisibleAccountIndices().map((i) => {
                      const a = accountAddresses[i];
                      // A wallet must always keep one account, so the last one
                      // can't be removed. Render the control DISABLED rather
                      // than hiding it — hiding made the feature look absent
                      // to anyone with a single account.
                      const lastAccount = getVisibleAccountIndices().length <= 1;
                      return (
                        <div
                          key={i}
                          className="menu-item"
                          style={{ alignItems: 'center', display: 'flex', gap: 8, ...(i === activeIdx ? { fontWeight: 700 } : {}) }}
                        >
                          <button
                            onClick={() => { onSwitchAccount?.(i); setAccountMenu(false); }}
                            style={{
                              flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                              background: 'none', border: 'none', color: 'inherit', font: 'inherit',
                              cursor: 'pointer', padding: 0, textAlign: 'left',
                            }}
                          >
                            <User size={16}/>
                            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
                              <span>{getAccountName(i)}</span>
                              {a && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', fontWeight: 400 }}>
                                  {a.slice(0, 6)}…{a.slice(-4)}
                                </span>
                              )}
                            </span>
                            {i === activeIdx && <span style={{ marginLeft: 'auto', color: 'var(--blue)' }}>●</span>}
                          </button>
                          {onRenameAccount && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRenameAccount(i); setAccountMenu(false); }}
                              title="Rename account"
                              aria-label={`Rename ${getAccountName(i)}`}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
                            >
                              <Pencil size={13}/>
                            </button>
                          )}
                          {onDeleteAccount && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (lastAccount) return;
                                onDeleteAccount(i);
                                setAccountMenu(false);
                              }}
                              disabled={lastAccount}
                              title={lastAccount
                                ? 'Your wallet must keep at least one account — add another to delete this one'
                                : 'Delete account'}
                              aria-label={`Delete ${getAccountName(i)}`}
                              style={{
                                background: 'none', border: 'none', padding: 4, display: 'flex',
                                cursor: lastAccount ? 'not-allowed' : 'pointer',
                                color: lastAccount ? 'var(--text-muted)' : 'var(--red, #f87171)',
                                opacity: lastAccount ? 0.45 : 1,
                              }}
                            >
                              <Trash2 size={13}/>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {onAddAccount && accountCount < 10 && (
                      <button className="menu-item" onClick={() => { onAddAccount(); setAccountMenu(false); }}>
                        <span style={{ width: 16, textAlign: 'center', fontSize: 18, lineHeight: '16px' }}>+</span>
                        Add account
                      </button>
                    )}
                  </>
                )}
                <div className="menu-divider"/>
                <button className="menu-item" onClick={() => { router.push('/app/permissions'); setAccountMenu(false); }}>
                  <KeyRound size={18}/> Permissions
                </button>
                <button className="menu-item" onClick={() => { router.push('/app/settings'); setAccountMenu(false); }}>
                  <SettingsIcon size={18}/> Settings
                </button>
                <button className="menu-item" onClick={() => { toggleTheme(); setAccountMenu(false); }}>
                  {isDark ? <Sun size={18}/> : <Moon size={18}/>} {isDark ? 'Light mode' : 'Dark mode'}
                </button>
                {onLock && <>
                  <div className="menu-divider"/>
                  <button className="menu-item menu-item-danger" onClick={() => { onLock(); setAccountMenu(false); }}>
                    <Lock size={18}/> Lock wallet
                  </button>
                </>}
              </div>
            </>
          )}
        </div>
        <button className="icon-btn-nav nav-icon-desktop" title="Search"><Search size={18}/></button>
        <button className="icon-btn-nav nav-icon-desktop" title="Notifications" style={{ position: 'relative' }}>
          <Bell size={18}/>
          <span style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, background: 'var(--blue)', borderRadius: '50%', border: '1.5px solid var(--bg-surface)' }}/>
        </button>
        <button className="nav-mobile-toggle" onClick={() => setMobileMenu(v => !v)} title="Menu">
          <Menu size={24}/>
        </button>
      </div>

      {/* Mobile drawer menu */}
      {mobileMenu && (
        <>
          <div className="menu-overlay" onClick={() => setMobileMenu(false)}/>
          <div className="mobile-nav-drawer">
            {NAV.map(n => (
              <button
                key={n.href}
                className={`mobile-nav-item ${isActive(n.href) ? 'active' : ''}`}
                onClick={() => { router.push(n.href); setMobileMenu(false); }}
              >
                {n.label}
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
