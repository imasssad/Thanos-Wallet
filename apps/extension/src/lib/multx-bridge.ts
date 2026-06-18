/**
 * MultX cross-chain bridge glue (extension).
 *
 * Same shape as the web glue (apps/web/lib/multx-bridge.ts): `@litho/multx-sdk`
 * is ethers **v5**, the extension is ethers **v6**. The vendored tarball
 * declares ethers@5 as a real dependency so it nests under the SDK (isolated
 * from the app's v6); here we build the v5 `Signer` from the `ethers5` alias.
 *
 * The popup already holds the unlocked seed and signs in-process, so there's no
 * injected wallet / network-switch — we derive the key (v6) and bind a v5
 * JsonRpcProvider to Makalu's RPC directly (host_permissions already cover it).
 *
 * Live route (docs/MULTX-SDK-guide.md §6): Makalu (700777) -> Kamet (900523).
 */
import { MultXClient, MultXError } from '@litho/multx-sdk';
import { MAKALU_TESTNET } from '@litho/multx-sdk/presets';
import type { SupportedToken } from '@litho/multx-sdk';
import { Wallet as WalletV5, providers as ProvidersV5, utils as UtilsV5 } from 'ethers5';
import { HDNodeWallet, Mnemonic } from 'ethers';

const MAKALU_CHAIN_ID = 700777;
const KAMET_CHAIN_ID  = 900523;
const MAKALU_RPC      = 'https://rpc.litho.ai';

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
