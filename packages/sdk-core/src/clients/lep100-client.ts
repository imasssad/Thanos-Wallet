import type {
  Lep100Allowance,
  Lep100ApproveRequest,
  Lep100Balance,
  Lep100BurnRequest,
  Lep100BurnFromRequest,
  Lep100IndexerSpec,
  Lep100OwnershipRequest,
  Lep100ReadRequest,
  Lep100TokenMetadata,
  Lep100TransferRequest,
  LithicCallRequest
} from '../types';
import { LithicClient } from './lithic-client';

/**
 * LEP100 method names. LEP100 = standard ERC-20 + ERC20Burnable
 * (burn / burnFrom) + Ownable (owner / transferOwnership /
 * renounceOwnership) — nothing custom. The full ABI is the canonical
 * artifact at
 * contracts/artifacts/contracts/LEP100Token.sol/LEP100Token.json;
 * this client calls by method name through LithicClient's JSON-RPC,
 * so it needs the names rather than the ABI array.
 */
const LEP100_METHODS = {
  name:              'name',
  symbol:            'symbol',
  decimals:          'decimals',
  totalSupply:       'totalSupply',
  balanceOf:         'balanceOf',
  allowance:         'allowance',
  transfer:          'transfer',
  approve:           'approve',
  transferFrom:      'transferFrom',
  burn:              'burn',
  burnFrom:          'burnFrom',
  owner:             'owner',
  transferOwnership: 'transferOwnership',
  renounceOwnership: 'renounceOwnership'
} as const;

export const DEFAULT_LEP100_INDEXER_SPEC: Lep100IndexerSpec = {
  standard: 'lep100',
  chainIds: [700777, 900523], // Makalu, Kamet
  metadataMethodNames: {
    name: LEP100_METHODS.name,
    symbol: LEP100_METHODS.symbol,
    decimals: LEP100_METHODS.decimals,
    totalSupply: LEP100_METHODS.totalSupply
  },
  balanceMethodName: LEP100_METHODS.balanceOf,
  allowanceMethodName: LEP100_METHODS.allowance,
  transferMethodName: LEP100_METHODS.transfer,
  approveMethodName: LEP100_METHODS.approve,
  transferEventName: 'Transfer',
  approvalEventName: 'Approval',
  storage: {
    tokenTable: 'lep100_tokens',
    balanceTable: 'lep100_balances',
    approvalTable: 'lep100_allowances',
    eventTable: 'lep100_events'
  }
};

export class Lep100Client {
  constructor(private readonly lithic: LithicClient = new LithicClient()) {}

  private read(chainId: number, contractAddress: string, method: string, args: unknown[] = []) {
    const request: LithicCallRequest = { chainId, contract: contractAddress, method, args };
    return this.lithic.callReadonly(request);
  }

  async getMetadata(chainId: number, contractAddress: string): Promise<Lep100TokenMetadata> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.read(chainId, contractAddress, LEP100_METHODS.name),
      this.read(chainId, contractAddress, LEP100_METHODS.symbol),
      this.read(chainId, contractAddress, LEP100_METHODS.decimals),
      this.read(chainId, contractAddress, LEP100_METHODS.totalSupply)
    ]);

    return {
      chainId,
      contractAddress,
      name: String(name ?? 'Unknown LEP100 Token'),
      symbol: String(symbol ?? 'LEP100'),
      decimals: Number(decimals ?? 18),
      totalSupply: String(totalSupply ?? '0'),
      verified: false
    };
  }

  async balanceOf(request: Lep100ReadRequest): Promise<Lep100Balance> {
    if (!request.owner) throw new Error('owner is required for LEP100 balanceOf');
    const token = await this.getMetadata(request.chainId, request.contractAddress);
    const balance = await this.read(request.chainId, request.contractAddress, LEP100_METHODS.balanceOf, [request.owner]);
    return { owner: request.owner, balance: String(balance ?? '0'), token };
  }

  async allowance(request: Lep100ReadRequest): Promise<Lep100Allowance> {
    if (!request.owner || !request.spender) throw new Error('owner and spender are required for LEP100 allowance');
    const token = await this.getMetadata(request.chainId, request.contractAddress);
    const allowance = await this.read(request.chainId, request.contractAddress, LEP100_METHODS.allowance, [request.owner, request.spender]);
    return { owner: request.owner, spender: request.spender, allowance: String(allowance ?? '0'), token };
  }

  async transfer(request: Lep100TransferRequest) {
    // Standard ERC-20 transfer(to, amount) — two args, no memo.
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.transfer,
      args: [request.to, request.amount]
    });
  }

  async approve(request: Lep100ApproveRequest) {
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.approve,
      args: [request.spender, request.amount]
    });
  }

  /* ─── ERC20Burnable ──────────────────────────────────────────────── */

  /** burn(amount) — burns from the caller's own balance. */
  async burn(request: Lep100BurnRequest) {
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.burn,
      args: [request.amount]
    });
  }

  /** burnFrom(account, amount) — burns from `account` against the
   *  caller's allowance. */
  async burnFrom(request: Lep100BurnFromRequest) {
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.burnFrom,
      args: [request.account, request.amount]
    });
  }

  /* ─── Ownable ────────────────────────────────────────────────────── */

  /** owner() — current contract owner address. */
  async getOwner(chainId: number, contractAddress: string): Promise<string> {
    const owner = await this.read(chainId, contractAddress, LEP100_METHODS.owner);
    return String(owner ?? '0x0000000000000000000000000000000000000000');
  }

  /** transferOwnership(newOwner). */
  async transferOwnership(request: Lep100OwnershipRequest) {
    if (!request.newOwner) throw new Error('newOwner is required for transferOwnership');
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.transferOwnership,
      args: [request.newOwner]
    });
  }

  /** renounceOwnership() — leaves the contract without an owner. */
  async renounceOwnership(request: Lep100OwnershipRequest) {
    return this.lithic.callContract({
      chainId: request.chainId,
      contract: request.contractAddress,
      method: LEP100_METHODS.renounceOwnership,
      args: []
    });
  }
}
