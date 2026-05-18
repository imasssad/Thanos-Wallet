/**
 * WalletConnect request signer for the mobile wallet.
 *
 * Takes the unlocked BIP39 seed and a session_request, signs/broadcasts
 * with ethers, and returns the JSON-RPC result. Pure logic — the UI
 * (WalletConnectRequestHost) decides whether to call this after the
 * user approves.
 *
 * Supported methods:
 *   personal_sign / eth_sign      → EIP-191 message signature
 *   eth_signTypedData_v4          → EIP-712 typed-data signature
 *   eth_sendTransaction           → sign + broadcast, returns tx hash
 *   eth_accounts / eth_requestAccounts → [address]
 *   eth_chainId                   → current chain (hex)
 *
 * The seed never leaves this module; a fresh HDNodeWallet is built per
 * call and discarded.
 */
import { HDNodeWallet, Mnemonic, JsonRpcProvider, getBytes, toUtf8Bytes, isHexString } from 'ethers';

const HD_PATH = "m/44'/60'/0'/0/0";
const MAKALU_CHAIN_ID = 700777;
const MAKALU_RPC = 'https://rpc.litho.ai';

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'WcSignerError';
  }
}

function walletFromSeed(seed: string[], provider?: JsonRpcProvider): HDNodeWallet {
  const mnemonic = Mnemonic.fromPhrase(seed.join(' '));
  const hd = HDNodeWallet.fromMnemonic(mnemonic, HD_PATH);
  return provider ? (hd.connect(provider) as HDNodeWallet) : hd;
}

interface WcRequestParams {
  request: { method: string; params: unknown };
  chainId?: string;
}

/** A short, human-readable summary of what the request will do — shown
 *  in the approval sheet so the user knows what they're signing. */
export function summariseRequest(method: string, params: unknown): string {
  switch (method) {
    case 'personal_sign':
    case 'eth_sign': {
      const arr = params as string[];
      const hex = method === 'personal_sign' ? arr[0] : arr[1];
      let text = hex ?? '';
      try { if (isHexString(text)) text = Buffer.from(text.slice(2), 'hex').toString('utf8'); }
      catch { /* leave hex */ }
      return `Sign message:\n"${text.slice(0, 140)}"`;
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

/** Execute a WC session_request. Throws WcSignerError (with a JSON-RPC
 *  error code) on failure so the host can respond cleanly to the dApp. */
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
      // params: [address, message] — second entry is the payload.
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
      // ethers v6 wants `types` without the EIP712Domain entry.
      const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
      void _omit;
      return walletFromSeed(seed).signTypedData(
        typed.domain,
        types as Record<string, Array<{ name: string; type: string }>>,
        typed.message,
      );
    }

    case 'eth_sendTransaction': {
      const tx = (params[0] as {
        to: string; value?: string; data?: string;
        gas?: string; gasLimit?: string;
        maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      });
      const provider = new JsonRpcProvider(MAKALU_RPC, MAKALU_CHAIN_ID);
      const wallet = walletFromSeed(seed, provider);
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
