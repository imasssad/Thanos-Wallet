'use client';
/**
 * Native Lithic LAX on Makalu (web) — read through the native gateway with
 * sdk-core's reader, only when the user has added Makalu (700777) as a custom
 * network, at that network's RPC (via the same-origin proxy for the litho.ai
 * hosts, which send no CORS headers). View-only: there's no Send for it.
 *
 * A failed read is kept as an error, never shown as a 0 balance.
 */
import { useEffect, useState } from 'react';
import { NATIVE_LAX, formatNativeAmount, readNativeLaxBalance, type NativeLaxBalance } from '@thanos/sdk-core';
import { customChains } from './custom-assets';
import { browserRpcUrl } from './evm-chains';

export type NativeLaxState =
  | { ok: true; read: NativeLaxBalance; text: string }
  | { ok: false; error: string };

export function useNativeLax(evmAddress?: string): NativeLaxState | null {
  const [state, setState] = useState<NativeLaxState | null>(null);
  useEffect(() => {
    const makalu = customChains().find((c) => c.chainId === NATIVE_LAX.chainId);
    if (!evmAddress || !makalu) { setState(null); return; }
    let cancel = false;
    readNativeLaxBalance(evmAddress, { rpcUrl: browserRpcUrl(makalu.rpcUrl) })
      .then((read) => {
        if (!cancel) setState({ ok: true, read, text: formatNativeAmount(read.balanceBaseUnits, read.decimals) });
      })
      .catch((e: unknown) => {
        if (!cancel) setState({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancel = true; };
  }, [evmAddress]);
  return state;
}
