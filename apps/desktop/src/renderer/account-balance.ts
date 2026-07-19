/**
 * Account balance lookup for the delete-account guard — desktop twin of
 * apps/web/lib/account-balance.ts.
 *
 * FAIL-SAFE BY DESIGN: returns `null` whenever the value cannot be determined
 * (indexer unreachable, unparseable balance, or a non-zero holding whose price
 * we don't know). Callers MUST treat null as "refuse to delete", never as
 * "it's empty" — hiding an account we couldn't price risks hiding funds the
 * user can't recover from the UI.
 */
import { formatUnits } from 'ethers';
import { fetchEcosystemPrices } from '@thanos/sdk-core';
import { fetchPortfolio } from './portfolio';

/** Below this, an account counts as empty and may be removed. */
export const DELETE_MAX_USD = 1;

export async function accountUsdValue(address: string): Promise<number | null> {
  if (!address) return null;
  try {
    const [portfolio, prices] = await Promise.all([
      fetchPortfolio(address),
      fetchEcosystemPrices().catch(() => ({} as Record<string, number>)),
    ]);
    let total = 0;
    for (const a of portfolio.assets) {
      let qty: number;
      try { qty = parseFloat(formatUnits(a.balance || '0', a.decimals ?? 18)); }
      catch { return null; }
      if (!isFinite(qty) || qty <= 0) continue;
      const px = prices[a.symbol];
      if (px == null || !isFinite(px)) return null;
      total += qty * px;
    }
    return total;
  } catch {
    return null;
  }
}
