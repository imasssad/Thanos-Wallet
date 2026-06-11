/**
 * DNNS — Lithosphere's ENS-compatible name service.
 *
 * Resolution is done with direct ENS-style contract reads against the
 * DNNS Registry + Resolver on Kamet (chain 900523). The API server uses
 * the same approach in services/api/src/lib/dnns-chain.ts; this is the
 * client-side mirror, used as the offline-capable fallback when the API
 * is unreachable.
 *
 * Forward (alice.litho → 0x…):
 *   1. namehash(name) → node
 *   2. Registry.resolver(node) → resolver contract
 *   3. Resolver.addr(node) → address
 *
 * Reverse (0x… → alice.litho):
 *   1. namehash('<addr-lowercase-no-0x>.addr.reverse') → reverseNode
 *   2. Registry.resolver(reverseNode) → reverse resolver
 *   3. Resolver.name(reverseNode) → claimed name
 *   4. Forward-verify: the claimed name must resolve back to this
 *      address. Reverse records are self-asserted, so an unverified
 *      claim is discarded.
 *
 * A LithicClient may be injected as a legacy fallback when the ethers
 * provider isn't available (test environments, minimal embeds). In
 * production the contract-read path is canonical.
 */
import { Contract, namehash, type Provider } from 'ethers';
import type { DnnsRecord, DnnsRegistrationRequest } from '../types';
import { getEvmProvider } from '../chains/provider';
import { LithicClient } from '../clients/lithic-client';

/** DNNS lives on Kamet — chain 900523. */
export const DNNS_KAMET_CHAIN_ID = 900523;

/** DNNS contract addresses on Kamet. The defaults are the deployed
 *  Lithosphere contracts; override via DnnsServiceOptions.contracts for
 *  staging deployments. */
export const DNNS_CONTRACTS = {
  nameWrapper:     '0xc47E49259b8dDa2C9D57941E1a52747E4c721Cb9',
  registry:        '0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab',
  baseRegistrar:   '0xB3D1a8e92FFAD73Ab8a07BF37A8E1374df8B3722',
  metadataService: '0x9138E4CD9c5EBAc6964Fd28516BD5B0E83E5AA51',
} as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const REGISTRY_ABI = [
  'function resolver(bytes32 node) view returns (address)',
] as const;

const RESOLVER_ABI = [
  'function addr(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function text(bytes32 node, string key) view returns (string)',
] as const;

export interface DnnsServiceOptions {
  /** Override the Kamet provider — for tests, or where the shared
   *  provider factory isn't initialised. */
  provider?: Provider;
  /** Override contract addresses — useful for staging deployments. */
  contracts?: Partial<typeof DNNS_CONTRACTS>;
  /** Legacy LithicClient — used as a fallback for resolve() when the
   *  on-chain read fails, and as the transport for register(). */
  lithic?: LithicClient;
}

export class DnnsService {
  private readonly provider?: Provider;
  private readonly contracts: typeof DNNS_CONTRACTS;
  private readonly lithic: LithicClient;

  constructor(opts: DnnsServiceOptions | LithicClient = {}) {
    // Backwards-compat: callers (and the existing unit tests) pass a
    // LithicClient (or LithicClient-shaped mock) directly. Detect the
    // shape rather than relying on instanceof, since mocks aren't real
    // subclasses.
    const looksLikeLithic =
      opts && typeof (opts as { resolveDnns?: unknown }).resolveDnns === 'function';
    if (looksLikeLithic) {
      this.lithic = opts as LithicClient;
      this.contracts = DNNS_CONTRACTS;
    } else {
      const o = opts as DnnsServiceOptions;
      this.provider = o.provider;
      this.contracts = { ...DNNS_CONTRACTS, ...(o.contracts ?? {}) };
      this.lithic = o.lithic ?? new LithicClient();
    }
  }

