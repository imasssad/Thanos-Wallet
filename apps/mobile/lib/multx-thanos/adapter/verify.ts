// Copied from packages/multx-adapter/src/verify.ts by scripts/sync-multx-thanos.mjs — edit the original and re-run it.
import type { VerifyDestinationReceipt } from './status';

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * A `VerifyDestinationReceipt` that reads the destination chain itself over
 * JSON-RPC: the release transaction must have succeeded and emitted an
 * ERC-20 Transfer of exactly the expected amount of the route's destination
 * token to the expected recipient. Anything else — no receipt, a reverted
 * one, a different token, recipient or amount, an unknown chain, an RPC
 * error — is "not verified", and the transfer stays out of RELEASED.
 */
export function verifyErc20ReleaseViaRpc(opts: {
  /** The destination chain's JSON-RPC URL, or undefined when the app has none. */
  rpcUrlFor: (chainId: number) => string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): VerifyDestinationReceipt {
  const doFetch = opts.fetchImpl ?? fetch;
  return async ({ destinationChainId, destinationTxHash, expectedRecipient, expectedAmountBaseUnits, expectedTokenAddress }) => {
    const url = opts.rpcUrlFor(destinationChainId);
    if (!url || !/^0x[0-9a-f]{64}$/i.test(destinationTxHash)) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    let receipt: unknown;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [destinationTxHash] }),
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      receipt = ((await res.json()) as { result?: unknown })?.result;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
    if (!receipt || typeof receipt !== 'object') return false;
    const r = receipt as { status?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string }> };
    if (r.status !== '0x1' || !Array.isArray(r.logs)) return false;
    const token = expectedTokenAddress.toLowerCase();
    const to = '0x' + expectedRecipient.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    return r.logs.some((log) => {
      if (log.address?.toLowerCase() !== token) return false;
      if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics?.[2]?.toLowerCase() !== to) return false;
      try { return BigInt(log.data ?? '0x') === expectedAmountBaseUnits; } catch { return false; }
    });
  };
}
