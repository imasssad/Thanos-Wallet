import type { TokenConfig } from '../types';
import { KAMET_MAINNET } from '../chains/networks';

/**
 * Kamet (mainnet, EVM chainId 900523) LEP100 token registry.
 *
 * Every contract address below was verified live on 2026-06-10 against
 * https://rpc-3.litho.ai (eth_getCode returned bytecode and eth_call to
 * symbol() matched). Unlike the Makalu seed, these carry full, callable
 * contract addresses (contractAddressStatus: 'verified'), so the wallet can
 * read balances and submit transfers directly.
 *
 * Source of truth: litho-validator-infra docs/integrations/THANOS_INTEGRATION_SPEC.md §3.
 */

export interface KametTokenSeed {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

export interface KametLep100SourceConfig {
  chainId: number;
  rpcUrl: string;
  restUrl: string;
  explorerBaseUrl: string;
  explorerTokensUrl: string;
  syncMode: 'rpc' | 'explorer' | 'hybrid';
  tokens: KametTokenSeed[];
}

export const KAMET_LEP100_SOURCE: KametLep100SourceConfig = {
  chainId: KAMET_MAINNET.chainId,
  rpcUrl: 'https://rpc-3.litho.ai',
  restUrl: 'https://api-3.litho.ai',
  explorerBaseUrl: 'https://kamet.litho.ai',
  explorerTokensUrl: 'https://kamet.litho.ai/tokens',
  syncMode: 'hybrid',
  tokens: [
    { symbol: 'wLITHO', name: 'Wrapped Lithosphere', decimals: 18, address: '0xC0FC628e3aB128fe387e7ed5e729bD809C017888' },
    { symbol: 'QTT', name: 'Quantts', decimals: 18, address: '0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe' },
    { symbol: 'COLLE', name: 'Colle AI', decimals: 18, address: '0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA' },
    { symbol: 'LitBTC', name: 'LitBTC', decimals: 18, address: '0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016' },
    { symbol: 'LAX', name: 'Lithosphere Algo', decimals: 18, address: '0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb' },
    { symbol: 'JOT', name: 'Jot Art', decimals: 18, address: '0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9' },
    { symbol: 'IMAGE', name: 'Imagen Network', decimals: 18, address: '0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0' },
    { symbol: 'AGII', name: 'AGII', decimals: 18, address: '0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7' },
    { symbol: 'BLDR', name: 'Built AI', decimals: 18, address: '0xF05f1F79273874E554F02ce06585E16132a3B62B' },
    // Names verified via on-chain name()/symbol() eth_calls 2026-06-12:
    // FGPT.name() = "FurGPT", MUSA.name() = "Mansa AI" on both chains.
    { symbol: 'FGPT', name: 'FurGPT', decimals: 18, address: '0x2F366c6350A6b211f6D6F847c3D56738C2E847ca' },
    { symbol: 'MUSA', name: 'Mansa AI', decimals: 18, address: '0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42' },
    { symbol: 'DOGE', name: 'DOGE', decimals: 18, address: '0x72791d72B6097D487cEC58605A62396c50C08b69' }
  ]
};

export function makeKametTokenConfig(seed: KametTokenSeed): TokenConfig {
  return {
    symbol: seed.symbol,
    name: seed.name,
    decimals: seed.decimals,
    standard: 'lep100',
    chainIds: [KAMET_LEP100_SOURCE.chainId],
    addresses: { [KAMET_LEP100_SOURCE.chainId]: seed.address },
    verified: true,
    lep100: {
      module: 'LEP100',
      version: 'v1',
      assetId: `kamet-${seed.symbol.toLowerCase()}`,
      verifiedSource: 'registry',
      sourceChain: 'kamet',
      syncMode: KAMET_LEP100_SOURCE.syncMode,
      contractAddressStatus: 'verified'
    }
  };
}

export const KAMET_LEP100_TOKENS: TokenConfig[] = KAMET_LEP100_SOURCE.tokens.map(makeKametTokenConfig);

export function getKametLep100Tokens(): TokenConfig[] {
  return KAMET_LEP100_TOKENS;
}
