/**
 * Live market data for the desktop wallet's Market view.
 *
 * Pulls the top coins by market cap from CoinGecko's keyless public API
 * — current price, 24h / 7d change, market cap and 24h volume. Replaces
 * the MARKET mock.
 */
import { useEffect, useState } from 'react';
import { coinColor } from './portfolio';

const MARKETS_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false' +
  '&price_change_percentage=24h,7d';

interface CGMarket {
  id:            string;
  symbol:        string;
  name:          string;
  current_price: number | null;
  market_cap:    number | null;
  total_volume:  number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?:  number | null;
}

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

/** $1,234.56 for >= $1, more precision for sub-dollar prices. */
export function formatMarketPrice(n: number): string {
  if (!isFinite(n) || n === 0) return '$0.00';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** Compact magnitude: $1.2T / $62.1B / $24.5M / $980.0K. */
export function formatCompact(n: number): string {
  if (!isFinite(n) || n === 0) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3)  return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

/** Fetch the top-50 coins by market cap. Refetch via the returned reload(). */
export function useMarket(): MarketState {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<MarketState, 'reload'>>({
    rows: [], loading: true, offline: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, offline: false }));
    (async () => {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(MARKETS_URL, {
          signal: ctrl.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`coingecko ${res.status}`);
        const data = (await res.json()) as CGMarket[];
        if (cancelled) return;
        const rows: MarketRow[] = data.map((m) => ({
          id:    m.id,
          sym:   (m.symbol || '').toUpperCase(),
          name:  m.name,
          price: m.current_price ?? 0,
          chg24: m.price_change_percentage_24h_in_currency ?? 0,
          chg7:  m.price_change_percentage_7d_in_currency ?? 0,
          cap:   m.market_cap ?? 0,
          vol:   m.total_volume ?? 0,
          color: coinColor((m.symbol || '').toUpperCase()),
        }));
        setState({ rows, loading: false, offline: false });
      } catch {
        if (!cancelled) setState({ rows: [], loading: false, offline: true });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
