'use client';
/**
 * useLiveBalances — single source of truth for the wallet's on-chain balances.
 *
 * Replaces the per-page balance fetches that used to live inside Dashboard
 * and (implicitly) the canonical TOKENS.balance placeholders that several
 * components fell back to. Every UI surface that needs "how much of X
 * does the user actually have right now" should go through this hook.
 *
 * Sources:
 *   - EVM (Lithosphere Makalu + LEP100 tokens) via the indexer's
 *     /portfolio/:wallet endpoint
 *   - Bitcoin via mempool.space (BIP84 / single-keypair P2WPKH)
 *   - Solana via Solana mainnet-beta RPC
 *
 * No canonical-mock fallback. If a chain is unreachable the relevant
 * entry stays undefined and the UI shows '—' / '0'.
 *
 * The hook caches in module scope keyed by EVM address so a render
 * cascade (Dashboard + Send modal + Exchange widget all mounting at
 * once) only triggers one set of fetches.
 */
import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { getPortfolio, IndexerOffline, type IndexerAsset } from './indexer';
import { getSolanaAddress,    getSolanaBalance    } from './solana';
import { getBitcoinAddressFromSource, getBitcoinBalance } from './bitcoin';
import type { WalletSource } from './wallet-source';

export interface LiveBalances {
  /** Lower-cased ticker → balance as human-readable decimal string. */
  bySym:        Map<string, string>;
  /** Lower-cased ticker → balance as a float for math. Zero if missing. */
  bySymNumber:  Map<string, number>;
  /** True until the first set of fetches resolves. */
  loading:      boolean;
  /** Set to true when the indexer call fails with IndexerOffline. */
  indexerOk:    boolean;
}

interface CachedEntry {
  at:      number;
  result:  LiveBalances;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CachedEntry>();

/* In-flight Promise dedup so two mounting components share one fetch. */
const inFlight = new Map<string, Promise<LiveBalances>>();

function emptyBalances(): LiveBalances {
  return {
    bySym:       new Map(),
    bySymNumber: new Map(),
    loading:     false,
    indexerOk:   true,
  };
}

async function loadOnce(
  evmAddress: string | undefined,
  source:     WalletSource | null,
): Promise<LiveBalances> {
  const key = `${evmAddress ?? ''}|${source?.kind ?? ''}|${source?.kind === 'privateKey' ? source.privateKey.slice(0, 6) : ''}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = (async () => {
    const bySym       = new Map<string, string>();
    const bySymNumber = new Map<string, number>();
    let   indexerOk   = true;

    /* ── EVM via indexer ───────────────────────────────────────── */
    if (evmAddress) {
      try {
        const portfolio = await getPortfolio(evmAddress);
        for (const a of (portfolio.assets ?? []) as IndexerAsset[]) {
          let decimal = '0';
          try { decimal = ethers.formatUnits(a.balance || '0', a.decimals ?? 18); }
          catch { /* malformed — leave 0 */ }
          const num = parseFloat(decimal) || 0;
          if (num > 0) {
            const sym = a.symbol.toLowerCase();
            bySym.set(sym, num.toLocaleString('en-US', { maximumFractionDigits: 8 }));
            bySymNumber.set(sym, num);
          }
        }
      } catch (e) {
        if (e instanceof IndexerOffline) indexerOk = false;
        // Otherwise swallow — keep what we have, don't surface to UI as error.
      }
    }

    /* ── Solana (mnemonic only — no SLIP-0010 from raw secp key) ── */
    if (source?.kind === 'mnemonic') {
      try {
        const addr = getSolanaAddress(source.mnemonic);
        const bal  = parseFloat(await getSolanaBalance(addr));
        if (bal > 0) {
          bySym.set('sol', bal.toLocaleString('en-US', { maximumFractionDigits: 9 }));
          bySymNumber.set('sol', bal);
        }
      } catch { /* RPC blip — skip */ }
    }

    /* ── Bitcoin (works for both mnemonic and PK) ──────────────── */
    if (source) {
      try {
        const addr = getBitcoinAddressFromSource(source);
        if (addr) {
          const bal = parseFloat(await getBitcoinBalance(addr));
          if (bal > 0) {
            bySym.set('btc', bal.toLocaleString('en-US', { maximumFractionDigits: 8 }));
            bySymNumber.set('btc', bal);
          }
        }
      } catch { /* mempool.space blip — skip */ }
    }

    const result: LiveBalances = { bySym, bySymNumber, loading: false, indexerOk };
    cache.set(key, { at: Date.now(), result });
    return result;
  })().finally(() => { inFlight.delete(key); });

  inFlight.set(key, p);
  return p;
}

export function useLiveBalances(
  evmAddress: string | undefined,
  source:     WalletSource | null,
): LiveBalances {
  const [state, setState] = useState<LiveBalances>(() => ({
    ...emptyBalances(),
    loading: !!(evmAddress || source),
  }));

  useEffect(() => {
    let cancel = false;
    if (!evmAddress && !source) {
      setState({ ...emptyBalances(), loading: false });
      return;
    }
    setState(prev => ({ ...prev, loading: true }));
    loadOnce(evmAddress, source)
      .then(r => { if (!cancel) setState(r); })
      .catch(() => { if (!cancel) setState({ ...emptyBalances(), loading: false }); });
    return () => { cancel = true; };
  }, [evmAddress, source?.kind, source?.kind === 'mnemonic' ? source.mnemonic : source?.kind === 'privateKey' ? source.privateKey : '']);

  return state;
}

/** Force-refresh — drops the cache entry so the next useLiveBalances mount
 *  re-fetches. Call after a successful Send to invalidate stale balances. */
export function invalidateLiveBalances(): void {
  cache.clear();
}
