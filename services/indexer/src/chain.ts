/**
 * RPC + contract bindings for Makalu (chain 700777) and Kamet (chain 900523).
 *
 * The indexer uses a *separate* RPC endpoint from user-facing requests
 * (rpc-2.litho.ai) so head-of-chain reads don't compete with sync traffic.
 */
import { Contract, JsonRpcProvider, ZeroAddress } from 'ethers';

export const MAKALU_CHAIN_ID = 700777;
export const KAMET_CHAIN_ID  = 900523;

/** Provider used by the sync loop. Defaults to the rpc-2 endpoint. */
export const makaluProvider = new JsonRpcProvider(
  process.env.LITHO_RPC_INDEXER
    || process.env.LITHO_RPC_PRIMARY
    || 'https://rpc-2.litho.ai',
  MAKALU_CHAIN_ID,
);

/** Standard ERC-20 / LEP-100 ABI. LEP-100 = ERC-20 + burn/burnFrom, but
 *  burn doesn't emit a distinct event — it shows as a Transfer to 0x0 —
 *  so this minimal subset is enough for balance/activity sync. */
export const LEP100_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const;

export interface TokenSpec {
  chainId: number;
  address: string;
  /** Hint used if the on-chain symbol read fails. */
  fallbackSymbol?: string;
}

/** Build the canonical Makalu token list from env. Each MAKALU_LEP100_*_ADDRESS
 *  env var becomes a tracked token. */
export function getConfiguredTokens(): TokenSpec[] {
  const tokens: TokenSpec[] = [];
  const env = process.env;
  const map: [string, string][] = [
    ['MAKALU_LEP100_LITBTC_ADDRESS',  'LitBTC'],
    ['MAKALU_LEP100_JOT_ADDRESS',     'JOT'],
    ['MAKALU_LEP100_LAX_ADDRESS',     'LAX'],
    ['MAKALU_LEP100_COLLE_ADDRESS',   'COLLE'],
    ['MAKALU_LEP100_FURGPT_ADDRESS',  'FurGPT'],
    ['MAKALU_LEP100_IMAGE_ADDRESS',   'IMAGE'],
    ['MAKALU_LEP100_WLITHO_ADDRESS',  'wLITHO'],
    ['MAKALU_LEP100_AGII_ADDRESS',    'AGII'],
    ['MAKALU_LEP100_BLDR_ADDRESS',    'BLDR'],
    ['MAKALU_LEP100_FGPT_ADDRESS',    'FGPT'],
    ['MAKALU_LEP100_MUSA_ADDRESS',    'MUSA'],
  ];
  for (const [key, fallbackSymbol] of map) {
    const addr = env[key];
    if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
      tokens.push({ chainId: MAKALU_CHAIN_ID, address: addr.toLowerCase(), fallbackSymbol });
    }
  }
  return tokens;
}

export function tokenContract(address: string): Contract {
  return new Contract(address, LEP100_ABI, makaluProvider);
}

/** Sentinel: when from == ZeroAddress, the Transfer represents a mint. */
export const ZERO_ADDRESS = ZeroAddress;
