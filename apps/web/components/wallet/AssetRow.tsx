'use client';
import React from 'react';
import styles from './AssetRow.module.css';

export interface Asset {
  symbol: string;
  name: string;
  chain: string;
  balance: string;
  balanceUsd: string;
  price: string;
  change24h: number;
  icon?: string;
}

interface AssetRowProps {
  asset: Asset;
  hidden?: boolean;
  onClick?: () => void;
}

const TOKEN_GRADIENTS: Record<string, [string, string]> = {
  LITHO: ['#8b7df7', '#7060e0'],
  BTC:   ['#f97316', '#ea580c'],
  SOL:   ['#9945ff', '#7c3aed'],
  ETH:   ['#627eea', '#4f63bb'],
  USDC:  ['#2775ca', '#1a5fa0'],
  COLLE: ['#4ade80', '#22c55e'],
  USDT:  ['#26a17b', '#1a7a5a'],
  BNB:   ['#f0b90b', '#c8950a'],
  MATIC: ['#8247e5', '#6434bf'],
};

function TokenAvatar({ symbol, icon }: { symbol: string; icon?: string }) {
  if (icon) return <img src={icon} alt={symbol} className={styles.tokenImg} />;
  const [from, to] = TOKEN_GRADIENTS[symbol.toUpperCase()] ?? ['#2d2d50', '#1a1a38'];
  return (
    <div
      className={styles.tokenAvatar}
      style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function AssetRow({ asset, hidden, onClick }: AssetRowProps) {
  const isPositive = asset.change24h >= 0;

  return (
    <button className={styles.row} onClick={onClick}>
      {/* Left: circular avatar + symbol + token balance */}
      <div className={styles.left}>
        <div className={styles.avatarWrap}>
          <TokenAvatar symbol={asset.symbol} icon={asset.icon} />
          <span className={styles.chainBadge}>{asset.chain.slice(0, 3).toUpperCase()}</span>
        </div>
        <div className={styles.info}>
          <span className={styles.symbol}>{asset.symbol}</span>
          <span className={styles.balanceAmt}>
            {hidden ? '•••' : `${asset.balance} ${asset.symbol}`}
          </span>
        </div>
      </div>

      {/* Right: USD value + token price + 24h change */}
      <div className={styles.right}>
        <span className={styles.balanceUsd}>
          {hidden ? '••••' : asset.balanceUsd}
        </span>
        <div className={styles.priceLine}>
          <span className={styles.price}>{asset.price}</span>
          <span className={[styles.change, isPositive ? styles.positive : styles.negative].join(' ')}>
            {isPositive ? '+' : ''}{asset.change24h.toFixed(2)}%
          </span>
        </div>
      </div>
    </button>
  );
}
