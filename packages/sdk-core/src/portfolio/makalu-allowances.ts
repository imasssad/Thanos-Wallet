/**
 * Convenience wrapper for the LEP-100 allowance reader on Makalu.
 *
 * Resolves the canonical LEP-100 token list from the sdk-core registry
 * and calls `fetchTokenAllowances()`. Each client just calls
 * `fetchMakaluAllowances({ wallet })` and renders the rows.
 */
import { type Provider } from 'ethers';
import { fetchTokenAllowances, type AllowanceRow, type KnownToken } from './allowances';
import { getMakaluLep100Tokens } from '../tokens/lep100-registry';
import { MAKALU_TESTNET } from '../chains/networks';

function knownTokens(chainId: number): KnownToken[] {
  return getMakaluLep100Tokens()
    .filter(t => t.standard !== 'native' && t.addresses[chainId])
    .map(t => ({
      address:  t.addresses[chainId]!,
      symbol:   t.symbol,
      name:     t.name,
      decimals: t.decimals,
    }));
}

export async function fetchMakaluAllowances(args: {
  walletAddress: string;
  provider:      Provider;
  indexerUrl?:   string;
}): Promise<AllowanceRow[]> {
  return fetchTokenAllowances({
    walletAddress: args.walletAddress,
    chainId:       MAKALU_TESTNET.chainId,
    provider:      args.provider,
    indexerUrl:    args.indexerUrl,
    knownTokens:   knownTokens(MAKALU_TESTNET.chainId),
  });
}
