/**
 * Lightweight MultX bridge metadata — token list, route, step type, and the
 * Makalu bridge config object.
 *
 * Deliberately imports NOTHING heavy (no @litho/multx-sdk, no ethers) so the
 * Bridge UI can render purely from this data WITHOUT pulling the ESM bridge SDK
 * (+ two copies of ethers) onto the eager/static load path. That static import
 * was both a startup-time "Requiring unknown module \"undefined\"" crash risk
 * (Metro's partial ESM support) and a source of navigation jank. The SDK is now
 * loaded lazily by lib/multx-bridge.ts only when a bridge is actually executed.
 */

export const MAKALU_CHAIN_ID = 700777;
export const KAMET_CHAIN_ID  = 900523;
export const MAKALU_RPC       = 'https://rpc.litho.ai';

export interface BridgeToken {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
  icon?: string | null;
}

export type BridgeStep = 'idle' | 'approving' | 'locking' | 'signing' | 'completed' | 'error';

/** Makalu MultX tokens — verbatim from @litho/multx-sdk (10 tokens, no QTT). */
export const BRIDGE_TOKENS: readonly BridgeToken[] = [
  { symbol: 'wLITHO', name: 'Wrapped LITHO',       decimals: 18, address: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161' },
  { symbol: 'LitBTC', name: 'Lithosphere Bitcoin', decimals: 18, address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74' },
  { symbol: 'LAX',    name: 'LAX Token',           decimals: 18, address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d' },
  { symbol: 'JOT',    name: 'JOT Token',           decimals: 18, address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e' },
  { symbol: 'COLLE',  name: 'Colle AI',            decimals: 18, address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61' },
  { symbol: 'IMAGE',  name: 'Image AI',            decimals: 18, address: '0xAcD98E323968647936887aD4934e64B01060727e' },
  { symbol: 'AGII',   name: 'AGI Inception',       decimals: 18, address: '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c' },
  { symbol: 'BLDR',   name: 'Builder Finance',     decimals: 18, address: '0x798eD6bFc5bfCFc60938d5098825b354427A0786' },
  { symbol: 'FGPT',   name: 'Finesse GPT',         decimals: 18, address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e' },
  { symbol: 'MUSA',   name: 'Musa AI',             decimals: 18, address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D' },
];

export const BRIDGE_ROUTE = {
  source: { chainId: MAKALU_CHAIN_ID, name: 'Makalu' },
  dest:   { chainId: KAMET_CHAIN_ID,  name: 'Kamet' },
} as const;

/** MultX bridge config for Makalu — passed to MultXClient at execution time.
 *  Structurally a MultXConfig; typed loosely here to avoid importing the SDK. */
export const MAKALU_BRIDGE_CONFIG = {
  bridgeAddress: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
  bridgeApiUrl:  'https://bridge.litho.ai',
  lithoTokenAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161',
  supportedTokens: BRIDGE_TOKENS as BridgeToken[],
  destinationChains: [
    { name: 'Lithosphere Kamet', chainId: KAMET_CHAIN_ID, symbol: 'LITHO', label: 'Kamet' },
  ],
  chains: { lithosphere: MAKALU_CHAIN_ID, kamet: KAMET_CHAIN_ID, ethereum: 1 },
};
