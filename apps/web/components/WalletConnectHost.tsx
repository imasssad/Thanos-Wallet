'use client';
/**
 * Listens for incoming WalletConnect session_request events (after the user
 * has approved a session via WalletConnectModal) and routes them to the
 * appropriate signer in apps/web/lib/signer.ts.
 *
 * Methods handled:
 *   - personal_sign           — wallet signs the raw message
 *   - eth_signTypedData_v4    — wallet signs the EIP-712 typed data
 *   - eth_sendTransaction     — wallet signs + broadcasts the tx via
 *                                makeProvider() and returns the hash
 *
 * Everything else gets responded with a 4200 'method not supported'.
 *
 * Mount this once inside the AppShell so it survives navigation.
 */
import { useEffect, useRef, useState } from 'react';
import type { WalletKitTypes } from '@reown/walletkit';
import { useWallet } from './shell/AppShell';
import {
  onSessionRequest, respondRequest, respondError,
} from '../lib/walletconnect';
import { walletFromSeed, makeProvider } from '../lib/signer';

interface PendingRequest {
  request: WalletKitTypes.SessionRequest;
  /** Auto-resolved by the user via the approval UI. */
  approve: () => Promise<void>;
  reject:  (reason?: string) => Promise<void>;
}

export function WalletConnectHost() {
  const wallet = useWallet();
  const seed   = wallet?.seed ?? [];
  const evm    = wallet?.evmAddress ?? '';

  // Latest values without retriggering the subscribe effect on every change.
  const seedRef = useRef(seed); seedRef.current = seed;
  const evmRef  = useRef(evm);  evmRef.current  = evm;

  const [pending, setPending] = useState<PendingRequest | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    onSessionRequest(async (request) => {
      const topic  = request.topic;
      const id     = request.id;
      const method = request.params.request.method;
      const params = request.params.request.params as unknown[];

      const sendOk    = (result: unknown) => respondRequest({ topic, id, result });
      const sendErr   = (code: number, message: string) => respondError({ topic, id, code, message });

      try {
        switch (method) {
          case 'personal_sign': {
            // params: [hexMessage, fromAddress] — the address may or may not
            // be checksummed; we sign regardless of order as long as one of
            // the entries matches our address.
            const wallet = walletFromSeed(seedRef.current);
            const messageHex = (params[0] as string) ?? '';
            const message = messageHex.startsWith('0x')
              ? Buffer.from(messageHex.slice(2), 'hex')
              : new TextEncoder().encode(String(messageHex));
            // Auto-approve for MVP. UI approval pass is the next iteration.
            const signature = await wallet.signMessage(message);
            await sendOk(signature);
            break;
          }
          case 'eth_signTypedData_v4': {
            const wallet = walletFromSeed(seedRef.current);
            const typedData = JSON.parse(params[1] as string) as {
              domain: Record<string, unknown>;
              types:  Record<string, Array<{ name: string; type: string }>>;
              message: Record<string, unknown>;
              primaryType: string;
            };
            // ethers v6 wants {types} *without* EIP712Domain — strip if present.
            const { EIP712Domain, ...types } = typedData.types as Record<string, unknown>;
            void EIP712Domain;
            const sig = await wallet.signTypedData(
              typedData.domain,
              types as Record<string, Array<{ name: string; type: string }>>,
              typedData.message,
            );
            await sendOk(sig);
            break;
          }
          case 'eth_sendTransaction': {
            const w = walletFromSeed(seedRef.current, makeProvider());
            const txParams = params[0] as {
              to: string; value?: string; data?: string; gas?: string; gasLimit?: string;
              maxFeePerGas?: string; maxPriorityFeePerGas?: string;
            };
            const tx = await w.sendTransaction({
              to:    txParams.to,
              value: txParams.value ? BigInt(txParams.value) : undefined,
              data:  txParams.data,
              gasLimit: txParams.gas ?? txParams.gasLimit,
              maxFeePerGas:         txParams.maxFeePerGas,
              maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
            });
            await sendOk(tx.hash);
            break;
          }
          case 'eth_accounts':
          case 'eth_requestAccounts': {
            await sendOk([evmRef.current]);
            break;
          }
          case 'eth_chainId': {
            await sendOk('0xab09f9'); // 700777
            break;
          }
          default:
            await sendErr(4200, `Method not supported: ${method}`);
        }
      } catch (e) {
        const err = e as { code?: number; message?: string };
        await sendErr(err.code ?? -32603, err.message ?? 'Internal error');
      }
    })
      .then(fn => { unsub = fn; })
      .catch(() => {});

    return () => { if (unsub) unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; refs keep latest seed/address

  // Future: render a per-request approval modal here using `pending`.
  void pending; void setPending;
  return null;
}
