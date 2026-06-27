/**
 * Live portfolio + activity data for the extension popup.
 *
 * Fetches real balances and recent activity from the indexer
 * (services/indexer) and prices assets via @thanos/sdk-core's CoinGecko
 * pricing. Replaces the ASSETS / TXS mocks.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { fetchEcosystemPrices } from '@thanos/sdk-core';
import { formatUnits } from 'ethers';
import { getLocalActivity } from '../../lib/local-activity';

const INDEXER_BASE = String(
  (import.meta as unknown as { env?: { VITE_INDEXER_URL?: string } }).env?.VITE_INDEXER_URL ||
    'https://thanos.fi/indexer',
).replace(/\/$/, '');

/* ─── Indexer response shape (services/indexer/src/server.ts) ────────── */

interface IndexerAsset {
  chainId: number; symbol: string; name: string; decimals: number;
  balance: string; native?: boolean; tokenAddress?: string;
}
interface IndexerActivityItem {
  id: string; type: string; symbol: string; amount: string;
  txHash?: string; ts?: string; status?: string;
}
interface IndexerPortfolio {
  walletAddress: string; updatedAt: string;
  assets: IndexerAsset[]; activity?: IndexerActivityItem[];
}

/* ─── Display helpers ────────────────────────────────────────────────── */

