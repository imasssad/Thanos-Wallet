/**
 * Live portfolio + activity data for the desktop wallet.
 *
 * Reads balances straight from each chain's RPC (Lithosphere Mainnet, the
 * external EVM chains, custom networks, BTC/SOL/ATOM) and prices them via
 * @thanos/sdk-core's CoinGecko pricing. Activity is Lithosphere Mainnet's
 * explorer feed plus the user's own recorded sends. (The Thanos indexer only
 * covers the Makalu testnet, which the wallet no longer includes —
 * 2026-09-29.)
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { fetchEcosystemPrices, formatFiat } from '@thanos/sdk-core';
import { getLocalActivity, resolvePendingActivity } from './local-activity';
import { readSnapshot, writeSnapshot } from './portfolio-cache';
import { fetchMainnetNativeActivity } from './explorer-activity';

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

/** Format a USD amount in the user's display currency (Settings →
 *  Currency). Conversion happens at format time via the shared sdk-core fx
 *  engine; the value pipeline stays USD. Falls back to $ until rates load. */
export function formatUsd(n: number): string {
  return formatFiat(n);
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

/** Merge optimistic local sends (recorded at broadcast time) into the
 *  explorer feed. External-chain sends have no feed, so without this a user's
 *  own transaction never appears. Deduped by tx hash so once the explorer
 *  reports the tx the local copy drops out. Local entries (newest) sort above
 *  the explorer ones. A local row whose status has been resolved by
 *  resolvePendingActivity() renders as Completed/Failed instead of staying
 *  stuck on Pending. */
function mergeLocalActivity(address: string, indexed: DisplayTx[]): DisplayTx[] {
  const local: DisplayTx[] = getLocalActivity(address).map((t) => {
    const resolved = t.status === 'confirmed' || t.status === 'failed';
    return {
      id: t.hash,
      sym: t.sym,
      name: t.sym,
      type: 'Send' as const,
      date: formatDate(new Date(t.ts).toISOString()),
      status: t.status === 'failed' ? 'Failed' as const : 'Completed' as const,
      amount: `-${String(t.amount).replace(/^[+-]/, '')} ${t.sym}`,
      pos: false,
      color: coinColor(t.sym),
      txHash: t.hash,
      rawTs: new Date(t.ts).toISOString(),
      rawAmount: parseFloat(String(t.amount).replace(/^[+-]/, '')) || 0,
      pending: !resolved, // drives the "Pending" badge until the explorer OR resolvePendingActivity resolves it
    };
  });
  const fresh = local.filter(
    (l) => !indexed.some((x) => x.id === l.id || (!!x.txHash && x.txHash === l.txHash)),
  );
  return [...fresh, ...indexed];
}

/** Map an explorer activity type to a display type + direction. */
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
  /** EVM chain id (9005 Lithosphere Mainnet, 1, 56, … or a custom network) —
   *  Send signs on exactly this chain. Undefined for BTC / SOL / ATOM. */
  chainId?: number;
}

export interface DisplayTx {
  id: string; sym: string; name: string;
  type: 'Send' | 'Receive' | 'Swap' | 'Other';
  date: string;
  status: 'Completed' | 'Pending' | 'Failed';
  amount: string; pos: boolean; color: string;
  txHash?: string;
  /** Raw fields the detail modal needs (the display strings above are lossy):
   *  ISO timestamp for the "Jul 20, 2026 7:20 PM" line, numeric amount for the
   *  ≈fiat hero. */
  rawTs?: string;
  rawAmount?: number;
  /** True while this row is a local-only optimistic send the explorer hasn't
   *  reported yet. Drives the subtle "Pending" badge; cleared once reconciled. */
  pending?: boolean;
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
        // Balances come straight from each chain's RPC below. The Thanos
        // indexer only covers the Makalu testnet, which the wallet no longer
        // includes (2026-09-29), so its holdings and activity aren't shown.
        // A pricing outage mustn't hide balances — they just show unpriced.
        const [prices, mainnetActivity] = await Promise.all([
          fetchEcosystemPrices().catch(() => ({} as Record<string, number>)),
          // Native LITHO transfers on Lithosphere Mainnet, from its explorer
          // (native transfers emit no logs, so nothing else reports them).
          fetchMainnetNativeActivity(address).catch(() => []),
          // Every other local send is resolved via direct chain-RPC receipt
          // polling, so it doesn't stay "Pending" forever. Persists to
          // storage itself; mergeLocalActivity below re-reads.
          resolvePendingActivity(address).catch(() => {}),
        ]);
        if (cancelled) return;

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

        // EVM chains (Lithosphere Mainnet, Ethereum / BNB / Polygon / Base /
        // Arbitrum / Optimism / Linea / Avalanche, custom networks) — native
        // coins + tokens at the one 0x address. Every row carries its chainId,
        // which is the chain Send signs on. Best-effort; an RPC hiccup can't
        // blank the rest.
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
              // Built-in USDT/USDC are ≈$1; every other token (custom or
              // ecosystem, e.g. COLLE/IMAGE) uses a live price if known,
              // else $0 — never fabricate a stablecoin peg for it.
              const isStable = token.symbol === 'USDT' || token.symbol === 'USDC';
              const priceUsd = prices[token.symbol] ?? (isStable ? 1 : 0);
              xchain.push({
                sym: token.symbol,
                name: `${token.symbol} · ${m.getExtEvmChain(token.chainId)?.name ?? ''}`.trim(),
                balance, balanceText: formatAmount(balance), decimals: token.decimals,
                priceUsd, usdValue: balance * priceUsd,
                pct: 0, color: token.symbol === 'USDT' ? '#26a17b' : token.symbol === 'USDC' ? '#2775ca' : coinColor(token.symbol),
                tokenAddress: token.address, native: false, chainId: token.chainId,
              });
            }
          }
        } catch { /* best-effort — external chains stay hidden on failure */ }

        const totalUsd = xchain.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = xchain.map(c => ({ ...c, pct: totalUsd > 0 ? Math.round((c.usdValue / totalUsd) * 100) : 0 }));
        // Lithosphere MAINNET (chainId 9005) always leads regardless of
        // amount — the Web4 home chain, client requirement 2026-08-27.
        coins.sort((a, b) => {
          const rank = (c: typeof a) => c.chainId === 9005 ? -1 : c.sym === 'LITHO' ? 0 : 1;
          return rank(a) - rank(b);
        });

        const activity: DisplayTx[] = mainnetActivity.map((t, i) => {
          const { type, pos } = txType(t.type);
          const amt = String(t.amount ?? '').replace(/^[+-]/, '');
          return {
            id: t.id || `tx-${i}`,
            sym: t.symbol, name: t.symbol,
            type, date: formatDate(t.ts), status: txStatus(t.status),
            amount: `${pos ? '+' : '-'}${amt} ${t.symbol}`,
            pos, color: coinColor(t.symbol), txHash: t.txHash,
            rawTs: t.ts, rawAmount: parseFloat(amt) || 0,
          };
        });

        // Cache-write: only persist a snapshot when the fetch produced real
        // data. An empty result (every chain read failed) must never overwrite
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