  /** Resolve the configured Kamet provider — throws if the host app
   *  hasn't called setRpcUrls(900523, [...]) and no rpcUrls fall through
   *  from networks.ts. Callers wrap in try/catch and fall back. */
  private getProvider(): Provider {
    if (this.provider) return this.provider;
    const p = getEvmProvider(DNNS_KAMET_CHAIN_ID);
    if (!p) throw new Error('Kamet provider not configured');
    return p;
  }

  async resolve(chainId: number, name: string): Promise<DnnsRecord> {
    // Path A — on-chain ENS-style read.
    try {
      const node = namehash(name);
      const provider = this.getProvider();
      const registry = new Contract(this.contracts.registry, REGISTRY_ABI, provider);
      const resolverAddr: string = await registry.resolver(node);

      if (resolverAddr && resolverAddr !== ZERO_ADDRESS) {
        const resolver = new Contract(resolverAddr, RESOLVER_ABI, provider);
        const [address, avatar, bio] = await Promise.all([
          resolver.addr(node).catch(() => ZERO_ADDRESS) as Promise<string>,
          resolver.text(node, 'avatar').catch(() => '') as Promise<string>,
          resolver.text(node, 'description').catch(() => '') as Promise<string>,
        ]);
        return {
          name,
          address: address && address !== ZERO_ADDRESS ? address : ZERO_ADDRESS,
          chainId,
          resolver: resolverAddr,
          avatarUrl: avatar || undefined,
          bio: bio || undefined,
        };
      }
    } catch {
      /* fall through to legacy RPC path */
    }

    // Path B — legacy LithicClient RPC fallback. Used when the ethers
    // provider isn't wired (tests, minimal embeds) or the on-chain read
    // throws. Matches the previous service's shape.
    const resolved = await this.lithic.resolveDnns(chainId, name).catch(() => null);
    return {
      name,
      address: typeof resolved === 'string' ? resolved : ZERO_ADDRESS,
      chainId,
      resolver: 'thanos-default-resolver',
    };
  }

  /**
   * Reverse-resolve an address to its primary DNNS name, with forward
   * verification. Returns null when no verified reverse record exists.
   * Pure on-chain read — no API roundtrip.
   */
  async reverseResolve(chainId: number, address: string): Promise<string | null> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;

    try {
      const reverseNode = namehash(
        `${address.toLowerCase().replace(/^0x/, '')}.addr.reverse`,
      );
      const provider = this.getProvider();
      const registry = new Contract(this.contracts.registry, REGISTRY_ABI, provider);
      const resolverAddr: string = await registry.resolver(reverseNode);
      if (!resolverAddr || resolverAddr === ZERO_ADDRESS) return null;

      const resolver = new Contract(resolverAddr, RESOLVER_ABI, provider);
      const claimed: string = await resolver.name(reverseNode).catch(() => '');
      if (!claimed) return null;

      // Reverse records are self-asserted — anyone can point their own
      // reverse node at any name. Only trust the claim if the name
      // resolves forward back to this exact address.
      const forward = await this.resolve(chainId, claimed).catch(() => null);
      if (
        !forward?.address ||
        forward.address === ZERO_ADDRESS ||
        forward.address.toLowerCase() !== address.toLowerCase()
      ) {
        return null;
      }
      return claimed;
    } catch {
      return null;
    }
  }

  async register(request: DnnsRegistrationRequest): Promise<{ submitted: true; txHash: string }> {
    // No catch-and-fabricate here: this used to swallow the RPC error
    // and synthesize a fake txHash from the name+owner, telling the user
    // a PAID registration succeeded when nothing was submitted on-chain.
    // Failing loudly is the only honest behaviour — the UI surfaces the
    // error and the user retries.
    const txHash = await this.lithic.callContract({
      chainId:  request.chainId,
      contract: 'dnns-registry',
      method:   'register',
      args:     [request.name, request.owner, request.years ?? 1],
    });
    if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error(`DNNS register returned an invalid tx hash: ${String(txHash).slice(0, 40)}`);
    }
    return { submitted: true, txHash };
  }
}
