import { Contract, JsonRpcProvider } from 'ethers';
import type { LithicCallRequest, SimulationReport } from '../types';
import { getNetworkByChainId } from '../chains/networks';

export interface LithicTransport {
  call(method: string, params: unknown[]): Promise<unknown>;
}

export interface LithicRpcMethods {
  chainInfo: string;
  runtimeInfo: string;
  estimateGas: string;
  simulateContract: string;
  callContract: string;
  deployContract: string;
  resolveDnns: string;
  readonlyContract: string;
}

const DEFAULT_METHODS: LithicRpcMethods = {
  chainInfo: 'lith_chainInfo',
  runtimeInfo: 'lithic_runtimeInfo',
  estimateGas: 'lithic_estimateGas',
  simulateContract: 'lithic_simulateContract',
  callContract: 'lithic_callContract',
  deployContract: 'lithic_deployContract',
  resolveDnns: 'dnns_resolve',
  readonlyContract: 'lithic_callReadonly'
};

export class RpcLithicTransport implements LithicTransport {
  constructor(private readonly rpcUrl: string) {}

  async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    });

    const json = await response.json();
    if (json.error) throw new Error(json.error.message || 'Lithic RPC error');
    return json.result;
  }
}

/**
 * Transport for standard EVM chains (Evmos/Ethermint, incl. Lithosphere
 * Kamet/Makalu). The Lithosphere networks do NOT implement the custom
 * `lithic_*` JSON-RPC methods — they speak standard `eth_*`. This transport
 * maps the SDK's `lithic_callReadonly` contract reads onto `eth_call` via
 * ethers, and passes any other (already-standard `eth_*`) method straight
 * through. uint results are returned as decimal strings so existing callers
 * (`String(balance)`, `Number(decimals)`) keep working unchanged.
 */
const LEP100_READ_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

export class EvmLithicTransport implements LithicTransport {
  private readonly provider: JsonRpcProvider;

  constructor(rpcUrl: string, chainId: number) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  }

  async call(method: string, params: unknown[]): Promise<unknown> {
    if (method === 'lithic_callReadonly') {
      const req = (params?.[0] ?? {}) as LithicCallRequest;
      const contract = new Contract(req.contract, LEP100_READ_ABI, this.provider);
      const fn = contract.getFunction(req.method);
      const result = await fn(...(req.args ?? []));
      return typeof result === 'bigint' ? result.toString() : result;
    }
    // Already-standard EVM JSON-RPC (eth_*) — forward verbatim.
    return this.provider.send(method, (params ?? []) as unknown[]);
  }
}

export class LithicClient {
  constructor(
    private readonly transportFactory?: (chainId: number) => LithicTransport,
    private readonly methods: LithicRpcMethods = DEFAULT_METHODS
  ) {}

  private getTransport(chainId: number): LithicTransport {
    if (this.transportFactory) return this.transportFactory(chainId);
    const network = getNetworkByChainId(chainId);
    // Lithosphere (lithic) and other EVM chains are standard Ethermint/EVM
    // and have no lithic_* RPC — read via eth_call. Non-EVM kinds (bitcoin,
    // solana) keep the raw passthrough transport.
    if (network.kind === 'evm' || network.kind === 'lithic') {
      return new EvmLithicTransport(network.rpcUrls[0], chainId);
    }
    return new RpcLithicTransport(network.rpcUrls[0]);
  }

  async getChainInfo(chainId: number): Promise<unknown> {
    return this.getTransport(chainId).call(this.methods.chainInfo, []);
  }

  async getRuntimeInfo(chainId: number): Promise<unknown> {
    return this.getTransport(chainId).call(this.methods.runtimeInfo, []);
  }

  async estimateGas(request: LithicCallRequest): Promise<unknown> {
    return this.getTransport(request.chainId).call(this.methods.estimateGas, [request]);
  }

  async simulateContract(request: LithicCallRequest): Promise<SimulationReport> {
    const raw = await this.getTransport(request.chainId).call(this.methods.simulateContract, [request]);
    return {
      chainId: request.chainId,
      summary: `Simulation complete for ${request.contract}.${request.method}`,
      issues: [],
      raw
    };
  }

  async callContract(request: LithicCallRequest): Promise<unknown> {
    return this.getTransport(request.chainId).call(this.methods.callContract, [request]);
  }

  async callReadonly(request: LithicCallRequest): Promise<unknown> {
    return this.getTransport(request.chainId).call(this.methods.readonlyContract, [request]);
  }

  async deployContract(chainId: number, bytecode: string, constructorArgs: unknown[] = []): Promise<unknown> {
    return this.getTransport(chainId).call(this.methods.deployContract, [{ bytecode, constructorArgs }]);
  }

  async resolveDnns(chainId: number, name: string): Promise<unknown> {
    return this.getTransport(chainId).call(this.methods.resolveDnns, [name]);
  }

  async invokeRaw(chainId: number, method: string, params: unknown[] = []): Promise<unknown> {
    return this.getTransport(chainId).call(method, params);
  }
}
