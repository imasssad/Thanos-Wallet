/**
 * Live portfolio + activity data for the extension popup.
 *
 * Reads balances straight from each chain's RPC (Lithosphere Mainnet, the
 * external EVM chains, custom networks, BTC/SOL/ATOM) and prices them via
 * @thanos/sdk-core's CoinGecko pricing. Activity is the wallet's own history
 * (lib/local-activity.ts): sends, settled on their own chain; the full history
 * of every network from its explorer (lib/explorer-activity.ts); and funds
 * received on a network no explorer covers, noticed as balance increases
 * (lib/incoming.ts). (The Thanos
 * indexer only covers the Makalu testnet, which the wallet no longer
 * includes — 2026-09-29.) With Makalu added as a custom network, native
 * Lithic LAX is read through the native gateway and shown view-only.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { NATIVE_LAX, fetchEcosystemPrices, formatFiat, formatNativeAmount, readNativeLaxBalance } from '@thanos/sdk-core';
import { customChains, onCustomAssetsChanged, refreshDiscoveredTokens } from '../../lib/custom-assets';
import { getLocalActivity, addLocalReceive, mergeExplorerRows, resolvePendingActivity, rowId } from '../../lib/local-activity';
import { fetchWalletHistory, HISTORY_EVM_CHAIN_IDS } from '../../lib/explorer-activity';
import { detectIncoming, watchKeyEvm, watchKeyNative, type WatchedBalance } from '../../lib/incoming';
import { loadSnapshot, saveSnapshot } from './portfolio-cache';

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

/** Explorer page for a Bitcoin / Solana / Cosmos transaction (EVM ones come
 *  from the on-chain detail lookup, which knows the chain). */
function nonEvmTxUrl(chain: string, hash: string): string | undefined {
  if (!hash) return undefined;
  if (chain === 'bitcoin') return `https://mempool.space/tx/${hash}`;
  if (chain === 'solana') return `https://explorer.solana.com/tx/${hash}`;
  if (chain === 'cosmos') return `https://www.mintscan.io/cosmos/tx/${hash}`;
  return undefined;
}

/** Amount for a list row: explorers report every wei (0.000151744025760472),
 *  which crowds the row — round like the balances; dust keeps 2 significant
 *  digits instead of rounding to 0. */
