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
import { allEvmChains, allTokensForChain } from './custom-assets';

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

/** EVM chains shown as first-class rows. Order = display order. Lithosphere
 *  Mainnet (9005) leads — it's the flagship Litho L1 (EVM chainId 9005, Cosmos
 *  lithosphere_9005-1); dApps like lithoscan.ai switch/add to it via the
 *  provider, so it must be in DAPP_CHAINS (= Makalu + this list). */
export const EXT_EVM_CHAINS: readonly ExtEvmChain[] = [
  { chainId: 9005,  name: 'Lithosphere', slug: 'lithosphere', rpcUrl: 'https://rpc-mainnet.litho.ai',           nativeSymbol: 'LITHO', nativeName: 'Lithosphere',       explorerUrl: 'https://lithoscan.ai',            color: '#22c55e' },
  { chainId: 1,     name: 'Ethereum',  slug: 'ethereum',  rpcUrl: 'https://ethereum.publicnode.com',         nativeSymbol: 'ETH',  nativeName: 'Ether',              explorerUrl: 'https://etherscan.io',            color: '#627eea' },
  { chainId: 56,    name: 'BNB Chain', slug: 'bsc',       rpcUrl: 'https://bsc-dataseed.bnbchain.org',       nativeSymbol: 'BNB',  nativeName: 'BNB',                explorerUrl: 'https://bscscan.com',             color: '#f3ba2f' },
  { chainId: 137,   name: 'Polygon',   slug: 'polygon',   rpcUrl: 'https://polygon-bor-rpc.publicnode.com',  nativeSymbol: 'POL',  nativeName: 'Polygon',            explorerUrl: 'https://polygonscan.com',         color: '#8247e5' },
  { chainId: 8453,  name: 'Base',      slug: 'base',      rpcUrl: 'https://mainnet.base.org',                nativeSymbol: 'ETH',  nativeName: 'Ether (Base)',       explorerUrl: 'https://basescan.org',            color: '#0052ff' },
  { chainId: 42161, name: 'Arbitrum',  slug: 'arbitrum',  rpcUrl: 'https://arb1.arbitrum.io/rpc',            nativeSymbol: 'ETH',  nativeName: 'Ether (Arbitrum)',   explorerUrl: 'https://arbiscan.io',             color: '#28a0f0' },
  { chainId: 59144, name: 'Linea',     slug: 'linea',     rpcUrl: 'https://rpc.linea.build',                 nativeSymbol: 'ETH',  nativeName: 'Ether (Linea)',      explorerUrl: 'https://lineascan.build',         color: '#62dfff' },
  { chainId: 10,    name: 'Optimism',  slug: 'optimism',  rpcUrl: 'https://mainnet.optimism.io',             nativeSymbol: 'ETH',  nativeName: 'Ether (Optimism)',   explorerUrl: 'https://optimistic.etherscan.io', color: '#ff0420' },
  { chainId: 43114, name: 'Avalanche', slug: 'avalanche', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',   nativeSymbol: 'AVAX', nativeName: 'Avalanche',          explorerUrl: 'https://snowtrace.io',            color: '#e84142' },
];

export function getExtEvmChain(chainId: number): ExtEvmChain | undefined {
  // Merged: built-in EXT_EVM_CHAINS + user-added custom networks.
  return allEvmChains().find(c => c.chainId === chainId);
}

export interface ExtEvmToken {
  chainId:  number;
  symbol:   string;
  name:     string;
  address:  string;
  decimals: number;
}

/** USDT/USDC catalog — addresses VERIFIED on-chain 2026-06-20 (same as web). */
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
  // LITHO-ecosystem tokens on external chains — the same verified list as the
  // phone app and web (apps/mobile/lib/evm-external.ts).
  { chainId: 56,    symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 1,     symbol: 'MUSA',  name: 'Mansa AI',       address: '0x528605856a9eb9567688b0e912ed6961522a74d4', decimals: 18 },
  { chainId: 56,    symbol: 'AGII',  name: 'AGII',           address: '0x328fd053c4bb968875afd9ad0af36fcf4a0bdda9', decimals: 18 },
  { chainId: 1,     symbol: 'AGII',  name: 'AGII',           address: '0x75d86078625d1e2f612de2627d34c7bc411c18b8', decimals: 18 },
  { chainId: 1,     symbol: 'IMAGE', name: 'Imagen Network', address: '0x1c3547dfa9ce7acd9c54ae49244575fa65bc75e2', decimals: 18 },
  { chainId: 1,     symbol: 'COLLE', name: 'Colle AI',       address: '0xc36983d3d9d379ddfb306dfb919099cb6730e355', decimals: 18 },
  { chainId: 56,    symbol: 'COLLE', name: 'Colle AI',       address: '0xaeb63742f2c7dd1538bbe2285b6789017a06b58b', decimals: 18 },
  // LAX: the contracts from the team's own deploy transactions (2026-10-17),
  // each verified on-chain (symbol LAX, "Lithosphere Algorithmic", 18 decimals).
  { chainId: 1,     symbol: 'LAX',   name: 'Lithosphere Algorithmic', address: '0xbd79b7db6f70979df7f4124e161eb3586085d140', decimals: 18 },
  { chainId: 56,    symbol: 'LAX',   name: 'Lithosphere Algorithmic', address: '0x11125e44843170467a7955d29776d63760ea4b6e', decimals: 18 },
  { chainId: 8453,  symbol: 'LAX',   name: 'Lithosphere Algorithmic', address: '0xe7645444eb4e8e04d886c7038dd0152d331d3680', decimals: 18 },
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

/** Native gas-coin balance on every chain (built-in + custom); `null` where
 *  the read failed — so a caller can tell an empty wallet (0) from an RPC
 *  that didn't answer (lib/incoming.ts relies on that). */
export async function readAllExtEvmNativeBalances(address: string): Promise<Array<{ chain: ExtEvmChain; balance: number | null }>> {
  if (!address) return [];
  const chains = allEvmChains();
  const results = await Promise.allSettled(
    chains.map(async (c) => parseFloat(formatUnits(await getExtEvmProvider(c.chainId).getBalance(address), 18)) || 0),
  );
  return chains.map((chain, i) => ({ chain, balance: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<number>).value : null }));
}

