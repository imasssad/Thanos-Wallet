'use client';
import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '../providers/ThemeProvider';
import { useWallet } from './AppShell';
import {
  Search, Bell, ChevronDown, Sun, Moon, User, Copy, Settings as SettingsIcon, Lock, Menu,
} from 'lucide-react';

const ACCOUNT_NAME = 'RobbyWallet';

const NAV = [
  { href: '/app',           label: 'Dashboard'    },
  { href: '/app/assets',    label: 'Assets'       },
  { href: '/app/market',    label: 'Market'       },
  { href: '/app/history',   label: 'Transactions' },
  { href: '/app/staking',   label: 'Staking'      },
  { href: '/app/settings',  label: 'Settings'     },
];

export function TopNav({ onLock }: { onLock?: () => void }) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, toggleTheme } = useTheme();
  const wallet     = useWallet();
  const isDark = theme === 'dark';
  const [accountMenu, setAccountMenu] = useState(false);
  const [mobileMenu, setMobileMenu]   = useState(false);
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
              <span className="chip-name">{ACCOUNT_NAME}</span>
              <span className="chip-addr">{activeShort}</span>
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
                    <div className="menu-name">{ACCOUNT_NAME}</div>
                    <div className="menu-addr" title={activeAddr}>{activeShort}</div>
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
                  <div className="addr-row-value" title={litho}>{shortLitho}</div>
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
                  <div className="addr-row-value" title={evm}>{shortEvm}</div>
                  <button
                    className="addr-row-copy"
                    onClick={e => { e.stopPropagation(); copyAddr('evm'); }}
                    title="Copy 0x address"
                  >
                    {copiedFmt === 'evm' ? '✓' : <Copy size={14}/>}
                  </button>
                </div>
                <div className="menu-divider"/>
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
