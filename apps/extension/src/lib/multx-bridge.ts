/**
 * MultX cross-chain bridge glue (mobile / React Native).
 *
 * Reimplemented WITHOUT `@litho/multx-sdk`. The SDK is ESM ("type":"module"
 * with an import-only `exports` map) and Metro (Expo SDK 52 / RN 0.76) does
 * NOT enable package-`exports` resolution by default, so it fell back to the
 * ESM `main`, failed to resolve the SDK's nested deps, and emitted a module
 * with an `undefined` id. When the bridge ran, that surfaced as the fatal
 * `Requiring unknown module "undefined"` crash — and because the SDK threw it
 * from an async continuation (setTimeout poll), even the caller's try/catch
 * couldn't trap it (the error escaped to the ErrorBoundary).
 *
 * The bridge itself is only two on-chain calls + a REST status poll, so we do
 * them directly with the app's ethers v6. Same Makalu→Kamet route, same
 * approve → lock → validators-sign → relayer-release flow, same backend
 * (bridge.litho.ai). Funds land at the SAME address on Kamet.
 *
 * ABIs + control-flow were lifted verbatim from the vendored SDK
 * (dist/abis.js, dist/client.js) so on-chain behaviour is byte-identical,
 * including the Ethermint stale-nonce retry that Makalu (Cosmos-SDK) needs.
 */
import {
  Contract, JsonRpcProvider, Wallet, HDNodeWallet, Mnemonic, parseUnits, formatUnits,
} from 'ethers';
import {
  MAKALU_BRIDGE_CONFIG, MAKALU_CHAIN_ID, KAMET_CHAIN_ID, MAKALU_RPC,
  type BridgeToken, type BridgeStep,
} from './bridge-meta';

const BRIDGE_ADDRESS = MAKALU_BRIDGE_CONFIG.bridgeAddress;
const BRIDGE_API     = MAKALU_BRIDGE_CONFIG.bridgeApiUrl;

const TOKEN_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];
const BRIDGE_ABI = [
  'function lockTokens(address token, uint256 amount, uint256 targetChain) external returns (bytes32 txHash)',
  'function supportedTokens(address token) external view returns (bool)',
];

export type BridgeWalletSource =
  | { seed: string[]; accountIdx: number }
  | { privateKey: string };

