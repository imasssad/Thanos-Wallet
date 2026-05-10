'use client';
import React, { useState } from 'react';
import styles from './HistoryView.module.css';
import { Badge } from '../ui/Badge';
import { IconArrowUpRight, IconArrowDownLeft, IconSwap, IconLink } from '../ui/Icons';

type TxType = 'send' | 'receive' | 'swap' | 'contract';
type TxStatus = 'confirmed' | 'pending' | 'failed';

interface Tx {
  id: string;
  type: TxType;
  status: TxStatus;
  amount: string;
  symbol: string;
  chain: string;
  to?: string;
  from?: string;
  hash: string;
  time: string;
  usdValue: string;
}

const MOCK_TXS: Tx[] = [
  { id: '1', type: 'receive', status: 'confirmed', amount: '+1,200',  symbol: 'LITHO', chain: 'Makalu',  from: 'litho1xm9…4a2f', hash: '0xabc123', time: '2 min ago',   usdValue: '$360.00' },
  { id: '2', type: 'send',    status: 'confirmed', amount: '-0.012',  symbol: 'BTC',   chain: 'Bitcoin', to:   'bc1q…mq',        hash: '0xdef456', time: '1 hr ago',   usdValue: '$719.52' },
  { id: '3', type: 'swap',    status: 'confirmed', amount: '500',     symbol: 'wLITHO', chain: 'EVM',     to:   'MultX router',   hash: '0x789abc', time: '3 hr ago',   usdValue: '$150.00' },
  { id: '4', type: 'receive', status: 'confirmed', amount: '+840',    symbol: 'USDC',  chain: 'EVM',     from: '0x1a2b…cd3e',   hash: '0x123def', time: 'Yesterday',   usdValue: '$840.00' },
  { id: '5', type: 'send',    status: 'pending',   amount: '-500',    symbol: 'COLLE', chain: 'Makalu',  to:   'litho1zr8…1k9p', hash: '0x456789', time: '2 days ago',  usdValue: '$10.00' },
  { id: '6', type: 'contract',status: 'confirmed', amount: 'LEP100 Approve', symbol: '', chain: 'Makalu', to: 'MultX DEX',      hash: '0x789012', time: '3 days ago',  usdValue: '' },
  { id: '7', type: 'send',    status: 'failed',    amount: '-1.0',    symbol: 'ETH',   chain: 'EVM',     to:   '0x9f8e…7d6c',   hash: '0xabcdef', time: '4 days ago',  usdValue: '$3,600' },
];

const TYPE_META = {
  send:     { label: 'Sent',     Icon: IconArrowUpRight,  color: 'red'    as const, bg: 'var(--red-dim)'    },
  receive:  { label: 'Received', Icon: IconArrowDownLeft, color: 'green'  as const, bg: 'var(--green-dim)'  },
  swap:     { label: 'Swap',     Icon: IconSwap,          color: 'blue'   as const, bg: 'var(--blue-dim)'   },
  contract: { label: 'Contract', Icon: IconLink,          color: 'purple' as const, bg: 'var(--purple-glow)'},
};

const STATUS_BADGE = {
  confirmed: 'green'  as const,
  pending:   'yellow' as const,
  failed:    'red'    as const,
};

type Filter = 'all' | TxType;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'send',     label: 'Sent' },
  { key: 'receive',  label: 'Received' },
  { key: 'swap',     label: 'Swaps' },
];

export function HistoryView() {
  const [filter, setFilter] = useState<Filter>('all');

  const txs = filter === 'all' ? MOCK_TXS : MOCK_TXS.filter(t => t.type === filter);

  return (
    <div className={styles.page + ' fade-in'}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>History</h1>
          <p className={styles.subtitle}>Your recent transactions across all chains</p>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={[styles.filterBtn, filter === f.key ? styles.filterActive : ''].join(' ')}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tx list */}
      <div className={styles.list}>
        {txs.map(tx => {
          const meta = TYPE_META[tx.type];
          const Icon = meta.Icon;
          return (
            <div key={tx.id} className={styles.txRow}>
              <div className={styles.txLeft}>
                <div className={styles.txIcon} style={{ background: meta.bg }}>
                  <Icon size={16} color={`var(--${meta.color === 'purple' ? 'purple-400' : meta.color})`} />
                </div>
                <div className={styles.txInfo}>
                  <div className={styles.txTopLine}>
                    <span className={styles.txType}>{meta.label}</span>
                    <Badge variant={STATUS_BADGE[tx.status]}>
                      {tx.status}
                    </Badge>
                  </div>
                  <span className={styles.txMeta}>
                    {tx.chain} · {tx.time} · <span className="mono">{tx.hash.slice(0, 10)}…</span>
                  </span>
                </div>
              </div>

              <div className={styles.txRight}>
                <span className={[
                  styles.txAmount,
                  tx.type === 'receive' ? styles.positive : tx.type === 'send' || tx.type === 'swap' ? styles.negative : ''
                ].join(' ')}>
                  {tx.amount} {tx.symbol}
                </span>
                {tx.usdValue && (
                  <span className={styles.txUsd}>{tx.usdValue}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
