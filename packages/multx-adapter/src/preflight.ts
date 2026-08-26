import { MultXAdapterError } from './errors.js';
import type { MultXManifest, MultXRoute, MultXSigner } from './types.js';

/**
 * Resolve + validate the exact route + token for a requested transfer
 * against the manifest. Fails closed on anything not explicitly listed —
 * "Unknown token and unsupported route fail closed" (acceptance checklist).
 */
export function resolveRoute(
  manifest: MultXManifest,
  params: { sourceChainId: number; destinationChainId: number; tokenSymbol: string },
): { route: MultXRoute; token: MultXRoute['tokens'][number] } {
  const route = manifest.routes.find(
    (r) => r.sourceChainId === params.sourceChainId && r.destinationChainId === params.destinationChainId,
  );
  if (!route) {
    throw new MultXAdapterError(
      'UNSUPPORTED_ROUTE',
      `No approved route from chain ${params.sourceChainId} to ${params.destinationChainId}.`,
    );
  }
  const token = route.tokens.find((t) => t.symbol.toUpperCase() === params.tokenSymbol.toUpperCase());
  if (!token) {
    throw new MultXAdapterError('UNSUPPORTED_TOKEN', `${params.tokenSymbol} is not approved on this route.`);
  }
  return { route, token };
}

/** Confirms the connected signer is actually on the route's source chain
 *  before any approve/lock call — "Wallet connect and exact source-network
 *  check pass" / "Wrong chain fails closed". */
export async function preflightNetwork(signer: MultXSigner, expectedChainId: number): Promise<void> {
  if (!signer.provider) {
    throw new MultXAdapterError('WRONG_NETWORK', 'Wallet signer has no connected provider.');
  }
  const net = await signer.provider.getNetwork();
  const actual = Number(net.chainId);
  if (actual !== expectedChainId) {
    throw new MultXAdapterError(
      'WRONG_NETWORK',
      `Wallet is on chain ${actual}, but this route requires chain ${expectedChainId}. Switch networks and try again.`,
    );
  }
}

/** Validates the requested amount against decimals + an optional per-route
 *  cap. Returns the base-unit amount as a bigint string — the adapter always
 *  works in base units, never floating point, to avoid decimal rounding
 *  turning into a fund-loss bug. */
export function validateAmount(amountBaseUnits: string, route: MultXRoute): bigint {
  let amount: bigint;
  try {
    amount = BigInt(amountBaseUnits);
  } catch {
    throw new MultXAdapterError('INVALID_AMOUNT', 'Amount must be a whole base-unit integer.');
  }
  if (amount <= 0n) {
    throw new MultXAdapterError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  if (route.maxAmountBaseUnits) {
    const cap = BigInt(route.maxAmountBaseUnits);
    if (amount > cap) {
      throw new MultXAdapterError('CAP_EXCEEDED', 'Amount exceeds this route’s approved transfer cap.');
    }
  }
  return amount;
}
