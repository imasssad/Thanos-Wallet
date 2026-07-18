/**
 * Post-approval signer for the in-app dApp browser (desktop).
 *
 * The dApp's provider (src/main/dapp-provider-preload.ts) sends EIP-1193
 * requests to the main process, which shows the approval dialog and — once the
 * user approves — asks THIS component to actually sign. Split of duties: main
 * owns approval (a native dialog is the only surface guaranteed to draw above
 * the WebContentsView); the renderer owns the seed + active account and reuses
 * executeWcRequest, the SAME signer the WalletConnect path uses — so the in-app
 * browser and WalletConnect sign identically. Non-visual: renders nothing.
 */
import { useEffect } from 'react';
import { executeWcRequest, WcSignerError } from './wc-signer';
import { getActiveAccountIndex } from './vault';

const MAKALU_CHAIN_ID = 700777;

export function DappRequestHost({ seed }: { seed: string[] }) {
  useEffect(() => {
    const bridge = window.thanosDesktop?.dapp;
    if (!bridge?.onExec) return;
    return bridge.onExec(async (req) => {
      try {
        let result: unknown;
        // eth_sendTransaction on a non-Makalu chain → broadcast on THAT chain
        // (contract calls carry `data`). Signatures are chain-independent and
        // go through executeWcRequest regardless.
        if (req.method === 'eth_sendTransaction' && req.chainId && req.chainId !== MAKALU_CHAIN_ID) {
          const tx = (req.params[0] ?? {}) as {
            to?: string; value?: string; data?: string; gas?: string; gasLimit?: string;
            maxFeePerGas?: string; maxPriorityFeePerGas?: string;
          };
          const { sendExtEvmRaw } = await import('./evm-external');
          result = await sendExtEvmRaw({ seed, accountIdx: getActiveAccountIndex(), chainId: req.chainId, tx });
        } else {
          result = await executeWcRequest(seed, {
            request: { method: req.method, params: req.params },
          });
        }
        bridge.execRespond?.(req.id, result);
      } catch (e) {
        const code = e instanceof WcSignerError ? e.code : -32603;
        bridge.execRespond?.(req.id, undefined, { code, message: (e as Error)?.message || 'Request failed' });
      }
    });
  }, [seed]);

  return null;
}
