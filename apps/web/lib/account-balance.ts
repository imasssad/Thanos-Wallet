'use client';
/**
 * Account balance lookup for the delete-account guard.
 *
 * An account may only be removed when it's effectively empty. This computes
 * what a given account address holds, in USD, across every EVM chain the
 * wallet shows (Lithosphere Mainnet first, the external chains, custom
 * networks) and their known tokens, priced with the caller's price map.
 * (It used to read the Thanos indexer, which only covers the Makalu testnet —
 * no longer part of the wallet, 2026-09-29.)
 *
 * FAIL-SAFE BY DESIGN: returns `null` whenever the value cannot be determined
 * — a chain we couldn't read, an unparseable balance, or a non-zero holding
 * whose price we don't know. Callers MUST treat null as "refuse to delete",
 * never as "it's empty". Deleting an account we couldn't price risks hiding
 * funds.
 */
import { Contract, formatUnits } from 'ethers';
import { getEvmProvider } from './evm-chains';
import { allEvmChains, allTokensForChain } from './custom-assets';

/** Below this, an account counts as empty and may be removed. */
export const DELETE_MAX_USD = 1;

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export async function accountUsdValue(
  address: string,
  prices: Record<string, number>,
): Promise<number | null> {
  if (!address) return null;
  try {
    const chains = allEvmChains();
    const tokens = chains.flatMap((c) => allTokensForChain(c.chainId));
    // Promise.all, not allSettled: a chain we couldn't read may be the one
    // holding the funds, so any failed read makes the whole answer null.
    const [natives, tokenBals] = await Promise.all([
      Promise.all(chains.map(async (c) => ({
        sym: c.nativeSymbol,
        qty: parseFloat(formatUnits(await getEvmProvider(c.chainId).getBalance(address), 18)),
      }))),
      Promise.all(tokens.map(async (t) => {
        const raw = await new Contract(t.address, ERC20_BALANCE_ABI, getEvmProvider(t.chainId)).balanceOf(address) as bigint;
        return { sym: t.symbol, qty: parseFloat(formatUnits(raw, t.decimals)) };
      })),
    ]);
    let total = 0;
    for (const h of [...natives, ...tokenBals]) {
      if (!isFinite(h.qty)) return null;              // unparseable → can't verify
      if (h.qty <= 0) continue;
      const px = prices[h.sym];
      if (px == null || !isFinite(px)) return null;   // holds something we can't price
      total += h.qty * px;
    }
    return total;
  } catch {
    return null;                                      // a chain unreachable → can't verify
  }
}
