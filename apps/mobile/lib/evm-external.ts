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

export interface ExtEvmChain {
  chainId:      number;
  name:         string;
  slug:         string;
  rpcUrl:       string;
  nativeSymbol: string;   // ETH / BNB / POL / AVAX
  nativeName:   string;
  explorerUrl:  string;
  color:        string;
}

/** The 8 external EVM chains shown as first-class rows. Order = display order. */
export const EXT_EVM_CHAINS: readonly ExtEvmChain[] = [
  { chainId: 1,     name: 'Ethereum',  slug: 'ethereum',  rpcUrl: 'https://ethereum.publicnode.com',         nativeSymbol: 'ETH',  nativeName: 'Ether',              explorerUrl: 'https://etherscan.io',            color: '#627eea' },
  { chainId: 56,    name: 'BNB Chain', slug: 'bsc',       rpcUrl: 'https://bsc-dataseed.binance.org',        nativeSymbol: 'BNB',  nativeName: 'BNB',                explorerUrl: 'https://bscscan.com',             color: '#f3ba2f' },
  { chainId: 137,   name: 'Polygon',   slug: 'polygon',   rpcUrl: 'https://polygon-bor-rpc.publicnode.com',  nativeSymbol: 'POL',  nativeName: 'Polygon',            explorerUrl: 'https://polygonscan.com',         color: '#8247e5' },
  { chainId: 8453,  name: 'Base',      slug: 'base',      rpcUrl: 'https://mainnet.base.org',                nativeSymbol: 'ETH',  nativeName: 'Ether (Base)',       explorerUrl: 'https://basescan.org',            color: '#0052ff' },
  { chainId: 42161, name: 'Arbitrum',  slug: 'arbitrum',  rpcUrl: 'https://arb1.arbitrum.io/rpc',            nativeSymbol: 'ETH',  nativeName: 'Ether (Arbitrum)',   explorerUrl: 'https://arbiscan.io',             color: '#28a0f0' },
  { chainId: 59144, name: 'Linea',     slug: 'linea',     rpcUrl: 'https://rpc.linea.build',                 nativeSymbol: 'ETH',  nativeName: 'Ether (Linea)',      explorerUrl: 'https://lineascan.build',         color: '#62dfff' },
  { chainId: 10,    name: 'Optimism',  slug: 'optimism',  rpcUrl: 'https://mainnet.optimism.io',             nativeSymbol: 'ETH',  nativeName: 'Ether (Optimism)',   explorerUrl: 'https://optimistic.etherscan.io', color: '#ff0420' },
  { chainId: 43114, name: 'Avalanche', slug: 'avalanche', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',   nativeSymbol: 'AVAX', nativeName: 'Avalanche',          explorerUrl: 'https://snowtrace.io',            color: '#e84142' },
];

export function getExtEvmChain(chainId: number): ExtEvmChain | undefined {
  return EXT_EVM_CHAINS.find(c => c.chainId === chainId);
}

export interface ExtEvmToken {
  chainId:  number;
  symbol:   string;
  name:     string;
  address:  string;
  decimals: number;
}

/** External-chain token catalog — every address VERIFIED on-chain via
 *  symbol()/decimals()/name() before inclusion (USDT/USDC 2026-06-20;
 *  ecosystem tokens 2026-07-15). Keep in sync with apps/web/lib/evm-tokens.ts. */
export const EXT_EVM_TOKENS: readonly ExtEvmToken[] = [
  { chainId: 1,     symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6  },
  { chainId: 1,     symbol: 'USDC', name: 'USD Coin',   address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6  },
  { chainId: 56,    symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  { chainId: 56,    symbol: 'USDC', name: 'USD Coin',   address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  { chainId: 137,   symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6  },
  { chainId: 137,   symbol: 'USDC', name: 'USD Coin',   address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6  },
  { chainId: 42161, symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6  },
  { chainId: 42161, symbol: 'USDC', name: 'USD Coin',   address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6  },
  { chainId: 8453,  symbol: 'USDC', name: 'USD Coin',   address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  },
  { chainId: 10,    symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6  },
  { chainId: 10,    symbol: 'USDC', name: 'USD Coin',   address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6  },
  { chainId: 43114, symbol: 'USDT', name: 'Tether USD', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6  },
  { chainId: 43114, symbol: 'USDC', name: 'USD Coin',   address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6  },
  // ─── LITHO-ecosystem tokens on external chains (client request 2026-07-15:
  // "wrapped tokens on BNB and other chains are missing"). Addresses from the
  // projects' CoinGecko listings, then INDEPENDENTLY verified on-chain
  // (symbol/decimals/name read via each chain's RPC) before inclusion.
  // LITHO / FGPT / JOT / LAX external deployments are NOT listed anywhere
  // verifiable — add only with team-confirmed addresses, never from memory.
  { chainId: 56,    symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 1,     symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 56,    symbol: 'AGII',  name: 'AGII',           address: '0x328fd053c4bb968875afd9ad0af36fcf4a0bdda9', decimals: 18 },
  { chainId: 1,     symbol: 'AGII',  name: 'AGII',           address: '0x75d86078625d1e2f612de2627d34c7bc411c18b8', decimals: 18 },
  { chainId: 1,     symbol: 'IMAGE', name: 'Imagen Network', address: '0x1c3547dfa9ce7acd9c54ae49244575fa65bc75e2', decimals: 18 },
  { chainId: 1,     symbol: 'COLLE', name: 'Colle AI',       address: '0xc36983d3d9d379ddfb306dfb919099cb6730e355', decimals: 18 },
  { chainId: 56,    symbol: 'COLLE', name: 'Colle AI',       address: '0xaeb63742f2c7dd1538bbe2285b6789017a06b58b', decimals: 18 },
];

export function extEvmTokensForChain(chainId: number): ExtEvmToken[] {
  return EXT_EVM_TOKENS.filter(t => t.chainId === chainId);
}

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

/**
 * Sign + broadcast an ARBITRARY transaction (incl. contract calls carrying
 * `data`) on an external EVM chain — the in-app dApp browser's
 * eth_sendTransaction path once the user has switched off Makalu (e.g. the
 * Ignite TGE on BNB Chain). Distinct from sendExtEvm (structured native/ERC-20
 * transfers only). ethers accepts the dApp's hex-string fields directly and
 * stamps the correct EIP-155 chainId from the chain-bound provider.
 */
export async function sendExtEvmRaw(args: {
  seed: string[];
  accountIdx: number;
  chainId: number;
  tx: {
    to?: string; value?: string; data?: string;
    gas?: string; gasLimit?: string;
    maxFeePerGas?: string; maxPriorityFeePerGas?: string;
  };
}): Promise<string> {
  const chain = getExtEvmChain(args.chainId);
  if (!chain) throw new ExtEvmSendError('invalid_chain', `Unsupported chain ${args.chainId}`);
  const provider = getExtEvmProvider(args.chainId);
  const wallet   = walletFor(args.seed, args.accountIdx, provider);
  const t = args.tx;
  try {
    const sent = await wallet.sendTransaction({
      to:                   t.to,
      value:                t.value,
      data:                 t.data,
      gasLimit:             t.gas ?? t.gasLimit,
      maxFeePerGas:         t.maxFeePerGas,
      maxPriorityFeePerGas: t.maxPriorityFeePerGas,
    });
    return sent.hash;
  } catch (e) {
    const msg = (e as Error)?.message || 'Broadcast failed';
    if (/insufficient funds/i.test(msg)) throw new ExtEvmSendError('insufficient', `Insufficient ${chain.nativeSymbol} for amount + gas`);
    throw new ExtEvmSendError('rpc_error', msg);
  }
}
