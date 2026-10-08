import { MultXAdapterError } from './errors.js';

export interface BridgeStatusResponse {
  status: 'pending' | 'locked' | 'signing' | 'signed' | 'completed' | 'failed';
  /** The release transaction on the destination chain. bridge.litho.ai
   *  reports it as `releaseTxHash` (MultX OpenAPI `BridgeStatus`);
   *  `destinationTxHash` is accepted too. */
  releaseTxHash?: string | null;
  destinationTxHash?: string | null;
  failureReason?: string;
}

/** Independent verification of the destination release — the caller must
 *  prove the destination transaction actually happened (e.g. by reading the
 *  destination chain directly), not just trust the bridge API's self-
 *  reported "completed" status. Returning false means "do not credit
 *  anything yet" — see "Invalid destination receipt cannot credit funds"
 *  and "Product balance/action remains blocked until settlement". */
export type VerifyDestinationReceipt = (params: {
  destinationChainId: number;
  destinationTxHash: string;
  expectedRecipient: string;
  expectedAmountBaseUnits: bigint;
  expectedTokenAddress: string;
}) => Promise<boolean>;

export interface PollAndReconcileParams {
  apiUrl: string;
  sourceTxHash: string;
  destinationChainId: number;
  destinationTokenAddress: string;
  expectedRecipient: string;
  expectedAmountBaseUnits: bigint;
  verifyDestinationReceipt: VerifyDestinationReceipt;
  onStep?: (status: BridgeStatusResponse['status']) => void;
  /** Poll cadence bounds — mirrors the SDK's own backoff (5s, capped 30s). */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  /** Waits between polls; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ReconciledResult {
  status: 'RELEASED' | 'FAILED' | 'REVIEW';
  destinationTxHash?: string;
  failureReason?: string;
}

/**
 * Poll `${apiUrl}/bridge/status/:sourceTxHash` until a terminal state, then
 * independently verify the destination receipt before ever reporting
 * RELEASED. A `completed` bridge status with a receipt that fails
 * independent verification comes back as REVIEW, never RELEASED — the
 * partner app must not credit a balance on that outcome.
 *
 * A 404 means the bridge hasn't observed the source transaction yet (it
 * indexes after confirmations) — keep polling. Any other 4xx is an error.
 */
export async function pollAndReconcile(params: PollAndReconcileParams): Promise<ReconciledResult> {
  const { apiUrl, sourceTxHash, maxAttempts = 60 } = params;
  const doFetch = params.fetchImpl ?? fetch;
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempts = 0;

  while (attempts < maxAttempts) {
    let data: BridgeStatusResponse | null = null;
    try {
      const res = await doFetch(`${apiUrl.replace(/\/+$/, '')}/bridge/status/${encodeURIComponent(sourceTxHash)}`);
      if (res.ok) data = (await res.json()) as BridgeStatusResponse;
      else if (res.status === 404) params.onStep?.('pending');
      else if (res.status >= 400 && res.status < 500) {
        throw new MultXAdapterError('MANIFEST_UNREACHABLE', `Bridge status endpoint returned ${res.status}.`);
      }
    } catch (err) {
      if (err instanceof MultXAdapterError) throw err;
      // Transient transport error — fall through to backoff and retry.
    }

    if (data) {
      params.onStep?.(data.status);

      if (data.status === 'failed') {
        return { status: 'FAILED', failureReason: data.failureReason ?? 'Bridge transfer failed.' };
      }

      if (data.status === 'completed') {
        const destinationTxHash = data.releaseTxHash ?? data.destinationTxHash ?? undefined;
        if (!destinationTxHash) {
          // The API says completed but gave us nothing to verify against —
          // that's not a pass, it's exactly the ambiguous case REVIEW exists for.
          return { status: 'REVIEW', failureReason: 'Bridge reported completion without a destination transaction hash.' };
        }
        const verified = await params.verifyDestinationReceipt({
          destinationChainId:      params.destinationChainId,
          destinationTxHash,
          expectedRecipient:       params.expectedRecipient,
          expectedAmountBaseUnits: params.expectedAmountBaseUnits,
          expectedTokenAddress:    params.destinationTokenAddress,
        }).catch(() => false);

        return verified
          ? { status: 'RELEASED', destinationTxHash }
          : { status: 'REVIEW', destinationTxHash, failureReason: 'Destination receipt failed independent verification.' };
      }
    }

    await sleep(Math.min(5_000 + attempts * 1_000, 30_000));
    attempts += 1;
  }

  return { status: 'REVIEW', failureReason: 'Bridge is taking longer than expected — needs manual follow-up.' };
}
