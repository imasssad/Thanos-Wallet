'use client';
/**
 * Account balance lookup for the delete-account guard.
 *
 * An account may only be removed when it's effectively empty. This computes
 * what a given account address holds, in USD, from the indexer portfolio plus
 * the caller's price map.
 *
 * FAIL-SAFE BY DESIGN: returns `null` whenever the value cannot be determined
 * — indexer unreachable, an unparseable balance, or a non-zero holding whose
 * price we don't know. Callers MUST treat null as "refuse to delete", never as
 * "it's empty". Deleting an account we couldn't price risks hiding funds.
 */
import { formatUnits } from 'ethers';
import { getPortfolio } from './indexer';

/** Below this, an account counts as empty and may be removed. */
export const DELETE_MAX_USD = 1;

export async function accountUsdValue(
  address: string,
  prices: Record<string, number>,
): Promise<number | null> {
  if (!address) return null;
  try {
    const portfolio = await getPortfolio(address);
    let total = 0;
    for (const a of portfolio.assets) {
      let qty: number;
      try { qty = parseFloat(formatUnits(a.balance, a.decimals)); }
      catch { return null; }                 // unparseable → can't verify
      if (!isFinite(qty) || qty <= 0) continue;
      const px = prices[a.symbol];
      if (!isFinite(px) || px == null) return null; // holds something we can't price
      total += qty * px;
    }
    return total;
  } catch {
    return null;                             // indexer offline → can't verify
  }
}
