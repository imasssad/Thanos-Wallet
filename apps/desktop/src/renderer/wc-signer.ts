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
 *   eth_chainId                    → the request's chain (hex)
 *
 * Every request names its chain (WalletConnect's CAIP-2 `eip155:<id>`, or
 * the in-app browser's current chain) and a transaction is signed for and
 * broadcast on exactly that chain. There is no default network to fall back
 * to — a transaction for a chain the wallet doesn't know is refused.
 */
import {
  HDNodeWallet, JsonRpcProvider, Mnemonic, Wallet, getBytes, toUtf8Bytes, isHexString,
} from 'ethers';
import { getActiveAccountIndex, isPrivateKeyWallet } from './vault';
import { getExtEvmChain } from './custom-assets';
import type { ExtEvmChain } from './evm-external-meta';

/** HD path for the active EVM account. Read at sign time so a TopNav
 *  switch takes effect on the very next WalletConnect signature. */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}
/** Lithosphere Mainnet — reported by eth_chainId when a request names no chain. */
export const DEFAULT_WC_CHAIN_ID = 9005;

/** "eip155:9005" (WalletConnect) → 9005; anything else → null. */
export function chainIdFromCaip(caip: string | undefined): number | null {
  const m = /^eip155:(\d+)$/.exec(caip ?? '');
  const id = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The chain a request asked for, from the registry (built-in + custom). */
function requestChain(reqParams: { chainId?: string }): ExtEvmChain | undefined {
  const id = chainIdFromCaip(reqParams.chainId);
  return id == null ? undefined : getExtEvmChain(id);
}

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'WcSignerError';
  }
}

/** A raw-key wallet is a single account (no derivation) — the dApp browser's
 *  transactions used to go through evm-external, which already handled it. */
function walletFromSeed(seed: string[]): HDNodeWallet | Wallet {
  if (isPrivateKeyWallet(seed)) return new Wallet(seed[0].trim());
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
      return `0x${(chainIdFromCaip(reqParams.chainId) ?? DEFAULT_WC_CHAIN_ID).toString(16)}`;

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
      // The chain the request names — its own RPC, and its chainId pinned
      // into the signature, so the tx can only ever land there.
      const chain = requestChain(reqParams);
      if (!chain) throw new WcSignerError(4901, 'This network is not available in the wallet.');
      const wallet = walletFromSeed(seed).connect(new JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true }));
      try {
        const sent = await wallet.sendTransaction({
          to:                   tx.to,
          value:                tx.value ? BigInt(tx.value) : undefined,
          data:                 tx.data,
          gasLimit:             tx.gas ?? tx.gasLimit,
          maxFeePerGas:         tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          chainId:              BigInt(chain.chainId),
        });
        return sent.hash;
      } catch (e) {
        const msg = (e as Error).message || 'Broadcast failed';
        if (/insufficient funds/i.test(msg)) throw new WcSignerError(-32000, `Insufficient ${chain.nativeSymbol} for amount + gas`);
        throw new WcSignerError(-32603, msg);
      }
    }

    /* EIP-3085/3326 — WalletConnect dApps (wagmi etc.) ask to add / switch
       to their chain on sign-in. Every request already names its chain and
       is routed there, so a chain the wallet can sign on succeeds as a no-op
       and anything else is refused honestly. */
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain': {
      const target = Number(((params[0] as { chainId?: string })?.chainId ?? ''));
      if (!Number.isSafeInteger(target) || target <= 0 || !getExtEvmChain(target)) {
        // 4902 ("add it first") only fits switch; add-refusal is 4001.
        throw new WcSignerError(
          method === 'wallet_switchEthereumChain' ? 4902 : 4001,
          'Unsupported network — add it in Settings → Custom networks & tokens first.',
        );
      }
      return null;
    }

    default:
      throw new WcSignerError(4200, `Method not supported: ${method}`);
  }
}
