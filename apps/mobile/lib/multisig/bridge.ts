// Copied from packages/multisig/src/bridge.ts by scripts/sync-multisig.mjs — edit the original and re-run it.
/**
 * The wallet side of Thanos MultiSig. Each app passes a WalletBridge backed by its own signer
 * (web: the signing worker; extension: the offscreen document; desktop: the main process;
 * mobile: its keystore), so keys never leave the place they already live. BridgeSigner turns the
 * bridge into an ethers Signer, which is all the Litho Vault SDK needs to propose, approve,
 * revoke, execute, cancel and sign off-chain approvals.
 */
import {
  AbstractSigner,
  getAddress,
  type Provider,
  type TransactionRequest,
  type TransactionResponse,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';

export interface BridgeTransaction {
  chainId: number;
  /** RPC to broadcast through. */
  rpcUrl: string;
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
}

export interface BridgeTypedData {
  domain: TypedDataDomain;
  /** Without EIP712Domain. */
  types: Record<string, TypedDataField[]>;
  message: Record<string, unknown>;
}

export interface WalletBridge {
  /** The active account (0x). */
  address: string;
  /** Its name in the wallet, e.g. "Account 1". */
  accountName?: string;
  /** False when this account can't sign here (watch-only, or a hardware wallet the app can't use for this yet). */
  canSign: boolean;
  /** Why canSign is false, shown to the user. */
  cannotSignReason?: string;
  /** Signs and broadcasts a transaction; returns its hash. The app shows its own confirmation first if it has one. */
  sendTransaction(tx: BridgeTransaction): Promise<string>;
  /** EIP-712 signature. */
  signTypedData(input: BridgeTypedData): Promise<string>;
  /** Opens a link outside the wallet (explorer, Litho Vault app). Defaults to window.open. */
  openUrl?(url: string): void;
}

const POLL_MS = 1_000;
const SEEN_TIMEOUT_MS = 90_000;

function withHeadroom(gas: bigint): bigint {
  // Executions measure token balances and can cost a little more than the estimate.
  return (gas * 125n) / 100n + 20_000n;
}

export class BridgeSigner extends AbstractSigner {
  constructor(
    private readonly bridge: WalletBridge,
    private readonly chainId: number,
    private readonly rpcUrl: string,
    provider: Provider,
  ) {
    super(provider);
  }

  override async getAddress(): Promise<string> {
    return getAddress(this.bridge.address);
  }

  override connect(provider: Provider | null): BridgeSigner {
    if (!provider) throw new Error('BridgeSigner needs a provider');
    return new BridgeSigner(this.bridge, this.chainId, this.rpcUrl, provider);
  }

  override async signTransaction(): Promise<string> {
    throw new Error('Thanos MultiSig sends transactions through the wallet; it never handles raw signed transactions');
  }

  override async signMessage(): Promise<string> {
    throw new Error('Thanos MultiSig does not sign plain messages');
  }

  override async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string> {
    if (!this.bridge.canSign) throw new Error(this.bridge.cannotSignReason ?? 'This account cannot sign here');
    return this.bridge.signTypedData({ domain, types, message: value });
  }

  override async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    if (!this.bridge.canSign) throw new Error(this.bridge.cannotSignReason ?? 'This account cannot sign here');
    const provider = this.provider!;
    const from = await this.getAddress();
    const pop = await this.populateCall(tx);
    if (!pop.to) throw new Error('Thanos MultiSig only sends calls to existing contracts');
    const to = getAddress(pop.to);
    const data = pop.data ?? '0x';
    const value = pop.value != null ? BigInt(pop.value) : 0n;
    const gasLimit = pop.gasLimit != null ? BigInt(pop.gasLimit) : withHeadroom(await provider.estimateGas({ from, to, data, value }));
    const hash = await this.bridge.sendTransaction({ chainId: this.chainId, rpcUrl: this.rpcUrl, to, data, value, gasLimit });
    const deadline = Date.now() + SEEN_TIMEOUT_MS;
    for (;;) {
      const seen = await provider.getTransaction(hash).catch(() => null);
      if (seen) return seen;
      if (Date.now() > deadline) throw new Error(`Sent ${hash}, but the network has not shown it yet. Check Activity before trying again.`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

/**
 * A copy with every bigint written as a decimal string, for bridges that pass requests as JSON
 * (the extension's runtime messages). ethers reads uint fields and the domain's chainId from
 * decimal strings, so the signature is the same.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as T;
}
