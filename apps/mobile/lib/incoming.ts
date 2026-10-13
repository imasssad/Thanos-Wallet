/**
 * Funds received, noticed on the phone (client 2026-10-13: "received fund
 * notification needs to work" and "keep the history of txn").
 *
 * The only server feed of incoming transfers is the indexer, which watches
 * the Makalu testnet — no longer part of the wallet — so nothing reported a
 * receive on Lithosphere Mainnet tokens, the external EVM chains, BTC, SOL
 * or ATOM. Instead, every balance the portfolio actually READS is compared
 * with the last one seen for that asset on this wallet address; an increase
 * is funds received. The caller records it in Activity and notifies.
 *
 * Only fresh reads are passed in: a network that failed keeps its
 * last-known number in the portfolio and is skipped here, so an outage
 * followed by recovery is never mistaken for a deposit. The first time an
 * asset is seen its balance is just recorded — existing holdings never
 * trigger a notification. Works while the app is open or returns to the
 * foreground; a notification with the app closed needs server push.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SendChainKind } from './local-activity';

const PREFIX = 'balance_watch:';

export interface WatchedBalance {
  /** Stable per asset: chain + token contract (or "native"). */
  key:           string;
  sym:           string;
  balance:       number;
  decimals:      number;
  networkName:   string;
  chainId?:      number;
  chain?:        SendChainKind;
  tokenAddress?: string;
}
export interface Incoming extends WatchedBalance { amount: number }

export const watchKeyEvm = (chainId: number, tokenAddress?: string) =>
  `evm:${chainId}:${tokenAddress ? tokenAddress.toLowerCase() : 'native'}`;
export const watchKeyNative = (sym: string) => `native:${sym}`;

// Several screens hold their own portfolio; serialise so two reads of the
// same increase can't both see the old balance.
let queue: Promise<unknown> = Promise.resolve();

/** Compare fresh reads with the last balances seen for `address`; returns
 *  the increases and remembers the new balances. */
export function detectIncoming(address: string, reads: WatchedBalance[]): Promise<Incoming[]> {
  if (!address || reads.length === 0) return Promise.resolve([]);
  const run = queue.then(async () => {
    const storeKey = PREFIX + address.toLowerCase();
    let prev: Record<string, number> = {};
    try {
      const raw = await AsyncStorage.getItem(storeKey);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') prev = parsed as Record<string, number>;
    } catch { /* unreadable — start fresh */ }

    const next: Record<string, number> = { ...prev };
    const out: Incoming[] = [];
    for (const r of reads) {
      if (!Number.isFinite(r.balance) || r.balance < 0) continue;
      const before = prev[r.key];
      next[r.key] = r.balance;
      if (typeof before !== 'number') continue; // first sighting: just record
      const diff = r.balance - before;
      // Below one unit of the asset's last decimal (or float noise on a large
      // balance) is not a deposit.
      const eps = Math.max(10 ** -Math.min(r.decimals, 12), Math.abs(before) * 1e-9);
      if (diff > eps) out.push({ ...r, amount: diff });
    }
    try { await AsyncStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* best-effort */ }
    return out;
  });
  queue = run.catch(() => []);
  return run;
}
