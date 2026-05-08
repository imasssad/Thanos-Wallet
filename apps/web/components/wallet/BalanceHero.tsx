'use client';
import React, { useState } from 'react';
import styles from './BalanceHero.module.css';
import { IconCopy, IconCheck } from '../ui/Icons';

interface BalanceHeroProps {
  hidden: boolean;
  totalUsd: string;
  change24h: number;
  address: string;
}

function shorten(addr: string) {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export function BalanceHero({ hidden, totalUsd, change24h, address }: BalanceHeroProps) {
  const isPositive = change24h >= 0;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className={styles.hero}>
      <p className={styles.label}>Total balance</p>

      <div className={styles.balanceRow}>
        <span className={styles.balance}>{hidden ? '••••••' : totalUsd}</span>
        <span className={[styles.change, isPositive ? styles.positive : styles.negative].join(' ')}>
          {isPositive ? '+' : '−'}{Math.abs(change24h).toFixed(2)}% · 24h
        </span>
      </div>

      <button className={styles.addressRow} onClick={copy} title="Copy address">
        {hidden ? '••••••••••••' : shorten(address)}
        {copied
          ? <IconCheck size={11} color="var(--green)" />
          : <IconCopy size={11} />}
      </button>
    </div>
  );
}