function listAmount(amt: string): string {
  const n = parseFloat(amt.replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return amt;
  const shown = formatAmount(n);
  return shown === '0' ? n.toLocaleString('en-US', { maximumSignificantDigits: 2 }) : shown;
}

/** The wallet's history (lib/local-activity.ts) as display rows, newest
 *  first. "Pending" only while a send hasn't been settled on its chain. */
function activityFromStore(address: string): DisplayTx[] {
  return getLocalActivity(address).map((t) => {
    const received = t.label === 'Received';
    const status = t.status ?? 'pending';
    const amt = String(t.amount).replace(/^[+-]/, '');
    return {
      id: rowId(t),
      sym: t.sym,
      label: t.label,
      amount: `${received ? '+' : '-'}${listAmount(amt)}`,
      time: relativeTime(new Date(t.ts).toISOString()) || 'just now',
      ...(t.networkName ? { network: t.networkName } : {}),
      ...(t.chainId != null ? { chainId: t.chainId } : {}),
      ...(nonEvmTxUrl(t.chain, t.hash) ? { explorerUrl: nonEvmTxUrl(t.chain, t.hash) } : {}),
      pos: received,
      color: coinColor(t.sym),
      ...(t.hash ? { txHash: t.hash } : {}),
      ...(t.nativeHash ? { nativeHash: t.nativeHash } : {}),
      ts: new Date(t.ts).toISOString(),
      rawAmount: parseFloat(amt.replace(/,/g, '')) || 0,
      status,
      pending: status === 'pending' ? true : undefined,
    };
  });
}

/** Funds received (lib/incoming.ts) go into the history — only on networks
 *  no explorer covers; everywhere else the explorer lists the transfer with
 *  its hash and time (lib/explorer-activity.ts). BTC/SOL/ATOM are read only
 *  with the phrase unlocked, and then their history is read too. */
function recordIncoming(address: string, reads: WatchedBalance[]): void {
  for (const rx of detectIncoming(address, reads)) {
    if (rx.chain !== 'evm' || (rx.chainId != null && HISTORY_EVM_CHAIN_IDS.has(rx.chainId))) continue;
    const now = Date.now();
    addLocalReceive(address, {
      id: `recv:${rx.key}:${now}`, chain: rx.chain, sym: rx.sym, amount: formatAmount(rx.amount), ts: now,
      chainId: rx.chainId, networkName: rx.networkName, tokenAddress: rx.tokenAddress,
    });
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
  id: string; sym: string;
  label: 'Sent' | 'Received' | 'Swap' | 'Activity';
  amount: string; time: string; pos: boolean; color: string;
  /** Network it happened on ("Base", "Bitcoin", …). */
  network?: string;
  /** EVM chain — the detail lookup goes straight to it. */
  chainId?: number;
  /** Explorer page for a non-EVM transaction. */
  explorerUrl?: string;
  /** Raw fields the detail modal needs (the display strings above are lossy):
   *  hash for the on-chain fee/nonce lookup, ISO timestamp for the date-time
   *  line, numeric amount for the ≈fiat hero, raw indexer status. */
  txHash?: string;
  /** Lithosphere's own hash (no 0x) — shown first, with txHash as the
   *  secondary "EVM hash". Unset until LithoScan has reported it. */
  nativeHash?: string;
  ts?: string;
  rawAmount?: number;
  status?: string;
  /** True while this row is a local optimistic send not yet confirmed by the
   *  indexer. Drops to undefined once the indexer reports the hash and the
   *  local copy is deduped out (see mergeLocalActivity). Drives the "Pending"
   *  badge; never persisted from the indexer. */
  pending?: boolean;
}

export interface PortfolioState {
  /** The account these are for (0x) — its saved history is keyed by it. */
  address:  string;
  coins:    DisplayCoin[];
  activity: DisplayTx[];
  totalUsd: number;
  loading:  boolean;
  offline:  boolean;
  reload:   () => void;
}

/** Native LAX on Makalu, read through the native gateway — only when the
 *  user has added Makalu (700777) as a custom network, at that network's RPC.
 *  A failed read shows as unavailable, never as 0. */
async function readNativeLaxCoin(address: string): Promise<DisplayCoin | null> {
  const makalu = customChains().find((c) => c.chainId === NATIVE_LAX.chainId);
  if (!makalu) return null;
  const coin: DisplayCoin = {
    sym: NATIVE_LAX.symbol, name: NATIVE_LAX.name, chainId: NATIVE_LAX.chainId,
    balance: 0, balanceText: '—', decimals: NATIVE_LAX.decimals,
    priceUsd: 0, usdValue: 0, color: coinColor(NATIVE_LAX.symbol), native: false,
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

/** Fetch + price the wallet's portfolio and activity. When `seed` is
 *  provided, also derives BTC/SOL/ATOM addresses and adds their native
 *  balances to the displayed coin list — so the dashboard total
 *  reflects every chain. */
/** Build the initial hook state, seeded synchronously from this address's
 *  last-known snapshot so the (re)mounted popup paints real numbers instantly.
 *  loading stays true — a background refresh always runs. */
function initialStateFor(address: string): Omit<PortfolioState, 'reload' | 'address'> {
  const snap = /^0x[0-9a-fA-F]{40}$/.test(address || '') ? loadSnapshot(address) : null;
  return snap
    ? { coins: snap.coins, activity: snap.activity, totalUsd: snap.totalUsd, loading: true, offline: false }
    : { coins: [], activity: [], totalUsd: 0, loading: true, offline: false };
}

export function usePortfolio(address: string, seed?: string[]): PortfolioState {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<PortfolioState, 'reload' | 'address'>>(() => initialStateFor(address));

  // The token list changing — a token added or removed in Settings, or one
  // discovery found — re-reads the balances, so the row appears without the
  // popup being closed and opened again.
  useEffect(() => onCustomAssetsChanged(() => setNonce((n) => n + 1)), []);

  const seedKey = seed?.join(' ') ?? '';

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) {
      setState({ coins: [], activity: [], totalUsd: 0, loading: false, offline: false });
      return;
    }
    // Address changed — hydrate from THAT address's snapshot (or empty).
    setState(initialStateFor(address));
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, offline: false }));
    (async () => {
      try {
        // Balances come straight from each chain's RPC below. The Thanos
        // indexer only covers the Makalu testnet, which the wallet no longer
        // includes (2026-09-29), so its holdings and activity aren't shown.
        // A pricing outage mustn't hide balances — they just show unpriced.
        const prices = await fetchEcosystemPrices().catch(() => ({} as Record<string, number>));
        if (cancelled) return;

        // Started now, awaited with the rest below.
        const nativeLax = readNativeLaxCoin(address);

        // Cross-chain native positions — only when seed is unlocked.
        const xchain: DisplayCoin[] = [];
        // Their addresses also feed the history read below.
        const xAddrs: { bitcoin?: string; solana?: string; cosmos?: string } = {};
        if (seedKey) {
          const phrase = seedKey;
          const tries = await Promise.allSettled([
            (async () => {
              const m = await import('../../lib/bitcoin');
              const addr = m.getBitcoinAddress(phrase);
              xAddrs.bitcoin = addr;
              const bal = parseFloat(await m.getBitcoinBalance(addr)) || 0;
              return { sym: 'BTC',  name: 'Bitcoin',    bal, decimals: 8 };
            })(),
            // O-01 (H-1 residual, non-signing): both addresses come from
            // the offscreen signer's cache, not derived from `phrase`.
            (async () => {
              const [m, { getSolanaAddressFromSigner }] = await Promise.all([
                import('../../lib/solana'), import('./offscreen-sign'),
              ]);
              const addr = await getSolanaAddressFromSigner();
              xAddrs.solana = addr;
              const bal = parseFloat(await m.getSolanaBalance(addr)) || 0;
              return { sym: 'SOL',  name: 'Solana',     bal, decimals: 9 };
            })(),
            (async () => {
              const [m, { getCosmosAddressFromSigner }] = await Promise.all([
                import('../../lib/cosmos'), import('./offscreen-sign'),
              ]);
              const addr = await getCosmosAddressFromSigner();
              xAddrs.cosmos = addr;
              const bal = parseFloat(await m.getCosmosBalance(addr)) || 0;
              return { sym: 'ATOM', name: 'Cosmos Hub', bal, decimals: 6 };
            })(),
          ]);
          recordIncoming(address, tries.flatMap((r) => r.status !== 'fulfilled' ? [] : [{
            key: watchKeyNative(r.value.sym), sym: r.value.sym, balance: r.value.bal, decimals: r.value.decimals,
            networkName: r.value.name, chain: (r.value.sym === 'BTC' ? 'bitcoin' : r.value.sym === 'SOL' ? 'solana' : 'cosmos') as WatchedBalance['chain'],
          }]));
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
          const [nativeReads, tokenReads] = await Promise.all([
            m.readAllExtEvmNativeBalances(address),
            m.readAllExtEvmTokenBalances(address),
          ]);
          if (cancelled) return;
          recordIncoming(address, [
            ...nativeReads.flatMap(({ chain, balance }) => balance == null ? [] : [{
              key: watchKeyEvm(chain.chainId), sym: chain.nativeSymbol, balance, decimals: 18,
              networkName: chain.name, chain: 'evm' as const, chainId: chain.chainId,
            }]),
            ...tokenReads.flatMap(({ token, balance }) => balance == null ? [] : [{
              key: watchKeyEvm(token.chainId, token.address), sym: token.symbol, balance, decimals: token.decimals,
              networkName: m.getExtEvmChain(token.chainId)?.name ?? '', chain: 'evm' as const,
              chainId: token.chainId, tokenAddress: token.address,
            }]),
          ]);
          const natives = nativeReads.filter((r): r is { chain: typeof r.chain; balance: number } => r.balance != null && r.balance > 0);
          // Built-in USDT/USDC are a catalog: only what's actually held shows.
          // A token the USER added is an explicit "show me this", so it keeps
          // its row at zero — and even when the RPC read fails (balance null),
          // so an added asset never silently vanishes from Home/Assets.
          const tokens = tokenReads.flatMap(({ token, balance }) =>
            balance != null && balance > 0 ? [{ token, balance }]
            : token.custom              ? [{ token, balance: balance ?? 0 }]
            : []);
          for (const { chain, balance } of natives) {
            const priceUsd = prices[chain.nativeSymbol] ?? 0;
            evmExt.push({
              sym: chain.nativeSymbol, name: chain.name, chainId: chain.chainId,
              balance, balanceText: formatAmount(balance), decimals: 18,
              priceUsd, usdValue: balance * priceUsd, color: chain.color, native: true,
            });
          }
          for (const { token, balance } of tokens) {
            // Built-in USDT/USDC are ≈$1; custom tokens use a live price if known,
            // else $0 — never fabricate a stablecoin peg for an unknown token.
            const isStable = token.symbol === 'USDT' || token.symbol === 'USDC';
            const priceUsd = prices[token.symbol] ?? (isStable ? 1 : 0);
            evmExt.push({
              sym: token.symbol, name: `${token.symbol} · ${m.getExtEvmChain(token.chainId)?.name ?? ''}`.trim(),
              chainId: token.chainId, balance, balanceText: formatAmount(balance),
              decimals: token.decimals, priceUsd, usdValue: balance * priceUsd,
              color: token.symbol === 'USDT' ? '#26a17b' : token.symbol === 'USDC' ? '#2775ca' : coinColor(token.symbol),
              tokenAddress: token.address, native: false,
            });
          }
        } catch { /* best-effort */ }

        // What else this address holds on Lithosphere (LithoScan). Throttled,
        // never awaited here: it only announces a change, which re-runs this
        // effect and reads the new rows' balances the normal way.
        void refreshDiscoveredTokens(address);

        const lax = await nativeLax;
        if (cancelled) return;
        const totalUsd = xchain.reduce((s, x) => s + x.usdValue, 0)
                       + evmExt.reduce((s, x) => s + x.usdValue, 0);
        const coins: DisplayCoin[] = [...xchain, ...evmExt, ...(lax ? [lax] : [])];
        // Lithosphere MAINNET (chainId 9005) always leads regardless of
        // amount — the Web4 home chain, client requirement 2026-08-27.
        coins.sort((a, b) => {
          const rank = (c: typeof a) => c.chainId === 9005 ? -1 : c.sym === 'LITHO' ? 0 : 1;
          return rank(a) - rank(b);
        });

        const mergedActivity = activityFromStore(address);
        setState({ coins, activity: mergedActivity, totalUsd, loading: false, offline: false });
        // Then bring the history up to date without holding up the balances:
        // every network's explorer rows (older history, receives, sends from
        // other devices) and pending sends settled on their own chain.
        void (async () => {
          const known = getLocalActivity(address).map((t) => t.hash).filter(Boolean);
          const history = await fetchWalletHistory({ evm: address, ...xAddrs }, known).catch(() => null);
          if (history) mergeExplorerRows(address, history);
          await resolvePendingActivity(address).catch(() => null);
          if (cancelled) return;
          const activity = activityFromStore(address);
          setState((st) => ({ ...st, activity }));
          if (coins.length > 0) saveSnapshot(address, { coins, activity, totalUsd });
        })();
        // Persist the fresh result so the next popup open paints instantly.
        // Guard on coins.length: the per-chain reads are best-effort, so an
        // RPC outage can reach here as an empty list with offline:false —
        // without this guard it would overwrite a good snapshot and defeat
        // cached-first on the next open. A genuinely-empty wallet simply isn't
        // cached (it just shows a brief skeleton next time), which is fine.
        if (coins.length > 0) {
          saveSnapshot(address, { coins, activity: mergedActivity, totalUsd });
        }
      } catch {
        if (cancelled) return;
        // Pricing unreachable — still surface the user's own recorded sends.
        setState({ coins: [], activity: activityFromStore(address), totalUsd: 0, loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce, seedKey]);

  return { ...state, address, reload: () => setNonce((n) => n + 1) };
}

/* ─── Context — App fetches once, every screen reads it ──────────────── */

export const PortfolioContext = createContext<PortfolioState>({
  address: '', coins: [], activity: [], totalUsd: 0, loading: false, offline: false, reload: () => {},
});
export function usePortfolioCtx(): PortfolioState {
  return useContext(PortfolioContext);
}