function sourcePrivateKey(src: BridgeWalletSource): string {
  if ('privateKey' in src) return src.privateKey;
  const m = Mnemonic.fromPhrase(src.seed.join(' '));
  return HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${src.accountIdx}`).privateKey;
}

function makeMakaluSigner(src: BridgeWalletSource): Wallet {
  const provider = new JsonRpcProvider(MAKALU_RPC, MAKALU_CHAIN_ID);
  return new Wallet(sourcePrivateKey(src), provider);
}

export class BridgeError extends Error {
  constructor(message: string) { super(message); this.name = 'BridgeError'; }
}

export interface BridgeResult { txHash: string; status: string }

const SEQUENCE_ERR = /invalid nonce|invalid sequence|account sequence mismatch|nonce too low|nonce has already been used/i;

/**
 * Submit a contract call, retrying ONCE with an explicitly-queried pending
 * nonce on Ethermint "invalid nonce/sequence" errors (Makalu's RPC can hand
 * back a stale pending count right after a recent tx). Mirrors the SDK's
 * `sendWithNonceRetry`.
 */
async function sendWithNonceRetry(
  signer: Wallet,
  send: (overrides?: { nonce: number }) => Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
): Promise<{ hash: string; status: number }> {
  let tx;
  try {
    tx = await send();
  } catch (err) {
    const e = err as { message?: string; reason?: string; shortMessage?: string; info?: { error?: { message?: string } } };
    const hay = [e?.message, e?.reason, e?.shortMessage, e?.info?.error?.message].filter(Boolean).join(' ');
    if (!SEQUENCE_ERR.test(hay)) throw err;
    const nonce = await signer.provider!.getTransactionCount(await signer.getAddress(), 'pending');
    tx = await send({ nonce });
  }
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new BridgeError('Transaction failed on Makalu');
  return { hash: tx.hash, status: 1 };
}

/** Poll the bridge backend until the transfer reaches a terminal state. */
async function pollBridgeStatus(txHash: string, onSigning?: () => void): Promise<string> {
  const maxAttempts = 60;
  let attempts = 0;
  let notified = false;
  while (attempts < maxAttempts) {
    try {
      const res  = await fetch(`${BRIDGE_API}/bridge/status/${txHash}`);
      const data = await res.json().catch(() => ({} as { status?: string; error?: string; failureReason?: string }));
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) throw new BridgeError(data?.error || `Bridge status ${res.status}`);
      } else {
        if (data.status === 'completed') return 'completed';
        if (data.status === 'failed') throw new BridgeError(data.failureReason || 'Bridge transfer failed');
        if ((data.status === 'locked' || data.status === 'signing' || data.status === 'signed') && !notified) {
          onSigning?.(); notified = true;
        }
      }
    } catch (e) {
      if (e instanceof BridgeError) throw e;
      // transient transport error — fall through to the backoff and retry
    }
    await new Promise(r => setTimeout(r, Math.min(5000 + attempts * 1000, 30000)));
    attempts += 1;
  }
  throw new BridgeError('Bridge is taking longer than expected — check bridge history shortly.');
}

/**
 * Bridge `amount` of `token` from Makalu (700777) to Kamet (900523). Locks on
 * Makalu; validators sign; a relayer releases the same amount to the SAME
 * address on Kamet — hands-off. Returns the Makalu lock tx hash + final status.
 */
export async function bridgeMakaluToKamet(opts: {
  source: BridgeWalletSource;
  token: BridgeToken;
  amount: string;
  onStep?: (step: BridgeStep, info?: { txHash?: string }) => void;
}): Promise<BridgeResult> {
  const { source, token, amount, onStep } = opts;
  const signer = makeMakaluSigner(source);
  const owner  = await signer.getAddress();
  const amountBase = parseUnits(amount, token.decimals);

  const tokenC  = new Contract(token.address, TOKEN_ABI, signer);
  const bridgeC = new Contract(BRIDGE_ADDRESS, BRIDGE_ABI, signer);

  // ── Pre-flight: balance + bridge-supported check (mirrors SDK lockTokens) ──
  const [balance, supported] = await Promise.all([
    tokenC.balanceOf(owner) as Promise<bigint>,
    (bridgeC.supportedTokens(token.address) as Promise<boolean>).catch(() => true),
  ]);
  if (!supported) throw new BridgeError(`${token.symbol} is not on the bridge supported-token list`);
  if (balance < amountBase) {
    throw new BridgeError(`Insufficient ${token.symbol}: have ${formatUnits(balance, token.decimals)}, need ${amount}`);
  }

  // ── Approve the bridge to pull the tokens (skip if already approved) ──
  onStep?.('approving');
  const allowance = await (tokenC.allowance(owner, BRIDGE_ADDRESS) as Promise<bigint>);
  if (allowance < amountBase) {
    await sendWithNonceRetry(signer, (ov) =>
      tokenC.approve(BRIDGE_ADDRESS, amountBase, ov ?? {}) as Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
    );
  }

  // ── Lock on Makalu ──
  onStep?.('locking');
  const lock = await sendWithNonceRetry(signer, (ov) =>
    bridgeC.lockTokens(token.address, amountBase, KAMET_CHAIN_ID, ov ?? {}) as Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
  );
  const txHash = lock.hash;

  // ── Validators sign → relayer releases on Kamet ──
  onStep?.('signing', { txHash });
  const status = await pollBridgeStatus(txHash, () => onStep?.('signing', { txHash }));

  onStep?.(status === 'completed' ? 'completed' : 'error', { txHash });
  return { txHash, status };
}
