'use client';
import React, { useState } from 'react';
import styles from './AssetList.module.css';
import { AssetRow, Asset } from './AssetRow';
import { IconPlus, IconSearch } from '../ui/Icons';

const MOCK_ASSETS: Asset[] = [
  { symbol: 'LITHO',  name: 'Lithosphere',         chain: 'Makalu',   balance: '50,000',    balanceUsd: '$15,000.00', price: '$0.30',   change24h: 18.40 },
  { symbol: 'BTC',    name: 'Bitcoin',             chain: 'Bitcoin',  balance: '0.04821',   balanceUsd: '$2,891.00',  price: '$59,960', change24h: -1.17 },
  { symbol: 'wLITHO', name: 'Wrapped Lithosphere', chain: 'EVM',      balance: '5,000',     balanceUsd: '$1,500.00',  price: '$0.30',   change24h: 18.40 },
  { symbol: 'ETH',    name: 'Ethereum',            chain: 'EVM',      balance: '0.6142',    balanceUsd: '$2,210.00',  price: '$3,600',  change24h:  0.54 },
  { symbol: 'FGPT',   name: 'FractalGPT',          chain: 'Makalu',   balance: '80,000',    balanceUsd: '$1,200.00',  price: '$0.015',  change24h: 42.30 },
  { symbol: 'USDC',   name: 'USD Coin',            chain: 'EVM',      balance: '840.00',    balanceUsd: '$840.00',    price: '$1.00',   change24h:  0.01 },
  { symbol: 'COLLE',  name: 'Colle AI',            chain: 'Makalu',   balance: '18,000',    balanceUsd: '$360.00',    price: '$0.020',  change24h:  8.22 },
];

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
