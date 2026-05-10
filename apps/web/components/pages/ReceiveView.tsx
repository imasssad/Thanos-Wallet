'use client';
import React, { useState } from 'react';
import styles from './ReceiveView.module.css';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { IconCopy, IconChevronDown, IconCheck } from '../ui/Icons';

const ACCOUNTS = [
  {
    chain: 'Makalu (Lithosphere)',
    symbol: 'LITHO',
    color: '#8b7df7',
    bech32: 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v',
    evm:    '0x4F9a7Bc2d8e61f3A0c5b9D7e81fC3a2B4d8E6f1A',
  },
  {
    chain: 'Bitcoin',
    symbol: 'BTC',
    color: '#f97316',
    bech32: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    evm:    '',
  },
  {
    chain: 'EVM (wLITHO)',
    symbol: 'wLITHO',
    color: '#a395f8',
    bech32: '',
    evm:    '0x4F9a7Bc2d8e61f3A0c5b9D7e81fC3a2B4d8E6f1A',
  },
  {
    chain: 'Makalu (FGPT)',
    symbol: 'FGPT',
    color: '#10b981',
    bech32: 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v',
    evm:    '',
  },
  {
    chain: 'EVM (Ethereum)',
    symbol: 'ETH',
    color: '#627eea',
    bech32: '',
    evm:    '0x4F9a7Bc2d8e61f3A0c5b9D7e81fC3a2B4d8E6f1A',
  },
];

export function ReceiveView() {
  const [selected, setSelected] = useState(ACCOUNTS[0]);
  const [showChains, setShowChains] = useState(false);
  const [copied, setCopied] = useState<'bech32' | 'evm' | null>(null);

  function copy(text: string, type: 'bech32' | 'evm') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const addr = selected.bech32 || selected.evm;

  return (
    <div className={styles.page + ' fade-in'}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>Receive</h1>
          <p className={styles.subtitle}>Share your address to receive crypto</p>
        </div>

        {/* Chain picker */}
        <div style={{ position: 'relative' }}>
          <button className={styles.chainBtn} onClick={() => setShowChains(v => !v)}>
            <span className={styles.dot} style={{ background: selected.color }} />
            <span className={styles.chainName}>{selected.chain}</span>
            <span className={styles.chainSymbol}>{selected.symbol}</span>
            <IconChevronDown size={15} color="var(--text-muted)" />
          </button>
          {showChains && (
            <div className={styles.dropdown}>
              {ACCOUNTS.map(a => (
                <button
                  key={a.chain}
                  className={[styles.dropOption, selected.chain === a.chain ? styles.dropActive : ''].join(' ')}
                  onClick={() => { setSelected(a); setShowChains(false); }}
                >
                  <span className={styles.dot} style={{ background: a.color }} />
                  <span>{a.chain}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{a.symbol}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* QR Code */}
        <div className={styles.qrWrap}>
          <div className={styles.qrFrame}>
            {/* SVG QR pattern - visual representation */}
            <svg width="160" height="160" viewBox="0 0 160 160" fill="none">
              {/* Corner squares */}
              <rect x="10" y="10" width="44" height="44" rx="4" fill="none" stroke="var(--text-primary)" strokeWidth="4"/>
              <rect x="20" y="20" width="24" height="24" rx="2" fill="var(--text-primary)"/>
              <rect x="106" y="10" width="44" height="44" rx="4" fill="none" stroke="var(--text-primary)" strokeWidth="4"/>
              <rect x="116" y="20" width="24" height="24" rx="2" fill="var(--text-primary)"/>
              <rect x="10" y="106" width="44" height="44" rx="4" fill="none" stroke="var(--text-primary)" strokeWidth="4"/>
              <rect x="20" y="116" width="24" height="24" rx="2" fill="var(--text-primary)"/>
              {/* Center logo */}
              <rect x="68" y="68" width="24" height="24" rx="6" fill="var(--purple-500)"/>
              <path d="M80 72l-6 3 6 3 6-3-6-3z" fill="white"/>
              <path d="M74 78l6 3 6-3M74 75l6 3 6-3" stroke="var(--purple-300)" strokeWidth="0.8" strokeLinecap="round"/>
              {/* Data dots pattern */}
              {[60,68,76,84,92,100].map(x =>
                [60,68,76,84,92,100].map(y => {
                  if (x >= 68 && x <= 84 && y >= 68 && y <= 84) return null;
                  if (x <= 54 && y <= 54) return null;
                  if (x >= 106 && y <= 54) return null;
                  if (x <= 54 && y >= 106) return null;
                  const show = (x + y) % 16 !== 0;
                  return show ? <rect key={`${x}${y}`} x={x} y={y} width="6" height="6" rx="1" fill="var(--text-primary)" opacity="0.8" /> : null;
                })
              )}
            </svg>
          </div>
          <p className={styles.qrHint}>Scan to receive {selected.symbol}</p>
        </div>

        {/* Addresses */}
        {selected.bech32 && (
          <AddressBlock
            label="Bech32 address"
            address={selected.bech32}
            badge="litho1"
            copied={copied === 'bech32'}
            onCopy={() => copy(selected.bech32, 'bech32')}
          />
        )}

        {selected.evm && (
          <AddressBlock
            label="EVM address (0x)"
            address={selected.evm}
            badge="0x"
            copied={copied === 'evm'}
            onCopy={() => copy(selected.evm, 'evm')}
          />
        )}

        <div className={styles.warning}>
          Only send <strong>{selected.symbol}</strong> and compatible tokens on the{' '}
          <strong>{selected.chain}</strong> network to this address.
        </div>
      </div>
    </div>
  );
}

function AddressBlock({
  label, address, badge, copied, onCopy
}: {
  label: string; address: string; badge: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <Badge variant="purple">{badge}</Badge>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)', padding: '10px 14px',
      }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, wordBreak: 'break-all', lineHeight: 1.6 }}>
          {address}
        </span>
        <button
          onClick={onCopy}
          style={{
            background: copied ? 'var(--green-dim)' : 'var(--bg-hover)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: copied ? 'var(--green)' : 'var(--text-secondary)',
            cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center',
            gap: 4, fontSize: 11, fontWeight: 600, flexShrink: 0, transition: 'all 0.15s',
          }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
