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
import { dappChainByHex, dappChainById, toChainHex, MAKALU_CHAIN_ID, type DappChain } from '../../lib/dapp-chains';
import {
  signAndBroadcastTx, signPersonalMessage, signTypedData,
} from './offscreen-sign';

function hdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

/** The wallet's currently-selected dApp chain (default Makalu). */
export async function activeChain(): Promise<DappChain> {
  try {
    const { chain_id_hex } = await browser.storage.local.get('chain_id_hex');
    const c = dappChainByHex(String(chain_id_hex ?? ''));
    if (c) return c;
  } catch { /* storage unavailable — fall back to Makalu */ }
  return dappChainById(MAKALU_CHAIN_ID)!;
}

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
    case 'wallet_switchEthereumChain': {
      const target = ((params as Array<{ chainId?: string }>)?.[0]?.chainId ?? '').toLowerCase();
      const chain = dappChainByHex(target);
      return chain
        ? `Switch this site's network to ${chain.name}.`
        : `Switch network (${target || 'unknown'}) — not supported.`;
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
      // Broadcast on the wallet's ACTIVE chain — the same chain the approval
      // sheet shows. Makalu routes through the sdk provider (rpcUrl ''); the
      // 8 external EVM chains route through their own RPC with a pinned
      // chainId so a mainnet tx can never land on Makalu (or vice-versa).
      const chain = await activeChain();
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
          chainId: chain.chainId,
          rpcUrl:  chain.rpcUrl || undefined,
        });
      } catch (e) {
        const msg = (e as Error).message || 'Broadcast failed';
        if (/insufficient funds/i.test(msg)) throw new WcSignerError(-32000, `Insufficient ${chain.nativeSymbol} for amount + gas`);
        throw new WcSignerError(-32603, msg);
      }
    }
    /* EIP-3085/3326 network switching. Reached after the user approves the
       switch prompt (background routes switch to the approval flow). Persist
       the active chain + tell background to emit chainChanged to every tab.
       add-refusal uses 4001, switch-refusal 4902 (which means "unknown
       chain"), matching the standard switch().catch(add) dApp pattern. */
    case 'wallet_addEthereumChain':
    case 'wallet_switchEthereumChain': {
      const target = ((params[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
      const chain = dappChainByHex(target);
      if (!chain) {
        throw new WcSignerError(
          method === 'wallet_switchEthereumChain' ? 4902 : 4001,
          'Unsupported network. Thanos supports Lithosphere Makalu plus Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche and Linea.',
        );
      }
      await browser.storage.local.set({ chain_id_hex: toChainHex(chain.chainId) });
      try { await browser.runtime.sendMessage({ type: 'thanos-set-chain', chainHex: toChainHex(chain.chainId) }); }
      catch { /* background is async; storage write above is the source of truth */ }
      return null;
    }

    default:
      throw new WcSignerError(4200, `Method not supported: ${method}`);
  }
}
