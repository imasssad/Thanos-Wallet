'use client';
import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [balanceHidden, setBalanceHidden] = useState(false);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar
          balanceHidden={balanceHidden}
          onToggleBalance={() => setBalanceHidden(v => !v)}
        />
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
