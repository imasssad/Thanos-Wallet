import type { TokenConfig } from '../types';
import { KAMET_MAINNET, MAKALU_TESTNET } from '../chains/networks';
import { MAKALU_LEP100_SOURCE, makeMakaluTokenConfig } from './makalu-lep100-source';
import { getKametLep100Tokens } from './kamet-lep100-source';

export const MAKALU_LEP100_TOKENS: TokenConfig[] = [
  {
    symbol: 'LITHO',
    name: 'Lithosphere',
    decimals: 18,
    standard: 'native',
    chainIds: [MAKALU_TESTNET.chainId, KAMET_MAINNET.chainId],
    addresses: {}
  },
  ...MAKALU_LEP100_SOURCE.tokens.map(makeMakaluTokenConfig)
];

export const LEP100_EXCLUDED_SYMBOLS = [...MAKALU_LEP100_SOURCE.excludedSymbols];

export function getMakaluLep100Tokens(): TokenConfig[] {
  return MAKALU_LEP100_TOKENS.filter((token) => !LEP100_EXCLUDED_SYMBOLS.includes(token.symbol.toUpperCase()));
}

/** All verified LEP100 tokens across Lithosphere networks (Makalu previews + Kamet verified). */
export function getAllLep100Tokens(): TokenConfig[] {
  return [...getMakaluLep100Tokens(), ...getKametLep100Tokens()];
}
