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
import { MultXClient, type MultXConfig } from '@litho/multx-sdk';
import { Wallet as WalletV5, providers as ProvidersV5, utils as UtilsV5 } from 'ethers5';
import { HDNodeWallet, Mnemonic } from 'ethers';
import {
  MAKALU_BRIDGE_CONFIG, MAKALU_CHAIN_ID, KAMET_CHAIN_ID, MAKALU_RPC,
  type BridgeToken, type BridgeStep,
} from './bridge-meta';

// NOTE: this module statically imports the ESM @litho/multx-sdk + ethers v5/v6.
// It is loaded LAZILY (await import('./lib/multx-bridge')) only when a bridge is
// actually executed — never on the eager/startup path. Token list, route, and
// the BridgeStep type live in ./bridge-meta (zero heavy imports) for the UI.
const MAKALU_TESTNET = MAKALU_BRIDGE_CONFIG as MultXConfig;

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
  token: BridgeToken;
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
