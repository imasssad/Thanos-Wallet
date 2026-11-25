'use client';
/**
 * Lithic tokens (web) — LAX on LITHO mainnet, and the Makalu native LAX when
 * the user has added Makalu (700777) as a custom network.
 *
 * A Lithic token is not an ERC-20: its address has no EVM code, so it never
 * appears through the ordinary token-balance path and is read through the
 * LithoVM gateway with sdk-core's reader. Both RPCs go through the
 * same-origin proxy (browserRpcUrl), because the litho.ai hosts send no CORS
 * headers.
 *
 * View-only for now: Lithic sends ship behind a flag (see LITHIC_SEND_FLAG).
 * A failed read is kept as an error, never shown as a 0 balance — "couldn't
 * read" and "you hold nothing" must not look the same.
 */
import { useEffect, useState } from 'react';
import {
  MAINNET_LAX,
  NATIVE_LAX,
  formatNativeAmount,
  lithicNetworkLabel,
  readLithicBalance,
  type LithicToken,
  type NativeLaxBalance,
} from '@thanos/sdk-core';
import { customChains } from './custom-assets';
import { EVM_CHAINS, browserRpcUrl } from './evm-chains';

export type NativeLaxState =
  | { ok: true; token: LithicToken; label: string; read: NativeLaxBalance; text: string }
  | { ok: false; token: LithicToken; label: string; error: string };

/** The RPC for a Lithic token's chain: a built-in network (Lithosphere
 *  mainnet) or one the user added (Makalu). */
function rpcFor(token: LithicToken): string | null {
  const builtin = EVM_CHAINS.find((c) => c.chainId === token.chainId);
  const custom = customChains().find((c) => c.chainId === token.chainId);
  const url = builtin?.rpcUrl ?? custom?.rpcUrl;
  return url ? browserRpcUrl(url) : null;
}

/** Every Lithic token this wallet can read for `evmAddress`. */
export function useLithicTokens(evmAddress?: string): NativeLaxState[] {
  const [state, setState] = useState<NativeLaxState[]>([]);
  useEffect(() => {
    if (!evmAddress) { setState([]); return; }
    const tokens: LithicToken[] = [MAINNET_LAX, NATIVE_LAX].filter((t) => !!rpcFor(t));
    let cancel = false;
    void Promise.all(tokens.map(async (token): Promise<NativeLaxState> => {
      const label = lithicNetworkLabel(token);
      try {
        const read = await readLithicBalance(evmAddress, token, { rpcUrl: rpcFor(token)! });
        return { ok: true, token, label, read: read as NativeLaxBalance, text: formatNativeAmount(read.balanceBaseUnits, read.decimals) };
      } catch (e) {
        return { ok: false, token, label, error: e instanceof Error ? e.message : String(e) };
      }
    })).then((rows) => { if (!cancel) setState(rows); });
    return () => { cancel = true; };
  }, [evmAddress]);
  return state;
}

/** The Makalu row on its own — kept for the callers that predate mainnet. */
export function useNativeLax(evmAddress?: string): NativeLaxState | null {
  const all = useLithicTokens(evmAddress);
  return all.find((r) => r.token.chainId === NATIVE_LAX.chainId) ?? null;
}
