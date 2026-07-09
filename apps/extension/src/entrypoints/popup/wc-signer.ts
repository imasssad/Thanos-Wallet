/**
 * WalletConnect request signer for the extension popup.
 *
 * Routes every cryptographic operation through the offscreen document
 * (`./offscreen-sign`) so the popup process never holds derived private
 * keys. The only data this module touches is the BIP-39 seed words
 * (already in WalletSeedContext for unlock UX) plus the request params
 * supplied by the dApp.
 *
 * The pure-display helpers (summariseRequest, account / chain-id
 * lookups) stay local — they don't need to sign anything.
 */
import { hexlify, toUtf8Bytes, isHexString, HDNodeWallet, Mnemonic } from 'ethers';
import { bytesLikeToHex } from '../../lib/bytes-normalize';
import { getActiveAccountIndex } from '../../lib/vault';
import {
  signAndBroadcastTx, signPersonalMessage, signTypedData,
} from './offscreen-sign';

function hdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}
const MAKALU_CHAIN_ID = 700777;

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message); this.name = 'WcSignerError';
  }
}

/** Derive only the address — no private key materialised, no signing.
 *  Used for eth_accounts / eth_requestAccounts. */
function deriveAddress(seed: string[]): string {
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(seed.join(' ')), hdPath()).address;
}

export function summariseRequest(method: string, params: unknown): string {
  switch (method) {
    case 'personal_sign':
    case 'eth_sign': {
      const arr = params as unknown[];
      const raw = method === 'personal_sign' ? arr?.[0] : arr?.[1];
      // Heal a JSON-mangled Uint8Array ({0:…}) into hex before previewing —
      // requests stored by a pre-fix background can still carry them.
      let text = typeof raw === 'string' ? raw : (bytesLikeToHex(raw) ?? String(raw ?? ''));
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
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain':
      return 'Use the Lithosphere Makalu network (700777).';
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
  const path = hdPath();

  switch (method) {
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return [deriveAddress(seed)];

    case 'eth_chainId':
      return `0x${MAKALU_CHAIN_ID.toString(16)}`;

    case 'personal_sign': {
      const raw = params[0];
      // Normalize to a 0x hex string for the JSON-serialized bridge to the
      // offscreen signer (a Uint8Array would be mangled by sendMessage's
      // JSON). bytesLikeToHex also heals an ALREADY-mangled {0:…} object —
      // dApps can pass Uint8Array messages (makalu.litho.ai signin does).
      const messageHex = typeof raw === 'string' && isHexString(raw)
        ? raw
        : bytesLikeToHex(raw) ?? hexlify(toUtf8Bytes(String(raw)));
      return signPersonalMessage({ seed, hdPath: path, messageHex });
    }
    case 'eth_sign': {
      const raw = params[1];
      const messageHex = typeof raw === 'string' && isHexString(raw)
        ? raw
        : bytesLikeToHex(raw) ?? hexlify(toUtf8Bytes(String(raw)));
      return signPersonalMessage({ seed, hdPath: path, messageHex });
    }
    case 'eth_signTypedData_v4': {
      const typed = JSON.parse(params[1] as string) as {
        domain: Record<string, unknown>;
        types:  Record<string, Array<{ name: string; type: string }>>;
        message: Record<string, unknown>;
      };
      return signTypedData({
        seed, hdPath: path,
        payload: { domain: typed.domain, types: typed.types, value: typed.message },
      });
    }
    case 'eth_sendTransaction': {
      const tx = params[0] as {
        to: string; value?: string; data?: string;
        gas?: string; gasLimit?: string;
        maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      };
      try {
        return await signAndBroadcastTx({
          seed, hdPath: path,
          tx: {
            to:       tx.to,
            value:    tx.value,
            data:     tx.data,
            gas:      tx.gas ?? tx.gasLimit,
            gasPrice: undefined,
          },
        });
      } catch (e) {
        const msg = (e as Error).message || 'Broadcast failed';
        if (/insufficient funds/i.test(msg)) throw new WcSignerError(-32000, 'Insufficient balance');
        throw new WcSignerError(-32603, msg);
      }
    }
    /* EIP-3085/3326 — advertised in the offscreen session namespace, so
       the relay delivers them. The chain is built in: succeed as a no-op
       for Makalu, reject other chains honestly. Add-refusal uses 4001
       (user/wallet declined to add) not 4902 (which means "switch needs
       an add first" and would loop a standard switch().catch(add) flow). */
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain': {
      const target = ((params[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
      if (target !== `0x${MAKALU_CHAIN_ID.toString(16)}`) {
        throw new WcSignerError(
          method === 'wallet_switchEthereumChain' ? 4902 : 4001,
          'Only Lithosphere Makalu (700777) is supported.',
        );
      }
      return null;
    }

    default:
      throw new WcSignerError(4200, `Method not supported: ${method}`);
  }
}
