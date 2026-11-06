/**
 * Live portfolio + activity data for the desktop wallet.
 *
 * Reads balances straight from each chain's RPC (Lithosphere Mainnet, the
 * external EVM chains, custom networks, BTC/SOL/ATOM) and prices them via
 * @thanos/sdk-core's CoinGecko pricing. Activity is the wallet's history on
 * every network from the block explorers plus the user's own recorded sends,
 * both kept in local-activity.ts. (The Thanos indexer only covers the Makalu
 * testnet, which the wallet no longer includes — 2026-09-29.) With Makalu added
 * as a custom network, native Lithic LAX is read through the native gateway
 * and shown view-only.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NATIVE_LAX, fetchEcosystemPrices, formatFiat, formatNativeAmount, readNativeLaxBalance } from '@thanos/sdk-core';
import { getLocalActivity, resolvePendingActivity, setNativeHash, type LocalTx } from './local-activity';
import { readSnapshot, writeSnapshot } from './portfolio-cache';
import { syncWalletHistory } from './explorer-activity';
import { customChains, getExtEvmChain } from './custom-assets';
import { isPrivateKeyWallet } from './vault';

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

const NON_EVM_NETWORKS: Record<string, string> = { bitcoin: 'Bitcoin', solana: 'Solana', cosmos: 'Cosmos Hub' };

/** The network a saved row happened on — explorer rows carry it; a send
 *  recorded here has its chainId (EVM) or chain (BTC / SOL / ATOM). */
function networkOf(t: LocalTx): string | undefined {
  if (t.networkName) return t.networkName;
  if (t.chainId != null) return getExtEvmChain(t.chainId)?.name;
  return NON_EVM_NETWORKS[t.chain];
}

/** The Activity feed: the wallet's history from the explorers and its own
 *  recorded sends, saved together newest first (local-activity.ts — one row
 *  per transfer, a send settled by its explorer row or by
 *  resolvePendingActivity()). A row still pending shows the "Pending" badge;
 *  a failed one the Failed state. */
function storedActivity(address: string): DisplayTx[] {
  return getLocalActivity(address).map((t) => {
    const received = t.direction === 'in';
    const status = t.status ?? 'pending';
    const amt = String(t.amount).replace(/^[+-]/, '');
    const network = networkOf(t);
    return {
      id: t.id ?? t.hash,
      sym: t.sym,
      name: network ?? t.sym,
      type: received ? 'Receive' as const : 'Send' as const,
      date: formatDate(new Date(t.ts).toISOString()),
      status: txStatus(status),
      amount: `${received ? '+' : '-'}${amt} ${t.sym}`,
      pos: received,
      color: coinColor(t.sym),
      txHash: t.hash,
      nativeHash: t.nativeHash,
      network,
      chainId: t.chainId,
      counterparty: t.counterparty,
      rawTs: new Date(t.ts).toISOString(),
      rawAmount: parseFloat(amt) || 0,
      pending: status === 'pending',
    };
  });
}

/** The seed's Bitcoin / Solana / Cosmos addresses, each best-effort — for
 *  their balances and their history. */
async function otherChainAddresses(phrase: string): Promise<{ bitcoin?: string; solana?: string; cosmos?: string }> {
  // O-01 (H-1 residual, non-signing): Solana/Cosmos come from the main-
  // process signer bridge, not derived from `phrase` here. Bitcoin isn't
  // signing-isolated yet (H-1 residual, deferred).
  const bridge = typeof window !== 'undefined' ? window.thanosDesktop?.signer : undefined;
  const [bitcoin, solana, cosmos] = await Promise.allSettled([
    import('./bitcoin').then((m) => m.getBitcoinAddress(phrase)),
    bridge ? bridge.solAddress()    : Promise.reject(new Error('no signer bridge')),
    bridge ? bridge.cosmosAddress() : Promise.reject(new Error('no signer bridge')),
  ]);
  const ok = (r: PromiseSettledResult<string>) => (r.status === 'fulfilled' ? r.value : undefined);
  return { bitcoin: ok(bitcoin), solana: ok(solana), cosmos: ok(cosmos) };
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
  /** Native Lithic asset (Makalu LAX): its native target — not an ERC-20
   *  address, so never a tokenAddress. View-only: no Send. */
  nativeTarget?: string;
  readOnly?: boolean;
  /** Exact balance in base units (`balance` is a lossy JS number). */
  baseUnits?: string;
  /** Block the balance was read at. */
  blockHeight?: string;
  /** Why the balance couldn't be read — shown instead of a false 0. */
  readError?: string;
}

