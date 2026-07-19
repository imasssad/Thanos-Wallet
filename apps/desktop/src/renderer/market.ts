/**
 * Live market data for the desktop wallet's Market view.
 *
 * Pulls the top coins by market cap from CoinGecko's keyless public API
 * — current price, 24h / 7d change, market cap and 24h volume. Replaces
 * the MARKET mock.
 */
import { useEffect, useState } from 'react';
import { getMakaluLep100Tokens, fetchEcosystemPrices, convertFromUsd, withCurrencyAffix } from '@thanos/sdk-core';
import { coinColor } from './portfolio';

/* The Market lists ONLY the Lithosphere ecosystem (per Esha) — LITHO + the
   Makalu LEP100 tokens — not CoinGecko's global top-50. These tokens aren't on
   global market feeds, so we show the live price from the shared ecosystem
   price source; 24h/7d change + market cap + volume aren't available and read
   as — until an ecosystem market feed lands. */
const ECOSYSTEM_MARKET: { sym: string; name: string }[] = [
  { sym: 'LITHO', name: 'Lithosphere' },
  ...getMakaluLep100Tokens().map(t => ({ sym: t.symbol, name: t.name })),
];

export interface MarketRow {
  id: string; sym: string; name: string;
  price: number; chg24: number; chg7: number;
  cap: number; vol: number; color: string;
}

export interface MarketState {
  rows:    MarketRow[];
  loading: boolean;
  offline: boolean;
  reload:  () => void;
}

/** Per-unit price in the active display currency (input is USD). */
export function formatMarketPrice(nUsd: number): string {
  if (!isFinite(nUsd) || nUsd === 0) return withCurrencyAffix((0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const n = convertFromUsd(nUsd);
  if (n >= 1) return withCurrencyAffix(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  return withCurrencyAffix(n.toLocaleString('en-US', { maximumFractionDigits: 6 }));
}

/** Compact magnitude (market cap / volume) in the active display currency. */
export function formatCompact(nUsd: number): string {
  if (!isFinite(nUsd) || nUsd === 0) return '—';
  const n = convertFromUsd(nUsd);
  if (n >= 1e12) return withCurrencyAffix((n / 1e12).toFixed(2) + 'T');
  if (n >= 1e9)  return withCurrencyAffix((n / 1e9).toFixed(1) + 'B');
  if (n >= 1e6)  return withCurrencyAffix((n / 1e6).toFixed(1) + 'M');
  if (n >= 1e3)  return withCurrencyAffix((n / 1e3).toFixed(1) + 'K');
  return withCurrencyAffix(n.toFixed(0));
}

/** Live prices for the Lithosphere ecosystem tokens. Refetch via reload(). */
export function useMarket(): MarketState {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<MarketState, 'reload'>>({
    rows: [], loading: true, offline: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, offline: false }));
    (async () => {
      try {
        const prices = await fetchEcosystemPrices();
        if (cancelled) return;
        const rows: MarketRow[] = ECOSYSTEM_MARKET.map((t) => ({
          id:    t.sym.toLowerCase(),
          sym:   t.sym,
          name:  t.name,
          price: prices[t.sym] ?? 0,
          chg24: 0, chg7: 0, cap: 0, vol: 0,   // no global market feed for ecosystem tokens yet
          color: coinColor(t.sym),
        }));
        setState({ rows, loading: false, offline: false });
      } catch {
        if (!cancelled) setState({ rows: [], loading: false, offline: true });
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
