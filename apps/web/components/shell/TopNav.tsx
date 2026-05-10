'use client';
import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '../providers/ThemeProvider';
import {
  Search, Bell, ChevronDown, Sun, Moon, User, Copy, Settings as SettingsIcon, Lock, Menu,
} from 'lucide-react';

const ACCOUNT = { name: 'RobbyWallet', address: '0x70cA2F2B7' };

const NAV = [
  { href: '/',          label: 'Dashboard'    },
  { href: '/market',    label: 'Market'       },
  { href: '/portfolio', label: 'Portfolio'    },
  { href: '/history',   label: 'Transactions' },
  { href: '/staking',   label: 'Staking'      },
  { href: '/settings',  label: 'Settings'     },
];

export function TopNav({ onLock }: { onLock?: () => void }) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [accountMenu, setAccountMenu] = useState(false);
  const [mobileMenu, setMobileMenu]   = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="topnav">
      <div className="topnav-logo">
        <div className="logo-mark">
          <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos" width={34} height={34} style={{ objectFit: 'contain' }}/>
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
          <button className="account-chip" onClick={() => setAccountMenu(v => !v)}>
            <div className="chip-avatar">
              <User size={14}/>
            </div>
            <div className="chip-info">
              <span className="chip-name">{ACCOUNT.name}</span>
              <span className="chip-addr">{ACCOUNT.address}</span>
            </div>
            <ChevronDown size={11} color="var(--text-muted)"/>
          </button>

          {accountMenu && (
            <>
              <div className="menu-overlay" onClick={() => setAccountMenu(false)}/>
              <div className="account-menu">
                <div className="menu-header">
                  <div className="menu-avatar"><User size={20}/></div>
                  <div>
                    <div className="menu-name">{ACCOUNT.name}</div>
                    <div className="menu-addr">{ACCOUNT.address}</div>
                  </div>
                </div>
                <div className="menu-network">
                  <span className="menu-net-dot"/>
                  <span>Makalu</span>
                  <span className="menu-net-status">synced</span>
                </div>
                <div className="menu-divider"/>
                <button className="menu-item" onClick={() => { navigator.clipboard?.writeText(ACCOUNT.address); setAccountMenu(false); }}>
                  <Copy size={16}/> Copy address
                </button>
                <button className="menu-item" onClick={() => { router.push('/settings'); setAccountMenu(false); }}>
                  <SettingsIcon size={16}/> Settings
                </button>
                <button className="menu-item" onClick={() => { toggleTheme(); setAccountMenu(false); }}>
                  {isDark ? <Sun size={16}/> : <Moon size={16}/>} {isDark ? 'Light mode' : 'Dark mode'}
                </button>
                {onLock && <>
                  <div className="menu-divider"/>
                  <button className="menu-item menu-item-danger" onClick={() => { onLock(); setAccountMenu(false); }}>
                    <Lock size={16}/> Lock wallet
                  </button>
                </>}
              </div>
            </>
          )}
        </div>
        <button className="icon-btn-nav nav-icon-desktop" title="Search"><Search size={16}/></button>
        <button className="icon-btn-nav nav-icon-desktop" title="Notifications" style={{ position: 'relative' }}>
          <Bell size={16}/>
          <span style={{ position: 'absolute', top: 6, right: 6, width: 5, height: 5, background: 'var(--blue)', borderRadius: '50%', border: '1.5px solid var(--bg-surface)' }}/>
        </button>
        <button className="nav-mobile-toggle" onClick={() => setMobileMenu(v => !v)} title="Menu">
          <Menu size={20}/>
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
