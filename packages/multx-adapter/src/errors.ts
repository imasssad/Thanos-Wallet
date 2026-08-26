import type { MultXErrorCode } from './types.js';

/**
 * A categorized, user-safe error. `.message` is always safe to show a user;
 * `.cause` (when present) carries the raw underlying error for the caller's
 * own logs — the adapter itself never logs `.cause`, only ever hands it back
 * to the caller, who decides what their telemetry pipeline is allowed to see.
 */
export class MultXAdapterError extends Error {
  readonly code: MultXErrorCode;
  override readonly cause?: unknown;

  constructor(code: MultXErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MultXAdapterError';
    this.code = code;
    this.cause = cause;
  }
}

const REJECTED = /user rejected|user denied|ACTION_REJECTED/i;
const INSUFFICIENT_FUNDS = /insufficient funds/i;
const NONCE = /nonce too low|invalid nonce|invalid sequence|account sequence mismatch/i;
const REVERTED = /execution reverted/i;

/**
 * Turn whatever ethers/RPC throws into a MultXAdapterError with a
 * user-presentable message. Mirrors the decoded cases documented in the
 * MultX SDK guide (wallet rejection, insufficient balance/allowance,
 * execution reverted, insufficient gas, nonce mismatch) so partner UIs
 * that already branch on those cases keep working.
 */
export function classifyError(err: unknown): MultXAdapterError {
  if (err instanceof MultXAdapterError) return err;

  const e = err as { message?: string; reason?: string; shortMessage?: string; info?: { error?: { message?: string } } };
  const hay = [e?.message, e?.reason, e?.shortMessage, e?.info?.error?.message].filter(Boolean).join(' ');

  if (REJECTED.test(hay))            return new MultXAdapterError('WALLET_REJECTED', 'You declined the request in your wallet.', err);
  if (INSUFFICIENT_FUNDS.test(hay))  return new MultXAdapterError('INSUFFICIENT_GAS', 'Not enough native gas to complete this transaction.', err);
  if (NONCE.test(hay))               return new MultXAdapterError('NONCE_MISMATCH', 'Transaction nonce conflict — please try again.', err);
  if (REVERTED.test(hay))            return new MultXAdapterError('EXECUTION_REVERTED', 'The transaction reverted on-chain.', err);
  if ((err as { name?: string })?.name === 'AbortError') return new MultXAdapterError('TIMEOUT', 'The request timed out.', err);

  return new MultXAdapterError('UNKNOWN', 'Something went wrong completing the bridge transfer.', err);
}
