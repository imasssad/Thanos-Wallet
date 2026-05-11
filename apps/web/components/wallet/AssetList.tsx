'use client';
import React, { useState } from 'react';
import styles from './AssetList.module.css';
import { AssetRow, Asset } from './AssetRow';
import { IconPlus, IconSearch } from '../ui/Icons';

// Canonical Lithosphere ecosystem token list — see apps/web/lib/tokens.ts
import { TOKENS } from '../../lib/tokens';
const MOCK_ASSETS: Asset[] = TOKENS.map(t => {
  const balNum = parseFloat(t.balance.replace(/,/g, ''));
  const usdNum = balNum * t.priceUsd;
  return {
    symbol:     t.sym,
    name:       t.name,
    chain:      t.chain,
    balance:    t.balance,
    balanceUsd: `$${usdNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    price:      `$${t.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
    change24h:  t.change24h,
  };
});

interface AssetListProps {
  hidden?: boolean;
}

export function AssetList({ hidden }: AssetListProps) {
  const [filter, setFilter] = useState('');
  const filtered = MOCK_ASSETS.filter(a =>
    !filter ||
    a.symbol.toLowerCase().includes(filter.toLowerCase()) ||
    a.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Assets</h2>
        <div className={styles.headerRight}>
          <div className={styles.searchMini}>
            <IconSearch size={13} color="var(--text-muted)" />
            <input
              className={styles.searchInput}
              placeholder="Filter…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <button className={styles.addBtn}>
            <IconPlus size={15} />
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {filtered.length === 0 ? (
          <p className={styles.empty}>No assets found.</p>
        ) : (
          filtered.map(asset => (
            <AssetRow key={`${asset.symbol}-${asset.chain}`} asset={asset} hidden={hidden} />
          ))
        )}
      </div>
    </div>
  );
}