const COIN_COLORS: Record<string, string> = {
  LITHO: '#8b7df7', WLITHO: '#a395f8', BTC: '#f7931a', LITBTC: '#f7931a',
  ETH: '#627eea', SOL: '#14f195', USDC: '#2775ca', USDT: '#26a17b',
  BNB: '#f3ba2f', JOT: '#3b7af7', IMAGE: '#10b981', LAX: '#a3e635',
  FGPT: '#10b981', COLLE: '#a3e635', AGII: '#8b7df7',
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

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Merge optimistic local sends (recorded at broadcast time) into the indexer
 *  feed. Native LITHO / external-chain sends are never indexed, so without this
 *  a user's own transaction never appears. Deduped by tx hash — once the
 *  indexer reports the tx, the local copy drops out so there's no double row.
 *  Local entries (newest) sort above the indexed ones. */
function mergeLocalActivity(address: string, indexed: DisplayTx[]): DisplayTx[] {
  const local: DisplayTx[] = getLocalActivity(address).map((t) => ({
    id: t.hash,
    sym: t.sym,
    label: t.label,
    amount: `-${String(t.amount).replace(/^[+-]/, '')}`,
    time: relativeTime(new Date(t.ts).toISOString()) || 'just now',
    pos: false,
    color: coinColor(t.sym),
  }));
  const fresh = local.filter((l) => !indexed.some((x) => x.id === l.id || x.id.includes(l.id)));
  return [...fresh, ...indexed];
}

function txType(type: string): { label: 'Sent' | 'Received' | 'Swap' | 'Activity'; pos: boolean } {
  switch (type) {
    case 'receive': case 'mint': return { label: 'Received', pos: true  };
    case 'send':    case 'burn': return { label: 'Sent',     pos: false };
    case 'swap':                 return { label: 'Swap',     pos: true  };
    default:                     return { label: 'Activity', pos: true  };
  }
}

/* ─── Types ──────────────────────────────────────────────────────────── */

export interface DisplayCoin {
  sym: string; name: string;
  balance: number; balanceText: string; decimals: number;
  priceUsd: number; usdValue: number; color: string;
  tokenAddress?: string; native: boolean;
  /** EVM chainId for external-EVM holdings (1/56/137/…); absent for Litho/BTC/SOL/ATOM. */
  chainId?: number;
}

export interface DisplayTx {
  id: string; sym: string;
  label: 'Sent' | 'Received' | 'Swap' | 'Activity';
  amount: string; time: string; pos: boolean; color: string;
}

export interface PortfolioState {
  coins:    DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  loading:  boolean;
  offline:  boolean;
  reload:   () => void;
}

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

/** Fetch + price the wallet's portfolio and activity. When `seed` is
 *  provided, also derives BTC/SOL/ATOM addresses and adds their native
 *  balances to the displayed coin list — so the dashboard total
 *  reflects every chain. */
export function usePortfolio(address: string, seed?: string[]): PortfolioState {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<PortfolioState, 'reload'>>({
    coins: [], activity: [], totalUsd: 0, loading: true, offline: false,
  });

  const seedKey = seed?.join(' ') ?? '';

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
      setState({ coins: [], activity: [], totalUsd: 0, loading: false, offline: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, offline: false }));
    (async () => {
      try {
        const [pf, prices] = await Promise.all([
          fetchPortfolio(address).catch(() => ({ assets: [], activity: [], walletAddress: address, updatedAt: '' } as IndexerPortfolio)),
          fetchEcosystemPrices(),
        ]);
        if (cancelled) return;

        const priced = pf.assets.map((a) => {
          let bal = 0;
          try { bal = Number(formatUnits(a.balance || '0', a.decimals ?? 18)); } catch { bal = 0; }
          const priceUsd = prices[a.symbol] ?? 0;
          return { a, bal, priceUsd, usdValue: bal * priceUsd };
        });

        // Cross-chain native positions — only when seed is unlocked.
        const xchain: DisplayCoin[] = [];
        if (seedKey) {
          const phrase = seedKey;
          const tries = await Promise.allSettled([
            (async () => {
              const m = await import('../../lib/bitcoin');
              const addr = m.getBitcoinAddress(phrase);
              const bal = parseFloat(await m.getBitcoinBalance(addr)) || 0;
              return { sym: 'BTC',  name: 'Bitcoin',    bal, decimals: 8 };
            })(),
            (async () => {
              const m = await import('../../lib/solana');
              const addr = m.getSolanaAddress(phrase);
              const bal = parseFloat(await m.getSolanaBalance(addr)) || 0;
              return { sym: 'SOL',  name: 'Solana',     bal, decimals: 9 };
            })(),
            (async () => {
              const m = await import('../../lib/cosmos');
              const addr = await m.getCosmosAddress(phrase);
              const bal = parseFloat(await m.getCosmosBalance(addr)) || 0;
              return { sym: 'ATOM', name: 'Cosmos Hub', bal, decimals: 6 };
            })(),
          ]);
          for (const r of tries) {
            if (r.status !== 'fulfilled' || r.value.bal <= 0) continue;
            const priceUsd = prices[r.value.sym] ?? 0;
            xchain.push({
              sym: r.value.sym, name: r.value.name,
              balance: r.value.bal, balanceText: formatAmount(r.value.bal),
              decimals: r.value.decimals, priceUsd, usdValue: r.value.bal * priceUsd,
              color: coinColor(r.value.sym), native: true,
            });
          }
        }

        // External EVM (Ethereum/BNB/Polygon/Base/Arbitrum/Optimism/Linea/
        // Avalanche) — native coins + USDT/USDC at the SAME 0x address. The
        // extension's host_permissions (*/*) cover these RPCs, so the popup
        // reads them directly. Read-only; best-effort per chain.
        const evmExt: DisplayCoin[] = [];
        try {
          const m = await import('../../lib/evm-external');
          const [natives, tokens] = await Promise.all([
            m.getAllExtEvmNativeBalances(address),
            m.getAllExtEvmTokenBalances(address),
          ]);
          if (cancelled) return;
          for (const { chain, balance } of natives) {
            const priceUsd = prices[chain.nativeSymbol] ?? 0;
            evmExt.push({
              sym: chain.nativeSymbol, name: chain.name, chainId: chain.chainId,
              balance, balanceText: formatAmount(balance), decimals: 18,
              priceUsd, usdValue: balance * priceUsd, color: chain.color, native: true,
            });
          }
          for (const { token, balance } of tokens) {
            const priceUsd = prices[token.symbol] ?? 1; // stablecoins ≈ $1
            evmExt.push({
              sym: token.symbol, name: `${token.symbol} · ${m.getExtEvmChain(token.chainId)?.name ?? ''}`.trim(),
              chainId: token.chainId, balance, balanceText: formatAmount(balance),
              decimals: token.decimals, priceUsd, usdValue: balance * priceUsd,
              color: token.symbol === 'USDT' ? '#26a17b' : '#2775ca',
              tokenAddress: token.address, native: false,
            });
          }
        } catch { /* best-effort */ }

        const totalUsd = priced.reduce((s, x) => s + x.usdValue, 0)
                       + xchain.reduce((s, x) => s + x.usdValue, 0)
                       + evmExt.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = [
          ...priced.map(({ a, bal, priceUsd, usdValue }) => ({
            sym: a.symbol, name: a.name,
            balance: bal, balanceText: formatAmount(bal), decimals: a.decimals ?? 18,
            priceUsd, usdValue,
            color: coinColor(a.symbol),
            tokenAddress: a.tokenAddress, native: !!a.native,
          })),
          ...xchain,
          ...evmExt,
        ];

        const activity: DisplayTx[] = (pf.activity ?? []).map((t, i) => {
          const { label, pos } = txType(t.type);
          const amt = String(t.amount ?? '').replace(/^[+-]/, '');
          return {
            id: t.id || `tx-${i}`,
            sym: t.symbol, label,
            amount: `${pos ? '+' : '-'}${amt}`,
            time: relativeTime(t.ts) || (t.status ?? ''),
            pos, color: coinColor(t.symbol),
          };
        });

        setState({ coins, activity: mergeLocalActivity(address, activity), totalUsd, loading: false, offline: false });
      } catch {
        if (cancelled) return;
        // Indexer unreachable — still surface the user's own recorded sends.
        setState({ coins: [], activity: mergeLocalActivity(address, []), totalUsd: 0, loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce, seedKey]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/* ─── Context — App fetches once, every screen reads it ──────────────── */

export const PortfolioContext = createContext<PortfolioState>({
  coins: [], activity: [], totalUsd: 0, loading: false, offline: false, reload: () => {},
});
export function usePortfolioCtx(): PortfolioState {
  return useContext(PortfolioContext);
}
