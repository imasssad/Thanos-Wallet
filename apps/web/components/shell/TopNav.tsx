'use client';
import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '../providers/ThemeProvider';
import {
  IconSearch, IconChevronDown, IconSun, IconMoon, IconAlert,
} from '../ui/Icons';
const IconBell = IconAlert;

const ACCOUNT = { name: 'RobbyWallet', address: '0x70cA2F2B7' };

const NAV = [
  { href: '/',             label: 'Dashboard'    },
  { href: '/market',       label: 'Market'       },
  { href: '/portfolio',    label: 'Portfolio'    },
  { href: '/history',      label: 'Transactions' },
  { href: '/staking',      label: 'Staking'      },
  { href: '/settings',     label: 'Settings'     },
];

export function TopNav() {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [accountMenu, setAccountMenu] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="topnav">
      <div className="topnav-logo">
        <div className="logo-mark">
          <img
            src="/images/Thanos_Logo_Transparent.png"
            alt="Thanos"
            width={34}
            height={34}
            style={{ objectFit: 'contain' }}
          />
        </div>
      </div>

      <div className="nav-tabs">
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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
            </div>
            <div className="chip-info">
              <span className="chip-name">{ACCOUNT.name}</span>
              <span className="chip-addr">{ACCOUNT.address}</span>
            </div>
            <IconChevronDown size={11} color="var(--text-muted)"/>
          </button>

          {accountMenu && (
            <>
              <div className="menu-overlay" onClick={() => setAccountMenu(false)}/>
              <div className="account-menu">
                <div className="menu-header">
                  <div className="menu-avatar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                  </div>
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
                  📋 Copy address
                </button>
                <button className="menu-item" onClick={() => { router.push('/settings'); setAccountMenu(false); }}>
                  ⚙ Settings
                </button>
                <button className="menu-item" onClick={() => { toggleTheme(); setAccountMenu(false); }}>
                  {isDark ? '☀ Light mode' : '🌙 Dark mode'}
                </button>
              </div>
            </>
          )}
        </div>
        <button className="icon-btn-nav" title="Search"><IconSearch size={14}/></button>
        <button className="icon-btn-nav" title="Notifications" style={{ position: 'relative' }}>
          <IconBell size={14}/>
          <span style={{
            position: 'absolute', top: 6, right: 6,
            width: 5, height: 5, background: 'var(--blue)',
            borderRadius: '50%', border: '1.5px solid var(--bg-surface)',
          }}/>
        </button>
        <button className="nav-user-avatar" onClick={toggleTheme} title="Toggle theme">
          {isDark ? <IconSun size={15}/> : <IconMoon size={15}/>}
        </button>
      </div>
    </nav>
  );
}
