/**
 * Account balance lookup for the delete-account guard — mobile twin of
 * apps/web/lib/account-balance.ts.
 *
 * FAIL-SAFE BY DESIGN: returns `null` whenever the value cannot be determined
 * (a chain we couldn't read, an unparseable balance, or a non-zero holding
 * whose price we don't know). Callers MUST treat null as "refuse to delete",
 * never as "it's empty" — hiding an account we couldn't price risks hiding
 * funds the user can't recover from the UI.
 *
 * Reads the same balances the wallet shows: every EVM network (Lithosphere
 * Mainnet first, the external chains, custom networks) and their known
 * tokens. It used to read the Thanos indexer, which only covers the Makalu
 * testnet — no longer part of the wallet (2026-09-29) — so an account
 * holding Mainnet LITHO counted as empty.
 */
import { Contract, formatUnits } from 'ethers';
import { fetchEcosystemPrices } from './pricing';
import { getExtEvmProvider } from './evm-external';
import { allEvmChains, allTokensForChain } from './custom-assets';

/** Below this, an account counts as empty and may be removed. */
export const DELETE_MAX_USD = 1;

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export async function accountUsdValue(address: string): Promise<number | null> {
  if (!address) return null;
  try {
    const chains = allEvmChains();
    const tokens = chains.flatMap((c) => allTokensForChain(c.chainId));
    // Promise.all, not allSettled: a chain we couldn't read may be the one
    // holding the funds, so any failed read makes the whole answer null.
    const [natives, tokenBals, prices] = await Promise.all([
      Promise.all(chains.map(async (c) => ({
        sym: c.nativeSymbol,
        qty: parseFloat(formatUnits(await getExtEvmProvider(c.chainId).getBalance(address), 18)),
      }))),
      Promise.all(tokens.map(async (t) => {
        const raw = await new Contract(t.address, ERC20_BALANCE_ABI, getExtEvmProvider(t.chainId)).balanceOf(address) as bigint;
        return { sym: t.symbol, qty: parseFloat(formatUnits(raw, t.decimals)) };
      })),
      fetchEcosystemPrices().catch(() => ({} as Record<string, number>)),
    ]);
    let total = 0;
    for (const h of [...natives, ...tokenBals]) {
      if (!isFinite(h.qty)) return null;
      if (h.qty <= 0) continue;
      const px = prices[h.sym];
      if (px == null || !isFinite(px)) return null;
      total += h.qty * px;
    }
    return total;
  } catch {
    return null;
  }
}
