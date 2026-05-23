/**
 * WalletConnect request signer for the extension popup. Duplicated
 * (intentionally) from apps/desktop/src/renderer/wc-signer.ts and
 * apps/mobile/lib/wc-signer.ts because each client lives in its own
 * tree with platform-specific deps; the contract is identical so a bug
 * here behaves the same as in the other two.
 *
 * The seed is only in the popup's memory (decrypted vault); the
 * offscreen relay never sees it. The popup signs, hands the result
 * back through the message bridge for kit.respondSessionRequest.
 */
import {
  HDNodeWallet, Mnemonic, getBytes, toUtf8Bytes, isHexString,
} from 'ethers';
import { getMakaluProvider } from '@thanos/sdk-core';

const HD_PATH = "m/44'/60'/0'/0/0";
const MAKALU_CHAIN_ID = 700777;

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'WcSignerError';
  }
}

function walletFromSeed(seed: string[]): HDNodeWallet {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), HD_PATH);
}

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
