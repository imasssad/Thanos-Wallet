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
import {
  HDNodeWallet, Mnemonic, JsonRpcProvider, FallbackProvider, Contract,
  getBytes, toUtf8Bytes, isHexString, parseUnits, type Provider,
} from 'ethers';
import { getActiveAccountIndex } from './accounts';

/** HD path for the active EVM account. Read at sign time so a switch in
 *  the HomeScreen account chip takes effect on the very next signature. */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}
const MAKALU_CHAIN_ID = 700777;
// Makalu [primary, fallback] — failover via FallbackProvider.
const MAKALU_RPCS = ['https://rpc.litho.ai', 'https://rpc-2.litho.ai'];

/** Optional user-set RPC override (Settings → Custom RPC). Loaded from
 *  storage at app boot via setRpcOverride; preferred over the defaults. */
let RPC_OVERRIDE: string | null = null;
export function setRpcOverride(url: string | null): void {
  RPC_OVERRIDE = url && url.trim() ? url.trim() : null;
}
function rpcUrls(): string[] {
  return RPC_OVERRIDE ? [RPC_OVERRIDE, ...MAKALU_RPCS] : MAKALU_RPCS;
}

/** Makalu provider with primary→fallback failover. */
function makaluProvider(): Provider {
  return new FallbackProvider(
    rpcUrls().map(url => ({
      provider:     new JsonRpcProvider(url, MAKALU_CHAIN_ID),
      priority:     1,
      weight:       1,
      stallTimeout: 1500,
    })),
    MAKALU_CHAIN_ID,
    { quorum: 1 },
  );
}

/** Proxy a read-only JSON-RPC call (eth_call, eth_getBalance,
 *  eth_estimateGas, eth_blockNumber, …) straight to Makalu. Used by the
 *  in-app dApp browser for methods the wallet doesn't sign. */
export async function rpcProxy(method: string, params: unknown[]): Promise<unknown> {
  const p = new JsonRpcProvider(rpcUrls()[0], MAKALU_CHAIN_ID);
  return p.send(method, (params ?? []) as unknown[]);
}

export class WcSignerError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'WcSignerError';
  }
}

function walletFromSeed(seed: string[], provider?: Provider): HDNodeWallet {
  const mnemonic = Mnemonic.fromPhrase(seed.join(' '));
  const hd = HDNodeWallet.fromMnemonic(mnemonic, activeHdPath());
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
 *  error code) on failure so the host can respond cleanly to the dApp.
 *
 *  Routes every signing call through `./signer`, which holds the seed
 *  in a module-private closure (not React state) — derived private keys
 *  never live in any caller's scope. */
