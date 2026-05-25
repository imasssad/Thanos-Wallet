/**
 * WalletConnect request signer for desktop. Same shape + JSON-RPC error
 * codes as apps/mobile/lib/wc-signer.ts — duplicated rather than shared
 * because sdk-core can't take the platform-specific transport deps and
 * desktop's renderer is a separate React tree from mobile.
 *
 * Takes the unlocked BIP-39 seed and a session_request, signs/broadcasts
 * with ethers, returns the JSON-RPC result. The kit's
 * respondSessionRequest is called by the caller (walletconnect.tsx) so
 * this module stays pure-logic.
 *
 * Supported methods (subset, matching what the kit advertises):
 *   personal_sign / eth_sign       → EIP-191
 *   eth_signTypedData_v4           → EIP-712
 *   eth_sendTransaction            → sign + broadcast, returns tx hash
 *   eth_accounts / eth_requestAccounts → [address]
 *   eth_chainId                    → current chain (hex)
 */
import {
  HDNodeWallet, Mnemonic, getBytes, toUtf8Bytes, isHexString,
} from 'ethers';
import { getMakaluProvider } from '@thanos/sdk-core';
import { getActiveAccountIndex } from './vault';

/** HD path for the active EVM account. Read at sign time so a TopNav
 *  switch takes effect on the very next WalletConnect signature. */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}
const MAKALU_CHAIN_ID = 700777;

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'WcSignerError';
  }
}

function walletFromSeed(seed: string[]): HDNodeWallet {
  const mnemonic = Mnemonic.fromPhrase(seed.join(' '));
  return HDNodeWallet.fromMnemonic(mnemonic, activeHdPath());
}

/** Human-readable summary shown in the approval sheet. */
export function summariseRequest(method: string, params: unknown): string {
  switch (method) {
    case 'personal_sign':
    case 'eth_sign': {
      const arr = params as string[];
      const hex = method === 'personal_sign' ? arr[0] : arr[1];
      let text = hex ?? '';
      try { if (isHexString(text)) text = Buffer.from(text.slice(2), 'hex').toString('utf8'); }
      catch { /* leave hex */ }
      return `Sign message:\n"${text.slice(0, 200)}"`;
    }
    case 'eth_signTypedData_v4':
      return 'Sign typed data (EIP-712).';
    case 'eth_sendTransaction': {
      const tx = (params as Array<{ to?: string; value?: string }>)[0] ?? {};
      return `Send transaction to ${tx.to ?? '—'}`;
    }
    default:
      return method;
  }
}

export interface WcRequestParams {
  request: { method: string; params: unknown };
  chainId?: string;
}

/** Execute a WC session_request. Throws WcSignerError with a JSON-RPC
 *  error code so the caller can respondSessionRequest cleanly. */
export async function executeWcRequest(seed: string[], reqParams: WcRequestParams): Promise<unknown> {
  if (!seed.length) throw new WcSignerError(-32000, 'Wallet is locked');
  const method = reqParams.request.method;
  const params = reqParams.request.params as unknown[];

  switch (method) {
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return [walletFromSeed(seed).address];

    case 'eth_chainId':
      return `0x${MAKALU_CHAIN_ID.toString(16)}`;

    case 'personal_sign': {
      const hexMsg = params[0] as string;
      const bytes = isHexString(hexMsg) ? getBytes(hexMsg) : toUtf8Bytes(String(hexMsg));
      return walletFromSeed(seed).signMessage(bytes);
    }

    case 'eth_sign': {
      const hexMsg = params[1] as string;
      const bytes = isHexString(hexMsg) ? getBytes(hexMsg) : toUtf8Bytes(String(hexMsg));
      return walletFromSeed(seed).signMessage(bytes);
    }

    case 'eth_signTypedData_v4': {
      const typed = JSON.parse(params[1] as string) as {
        domain: Record<string, unknown>;
        types:  Record<string, Array<{ name: string; type: string }>>;
        message: Record<string, unknown>;
      };
      const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
      void _omit;
      return walletFromSeed(seed).signTypedData(
        typed.domain,
        types as Record<string, Array<{ name: string; type: string }>>,
        typed.message,
      );
    }

    case 'eth_sendTransaction': {
      const tx = params[0] as {
        to: string; value?: string; data?: string;
        gas?: string; gasLimit?: string;
        maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      };
      const wallet = walletFromSeed(seed).connect(getMakaluProvider());
      try {
        const sent = await wallet.sendTransaction({
          to:                   tx.to,
          value:                tx.value ? BigInt(tx.value) : undefined,
          data:                 tx.data,
          gasLimit:             tx.gas ?? tx.gasLimit,
          maxFeePerGas:         tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        });
        return sent.hash;
      } catch (e) {
        const msg = (e as Error).message || 'Broadcast failed';
        if (/insufficient funds/i.test(msg)) throw new WcSignerError(-32000, 'Insufficient balance');
        throw new WcSignerError(-32603, msg);
      }
    }

    default:
      throw new WcSignerError(4200, `Method not supported: ${method}`);
  }
}
