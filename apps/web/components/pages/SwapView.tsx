'use client';
import React, { useState } from 'react';
import styles from './SwapView.module.css';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { IconSwap, IconChevronDown, IconAlert } from '../ui/Icons';

const TOKENS = [
  { symbol: 'LITHO',  name: 'Lithosphere',         chain: 'Makalu',  balance: '50,000'  },
  { symbol: 'wLITHO', name: 'Wrapped Lithosphere', chain: 'EVM',     balance: '5,000'   },
  { symbol: 'FGPT',   name: 'FractalGPT',          chain: 'Makalu',  balance: '80,000'  },
  { symbol: 'BTC',    name: 'Bitcoin',             chain: 'Bitcoin', balance: '0.04821' },
  { symbol: 'ETH',    name: 'Ethereum',            chain: 'EVM',     balance: '0.6142'  },
  { symbol: 'USDC',   name: 'USD Coin',            chain: 'EVM',     balance: '840.00'  },
  { symbol: 'COLLE',  name: 'Colle AI',            chain: 'Makalu',  balance: '18,000'  },
];

export function SwapView() {
  const [from, setFrom] = useState(TOKENS[0]);
  const [to, setTo]     = useState(TOKENS[2]);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [loading, setLoading] = useState(false);
  const [showFromDrop, setShowFromDrop] = useState(false);
  const [showToDrop, setShowToDrop]     = useState(false);

  const rate = 4.72;
  const outAmount = parseFloat(amount) ? (parseFloat(amount) * rate).toFixed(4) : '';

  function flip() {
    setFrom(to);
    setTo(from);
    setAmount(outAmount);
  }

  async function handleSwap() {
    setLoading(true);
    await new Promise(r => setTimeout(r, 2000));
    setLoading(false);
  }

  return (
    <div className={styles.page + ' fade-in'}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Swap</h1>
          <div className={styles.headerRight}>
            <Badge variant="purple">MultX Router</Badge>
            <button className={styles.slippageBtn}>
              Slippage: {slippage}%
            </button>
          </div>
        </div>

        {/* From */}
        <div className={styles.swapBox}>
          <div className={styles.swapBoxHeader}>
            <span className={styles.swapBoxLabel}>You pay</span>
            <span className={styles.swapBoxBalance}>Balance: {from.balance} {from.symbol}</span>
          </div>
          <div className={styles.swapBoxBody}>
            <input
              className={styles.amountInput}
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
            <div style={{ position: 'relative' }}>
              <button className={styles.tokenBtn} onClick={() => setShowFromDrop(v => !v)}>
                <span className={styles.tokenSymbol}>{from.symbol}</span>
                <span className={styles.tokenChain}>{from.chain}</span>
                <IconChevronDown size={14} color="var(--text-muted)" />
              </button>
              {showFromDrop && (
                <TokenDropdown
                  tokens={TOKENS}
                  selected={from}
                  exclude={to.symbol}
                  onSelect={t => { setFrom(t); setShowFromDrop(false); }}
                />
              )}
            </div>
          </div>
          <button className={styles.maxTag} onClick={() => setAmount(from.balance.replace(',',''))}>
            MAX
          </button>
        </div>

        {/* Flip */}
        <div className={styles.flipRow}>
          <div className={styles.divider} />
          <button className={styles.flipBtn} onClick={flip}>
            <IconSwap size={16} color="var(--purple-400)" />
          </button>
          <div className={styles.divider} />
        </div>

        {/* To */}
        <div className={styles.swapBox}>
          <div className={styles.swapBoxHeader}>
            <span className={styles.swapBoxLabel}>You receive</span>
            <span className={styles.swapBoxBalance}>Balance: {to.balance} {to.symbol}</span>
          </div>
          <div className={styles.swapBoxBody}>
            <span className={[styles.amountInput, styles.amountOut].join(' ')}>
              {outAmount || '0.00'}
            </span>
            <div style={{ position: 'relative' }}>
              <button className={styles.tokenBtn} onClick={() => setShowToDrop(v => !v)}>
                <span className={styles.tokenSymbol}>{to.symbol}</span>
                <span className={styles.tokenChain}>{to.chain}</span>
                <IconChevronDown size={14} color="var(--text-muted)" />
              </button>
              {showToDrop && (
                <TokenDropdown
                  tokens={TOKENS}
                  selected={to}
                  exclude={from.symbol}
                  onSelect={t => { setTo(t); setShowToDrop(false); }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Rate info */}
        {amount && (
          <div className={styles.rateBox}>
            <div className={styles.rateRow}>
              <span>Rate</span>
              <span className="mono">1 {from.symbol} ≈ {rate} {to.symbol}</span>
            </div>
            <div className={styles.rateRow}>
              <span>Price impact</span>
              <span style={{ color: 'var(--green)' }}>{'< 0.1%'}</span>
            </div>
            <div className={styles.rateRow}>
              <span>Route</span>
              <span>{from.symbol} → MultX → {to.symbol}</span>
            </div>
            <div className={styles.rateRow}>
              <span>Max slippage</span>
              <span>{slippage}%</span>
            </div>
          </div>
        )}

        {/* Warning for cross-chain */}
        {from.chain !== to.chain && (
          <div className={styles.warning}>
            <IconAlert size={14} color="var(--yellow)" />
            <span>Cross-chain swap via MultX bridge. Expected time: 2–5 min.</span>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={!amount || parseFloat(amount) <= 0}
          onClick={handleSwap}
          icon={<IconSwap size={17} />}
        >
          Swap {from.symbol} → {to.symbol}
        </Button>
      </div>
    </div>
  );
}

function TokenDropdown({
  tokens, selected, exclude, onSelect
}: {
  tokens: typeof TOKENS; selected: typeof TOKENS[0]; exclude: string;
  onSelect: (t: typeof TOKENS[0]) => void;
}) {
  return (
    <div className={styles.tokenDropdown}>
      {tokens.filter(t => t.symbol !== exclude).map(t => (
        <button
          key={t.symbol}
          className={[styles.tokenOption, selected.symbol === t.symbol ? styles.tokenOptionActive : ''].join(' ')}
          onClick={() => onSelect(t)}
        >
          <span className={styles.tokenSymbol}>{t.symbol}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.chain}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{t.balance}</span>
        </button>
      ))}
    </div>
  );
}
