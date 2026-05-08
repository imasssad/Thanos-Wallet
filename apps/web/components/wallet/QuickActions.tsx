'use client';
import React from 'react';
import Link from 'next/link';
import styles from './QuickActions.module.css';
import { IconSend, IconReceive, IconSwap, IconLink } from '../ui/Icons';

const ACTIONS = [
  { href: '/send',    label: 'Send',    icon: IconSend,    primary: true  },
  { href: '/receive', label: 'Receive', icon: IconReceive, primary: false },
  { href: '/swap',    label: 'Swap',    icon: IconSwap,    primary: false },
  { href: '/dapps',   label: 'dApps',   icon: IconLink,    primary: false },
] as const;

export function QuickActions() {
  return (
    <div className={styles.actions}>
      {ACTIONS.map(({ href, label, icon: Icon, primary }) => (
        <Link
          key={href}
          href={href}
          className={[styles.action, primary ? styles.primary : ''].join(' ')}
        >
          <span className={styles.icon}><Icon size={15} /></span>
          {label}
        </Link>
      ))}
    </div>
  );
}