export interface DisplayTx {
  id: string; sym: string; name: string;
  type: 'Send' | 'Receive' | 'Swap' | 'Other';
  date: string;
  status: 'Completed' | 'Pending' | 'Failed';
  amount: string; pos: boolean; color: string;
  txHash?: string;
  /** Lithosphere Mainnet: the native hash (64 hex, no 0x) LithoScan shows
   *  first — `txHash` is then the secondary EVM hash. Unknown for a send
   *  made here until LithoScan has indexed it. */
  nativeHash?: string;
  /** The network it happened on ("Base", "Bitcoin", …) — also the row's name. */
  network?: string;
  /** EVM rows: the chain the detail modal reads fee / nonce from. */
  chainId?: number;
  /** The other side, as the explorer reported it (a token transfer's real
   *  recipient / sender, not the token contract). */
  counterparty?: string;
  /** Raw fields the detail modal needs (the display strings above are lossy):
   *  ISO timestamp for the "Jul 20, 2026 7:20 PM" line, numeric amount for the
   *  ≈fiat hero. */
  rawTs?: string;
  rawAmount?: number;
  /** True while the row's transaction hasn't settled on its chain (a fresh
   *  send, or an unconfirmed one the explorer reported). Drives the subtle
   *  "Pending" badge; cleared once settled. */
  pending?: boolean;
}

export interface PortfolioState {
  coins:    DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  loading:  boolean;
  offline:  boolean;
  reload:   () => void;
  /** Save a Lithosphere transaction's native hash on its stored row (looked
   *  up by the detail view or after a send) and show it in the feed. */
  saveNativeHash: (evmHash: string, nativeHash: string) => void;
}

/* ─── Fetch ──────────────────────────────────────────────────────────── */

/** Native LAX on Makalu, read through the native gateway — only when the
 *  user has added Makalu (700777) as a custom network, at that network's RPC.
 *  A failed read shows as unavailable, never as 0. */
