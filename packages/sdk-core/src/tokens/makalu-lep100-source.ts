import type { TokenConfig } from '../types';

/**
 * Makalu (testnet, EVM chainId 700777) LEP100 token registry.
 *
 * Makalu is the primary/default Lithosphere network in the wallet. Every
 * contract address below is the canonical deployment as published at
 * https://makalu.litho.ai/tokens and was verified live on 2026-06-10
 * (explorer /api/tokens + on-chain symbol() over https://rpc.litho.ai).
 *
 * These are full, callable addresses (contractAddressStatus: 'verified'),
 * so the wallet reads balances and submits transfers directly — no env-var
 * injection required.
 */

export interface MakaluTokenSeed {
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: string;
  address: string;
  verified: boolean;
}

export interface MakaluLep100SourceConfig {
  chainId: number;
  rpcUrl: string;
  explorerBaseUrl: string;
  explorerTokensUrl: string;
  syncMode: 'rpc' | 'explorer' | 'hybrid';
  excludedSymbols: string[];
  tokens: MakaluTokenSeed[];
}

export const MAKALU_LEP100_SOURCE: MakaluLep100SourceConfig = {
  chainId: 700777,
  rpcUrl: 'https://rpc.litho.ai',
  explorerBaseUrl: 'https://makalu.litho.ai',
  explorerTokensUrl: 'https://makalu.litho.ai/tokens',
  syncMode: 'hybrid',
  excludedSymbols: ['LITBTC2'],
  tokens: [
    // Verified live on 2026-06-10 by Litho infra (kmp/kamet-network-config):
    //   - The earlier "FurGPT" entry in this file was a Kamet-explorer
    //     mislabel — there is no FurGPT contract on chain. What we were
    //     calling FurGPT @0xDB829be... is actually MUSA (Musa AI), and
    //     the real FGPT is "Finesse GPT" at 0x151ef362. The legacy
    //     0xa25c2a49 contract is dead — dropped here.
    //   - wLITHO/LAX/JOT/COLLE/AGII/BLDR addresses were all truncated
    //     previews of the wrong contracts. Replaced with the canonical
    //     deployments from makalu.litho.ai/tokens.
    //   - Added LitBTC (previously missing from the seed list).
    { symbol: 'wLITHO', name: 'Wrapped LITHO',       decimals: 18, totalSupply: '1000000000', address: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', verified: true },
    { symbol: 'LitBTC', name: 'Lithosphere Bitcoin', decimals: 18, totalSupply: '21000000',   address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', verified: true },
    { symbol: 'LAX',    name: 'LAX Token',           decimals: 18, totalSupply: '10000000000', address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', verified: true },
    { symbol: 'JOT',    name: 'JOT Token',           decimals: 18, totalSupply: '1000000000', address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', verified: true },
    { symbol: 'COLLE',  name: 'Colle AI',            decimals: 18, totalSupply: '5000000000', address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61', verified: true },
    { symbol: 'IMAGE',  name: 'Image AI',            decimals: 18, totalSupply: '10000000000', address: '0xAcD98E323968647936887aD4934e64B01060727e', verified: true },
    { symbol: 'AGII',   name: 'AGI Inception',       decimals: 18, totalSupply: '1000000000', address: '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c', verified: true },
    { symbol: 'BLDR',   name: 'Builder Finance',     decimals: 18, totalSupply: '1000000000', address: '0x798eD6bFc5bfCFc60938d5098825b354427A0786', verified: true },
    { symbol: 'FGPT',   name: 'Finesse GPT',         decimals: 18, totalSupply: '1000000000', address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e', verified: true },
    { symbol: 'MUSA',   name: 'Musa AI',             decimals: 18, totalSupply: '1000000000', address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', verified: true }
  ]
};

export function getMakaluTokenAddress(symbol: string): string | undefined {
  return MAKALU_LEP100_SOURCE.tokens.find((token) => token.symbol.toUpperCase() === symbol.toUpperCase())?.address;
}

/** @deprecated addresses are now full + verified — use getMakaluTokenAddress. */
export const getMakaluExplorerAddressPreview = getMakaluTokenAddress;

export function makeMakaluTokenConfig(seed: MakaluTokenSeed): TokenConfig {
  return {
    symbol: seed.symbol,
    name: seed.name,
    decimals: seed.decimals,
    standard: 'lep100',
    chainIds: [MAKALU_LEP100_SOURCE.chainId],
    addresses: { [MAKALU_LEP100_SOURCE.chainId]: seed.address },
    verified: seed.verified,
    lep100: {
      module: 'LEP100',
      version: 'v1',
      assetId: `makalu-${seed.symbol.toLowerCase()}`,
      verifiedSource: 'registry',
      sourceChain: 'makalu',
      syncMode: MAKALU_LEP100_SOURCE.syncMode,
      explorerAddressPreview: seed.address,
      contractAddressStatus: 'verified'
    }
  };
}
