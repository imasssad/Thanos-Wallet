/**
 * Symbol → CoinGecko ID + price-policy map.
 *
 * Mirrors apps/web/lib/pricing.ts so all clients see the same prices:
 *   HARD prices  — never fetched (LAX is contractually pegged $1.0001)
 *   PLACEHOLDER  — never fetched, returned as-is until oracles are wired
 *                  (LITHO, JOT, IMAGE)
 *   Everything else — fetched live from CoinGecko's `/simple/price`
 */

export const HARD_PRICES: Record<string, number> = {
  LAX: 1.0001,
};

export const PLACEHOLDER_PRICES: Record<string, number> = {
  LITHO: 5.00,
  JOT:   0.50,
  IMAGE: 0.025,
};

/** Symbol → CoinGecko coin id. Lower-cased everywhere downstream. */
export const COINGECKO_IDS: Record<string, string> = {
  LitBTC: 'bitcoin',
  FurGPT: 'furgpt',
  COLLE:  'colle-ai',
  SOL:    'solana',
  BTC:    'bitcoin',
  ETH:    'ethereum',
  BNB:    'binancecoin',
  POL:    'matic-network',
  MATIC:  'matic-network',
  AVAX:   'avalanche-2',
};

/** Default symbol set for the scheduled price refresh — everything the
 *  wallet UI ever needs at runtime. Extra symbols can be passed in the
 *  job payload to override. */
export const DEFAULT_REFRESH_SYMBOLS: string[] = [
  ...Object.keys(HARD_PRICES),
  ...Object.keys(PLACEHOLDER_PRICES),
  ...Object.keys(COINGECKO_IDS),
];
