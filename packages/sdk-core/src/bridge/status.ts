/**
 * Bridge-status tracker for MultX (https://bridge.litho.ai).
 *
 * MultX is an internal Litho service — public, no API key, no auth. The
 * URL is fixed; only the env override exists for staging swaps. Mirrors
 * the worker's polling pattern (services/worker/src/worker.ts) so every
 * client + the worker share the same status semantics.
 *
 * Endpoint:
 *   GET /bridge/status/{sourceTxHash}
 *     → 404 while the bridge hasn't yet observed the source tx (we
 *       surface that as 'bridging')
 *     → { status: 'pending' | 'signing' | 'completed' | 'failed', ... }
 */
import type { BridgeStatus, SwapQuoteRequest } from '../types';

const DEFAULT_BASE = 'https://bridge.litho.ai';

function resolveBase(): string {
  // Workers / Node read MULTX_API_URL; the web client uses
  // NEXT_PUBLIC_MULTX_API_URL (Next inlines it); Expo uses
  // EXPO_PUBLIC_MULTX_API_URL. All three fall back to the same default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  const url =
    env.MULTX_API_URL ||
    env.NEXT_PUBLIC_MULTX_API_URL ||
    env.EXPO_PUBLIC_MULTX_API_URL ||
    DEFAULT_BASE;
  return String(url).replace(/\/$/, '');
}

export class BridgeTracker {
  constructor(private readonly baseUrl: string = resolveBase()) {}

  createPending(request: SwapQuoteRequest, executionId: string): BridgeStatus {
    return {
      executionId,
      provider:    'multx',
      status:      'submitted',
      fromChainId: request.fromChainId,
      toChainId:   request.toChainId,
      fromToken:   request.fromToken,
      toToken:     request.toToken,
      updatedAt:   new Date().toISOString(),
    };
  }

  /**
   * Live poll against MultX. `executionId` MUST be the source-chain tx
   * hash MultX keys bridge state on. Throws on transport failure so the
   * caller (worker re-queue / UI banner) can handle retries.
   */
  async poll(executionId: string): Promise<BridgeStatus> {
    const res = await fetch(`${this.baseUrl}/bridge/status/${executionId}`, {
      headers: { accept: 'application/json' },
    });

    // 404 = bridge hasn't observed the source tx yet → in-flight.
    if (res.status === 404) {
      return {
        executionId,
        provider:     'multx',
        status:       'bridging',
        fromChainId:  0,
        toChainId:    0,
        fromToken:    '',
        toToken:      '',
        sourceTxHash: executionId,
        updatedAt:    new Date().toISOString(),
      };
    }
    if (!res.ok) {
      throw new Error(`MultX status check failed: ${res.status}`);
    }

    const body = (await res.json()) as {
      status?:            'pending' | 'signing' | 'completed' | 'failed';
      fromChainId?:       number;
      toChainId?:         number;
      fromToken?:         string;
      toToken?:           string;
      sourceTxHash?:      string;
      destinationTxHash?: string;
      explorerUrls?:      string[];
    };

    // MultX status enum → our internal mapping (matches the worker).
    const mapped: BridgeStatus['status'] =
      body.status === 'completed' ? 'completed' :
      body.status === 'failed'    ? 'failed'    :
      body.status === 'signing'   ? 'settling'  :
      'bridging';

    return {
      executionId,
      provider:          'multx',
      status:            mapped,
      fromChainId:       body.fromChainId ?? 0,
      toChainId:         body.toChainId   ?? 0,
      fromToken:         body.fromToken   ?? '',
      toToken:           body.toToken     ?? '',
      sourceTxHash:      body.sourceTxHash ?? executionId,
      destinationTxHash: body.destinationTxHash,
      explorerUrls:      body.explorerUrls,
      updatedAt:         new Date().toISOString(),
    };
  }
}