/** Native gas-coin balance across all chains (built-in + custom). Failed/zero omitted. */
export async function getAllExtEvmNativeBalances(address: string): Promise<Array<{ chain: ExtEvmChain; balance: number }>> {
  return (await readAllExtEvmNativeBalances(address))
    .filter((r): r is { chain: ExtEvmChain; balance: number } => r.balance != null && r.balance > 0);
}

/** Minimal token shape the portfolio/send need — satisfied by both the built-in
 *  ExtEvmToken (USDT/USDC) and user-added custom tokens. */
export interface ExtTokenLike {
  chainId: number; symbol: string; name: string; address: string; decimals: number;
  /** true on a token the USER added (custom-assets.ts). Such a token keeps its
   *  Home row at zero balance — see portfolio.ts. */
  custom?: true;
}

/** ERC-20 balances for every known token (built-in USDT/USDC + custom);
 *  `null` where the read failed. */
export async function readAllExtEvmTokenBalances(address: string): Promise<Array<{ token: ExtTokenLike; balance: number | null }>> {
  if (!address) return [];
  const all: ExtTokenLike[] = allEvmChains().flatMap((c) => allTokensForChain(c.chainId) as ExtTokenLike[]);
  const results = await Promise.allSettled(
    all.map(async (t) => {
      const c = new Contract(t.address, ERC20_BALANCE_ABI, getExtEvmProvider(t.chainId));
      const raw: bigint = await c.balanceOf(address);
      return parseFloat(formatUnits(raw, t.decimals)) || 0;
    }),
  );
  return all.map((token, i) => ({ token, balance: results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<number>).value : null }));
}

/** ERC-20 balances across all chains — built-in USDT/USDC + custom tokens.
 *  Failed/zero entries omitted. */
export async function getAllExtEvmTokenBalances(address: string): Promise<Array<{ token: ExtTokenLike; balance: number }>> {
  return (await readAllExtEvmTokenBalances(address))
    .filter((r): r is { token: ExtTokenLike; balance: number } => r.balance != null && r.balance > 0);
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
