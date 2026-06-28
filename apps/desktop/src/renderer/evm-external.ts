/**
 * External-EVM support for the mobile wallet — Ethereum, BNB Chain, Polygon,
 * Base, Arbitrum, Optimism, Linea, Avalanche. Same `0x` keypair as Makalu,
 * just routed through each chain's own RPC.
 *
 * Mirrors apps/web/lib/evm-chains.ts + apps/web/lib/evm-tokens.ts. Pure ethers
 * v6 + fetch — no native modules, bundles fine under Metro/Hermes.
 *
 * Every token address + decimals below was VERIFIED on-chain (symbol()/
 * decimals()) — a wrong token address is a fund-loss bug, so do not edit
 * without re-verifying. USDT/USDC are 6 decimals everywhere EXCEPT BSC (18).
 */
import { Contract, JsonRpcProvider, HDNodeWallet, Wallet, Mnemonic, formatUnits, parseUnits, type Provider } from 'ethers';

// Static chain/token metadata lives in evm-external-meta.ts (no ethers) so the
// renderer can import the data without eager-loading ethers. Re-exported here
// so existing `import { EXT_EVM_CHAINS, ... } from './evm-external'` keep working.
export {
  EXT_EVM_CHAINS, EXT_EVM_TOKENS, getExtEvmChain, extEvmTokensForChain,
  type ExtEvmChain, type ExtEvmToken,
} from './evm-external-meta';
import { EXT_EVM_CHAINS, EXT_EVM_TOKENS, getExtEvmChain, type ExtEvmChain, type ExtEvmToken } from './evm-external-meta';

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
const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

/* ─── Balance reads (parallel, error-tolerant) ───────────────────────── */

/** Native gas-coin balance across all 8 chains. Failed/zero chains omitted. */
export async function getAllExtEvmNativeBalances(address: string): Promise<Array<{ chain: ExtEvmChain; balance: number }>> {
  if (!address) return [];
  const results = await Promise.allSettled(
    EXT_EVM_CHAINS.map(async (c) => {
      const wei = await getExtEvmProvider(c.chainId).getBalance(address);
      return { chain: c, balance: parseFloat(formatUnits(wei, 18)) || 0 };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ chain: ExtEvmChain; balance: number }> => r.status === 'fulfilled' && r.value.balance > 0)
    .map(r => r.value);
}

/** USDT/USDC balances across all chains. Failed/zero entries omitted. */
export async function getAllExtEvmTokenBalances(address: string): Promise<Array<{ token: ExtEvmToken; balance: number }>> {
  if (!address) return [];
  const results = await Promise.allSettled(
    EXT_EVM_TOKENS.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getExtEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return { token: t, balance: parseFloat(formatUnits(raw, t.decimals)) };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ token: ExtEvmToken; balance: number }> => r.status === 'fulfilled' && r.value.balance > 0)
    .map(r => r.value);
}

/* ─── Send (chain-aware; native or ERC-20) ───────────────────────────── */

export class ExtEvmSendError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ExtEvmSendError'; }
}

function walletFor(seed: string[], accountIdx: number, provider: Provider) {
  const isPk = seed.length === 1 && /^0x[0-9a-fA-F]{64}$/.test((seed[0] ?? '').trim());
  const w = isPk
    ? new Wallet(seed[0].trim())
    : HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), `m/44'/60'/0'/0/${accountIdx}`);
  return w.connect(provider);
}

/**
 * Send a native coin (ETH/BNB/POL/AVAX) or an ERC-20 (USDT/USDC) on an
 * external EVM chain. `tokenAddress` present → ERC-20 transfer; else native.
 * Returns the broadcast tx hash.
 */
export async function sendExtEvm(args: {
  seed: string[];
  accountIdx: number;
  chainId: number;
  recipient: string;
  amount: string;       // human-readable
  decimals: number;     // 18 native, token decimals for ERC-20
  tokenAddress?: string;
}): Promise<string> {
  const chain = getExtEvmChain(args.chainId);
  if (!chain) throw new ExtEvmSendError('invalid_chain', `Unsupported chain ${args.chainId}`);

  const to = args.recipient.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new ExtEvmSendError('invalid_address', `${chain.name} needs a 0x address`);

  let value: bigint;
  try { value = parseUnits(args.amount, args.decimals); }
  catch { throw new ExtEvmSendError('invalid_amount', 'Enter a valid amount'); }
  if (value <= 0n) throw new ExtEvmSendError('invalid_amount', 'Amount must be greater than zero');

  const provider = getExtEvmProvider(args.chainId);
  const wallet   = walletFor(args.seed, args.accountIdx, provider);

  try {
    if (args.tokenAddress) {
      const c = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, wallet);
      const sent = await c.transfer(to, value);
      return sent.hash as string;
    }
    const sent = await wallet.sendTransaction({ to, value });
    return sent.hash;
  } catch (e) {
    const msg = (e as Error)?.message || 'Broadcast failed';
    if (/insufficient funds/i.test(msg))               throw new ExtEvmSendError('insufficient', `Insufficient ${chain.nativeSymbol} for amount + gas`);
    if (/transfer amount exceeds balance/i.test(msg))  throw new ExtEvmSendError('insufficient', 'Insufficient token balance');
    throw new ExtEvmSendError('rpc_error', msg);
  }
}
