/**
 * Live portfolio + activity data for the desktop wallet.
 *
 * Fetches real balances and recent activity from the indexer
 * (services/indexer) and prices assets via @thanos/sdk-core's CoinGecko
 * pricing. Replaces the COINS / TXS / ALL_TXS mocks the renderer
 * shipped with.
 *
 * sdk-core's IndexerClient is intentionally not used for the typed
 * call — its PortfolioSnapshot type predates the indexer's current
 * response shape — so this module does a directly-typed fetch against
 * the real /portfolio response instead.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { fetchEcosystemPrices } from '@thanos/sdk-core';
import { formatUnits } from 'ethers';

const INDEXER_BASE = String(
  (import.meta as unknown as { env?: { VITE_INDEXER_URL?: string } }).env?.VITE_INDEXER_URL ||
    'https://thanos.fi/indexer',
).replace(/\/$/, '');

/* ─── Indexer response shape (services/indexer/src/server.ts) ────────── */

interface IndexerAsset {
  chainId:       number;
  symbol:        string;
  name:          string;
  decimals:      number;
  balance:       string;
  native?:       boolean;
  tokenAddress?: string;
}
interface IndexerActivityItem {
  id:       string;
  type:     string;
  symbol:   string;
  amount:   string;
  txHash?:  string;
  ts?:      string;
  status?:  string;
}
interface IndexerPortfolio {
  walletAddress: string;
  updatedAt:     string;
  assets:        IndexerAsset[];
  activity?:     IndexerActivityItem[];
}

/* ─── Display helpers ────────────────────────────────────────────────── */

const COIN_COLORS: Record<string, string> = {
  LITHO: '#8b7df7', WLITHO: '#a395f8', BTC: '#f7931a', LITBTC: '#f7931a',
  ETH: '#627eea', SOL: '#14f195', USDC: '#2775ca', USDT: '#26a17b',
  BNB: '#f3ba2f', JOT: '#3b7af7', IMAGE: '#10b981', LAX: '#a3e635',
  FGPT: '#10b981', FURGPT: '#10b981', COLLE: '#a3e635', AGII: '#8b7df7',
  BLDR: '#f97316', MUSA: '#eab308',
};
export function coinColor(sym: string): string {
  return COIN_COLORS[(sym || '').toUpperCase()] ?? '#8b7df7';
}

export function formatUsd(n: number): string {
  return '$' + (isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export function formatAmount(n: number): string {
  if (!isFinite(n) || n === 0) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 4 : 8 });
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Map an indexer activity type to a display type + direction. */
function txType(type: string): { type: 'Send' | 'Receive' | 'Swap' | 'Other'; pos: boolean } {
  switch (type) {
    case 'receive': case 'mint': return { type: 'Receive', pos: true  };
    case 'send':    case 'burn': return { type: 'Send',    pos: false };
    case 'swap':                 return { type: 'Swap',    pos: true  };
    default:                     return { type: 'Other',   pos: true  };
  }
}

function txStatus(status?: string): 'Completed' | 'Pending' | 'Failed' {
  if (status === 'failed')  return 'Failed';
  if (status === 'pending') return 'Pending';
  return 'Completed';
}

/* ─── Types ──────────────────────────────────────────────────────────── */

export interface DisplayCoin {
  sym: string; name: string;
  balance: number; balanceText: string; decimals: number;
  priceUsd: number; usdValue: number; pct: number; color: string;
  tokenAddress?: string; native: boolean;
}

export interface DisplayTx {
  id: string; sym: string; name: string;
  type: 'Send' | 'Receive' | 'Swap' | 'Other';
  date: string;
  status: 'Completed' | 'Pending' | 'Failed';
  amount: string; pos: boolean; color: string;
  txHash?: string;
}

export interface PortfolioState {
  coins:    DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  loading:  boolean;
  offline:  boolean;
  reload:   () => void;
}

/* ─── Fetch ──────────────────────────────────────────────────────────── */

async function fetchPortfolio(address: string): Promise<IndexerPortfolio> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${INDEXER_BASE}/portfolio/${encodeURIComponent(address)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`indexer ${res.status}`);
    return (await res.json()) as IndexerPortfolio;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + price the wallet's portfolio and activity. Re-runs on address change. */
export function usePortfolio(address: string): PortfolioState {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<PortfolioState, 'reload'>>({
    coins: [], activity: [], totalUsd: 0, loading: true, offline: false,
  });

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
      setState({ coins: [], activity: [], totalUsd: 0, loading: false, offline: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, offline: false }));
    (async () => {
      try {
        const [pf, prices] = await Promise.all([fetchPortfolio(address), fetchEcosystemPrices()]);
        if (cancelled) return;

        const priced = pf.assets.map((a) => {
          let bal = 0;
          try { bal = Number(formatUnits(a.balance || '0', a.decimals ?? 18)); } catch { bal = 0; }
          const priceUsd = prices[a.symbol] ?? 0;
          return { a, bal, priceUsd, usdValue: bal * priceUsd };
        });
        const totalUsd = priced.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = priced.map(({ a, bal, priceUsd, usdValue }) => ({
          sym: a.symbol, name: a.name,
          balance: bal, balanceText: formatAmount(bal), decimals: a.decimals ?? 18,
          priceUsd, usdValue,
          pct: totalUsd > 0 ? Math.round((usdValue / totalUsd) * 100) : 0,
          color: coinColor(a.symbol),
          tokenAddress: a.tokenAddress, native: !!a.native,
        }));

        const activity: DisplayTx[] = (pf.activity ?? []).map((t, i) => {
          const { type, pos } = txType(t.type);
          const amt = String(t.amount ?? '').replace(/^[+-]/, '');
          return {
            id: t.id || `tx-${i}`,
            sym: t.symbol, name: t.symbol,
            type, date: formatDate(t.ts), status: txStatus(t.status),
            amount: `${pos ? '+' : '-'}${amt} ${t.symbol}`,
            pos, color: coinColor(t.symbol), txHash: t.txHash,
          };
        });

        setState({ coins, activity, totalUsd, loading: false, offline: false });
      } catch {
        if (cancelled) return;
        setState({ coins: [], activity: [], totalUsd: 0, loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/* ─── Context — App fetches once, every view reads it ────────────────── */

export const PortfolioContext = createContext<PortfolioState>({
  coins: [], activity: [], totalUsd: 0, loading: false, offline: false, reload: () => {},
});
export function usePortfolioCtx(): PortfolioState {
  return useContext(PortfolioContext);
}
