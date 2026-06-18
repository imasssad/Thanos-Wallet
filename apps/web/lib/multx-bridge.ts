/**
 * MultX cross-chain bridge glue (web).
 *
 * Wraps `@litho/multx-sdk` (the official Lithosphere bridge SDK) for the
 * Thanos wallet. Two things make this non-trivial:
 *
 *  1. ethers version. The SDK is built on **ethers v5** (`BigNumber`,
 *     `ethers.Contract`, `ethers.utils`). The wallet app is on **ethers v6**.
 *     The vendored tarball declares ethers@5 as a real dependency so pnpm
 *     nests it under the SDK (isolated from the app's v6). Here we build the
 *     v5 `Signer` the SDK needs from the `ethers5` alias (npm:ethers@5.8.0).
 *
 *  2. Self-custody. The SDK guide assumes an injected wallet
 *     (`window.ethereum` + a MetaMask network switch). Thanos signs with its
 *     OWN key, so there is no network-switch prompt — we just point a v5
 *     JsonRpcProvider at the source chain's RPC and sign with the derived key.
 *
 * Live route (per docs/MULTX-SDK-guide.md §6): **Makalu (700777) -> Kamet
 * (900523)**, hands-off (lock -> validators sign -> relayer releases). The
 * Kamet->Sepolia/Base/BNB "Route 2" destinations are not wired yet, and the
 * Kamet preset declares no Makalu target, so we expose only Makalu->Kamet.
 */
import { MultXClient, MultXError } from '@litho/multx-sdk';
import { MAKALU_TESTNET } from '@litho/multx-sdk/presets';
import type { SupportedToken } from '@litho/multx-sdk';
import { Wallet as WalletV5, providers as ProvidersV5, utils as UtilsV5 } from 'ethers5';
import { listRpcUrls, MAKALU_CHAIN_ID, KAMET_CHAIN_ID } from './rpc';
import { walletFromSeed } from './signer';

/** The one live, funded bridge route today. */
export const BRIDGE_ROUTE = {
  source: { chainId: MAKALU_CHAIN_ID, name: 'Lithosphere Makalu' },
  dest:   { chainId: KAMET_CHAIN_ID,  name: 'Lithosphere Kamet' },
} as const;

/** Tokens bridgeable on the Makalu side (10 — no QTT). */
export const BRIDGE_TOKENS: readonly SupportedToken[] = MAKALU_TESTNET.supportedTokens;

/** Where in the flow we are — drives the UI status line. */
export type BridgeStep = 'idle' | 'approving' | 'locking' | 'signing' | 'completed' | 'error';

/** How the caller hands us the active account's key material. */
export type BridgeWalletSource =
  | { seed: string[]; accountIdx: number }
  | { privateKey: string };

/** 0x-prefixed private key for the account we're bridging from. For a mnemonic
 *  wallet we derive it (ethers v6) at the active HD index; a PK-imported wallet
 *  hands it over directly. The key never leaves this module. */
function sourcePrivateKey(src: BridgeWalletSource): string {
  if ('privateKey' in src) return src.privateKey;
  return walletFromSeed(src.seed, undefined, src.accountIdx).privateKey;
}

/** Build the ethers **v5** signer the SDK requires, bound to the Makalu RPC
 *  (the same-origin proxy the rest of the app uses — no CORS, no injected
 *  wallet). */
function makeMakaluSignerV5(src: BridgeWalletSource): WalletV5 {
  const rpcUrl = listRpcUrls(MAKALU_CHAIN_ID)[0];
  const provider = new ProvidersV5.JsonRpcProvider(rpcUrl, MAKALU_CHAIN_ID);
  return new WalletV5(sourcePrivateKey(src), provider);
}

export interface BridgeResult {
  txHash: string;
  /** Final backend status: 'completed' on success. */
  status: string;
}

/**
 * Execute a Makalu -> Kamet bridge: approve the bridge contract, lock the
 * tokens, then poll the backend until validators sign + the relayer releases
 * on Kamet. `onStep` drives the UI; throws a {@link MultXError} (decoded,
 * user-safe `.message`) on failure.
 */
export async function bridgeMakaluToKamet(opts: {
  source: BridgeWalletSource;
  token: SupportedToken;
  /** Human-readable amount, e.g. "100" (not base units). */
  amount: string;
  onStep?: (step: BridgeStep, info?: { txHash?: string }) => void;
}): Promise<BridgeResult> {
  const { source, token, amount, onStep } = opts;
  const client = new MultXClient(MAKALU_TESTNET);
  const signer = makeMakaluSignerV5(source);

  // Base units as a decimal string — accepted by the SDK's BigNumber.from and
  // keeps us off the ethers-version-specific BigNumber type in the public API.
  const amountBase = UtilsV5.parseUnits(amount, token.decimals).toString();

  onStep?.('approving');
  await client.approveToken({ signer, tokenAddress: token.address, amount: amountBase, tokenMeta: token });

  onStep?.('locking');
  const { txHash } = await client.lockTokens({
    signer,
    tokenAddress: token.address,
    amount: amountBase,
    targetChainId: KAMET_CHAIN_ID,
    tokenMeta: token,
  });

  onStep?.('signing', { txHash });
  const final = await client.getStatus(txHash, {
    onWaitingSignatures: () => onStep?.('signing', { txHash }),
  });

  onStep?.(final.status === 'completed' ? 'completed' : 'error', { txHash });
  return { txHash, status: final.status };
}

/** Read-only history for the connected address (never throws — [] on error). */
export async function bridgeHistory(address: string) {
  return new MultXClient(MAKALU_TESTNET).getHistory(address);
}

export { MultXError };