export async function executeWcRequest(seed: string[], reqParams: WcRequestParams): Promise<unknown> {
  if (!seed.length) throw new WcSignerError(-32000, 'Wallet is locked');
  const method = reqParams.request.method;
  const params = reqParams.request.params as unknown[];
  const path = activeHdPath();

  const signer = await import('./signer');
  if (!signer.hasSeed()) signer.setSeed(seed);

  switch (method) {
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return [signer.deriveAddress(path)];

    case 'eth_chainId':
      return `0x${MAKALU_CHAIN_ID.toString(16)}`;

    case 'personal_sign': {
      const hexMsg = params[0] as string;
      const bytes: Uint8Array = isHexString(hexMsg) ? getBytes(hexMsg) : toUtf8Bytes(String(hexMsg));
      return signer.signPersonalMessage(path, bytes);
    }

    case 'eth_sign': {
      const hexMsg = params[1] as string;
      const bytes: Uint8Array = isHexString(hexMsg) ? getBytes(hexMsg) : toUtf8Bytes(String(hexMsg));
      return signer.signPersonalMessage(path, bytes);
    }

    case 'eth_signTypedData_v4': {
      const typed = JSON.parse(params[1] as string) as {
        domain: Record<string, unknown>;
        types:  Record<string, Array<{ name: string; type: string }>>;
        message: Record<string, unknown>;
      };
      return signer.signTypedData(path, {
        domain: typed.domain, types: typed.types, value: typed.message,
      });
    }

    case 'eth_sendTransaction': {
      const tx = (params[0] as {
        to: string; value?: string; data?: string;
        gas?: string; gasLimit?: string;
        maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      });
      try {
        return await signer.signAndBroadcast(path, {
          to:                   tx.to,
          value:                tx.value ? BigInt(tx.value) : undefined,
          data:                 tx.data,
          gasLimit:             tx.gas ?? tx.gasLimit,
          maxFeePerGas:         tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        });
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

/* ─── Direct asset transfer (the Send screen) ────────────────────────── */

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

export type SendChain = 'evm' | 'bitcoin' | 'solana' | 'cosmos';

export interface SendAssetArgs {
  /** Unlocked BIP-39 seed words. */
  seed: string[];
  /** Target chain — defaults to 'evm' (Makalu native LITHO + LEP100). */
  chain?: SendChain;
  /** Recipient address — format depends on chain. */
  to: string;
  /** Human-readable amount, e.g. "12.5". */
  amount: string;
  /** Token decimals — 18 for native LITHO. */
  decimals: number;
  /** LEP100 / ERC-20 contract address; omit for a native LITHO send. */
  tokenAddress?: string;
  /** SPL mint address — required when chain='solana' and not native SOL. */
  splMintAddress?: string;
  /** Optional Cosmos memo. */
  memo?: string;
}

/**
 * Sign + broadcast a transfer on the chain identified by `args.chain`
 * (default 'evm' for Makalu). Returns the broadcast tx hash/signature.
 */
export async function sendAsset(args: SendAssetArgs): Promise<string> {
  if (!args.seed.length) throw new WcSignerError(-32000, 'Wallet is locked');
  const chain = args.chain ?? 'evm';

  if (chain === 'bitcoin') {
    const { sendBitcoin } = await import('./bitcoin');
    return sendBitcoin({ mnemonic: args.seed.join(' '), recipient: args.to, amount: args.amount });
  }
  if (chain === 'solana') {
    if (args.splMintAddress) {
      const { sendSplToken } = await import('./solana');
      return sendSplToken({
        mnemonic: args.seed.join(' '), recipient: args.to, amount: args.amount,
        mintAddress: args.splMintAddress, decimals: args.decimals,
      });
    }
    const { sendSol } = await import('./solana');
    return sendSol({ mnemonic: args.seed.join(' '), recipient: args.to, amount: args.amount });
  }
  if (chain === 'cosmos') {
    const { sendCosmos } = await import('./cosmos');
    return sendCosmos({
      mnemonic: args.seed.join(' '), recipient: args.to, amount: args.amount, memo: args.memo,
    });
  }

  // ─── EVM / Makalu default ─────────────────────────────────────────────
  // Signing happens in the module-isolated `./signer` so the caller's
  // closure never holds a derived private key.
  let value: bigint;
  try { value = parseUnits(args.amount, args.decimals); }
  catch { throw new WcSignerError(-32602, 'Invalid amount'); }
  if (value <= 0n) throw new WcSignerError(-32602, 'Amount must be greater than zero');

  const path = activeHdPath();
  const signer = await import('./signer');
  if (!signer.hasSeed()) signer.setSeed(args.seed);

  try {
    if (args.tokenAddress) {
      return await signer.transferErc20(path, {
        tokenAddress: args.tokenAddress, to: args.to, amount: value,
      });
    }
    return await signer.signAndBroadcast(path, { to: args.to, value });
  } catch (e) {
    const msg = (e as Error).message || 'Broadcast failed';
    if (/insufficient funds/i.test(msg)) throw new WcSignerError(-32000, 'Insufficient balance for amount + gas');
    throw new WcSignerError(-32603, msg);
  }
}
