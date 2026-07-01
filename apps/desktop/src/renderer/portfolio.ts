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
import { getLocalActivity } from './local-activity';
import { readSnapshot, writeSnapshot } from './portfolio-cache';

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

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Merge optimistic local sends (recorded at broadcast time) into the indexer
 *  feed. Native LITHO / external-chain sends are never indexed, so without this
 *  a user's own transaction never appears. Deduped by tx hash so once the
 *  indexer reports the tx the local copy drops out. Local entries (newest)
 *  sort above the indexed ones. */
function mergeLocalActivity(address: string, indexed: DisplayTx[]): DisplayTx[] {
  const local: DisplayTx[] = getLocalActivity(address).map((t) => ({
    id: t.hash,
    sym: t.sym,
    name: t.sym,
    type: 'Send' as const,
    date: formatDate(new Date(t.ts).toISOString()),
    status: 'Completed' as const,
    amount: `-${String(t.amount).replace(/^[+-]/, '')} ${t.sym}`,
    pos: false,
    color: coinColor(t.sym),
    txHash: t.hash,
  }));
  const fresh = local.filter(
    (l) => !indexed.some((x) => x.id === l.id || (!!x.txHash && x.txHash === l.txHash)),
  );
  return [...fresh, ...indexed];
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
  /** External-EVM chain id (1/56/137/…) for non-Makalu EVM positions, so Send
   *  can route them to that chain's RPC. Undefined for Makalu / BTC / SOL / ATOM. */
  chainId?: number;
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

/** Fetch + price the wallet's portfolio and activity. Re-runs on
 *  address change. When `seed` is supplied, also derives BTC/SOL/ATOM
 *  addresses and includes their native balances in the displayed
 *  portfolio so the total reflects every chain the wallet manages. */
export function usePortfolio(address: string, seed?: string[]): PortfolioState {
  const [nonce, setNonce] = useState(0);
  // Cached-first: paint real last-known numbers for this address immediately
  // (loading still true — a background refresh is running). Never blocks or
  // changes the fetch below.
  const [state, setState] = useState<Omit<PortfolioState, 'reload'>>(() => {
    const snap = readSnapshot(address);
    return {
      coins:    snap?.coins ?? [],
      activity: snap ? mergeLocalActivity(address, snap.activity) : [],
      totalUsd: snap?.totalUsd ?? 0,
      loading:  true,
      offline:  false,
    };
  });

  const seedKey = seed?.join(' ') ?? '';

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
      setState({ coins: [], activity: [], totalUsd: 0, loading: false, offline: false });
      return;
    }
    let cancelled = false;
    // Cached-first on address change: show THIS address's last-known snapshot
    // (or empty if none) while the fresh fetch runs in the background.
    const snap = readSnapshot(address);
    setState({
      coins:    snap?.coins ?? [],
      activity: mergeLocalActivity(address, snap?.activity ?? []),
      totalUsd: snap?.totalUsd ?? 0,
      loading:  true,
      offline:  false,
    });
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

        // Cross-chain native positions — only when the seed is unlocked.
        // Each chain runs best-effort; one RPC failure doesn't poison the
        // whole dashboard.
        const xchain: DisplayCoin[] = [];
        if (seedKey) {
          const phrase = seedKey;
          const tries = await Promise.allSettled([
            (async () => {
              const m = await import('./bitcoin');
              const addr = m.getBitcoinAddress(phrase);
              const bal = parseFloat(await m.getBitcoinBalance(addr)) || 0;
              return { sym: 'BTC',  name: 'Bitcoin',    bal, decimals: 8 };
            })(),
            (async () => {
              const m = await import('./solana');
              const addr = m.getSolanaAddress(phrase);
              const bal = parseFloat(await m.getSolanaBalance(addr)) || 0;
              return { sym: 'SOL',  name: 'Solana',     bal, decimals: 9 };
            })(),
            (async () => {
              const m = await import('./cosmos');
              const addr = await m.getCosmosAddress(phrase);
              const bal = parseFloat(await m.getCosmosBalance(addr)) || 0;
              return { sym: 'ATOM', name: 'Cosmos Hub', bal, decimals: 6 };
            })(),
          ]);
          for (const r of tries) {
            if (r.status !== 'fulfilled' || r.value.bal <= 0) continue;
            const priceUsd = prices[r.value.sym] ?? 0;
            const usdValue = r.value.bal * priceUsd;
            xchain.push({
              sym: r.value.sym, name: r.value.name,
              balance: r.value.bal, balanceText: formatAmount(r.value.bal),
              decimals: r.value.decimals, priceUsd, usdValue,
              pct: 0, color: coinColor(r.value.sym), native: true,
            });
          }
        }

        // External EVM chains (Ethereum / BNB / Polygon / Base / Arbitrum /
        // Optimism / Linea / Avalanche) — native coins + USDT/USDC at the SAME
        // 0x address as Makalu. Best-effort; an RPC hiccup can't blank the rest.
        try {
          const m = await import('./evm-external');
          const [natives, tokens] = await Promise.all([
            m.getAllExtEvmNativeBalances(address),
            m.getAllExtEvmTokenBalances(address),
          ]);
          if (!cancelled) {
            for (const { chain, balance } of natives) {
              if (balance <= 0) continue;
              const priceUsd = prices[chain.nativeSymbol] ?? 0;
              xchain.push({
                sym: chain.nativeSymbol, name: chain.name,
                balance, balanceText: formatAmount(balance), decimals: 18,
                priceUsd, usdValue: balance * priceUsd,
                pct: 0, color: chain.color, native: true, chainId: chain.chainId,
              });
            }
            for (const { token, balance } of tokens) {
              if (balance <= 0) continue;
              const priceUsd = prices[token.symbol] ?? 1; // stablecoins ~= $1
              xchain.push({
                sym: token.symbol,
                name: `${token.symbol} · ${m.getExtEvmChain(token.chainId)?.name ?? ''}`.trim(),
                balance, balanceText: formatAmount(balance), decimals: token.decimals,
                priceUsd, usdValue: balance * priceUsd,
                pct: 0, color: token.symbol === 'USDT' ? '#26a17b' : '#2775ca',
                tokenAddress: token.address, native: false, chainId: token.chainId,
              });
            }
          }
        } catch { /* best-effort — external chains stay hidden on failure */ }

        const totalUsd = priced.reduce((s, x) => s + x.usdValue, 0)
                       + xchain.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = [
          ...priced.map(({ a, bal, priceUsd, usdValue }) => ({
            sym: a.symbol, name: a.name,
            balance: bal, balanceText: formatAmount(bal), decimals: a.decimals ?? 18,
            priceUsd, usdValue,
            pct: totalUsd > 0 ? Math.round((usdValue / totalUsd) * 100) : 0,
            color: coinColor(a.symbol),
            tokenAddress: a.tokenAddress, native: !!a.native,
          })),
          ...xchain.map(c => ({ ...c, pct: totalUsd > 0 ? Math.round((c.usdValue / totalUsd) * 100) : 0 })),
        ];

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

        // Cache-write: only persist a snapshot when the fetch produced real
        // data. An empty result (indexer 500 caught to []) must never overwrite
        // a good snapshot — that would poison the cached-first view.
        if (coins.length > 0) {
          writeSnapshot(address, { coins, totalUsd, activity });
        }
        setState({ coins, activity: mergeLocalActivity(address, activity), totalUsd, loading: false, offline: false });
      } catch {
        if (cancelled) return;
        setState({ coins: [], activity: mergeLocalActivity(address, []), totalUsd: 0, loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce, seedKey]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/* ─── Context — App fetches once, every view reads it ────────────────── */

export const PortfolioContext = createContext<PortfolioState>({
  coins: [], activity: [], totalUsd: 0, loading: false, offline: false, reload: () => {},
});
export function usePortfolioCtx(): PortfolioState {
  return useContext(PortfolioContext);
}
