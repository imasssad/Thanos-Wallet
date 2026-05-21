/**
 * Push trigger — notifies a recipient's registered devices when the
 * indexer records a new incoming transfer. Fire-and-forget: a push
 * failure must never block or fail the sync.
 *
 * Calls the API's internal /push/notify over the Docker network, gated
 * by PUSH_INTERNAL_SECRET (shared with services/api). No-op until the
 * secret is configured.
 */
const API_URL = process.env.PUSH_API_URL ?? 'http://api:4000';
const SECRET  = process.env.PUSH_INTERNAL_SECRET;

export function notifyReceive(address: string, symbol: string, txHash: string): void {
  if (!SECRET) return; // push disabled
  fetch(`${API_URL}/push/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET },
    body: JSON.stringify({
      address,
      title: 'Funds received',
      body:  `You received ${symbol} on Makalu.`,
      data:  { txHash, symbol, kind: 'receive' },
    }),
  }).catch(() => { /* best-effort */ });
}
