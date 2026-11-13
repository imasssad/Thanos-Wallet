/**
 * Tokens an address is found to hold, laid over the wallet's own token list.
 *
 * portfolio/token-discovery.ts does the reading; this is the small piece of
 * state every client needs around it, so none of them has to grow its own:
 * the rows for the chains asked for, a throttle (one read per address per
 * interval, one in flight at a time), and a change announcement so a
 * portfolio already on screen re-reads and the new asset appears without a
 * reload.
 *
 * The rows carry metadata only — chain, contract, symbol, decimals. Each
 * client merges them into its own token list, so the balance on screen and
 * the one Send uses are read by that client's own code, on the token's own
 * chain, exactly as for a built-in or user-added token. A discovery whose
 * balance has since gone to zero therefore shows as zero (or drops out), and
 * discovery is never on the path that paints a balance: a read that fails
 * leaves the previous rows alone.
 *
 * Deliberately NOT persisted: a stale overlay would resurrect tokens the
 * wallet no longer holds, and a read is one request plus a few eth_calls.
 */
import {
  discoverTokenHoldings,
  type DiscoveredToken,
  type DiscoveryAddresses,
  type DiscoveryOptions,
} from './token-discovery';

/** A discovered token as a token-list row. */
export interface DiscoveredTokenRow {
  chainId:  number;
  symbol:   string;
  name:     string;
  /** Lowercase contract. */
  address:  string;
  decimals: number;
  /** Neither built in nor user-added: discovery found it. */
  discovered: true;
}

/** A token the wallet already lists, so discovery can class it as known. */
export interface KnownTokenRef { chainId: number; address: string; symbol?: string }

export interface DiscoveryOverlay {
  /** Discovered rows on one chain (built-ins/user tokens are the caller's). */
  tokensForChain(chainId: number): DiscoveredTokenRow[];
  /** Every discovered row. */
  tokens(): DiscoveredTokenRow[];
  /** The address the current rows belong to, lowercased; '' when none. */
  address(): string;
  /**
   * Read again for this address when due. Resolves when the pass is over and
   * NEVER throws or rejects — a client calls it beside its balance reads.
   * `force` skips the interval check (a pull-to-refresh).
   */
  refresh(address: string, known?: readonly KnownTokenRef[], force?: boolean): Promise<void>;
  /** Drop everything (wallet locked, account removed). */
  clear(): void;
}

const DEFAULT_EVERY_MS = 5 * 60 * 1000;

const rowKey = (r: DiscoveredTokenRow): string => `${r.chainId}:${r.address}`;

/** Only the ones worth showing beside listed tokens: `wellKnown` covers the
 *  wallet's own, the priced-and-unflagged, and Lithosphere holdings. */
function toRows(tokens: readonly DiscoveredToken[]): DiscoveredTokenRow[] {
  const out = new Map<string, DiscoveredTokenRow>();
  for (const t of tokens) {
    if (t.chain !== 'evm' || t.chainId == null) continue; // EVM token lists only
    if (!t.wellKnown) continue;
    const row: DiscoveredTokenRow = {
      chainId: t.chainId, symbol: t.symbol, name: t.name || t.symbol,
      address: t.address.toLowerCase(), decimals: t.decimals, discovered: true,
    };
    out.set(rowKey(row), row);
  }
  return [...out.values()];
}

export function createDiscoveryOverlay(opts: {
  /** EVM chains to read; omit for every chain a source covers. */
  chainIds?: number[];
  /** Minimum gap between reads for one address (default 5 min). */
  everyMs?: number;
  /** Called when the row set actually changed — not on an identical re-read. */
  onChange?: () => void;
  /** Extra options passed straight through (fetchImpl, timeoutMs, …). */
  discoveryOptions?: Omit<DiscoveryOptions, 'chainIds' | 'knownTokens'>;
  /** Swapped out in tests. */
  discover?: typeof discoverTokenHoldings;
} = {}): DiscoveryOverlay {
  const everyMs = Math.max(0, opts.everyMs ?? DEFAULT_EVERY_MS);
  const discover = opts.discover ?? discoverTokenHoldings;
  let rows: DiscoveredTokenRow[] = [];
  let forAddr = '';
  let lastAt = 0;
  // Tracked WITH its address: an account switch must start its own read
  // rather than wait on the previous account's, whose answer is dropped.
  let inFlight: { addr: string; p: Promise<void> } | null = null;

  const publish = (next: DiscoveredTokenRow[]): void => {
    const before = rows.map(rowKey).sort().join(',');
    const after = next.map(rowKey).sort().join(',');
    rows = next;
    if (before !== after) opts.onChange?.();
  };

  return {
    tokensForChain: (chainId) => rows.filter((r) => r.chainId === chainId),
    tokens: () => [...rows],
    address: () => forAddr,
    clear() {
      lastAt = 0; forAddr = '';
      publish([]);
    },
    refresh(address, known, force) {
      const addr = (address ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) { this.clear(); return Promise.resolve(); }
      // A different address: its rows are not this one's.
      if (addr !== forAddr) { forAddr = addr; lastAt = 0; publish([]); }
      if (inFlight && inFlight.addr === addr) return inFlight.p;
      if (!force && lastAt !== 0 && Date.now() - lastAt < everyMs) return Promise.resolve();
      lastAt = Date.now();
      const addrs: DiscoveryAddresses = { evm: address };
      const rec: { addr: string; p: Promise<void> } = { addr, p: Promise.resolve() };
      rec.p = discover(addrs, {
        ...opts.discoveryOptions,
        ...(opts.chainIds ? { chainIds: opts.chainIds } : {}),
        knownTokens: (known ?? []).map((k) => ({ chainId: k.chainId, address: k.address, ...(k.symbol ? { symbol: k.symbol } : {}) })),
      }).then(
        (res) => {
          // Still the address we read for, and something was actually read:
          // otherwise keep what we had rather than blanking it.
          if (addr !== forAddr || res.read.length === 0) return;
          publish(toRows(res.tokens));
        },
        () => { /* a failed read keeps the previous rows */ },
      ).finally(() => { if (inFlight === rec) inFlight = null; });
      inFlight = rec;
      return rec.p;
    },
  };
}
