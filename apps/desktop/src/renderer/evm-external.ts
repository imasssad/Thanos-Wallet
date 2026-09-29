/**
 * EVM chain support for the desktop wallet — Lithosphere Mainnet, Ethereum,
 * BNB Chain, Polygon, Base, Arbitrum, Optimism, Linea, Avalanche and custom
 * networks. One `0x` keypair, each chain read through its own RPC. (Sends go
 * through send.ts, which signs on the asset's own chain.)
 *
 * Mirrors apps/web/lib/evm-chains.ts + apps/web/lib/evm-tokens.ts. Pure ethers
 * v6 + fetch.
 *
 * Every token address + decimals below was VERIFIED on-chain (symbol()/
 * decimals()) — a wrong token address is a fund-loss bug, so do not edit
 * without re-verifying. USDT/USDC are 6 decimals everywhere EXCEPT BSC (18).
 */
import { Contract, JsonRpcProvider, formatUnits, type Provider } from 'ethers';

// Static chain/token metadata lives in evm-external-meta.ts (no ethers) so the
// renderer can import the data without eager-loading ethers. Re-exported here
// so existing `import { EXT_EVM_CHAINS, ... } from './evm-external'` keep working.
export {
  EXT_EVM_CHAINS, EXT_EVM_TOKENS, extEvmTokensForChain,
  type ExtEvmChain, type ExtEvmToken,
} from './evm-external-meta';
import { type ExtEvmChain } from './evm-external-meta';
// getExtEvmChain here is the MERGED version (built-ins + user-added custom
// networks) — shadows evm-external-meta's built-in-only one on purpose.
export { getExtEvmChain, type ExtTokenLike } from './custom-assets';
import { getExtEvmChain, allEvmChains, allTokensForChain, type ExtTokenLike } from './custom-assets';

/* ─── Providers (memoised) ───────────────────────────────────────────── */
const providers = new Map<number, Provider>();
export function getExtEvmProvider(chainId: number): Provider {
  const hit = providers.get(chainId);
  if (hit) return hit;
  const chain = getExtEvmChain(chainId);
  if (!chain) throw new Error(`evm-external: unsupported chainId ${chainId}`);
  const p = new JsonRpcProvider(chain.rpcUrl, chainId, { staticNetwork: true });
  providers.set(chainId, p);
  return p;
}

const ERC20_BALANCE_ABI  = ['function balanceOf(address owner) view returns (uint256)'];

/* ─── Balance reads (parallel, error-tolerant) ───────────────────────── */

/** Native gas-coin balance across all chains (built-in + custom). Failed/zero omitted. */
export async function getAllExtEvmNativeBalances(address: string): Promise<Array<{ chain: ExtEvmChain; balance: number }>> {
  if (!address) return [];
  const results = await Promise.allSettled(
    allEvmChains().map(async (c) => {
      const wei = await getExtEvmProvider(c.chainId).getBalance(address);
      return { chain: c, balance: parseFloat(formatUnits(wei, 18)) || 0 };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ chain: ExtEvmChain; balance: number }> => r.status === 'fulfilled' && r.value.balance > 0)
    .map(r => r.value);
}

/** ERC-20 balances across all chains — built-in USDT/USDC + custom tokens. Failed/zero omitted. */
export async function getAllExtEvmTokenBalances(address: string): Promise<Array<{ token: ExtTokenLike; balance: number }>> {
  if (!address) return [];
  const all = allEvmChains().flatMap((c) => allTokensForChain(c.chainId));
  const results = await Promise.allSettled(
    all.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getExtEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return { token: t, balance: parseFloat(formatUnits(raw, t.decimals)) };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ token: ExtTokenLike; balance: number }> => r.status === 'fulfilled' && r.value.balance > 0)
    .map(r => r.value);
}
