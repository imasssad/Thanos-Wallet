'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';
import {
  IconHome, IconSend, IconSwap, IconHistory, IconSettings, IconNetwork
} from '../ui/Icons';

const NAV = [
  { href: '/',         label: 'Portfolio',  icon: IconHome },
  { href: '/send',     label: 'Send',       icon: IconSend },
  { href: '/swap',     label: 'Swap',       icon: IconSwap },
  { href: '/history',  label: 'History',    icon: IconHistory },
  { href: '/settings', label: 'Settings',   icon: IconSettings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoMark}>
          <img src="/images/Thanos_Logo_Transparent.png" alt="Thanos" width={26} height={26} style={{ objectFit: 'contain', display: 'block' }} />
        </div>
        <span className={styles.logoText}>Thanos</span>
      </div>

      {/* Network pill */}
      <div className={styles.networkPill}>
        <span className={styles.networkDot} />
        <IconNetwork size={13} />
        <span>Makalu</span>
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[styles.navItem, active ? styles.active : ''].join(' ')}
            >
              {active && <span className={styles.activePill} />}
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom spacer + version */}
      <div className={styles.bottom}>
        <p className={styles.version}>v0.8.1 · Makalu Sync</p>
      </div>
    </aside>
  );
}
