import type { TokenConfig } from '../types';
import {
  BITCOIN_MAINNET,
  BITCOIN_TESTNET,
  MAKALU_TESTNET,
  KAMET_MAINNET,
  SOLANA_MAINNET,
  SOLANA_DEVNET
} from '../chains/networks';
import { getMakaluLep100Tokens } from './lep100-registry';
import { getKametLep100Tokens } from './kamet-lep100-source';

export const DEFAULT_TOKENS: TokenConfig[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    standard: 'btc',
    chainIds: [BITCOIN_MAINNET.chainId, BITCOIN_TESTNET.chainId],
    addresses: {}
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    standard: 'native',
    chainIds: [SOLANA_MAINNET.chainId, SOLANA_DEVNET.chainId],
    addresses: {}
  },
  {
    symbol: 'USDC-SPL',
    name: 'USD Coin (SPL)',
    decimals: 6,
    standard: 'spl',
    chainIds: [SOLANA_MAINNET.chainId, SOLANA_DEVNET.chainId],
    addresses: {
      [SOLANA_MAINNET.chainId]: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      [SOLANA_DEVNET.chainId]: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
    }
  },
  {
    symbol: 'LITHO',
    name: 'Lithosphere',
    decimals: 18,
    standard: 'native',
    chainIds: [MAKALU_TESTNET.chainId, KAMET_MAINNET.chainId],
    addresses: {}
  },
  // Verified LEP100 tokens (real, on-chain-checked contracts) are the source
  // of truth for both Lithosphere networks. The previous hand-authored COLLE/
  // AGII/ATUA/IMAGEN samples were dropped: they carried placeholder addresses
  // (0x000…000N), duplicated the real Makalu entries, and ATUA has no deployed
  // contract on either chain. COLLE/AGII/IMAGE now come from the sources below.
  ...getMakaluLep100Tokens(),
  ...getKametLep100Tokens()
];

export function getDefaultTokensForChain(chainId: number): TokenConfig[] {
  return DEFAULT_TOKENS.filter((token) => token.chainIds.includes(chainId));
}

export function getVerifiedLep100Tokens(chainId: number): TokenConfig[] {
  return DEFAULT_TOKENS.filter((token) => token.standard === 'lep100' && token.chainIds.includes(chainId));
}