async function readNativeLaxCoin(address: string): Promise<DisplayCoin | null> {
  const makalu = customChains().find((c) => c.chainId === NATIVE_LAX.chainId);
  if (!makalu) return null;
  const coin: DisplayCoin = {
    sym: NATIVE_LAX.symbol, name: NATIVE_LAX.name, chainId: NATIVE_LAX.chainId,
    balance: 0, balanceText: '—', decimals: NATIVE_LAX.decimals,
    priceUsd: 0, usdValue: 0, pct: 0, color: coinColor(NATIVE_LAX.symbol), native: false,
    nativeTarget: NATIVE_LAX.nativeTarget, readOnly: true,
  };
  try {
    const r = await readNativeLaxBalance(address, { rpcUrl: makalu.rpcUrl });
    return {
      ...coin,
      balance: Number(r.balanceFormatted), balanceText: formatNativeAmount(r.balanceBaseUnits, r.decimals),
      baseUnits: r.balanceBaseUnits, blockHeight: r.blockHeight,
    };
  } catch (e) {
    return { ...coin, readError: e instanceof Error ? e.message : String(e) };
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
  // changes the fetch below. Activity is saved on its own (local-activity.ts),
  // so it paints from there.
  const [state, setState] = useState<Omit<PortfolioState, 'reload' | 'saveNativeHash'>>(() => {
    const snap = readSnapshot(address);
    return {
      coins:    snap?.coins ?? [],
      activity: storedActivity(address),
      totalUsd: snap?.totalUsd ?? 0,
      loading:  true,
      offline:  false,
    };
  });

  const seedKey = seed?.join(' ') ?? '';
  // A raw-key wallet is one EVM account: no BTC / SOL / ATOM addresses.
  const rawKey = !!seed && isPrivateKeyWallet(seed);
  // The address a history read that outlives its effect may still update.
  const current = useRef(address);
  current.current = address;

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
      activity: storedActivity(address),
      totalUsd: snap?.totalUsd ?? 0,
      loading:  true,
      offline:  false,
    });
    // BTC / SOL / ATOM addresses — only when the seed is unlocked.
    const otherAddrs = seedKey && !rawKey ? otherChainAddresses(seedKey) : Promise.resolve({});
    // The wallet's history from the explorers (every network at most every 5
    // minutes, Lithosphere on every load — explorer-activity.ts). It can take
    // a while, so it never holds up balances: the feed updates when it lands,
    // even after a reload has started another pass. Unlocked wallets only.
    if (seedKey) {
      void otherAddrs
        .then((other) => syncWalletHistory({ ...other, evm: address }))
        .then((changed) => {
          if (changed && current.current === address) setState((s) => ({ ...s, activity: storedActivity(address) }));
        })
        .catch(() => { /* explorers unreachable — the saved feed stays */ });
    }
    (async () => {
      try {
        // Started now, awaited with the rest below.
        const nativeLax = readNativeLaxCoin(address);
        // Balances come straight from each chain's RPC below. The Thanos
        // indexer only covers the Makalu testnet, which the wallet no longer
        // includes (2026-09-29), so its holdings and activity aren't shown.
        // A pricing outage mustn't hide balances — they just show unpriced.
        const [prices] = await Promise.all([
          fetchEcosystemPrices().catch(() => ({} as Record<string, number>)),
          // A send no explorer has reported yet is resolved via direct
          // chain-RPC receipt polling, so it doesn't stay "Pending" forever.
          // Persists to storage itself; storedActivity below re-reads.
          resolvePendingActivity(address).catch(() => {}),
        ]);
        if (cancelled) return;

        // Cross-chain native positions — only when the seed is unlocked.
        // Each chain runs best-effort; one RPC failure doesn't poison the
        // whole dashboard.
        const xchain: DisplayCoin[] = [];
        if (seedKey) {
          const other: { bitcoin?: string; solana?: string; cosmos?: string } = await otherAddrs;
          const tries = await Promise.allSettled([
            (async () => {
              if (!other.bitcoin) return null;
              const m = await import('./bitcoin');
              const bal = parseFloat(await m.getBitcoinBalance(other.bitcoin)) || 0;
              return { sym: 'BTC',  name: 'Bitcoin',    bal, decimals: 8 };
            })(),
            (async () => {
              if (!other.solana) return null;
              const m = await import('./solana');
              const bal = parseFloat(await m.getSolanaBalance(other.solana)) || 0;
              return { sym: 'SOL',  name: 'Solana',     bal, decimals: 9 };
            })(),
            (async () => {
              if (!other.cosmos) return null;
              const m = await import('./cosmos');
              const bal = parseFloat(await m.getCosmosBalance(other.cosmos)) || 0;
              return { sym: 'ATOM', name: 'Cosmos Hub', bal, decimals: 6 };
            })(),
          ]);
          for (const r of tries) {
            if (r.status !== 'fulfilled' || !r.value || r.value.bal <= 0) continue;
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

        const lax = await nativeLax;
        if (cancelled) return;
        if (lax) xchain.push(lax);

        const totalUsd = xchain.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = xchain.map(c => ({ ...c, pct: totalUsd > 0 ? Math.round((c.usdValue / totalUsd) * 100) : 0 }));
        // Lithosphere MAINNET (chainId 9005) always leads regardless of
        // amount — the Web4 home chain, client requirement 2026-08-27.
        coins.sort((a, b) => {
          const rank = (c: typeof a) => c.chainId === 9005 ? -1 : c.sym === 'LITHO' ? 0 : 1;
          return rank(a) - rank(b);
        });

        // Cache-write: only persist a snapshot when the fetch produced real
        // data. An empty result (every chain read failed) must never overwrite
        // a good snapshot — that would poison the cached-first view.
        if (coins.length > 0) {
          writeSnapshot(address, { coins, totalUsd });
        }
        setState({ coins, activity: storedActivity(address), totalUsd, loading: false, offline: false });
      } catch {
        if (cancelled) return;
        setState({ coins: [], activity: storedActivity(address), totalUsd: 0, loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce, seedKey]);

  return {
    ...state,
    reload: () => setNonce((n) => n + 1),
    saveNativeHash: (evmHash, nativeHash) => {
      if (setNativeHash(address, evmHash, nativeHash) && current.current === address) {
        setState((s) => ({ ...s, activity: storedActivity(address) }));
      }
    },
  };
}

/* ─── Context — App fetches once, every view reads it ────────────────── */

export const PortfolioContext = createContext<PortfolioState>({
  coins: [], activity: [], totalUsd: 0, loading: false, offline: false, reload: () => {}, saveNativeHash: () => {},
});
export function usePortfolioCtx(): PortfolioState {
  return useContext(PortfolioContext);
}
