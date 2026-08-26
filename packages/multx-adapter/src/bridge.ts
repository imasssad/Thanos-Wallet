import { Contract, type Signer } from 'ethers';
import { classifyError, MultXAdapterError } from './errors.js';

/**
 * On-chain approve + lock. Deliberately minimal — the same two calls every
 * MultX integration in this monorepo already makes (each app's own
 * lib/multx-bridge.ts), generalized to take addresses from a validated
 * manifest route instead of a hardcoded Makalu config. This package never
 * holds or requests a private
 * key — it only calls methods on the `Signer` the partner app already has
 * connected ("No signer, validator, admin, recovery, or deployment private
 * key is required by the partner application").
 */

const TOKEN_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];
const BRIDGE_ABI = [
  'function lockTokens(address token, uint256 amount, uint256 targetChain) external returns (bytes32 txHash)',
  'function supportedTokens(address token) external view returns (bool)',
];

const SEQUENCE_ERR = /invalid nonce|invalid sequence|account sequence mismatch|nonce too low|nonce has already been used/i;

/** Retries once with an explicitly-queried pending nonce on an Ethermint/
 *  Cosmos-SDK "stale nonce" error — harmless no-op on any other EVM chain. */
async function sendWithNonceRetry(
  signer: Signer,
  send: (overrides?: { nonce: number }) => Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
): Promise<{ hash: string; status: number }> {
  let tx;
  try {
    tx = await send();
  } catch (err) {
    const e = err as { message?: string; reason?: string; shortMessage?: string; info?: { error?: { message?: string } } };
    const hay = [e?.message, e?.reason, e?.shortMessage, e?.info?.error?.message].filter(Boolean).join(' ');
    if (!SEQUENCE_ERR.test(hay)) throw classifyError(err);
    const nonce = await signer.provider!.getTransactionCount(await signer.getAddress(), 'pending');
    tx = await send({ nonce });
  }
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new MultXAdapterError('SOURCE_TX_FAILED', 'The source-chain transaction failed.');
  return { hash: tx.hash, status: 1 };
}

export interface ApproveAndLockParams {
  signer:              Signer;
  tokenAddress:        string;
  bridgeAddress:       string;
  amountBaseUnits:     bigint;
  destinationChainId:  number;
  onStep?: (step: 'checking' | 'approving' | 'locking') => void;
}

/** Runs the balance/support pre-flight, approves if needed, then locks.
 *  Returns the lock transaction hash — the value every downstream record
 *  (InternalMultXTransfer.sourceTxHash) is keyed on. */
export async function approveAndLock(params: ApproveAndLockParams): Promise<{ sourceTxHash: string }> {
  const { signer, tokenAddress, bridgeAddress, amountBaseUnits, destinationChainId, onStep } = params;
  const owner = await signer.getAddress();

  const tokenC  = new Contract(tokenAddress, TOKEN_ABI, signer);
  const bridgeC = new Contract(bridgeAddress, BRIDGE_ABI, signer);

  onStep?.('checking');
  const [balance, supported] = await Promise.all([
    tokenC.balanceOf(owner) as Promise<bigint>,
    (bridgeC.supportedTokens(tokenAddress) as Promise<boolean>).catch(() => true),
  ]);
  if (!supported) throw new MultXAdapterError('UNSUPPORTED_TOKEN', 'This token is not on the bridge’s supported list.');
  if (balance < amountBaseUnits) throw new MultXAdapterError('INSUFFICIENT_BALANCE', 'Insufficient token balance for this transfer.');

  const allowance = await (tokenC.allowance(owner, bridgeAddress) as Promise<bigint>);
  if (allowance < amountBaseUnits) {
    onStep?.('approving');
    try {
      await sendWithNonceRetry(signer, (ov) =>
        tokenC.approve(bridgeAddress, amountBaseUnits, ov ?? {}) as Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
      );
    } catch (err) {
      throw classifyError(err);
    }
  }

  onStep?.('locking');
  try {
    const lock = await sendWithNonceRetry(signer, (ov) =>
      bridgeC.lockTokens(tokenAddress, amountBaseUnits, destinationChainId, ov ?? {}) as Promise<{ wait: () => Promise<{ status?: number | null } | null>; hash: string }>,
    );
    return { sourceTxHash: lock.hash };
  } catch (err) {
    throw classifyError(err);
  }
}
