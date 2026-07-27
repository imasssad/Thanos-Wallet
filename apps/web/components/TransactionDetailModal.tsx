'use client';
/**
 * Transaction detail — opens when the user clicks a past activity row
 * (Transactions view, dashboard recent list). Client-requested layout:
 * a ≈fiat hero, signed amount, then Date / Status / Recipient and
 * Network fee / Nonce, with a block-explorer link.
 *
 * The indexer row carries amount/symbol/counterparty/hash/when; the network
 * fee + nonce live only on chain, so they're fetched on open via
 * fetchOnchainTxDetails (sdk-core) — shown as "…" while loading and "—" if the
 * chain can't be resolved (honesty rule: never a fabricated value). Non-EVM
 * hashes get the explorer link only.
 */
import React, { useEffect, useState } from 'react';
import { formatUnits } from 'ethers';
import {
  convertFromUsd, withCurrencyAffix,
  fetchOnchainTxDetails, type OnchainTxDetails,
} from '@thanos/sdk-core';
import { TOKENS } from '../lib/tokens';
import { useDisplayCurrency } from '../lib/use-fx';
import { useQuotes } from '../lib/usePrices';
import { TokenIcon } from './TokenIcon';
import type { IndexerActivityItem } from '../lib/indexer';

function txMeta(type: string): { title: string; out: boolean } {
  switch (type) {
    case 'send':     return { title: 'Sent',     out: true };
    case 'burn':     return { title: 'Burned',   out: true };
    case 'receive':  return { title: 'Received', out: false };
    case 'mint':     return { title: 'Minted',   out: false };
    case 'swap':     return { title: 'Swap',     out: false };
    case 'approval': return { title: 'Approval', out: false };
    default:         return { title: type ? type[0].toUpperCase() + type.slice(1) : 'Transaction', out: false };
  }
}

function fmtDateTime(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function shortAddr(a?: string | null): string {
  if (!a) return '—';
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '11px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, gap: 12,
    }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

/* Re-renders on display-currency change — see lib/use-fx.ts. */
export function TransactionDetailModal({ item, onClose }: { item: IndexerActivityItem; onClose: () => void }) {
  useDisplayCurrency();
  const quotes = useQuotes();
  const meta = txMeta(item.type);
  const canon = TOKENS.find(t => t.sym.toLowerCase() === item.symbol.toLowerCase());
  const decimals = canon?.decimals ?? 18;

  // Amount arrives as raw base units (wei) OR already-formatted — handle both.
  let amountNum = 0;
  let amountStr = item.amount;
  try {
    amountNum = parseFloat(formatUnits(item.amount, decimals));
    amountStr = amountNum.toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch {
    amountNum = parseFloat(item.amount) || 0;
  }

  const priceUsd = quotes?.[item.symbol]?.usd ?? (canon?.priceUsd || null);
  const fiat = priceUsd != null
    ? withCurrencyAffix(convertFromUsd(amountNum * priceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    : null;

  const statusText  = item.status === 'pending' ? 'Pending' : item.status === 'failed' ? 'Failed' : 'Completed';
  const statusColor = item.status === 'pending' ? 'var(--orange)' : item.status === 'failed' ? 'var(--red)' : 'var(--green)';

  /* Network fee + nonce live only on chain — fetch on open. */
  const [det, setDet] = useState<OnchainTxDetails | null>(null);
  const [detLoading, setDetLoading] = useState<boolean>(!!item.txHash);
  useEffect(() => {
    if (!item.txHash) { setDetLoading(false); return; }
    let cancel = false;
    setDetLoading(true);
    fetchOnchainTxDetails(item.txHash)
      .then(d => { if (!cancel) { setDet(d); setDetLoading(false); } })
      .catch(() => { if (!cancel) setDetLoading(false); });
    return () => { cancel = true; };
  }, [item.txHash]);

  const feeText = det?.feeNative != null
    ? `${det.feeNative.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${det.nativeSymbol}`
    : (detLoading ? '…' : '—');
  const feeUsdText = det?.feeUsd != null
    ? '≈ ' + withCurrencyAffix(convertFromUsd(det.feeUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
    : null;
  const nonceText = det?.nonce != null ? String(det.nonce) : (detLoading ? '…' : '—');

  const counterparty = item.counterparty ?? (meta.out ? det?.to : det?.from) ?? null;
  const recipientLabel = meta.out ? 'Recipient' : 'From';
  const explorer = det?.explorerTxUrl ?? (item.txHash ? `https://makalu.litho.ai/tx/${item.txHash}` : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box modal-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{meta.title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-scroll">
          {/* Hero: ≈fiat + signed amount */}
          <div style={{ textAlign: 'center', padding: '10px 0 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <TokenIcon sym={item.symbol} color={canon?.color} size={44} style={{ borderRadius: 14 }}/>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>{fiat ? `≈ ${fiat}` : `${meta.out ? '-' : '+'}${amountStr} ${item.symbol}`}</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{meta.out ? '-' : '+'}{amountStr} {item.symbol}</div>
          </div>

          {/* Date / Status / Recipient / Network */}
          <div className="card" style={{ padding: '2px 14px', marginBottom: 12 }}>
            <DetailRow label="Date">{fmtDateTime(item.ts)}</DetailRow>
            <DetailRow label="Status"><span style={{ color: statusColor, fontWeight: 700 }}>{statusText}</span></DetailRow>
            {counterparty && (
              <DetailRow label={recipientLabel}>
                <span style={{ fontFamily: 'Geist Mono, monospace' }}>{shortAddr(counterparty)}</span>
              </DetailRow>
            )}
            {det?.networkName && <DetailRow label="Network">{det.networkName}</DetailRow>}
          </div>

          {/* Network fee / Nonce (EVM hashes only) */}
          {item.txHash && (
            <div className="card" style={{ padding: '2px 14px', marginBottom: 12 }}>
              <DetailRow label="Network fee">
                <span>
                  <div>{feeText}</div>
                  {feeUsdText && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{feeUsdText}</div>}
                </span>
              </DetailRow>
              <DetailRow label="Nonce">{nonceText}</DetailRow>
            </div>
          )}

          {explorer && (
            <a href={explorer} target="_blank" rel="noreferrer" className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', color: 'var(--green)', fontWeight: 700, padding: '13px' }}>
              View on block explorer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
