/**
 * RPC failover for Makalu.
 *
 * Builds an ethers FallbackProvider over multiple Makalu RPC endpoints so
 * any single endpoint going down doesn't break send/balance/estimate calls.
 *
 * Endpoint list resolution order:
 *   1. NEXT_PUBLIC_LITHO_RPC env var (comma-separated)
 *   2. Hardcoded default list (rpc, rpc-2, rpc-3 — all litho.ai)
 *
 * FallbackProvider config:
 *   - quorum: 1   (any one provider's answer is fine — we're prioritising
 *                  availability over consensus)
 *   - priority: 1 for all (first-answer-wins)
 *   - stallTimeout: 1500ms before trying the next
 */
import { FallbackProvider, JsonRpcProvider, type Networkish } from 'ethers';

export const MAKALU_CHAIN_ID = 700777;

const DEFAULT_RPC_URLS = [
  'https://rpc.litho.ai',
  'https://rpc-2.litho.ai',
  'https://rpc-3.litho.ai',
];

function readRpcUrls(): string[] {
  const env =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_LITHO_RPC) || '';
  const parsed = String(env).split(',').map(s => s.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_RPC_URLS;
}

/**
 * Singleton provider for the Makalu network with automatic failover.
 *
 * Memoised so we don't build a new FallbackProvider tree on every call —
 * ethers FallbackProvider keeps internal state for health tracking.
 */
let _provider: FallbackProvider | JsonRpcProvider | null = null;

export function getMakaluProvider(): FallbackProvider | JsonRpcProvider {
  if (_provider) return _provider;

  const urls = readRpcUrls();
  const network: Networkish = MAKALU_CHAIN_ID;

  if (urls.length === 1) {
    // FallbackProvider needs >= 2 providers; with a single URL, use plain JSON-RPC.
    _provider = new JsonRpcProvider(urls[0], network);
    return _provider;
  }

  _provider = new FallbackProvider(
    urls.map((url, i) => ({
      provider:     new JsonRpcProvider(url, network),
      priority:     1,
      weight:       1,
      stallTimeout: 1500,
    })),
    network,
    { quorum: 1 },
  );
  return _provider;
}

/** Read-only access to the URL list, for diagnostics / health badges. */
export function listRpcUrls(): string[] {
  return readRpcUrls();
}
