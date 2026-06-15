/**
 * Pricing for the web app.
 *
 * The CoinGecko fetch + hard/placeholder price tables now live in
 * @thanos/sdk-core (tokens/pricing.ts) so every client shares them.
 * This module is the thin web glue: it merges the web token table's
 * default `priceUsd` in for any symbol the shared fetch doesn't cover.
 */
import { TOKENS, type Token } from './tokens';
import { fetchEcosystemPrices, HARD_PRICES, PLACEHOLDER_PRICES } from '@thanos/sdk-core';

export { HARD_PRICES, PLACEHOLDER_PRICES };

/** Latest USD prices — ONLY for symbols with a real source: the static
 *  pair (LITHO, LAX) plus whatever CoinGecko priced live. Symbols with no
 *  feed are intentionally ABSENT (not back-filled from TOKENS[].priceUsd),
 *  so the UI renders "—" instead of a fabricated number (client directive
 *  2026-06-15: "be careful and accurate … price unknown → show —").
 *  Cached 60s (in sdk-core). */
export async function fetchAllPrices(): Promise<Record<string, number>> {
  return fetchEcosystemPrices();
}

/** Tokens with their priceUsd fields updated from the latest fetch. */
export async function getTokensWithLivePrices(): Promise<Token[]> {
  const prices = await fetchAllPrices();
  return TOKENS.map((t) => ({ ...t, priceUsd: prices[t.sym] ?? t.priceUsd }));
}
