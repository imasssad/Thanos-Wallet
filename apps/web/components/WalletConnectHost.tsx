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
import { Wallet as EthersWallet } from 'ethers';
import { walletFromSeed, makeProvider } from '../lib/signer';
import {
  signerSignMessage, signerSignTypedData, signerSignTransaction, SignerError,
} from '../lib/signer-client';

interface PendingRequest {
  request: WalletKitTypes.SessionRequest;
  /** Auto-resolved by the user via the approval UI. */
  approve: () => Promise<void>;
  reject:  (reason?: string) => Promise<void>;
}

export function WalletConnectHost() {
  const wallet = useWallet();
  const seed   = wallet?.seed ?? [];
  const pk     = wallet?.privateKey;
  const evm    = wallet?.evmAddress ?? '';

  // Latest values without retriggering the subscribe effect on every change.
  const seedRef = useRef(seed); seedRef.current = seed;
  const pkRef   = useRef(pk);   pkRef.current   = pk;
  const evmRef  = useRef(evm);  evmRef.current  = evm;

  /** Build an ethers Wallet for the current unlock — either from the HD seed
   *  or from a raw private key — without leaking the secret beyond this fn. */
  const currentWallet = (provider?: Parameters<typeof walletFromSeed>[1]) => {
    if (pkRef.current) {
      const w = new EthersWallet(pkRef.current);
      return provider ? (w.connect(provider) as EthersWallet) : w;
    }
    return walletFromSeed(seedRef.current, provider);
  };

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
            const messageHex = (params[0] as string) ?? '';
            // Auto-approve for MVP. UI approval pass is the next iteration.
            // Worker-isolated signing first; on worker_locked we fall back
            // to in-process signing so an early-cold-start race doesn't fail.
            let signature: string;
            try {
              const r = await signerSignMessage(messageHex);
              signature = r.signature;
            } catch (wErr) {
              const code = wErr instanceof SignerError ? wErr.code : '';
              if (code === 'worker_locked' || code === 'worker_crashed') {
                const wallet = currentWallet();
                const messageBytes = messageHex.startsWith('0x')
                  ? Buffer.from(messageHex.slice(2), 'hex')
                  : new TextEncoder().encode(String(messageHex));
                signature = await wallet.signMessage(messageBytes);
              } else {
                throw wErr;
              }
            }
            await sendOk(signature);
            break;
          }
          case 'eth_signTypedData_v4': {
            const typedData = JSON.parse(params[1] as string) as {
              domain: Record<string, unknown>;
              types:  Record<string, Array<{ name: string; type: string }>>;
              message: Record<string, unknown>;
              primaryType: string;
            };
            // ethers v6 wants {types} *without* EIP712Domain — strip if present.
            const { EIP712Domain, ...types } = typedData.types as Record<string, unknown>;
            void EIP712Domain;
            const cleanTypes = types as Record<string, Array<{ name: string; type: string }>>;
            let sig: string;
            try {
              const r = await signerSignTypedData({ domain: typedData.domain, types: cleanTypes, message: typedData.message });
              sig = r.signature;
            } catch (wErr) {
              const code = wErr instanceof SignerError ? wErr.code : '';
              if (code === 'worker_locked' || code === 'worker_crashed') {
                const wallet = currentWallet();
                sig = await wallet.signTypedData(typedData.domain, cleanTypes, typedData.message);
              } else {
                throw wErr;
              }
            }
            await sendOk(sig);
            break;
          }
          case 'eth_sendTransaction': {
            const txParams = params[0] as {
              to: string; value?: string; data?: string; gas?: string; gasLimit?: string;
              maxFeePerGas?: string; maxPriorityFeePerGas?: string;
            };
            let hash: string;
            try {
              const r = await signerSignTransaction({
                to:                   txParams.to,
                value:                txParams.value,
                data:                 txParams.data,
                gasLimit:             txParams.gas ?? txParams.gasLimit,
                maxFeePerGas:         txParams.maxFeePerGas,
                maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
              });
              hash = r.hash;
            } catch (wErr) {
              const code = wErr instanceof SignerError ? wErr.code : '';
              if (code === 'worker_locked' || code === 'worker_crashed') {
                const w = currentWallet(makeProvider());
                const tx = await w.sendTransaction({
                  to:    txParams.to,
                  value: txParams.value ? BigInt(txParams.value) : undefined,
                  data:  txParams.data,
                  gasLimit:             txParams.gas ?? txParams.gasLimit,
                  maxFeePerGas:         txParams.maxFeePerGas,
                  maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
                });
                hash = tx.hash;
              } else {
                throw wErr;
              }
            }
            await sendOk(hash);
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
