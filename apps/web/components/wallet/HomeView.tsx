'use client';
import React, { useState } from 'react';
import styles from './HomeView.module.css';
import { BalanceHero } from './BalanceHero';
import { QuickActions } from './QuickActions';
import { AssetList } from './AssetList';

const MOCK_ADDRESS = 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v';

export function HomeView() {
  const [balanceHidden, setBalanceHidden] = useState(false);

  return (
    <div className={styles.page + ' fade-in'}>
      <BalanceHero
        hidden={balanceHidden}
        totalUsd="$9,357.00"
        change24h={2.34}
        address={MOCK_ADDRESS}
      />

      <QuickActions />

      <div className={styles.section}>
        <AssetList hidden={balanceHidden} />
      </div>
    </div>
  );
}
