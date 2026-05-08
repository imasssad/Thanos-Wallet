'use client';
import React, { useState } from 'react';
import styles from './SendView.module.css';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { IconSend, IconChevronDown, IconCheck, IconAlert } from '../ui/Icons';

const CHAINS = [
  { id: 'makalu',  label: 'Makalu',  symbol: 'LITHO', color: '#8b7df7' },
  { id: 'bitcoin', label: 'Bitcoin', symbol: 'BTC',   color: '#f97316' },
  { id: 'solana',  label: 'Solana',  symbol: 'SOL',   color: '#9945ff' },
  { id: 'evm',     label: 'EVM',     symbol: 'ETH',   color: '#627eea' },
];

type Step = 'compose' | 'review' | 'sent';

export function SendView() {
  const [chain, setChain] = useState(CHAINS[0]);
  const [showChains, setShowChains] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('compose');
  const [loading, setLoading] = useState(false);

  const toError = to && to.length > 3 && !to.startsWith('litho1') && !to.startsWith('0x') && !to.endsWith('.litho') ? 'Invalid address or DNNS name' : '';
  const amtNum = parseFloat(amount) || 0;
  const fee = 0.002;

  async function handleSend() {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1800));
    setLoading(false);
    setStep('sent');
  }

  if (step === 'sent') {
    return (
      <div className={styles.page + ' fade-in'}>
        <div className={styles.successCard}>
          <div className={styles.successIcon}><IconCheck size={32} color="var(--green)" /></div>
          <h2 className={styles.successTitle}>Transaction Sent</h2>
          <p className={styles.successSub}>
            {amount} {chain.symbol} sent to{' '}
            <span className="mono">{to.length > 20 ? to.slice(0, 10) + '…' + to.slice(-6) : to}</span>
          </p>
          <Badge variant="green" dot>Broadcast to {chain.label}</Badge>
          <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
            <Button variant="secondary" onClick={() => { setStep('compose'); setTo(''); setAmount(''); }}>
              New Transaction
            </Button>
            <Button variant="primary" onClick={() => window.location.href = '/'}>
              Back to Wallet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className={styles.page + ' fade-in'}>
        <div className={styles.reviewCard}>
          <div className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>Review Transaction</h1>
            <p className={styles.pageSubtitle}>Confirm the details before broadcasting</p>
          </div>

          <div className={styles.reviewRows}>
            <ReviewRow label="Network"  value={chain.label} />
            <ReviewRow label="To"       value={to} mono />
            <ReviewRow label="Amount"   value={`${amount} ${chain.symbol}`} />
            <ReviewRow label="Network fee" value={`~${fee} ${chain.symbol}`} muted />
            <ReviewRow label="Total"    value={`${(amtNum + fee).toFixed(6)} ${chain.symbol}`} bold />
          </div>

          <div className={styles.warningBox}>
            <IconAlert size={15} color="var(--yellow)" />
            <p>This transaction cannot be reversed once broadcast.</p>
          </div>

          <div className={styles.reviewActions}>
            <Button variant="secondary" onClick={() => setStep('compose')}>Back</Button>
            <Button variant="primary" loading={loading} onClick={handleSend} icon={<IconSend size={15} />}>
              Confirm & Send
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page + ' fade-in'}>
      <div className={styles.card}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Send</h1>
          <p className={styles.pageSubtitle}>Transfer assets to any address or DNNS name</p>
        </div>

        {/* Chain selector */}
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Network</label>
          <div style={{ position: 'relative' }}>
            <button className={styles.chainSelector} onClick={() => setShowChains(v => !v)}>
              <span className={styles.chainDot} style={{ background: chain.color }} />
              <span>{chain.label}</span>
              <span className={styles.chainSymbol}>{chain.symbol}</span>
              <IconChevronDown size={15} color="var(--text-muted)" />
            </button>
            {showChains && (
              <div className={styles.chainDropdown}>
                {CHAINS.map(c => (
                  <button
                    key={c.id}
                    className={[styles.chainOption, chain.id === c.id ? styles.chainOptionActive : ''].join(' ')}
                    onClick={() => { setChain(c); setShowChains(false); }}
                  >
                    <span className={styles.chainDot} style={{ background: c.color }} />
                    <span>{c.label}</span>
                    <span className={styles.chainSymbol}>{c.symbol}</span>
                    {chain.id === c.id && <IconCheck size={13} color="var(--purple-400)" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recipient */}
        <Input
          label="Recipient address or DNNS name"
          placeholder="litho1… or 0x… or name.litho"
          value={to}
          onChange={e => setTo(e.target.value)}
          error={toError}
          hint="Supports bech32, EVM hex, and DNNS names"
        />

        {/* Amount */}
        <div className={styles.amountWrap}>
          <Input
            label="Amount"
            placeholder="0.00"
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            suffix={
              <div className={styles.amountSuffix}>
                <span>{chain.symbol}</span>
                <button className={styles.maxBtn} onClick={() => setAmount('4280')}>MAX</button>
              </div>
            }
          />
        </div>

        {/* Fee estimate */}
        {amount && (
          <div className={styles.feeRow}>
            <span>Estimated fee</span>
            <span className="mono">~{fee} {chain.symbol}</span>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!to || !amount || !!toError || amtNum <= 0}
          onClick={() => setStep('review')}
          icon={<IconSend size={17} />}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono, muted, bold }: {
  label: string; value: string; mono?: boolean; muted?: boolean; bold?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '12px 0', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 13,
        color: muted ? 'var(--text-secondary)' : bold ? 'var(--text-primary)' : 'var(--text-primary)',
        fontWeight: bold ? 700 : 500,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        wordBreak: 'break-all',
        textAlign: 'right',
        maxWidth: '60%',
      }}>{value}</span>
    </div>
  );
}
