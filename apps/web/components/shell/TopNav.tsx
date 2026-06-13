'use client';
import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '../providers/ThemeProvider';
import { useWallet } from './AppShell';
import { Addr } from '../Addr';
import {
  Search, Bell, ChevronDown, Sun, Moon, User, Copy, Settings as SettingsIcon, Lock, Menu, KeyRound,
} from 'lucide-react';

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
  onSwitchAccount,
  onAddAccount,
}: {
  onLock?:          () => void;
  /** Current HD-derivation account (mnemonic wallets only). */
  activeIdx?:       number;
  accountCount?:    number;
  /** When set, the menu shows an Account-N switcher + "+ Add account". */
  onSwitchAccount?: (idx: number) => void;
  onAddAccount?:    () => void;
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
                    {Array.from({ length: accountCount }, (_, i) => (
                      <button
                        key={i}
                        className="menu-item"
                        onClick={() => { onSwitchAccount?.(i); setAccountMenu(false); }}
                        style={i === activeIdx ? { fontWeight: 700 } : undefined}
                      >
                        <User size={16}/> Account {i + 1}
                        {i === activeIdx && <span style={{ marginLeft: 'auto', color: 'var(--blue)' }}>●</span>}
                      </button>
                    ))}
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
