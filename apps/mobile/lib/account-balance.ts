/**
 * Account balance lookup for the delete-account guard — mobile twin of
 * apps/web/lib/account-balance.ts.
 *
 * An account may only be removed when it's effectively empty. This prices what
 * a given account address holds from the indexer portfolio + the ecosystem
 * price map.
 *
 * FAIL-SAFE BY DESIGN: returns `null` whenever the value cannot be determined
 * — indexer unreachable, an unparseable balance, or a non-zero holding whose
 * price we don't know. Callers MUST treat null as "refuse to delete", never as
 * "it's empty". Hiding an account we couldn't price risks hiding funds, and
 * the user has no way to undo that from the UI.
 */
import { formatUnits } from 'ethers';
import { getPortfolio } from './indexer';
import { fetchEcosystemPrices } from './pricing';

/** Below this, an account counts as empty and may be removed. */
export const DELETE_MAX_USD = 1;

export async function accountUsdValue(address: string): Promise<number | null> {
  if (!address) return null;
  try {
    const [portfolio, prices] = await Promise.all([
      getPortfolio(address),
      fetchEcosystemPrices().catch(() => ({} as Record<string, number>)),
    ]);
    let total = 0;
    for (const a of portfolio.assets) {
      let qty: number;
      try { qty = parseFloat(formatUnits(a.balance, a.decimals)); }
      catch { return null; }                        // unparseable → can't verify
      if (!isFinite(qty) || qty <= 0) continue;
      const px = prices[a.symbol];
      if (px == null || !isFinite(px)) return null; // holds something unpriceable
      total += qty * px;
    }
    return total;
  } catch {
    return null;                                    // indexer offline → can't verify
  }
}
