'use client';
import React, { useState } from 'react';
import styles from './TopBar.module.css';
import { IconSearch, IconEye, IconEyeOff, IconChevronDown, IconSun, IconMoon } from '../ui/Icons';
import { useTheme } from '../providers/ThemeProvider';

interface TopBarProps {
  balanceHidden: boolean;
  onToggleBalance: () => void;
}

export function TopBar({ balanceHidden, onToggleBalance }: TopBarProps) {
  const [search, setSearch] = useState('');
  const { theme, toggleTheme } = useTheme();

  return (
    <header className={styles.topbar}>
      {/* Account selector */}
      <button className={styles.accountBtn}>
        <div className={styles.accountAvatar}>
          <span>A</span>
        </div>
        <div className={styles.accountInfo}>
          <span className={styles.accountName}>Account 1</span>
          <span className={styles.accountAddress}>litho1…4d9f</span>
        </div>
        <IconChevronDown size={15} color="var(--text-muted)" />
      </button>

      {/* Search */}
      <div className={styles.searchWrap}>
        <IconSearch size={15} color="var(--text-muted)" />
        <input
          className={styles.searchInput}
          placeholder="Search assets, addresses…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.iconBtn} onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
        <button className={styles.iconBtn} onClick={onToggleBalance} title="Toggle balance">
          {balanceHidden ? <IconEyeOff size={17} /> : <IconEye size={17} />}
        </button>
        <div className={styles.notifDot} />
      </div>
    </header>
  );
}
