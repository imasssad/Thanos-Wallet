/**
 * MultX cross-chain bridge glue (mobile / React Native).
 *
 * Same job as the web/extension/desktop glue, but two RN-specific choices:
 *
 *  1. ethers versions. `@litho/multx-sdk` is ethers **v5**; the app is ethers
 *     **v6**. The vendored tarball declares ethers@5 as a real dependency, so
 *     npm nests it under the SDK (Metro's hierarchical resolution finds the
 *     nested copy, isolated from the app's v6). The v5 signer we hand the SDK
 *     comes from the `ethers5` alias (npm:ethers@5.8.0).
 *
 *  2. We import ONLY `MultXClient` from the package's main entry and INLINE the
 *     Makalu preset below — rather than `@litho/multx-sdk/presets`. The values
 *     are copied verbatim from the SDK's makalu preset (bridge address + API
 *     also confirmed against the live bridge.litho.ai/chains response), so we
 *     don't depend on Metro honouring the package `exports` subpath map.
 *
 * Live route (docs/MULTX-SDK-guide.md §6): Makalu (700777) -> Kamet (900523),
 * hands-off (lock -> validators sign -> relayer releases). Funds land at the
 * SAME address on Kamet.
 */
import { MultXClient, MultXError, type MultXConfig, type SupportedToken } from '@litho/multx-sdk';
import { Wallet as WalletV5, providers as ProvidersV5, utils as UtilsV5 } from 'ethers5';
import { HDNodeWallet, Mnemonic } from 'ethers';

const MAKALU_CHAIN_ID = 700777;
const KAMET_CHAIN_ID  = 900523;
const MAKALU_RPC      = 'https://rpc.litho.ai';

/** Makalu MultX preset — verbatim from @litho/multx-sdk (10 tokens, no QTT). */
const MAKALU_TESTNET: MultXConfig = {
  bridgeAddress: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
  bridgeApiUrl:  'https://bridge.litho.ai',
  lithoTokenAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161',
  supportedTokens: [
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
  ],
  destinationChains: [
    { name: 'Lithosphere Kamet', chainId: KAMET_CHAIN_ID, symbol: 'LITHO', label: 'Kamet' },
  ],
  chains: { lithosphere: MAKALU_CHAIN_ID, kamet: KAMET_CHAIN_ID, ethereum: 1 },
};

export const BRIDGE_ROUTE = {
  source: { chainId: MAKALU_CHAIN_ID, name: 'Makalu' },
  dest:   { chainId: KAMET_CHAIN_ID,  name: 'Kamet' },
} as const;

export const BRIDGE_TOKENS: readonly SupportedToken[] = MAKALU_TESTNET.supportedTokens;

export type BridgeStep = 'idle' | 'approving' | 'locking' | 'signing' | 'completed' | 'error';

export type BridgeWalletSource =
  | { seed: string[]; accountIdx: number }
  | { privateKey: string };

function sourcePrivateKey(src: BridgeWalletSource): string {
  if ('privateKey' in src) return src.privateKey;
  const m = Mnemonic.fromPhrase(src.seed.join(' '));
  return HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${src.accountIdx}`).privateKey;
}

function makeMakaluSignerV5(src: BridgeWalletSource): WalletV5 {
  const provider = new ProvidersV5.JsonRpcProvider(MAKALU_RPC, MAKALU_CHAIN_ID);
  return new WalletV5(sourcePrivateKey(src), provider);
}

export interface BridgeResult { txHash: string; status: string; }

export async function bridgeMakaluToKamet(opts: {
  source: BridgeWalletSource;
  token: SupportedToken;
  amount: string;
  onStep?: (step: BridgeStep, info?: { txHash?: string }) => void;
}): Promise<BridgeResult> {
  const { source, token, amount, onStep } = opts;
  const client = new MultXClient(MAKALU_TESTNET);
  const signer = makeMakaluSignerV5(source);
  const amountBase = UtilsV5.parseUnits(amount, token.decimals).toString();

  onStep?.('approving');
  await client.approveToken({ signer, tokenAddress: token.address, amount: amountBase, tokenMeta: token });

  onStep?.('locking');
  const { txHash } = await client.lockTokens({
    signer, tokenAddress: token.address, amount: amountBase, targetChainId: KAMET_CHAIN_ID, tokenMeta: token,
  });

  onStep?.('signing', { txHash });
  const final = await client.getStatus(txHash, { onWaitingSignatures: () => onStep?.('signing', { txHash }) });

  onStep?.(final.status === 'completed' ? 'completed' : 'error', { txHash });
  return { txHash, status: final.status };
}

export { MultXError };
