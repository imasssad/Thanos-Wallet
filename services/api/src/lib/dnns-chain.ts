/**
 * DNNS on-chain resolver — Lithosphere's decentralised name service.
 *
 * DNNS is an ENS-style name service deployed on the Kamet chain
 * (900523). This module talks to its contracts directly over RPC; the
 * previous implementation guessed at a non-standard `dnns_resolve`
 * JSON-RPC method that no node actually exposes.
 *
 * Forward resolution (name → 0x…):
 *   1. namehash(name) → node
 *   2. Registry.resolver(node) → the resolver contract for that name
 *   3. Resolver.addr(node) → the address the name points at
 *      Resolver.text(node, 'avatar' | 'description') → profile records
 *
 * Reverse resolution (0x… → name) follows the ENS reverse pattern:
 *   1. namehash('<addr-lowercase-no-0x>.addr.reverse') → reverseNode
 *   2. Registry.resolver(reverseNode) → the reverse resolver
 *   3. Resolver.name(reverseNode) → the claimed name
 *   4. Forward-verify: the claimed name must resolve back to the same
 *      address. A reverse record can be set by anyone, so an
 *      unverified claim is discarded.
 *
 * Contract addresses come from env (DNNS_*_ADDRESS); see .env.example.
 * Every call goes through an ethers FallbackProvider over Kamet's
 * primary + fallback RPC endpoints, so a stalled primary rotates
 * transparently.
 */
import { Contract, FallbackProvider, JsonRpcProvider, namehash, type Provider } from 'ethers';
import { log } from './log.js';

/** DNNS lives on Kamet — chain 900523. */
export const DNNS_CHAIN_ID = Number(process.env.KAMET_CHAIN_ID || 900523);

/** DNNS contract addresses on Kamet. Env-overridable; the defaults are
 *  the deployed Lithosphere contracts. */
export const DNNS_CONTRACTS = {
  nameWrapper:     process.env.DNNS_NAME_WRAPPER_ADDRESS     || '0xc47E49259b8dDa2C9D57941E1a52747E4c721Cb9',
  registry:        process.env.DNNS_REGISTRY_ADDRESS         || '0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab',
  baseRegistrar:   process.env.DNNS_BASE_REGISTRAR_ADDRESS   || '0xB3D1a8e92FFAD73Ab8a07BF37A8E1374df8B3722',
  metadataService: process.env.DNNS_METADATA_SERVICE_ADDRESS || '0x9138E4CD9c5EBAc6964Fd28516BD5B0E83E5AA51',
} as const;

/** Token-metadata URI template ({id} → token id). Served by the
 *  MetadataService contract; exposed for the registration / NFT UI. */
export const DNNS_METADATA_URI =
  process.env.DNNS_METADATA_URI || 'https://names.litho.ai/metadata/{id}';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Kamet RPC endpoints as [primary, fallback]. */
const KAMET_RPC_URLS = String(
  (process.env.KAMET_RPC_PRIMARY &&
    `${process.env.KAMET_RPC_PRIMARY},${process.env.KAMET_RPC_FALLBACK ?? 'https://rpc-3.litho.ai'}`) ||
    'https://rpc-3.litho.ai',
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/* ─── Contract ABIs (ENS-style, human-readable) ──────────────────── */

const REGISTRY_ABI = [
  'function resolver(bytes32 node) view returns (address)',
  'function owner(bytes32 node) view returns (address)',
] as const;

const RESOLVER_ABI = [
  'function addr(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function text(bytes32 node, string key) view returns (string)',
] as const;

/* ─── Provider (memoised, with failover) ─────────────────────────── */

let _provider: Provider | null = null;

/** Memoised Kamet provider. A FallbackProvider when 2+ endpoints are
 *  configured (stalled primary >1.5s rotates to the fallback);
 *  a plain JsonRpcProvider for a single endpoint. */
function getProvider(): Provider {
  if (_provider) return _provider;
  _provider =
    KAMET_RPC_URLS.length === 1
      ? new JsonRpcProvider(KAMET_RPC_URLS[0], DNNS_CHAIN_ID)
      : new FallbackProvider(
          KAMET_RPC_URLS.map(url => ({
            provider:     new JsonRpcProvider(url, DNNS_CHAIN_ID),
            priority:     1,
            weight:       1,
            stallTimeout: 1500,
          })),
          DNNS_CHAIN_ID,
          { quorum: 1 },
        );
  return _provider;
}

/* ─── Resolution ─────────────────────────────────────────────────── */

export interface DnnsResolution {
  /** The 0x address the name points at, or null if unset/unregistered. */
  address:   string | null;
  /** The resolver contract that answered, or null if the name has none. */
  resolver:  string | null;
  /** `avatar` text record. */
  avatarUrl: string | null;
  /** `description` text record. */
  bio:       string | null;
}

/**
 * Resolve a DNNS name to its on-chain record. Returns an all-null
 * record when the name is unregistered or has no resolver; throws only
 * on a transport failure so the caller can distinguish "not found"
 * (cacheable) from "RPC down" (retry).
 */
export async function resolveName(name: string): Promise<DnnsResolution> {
  let node: string;
  try {
    node = namehash(name);
  } catch {
    // Not a namehash-able string — treat as unregistered, not an error.
    return { address: null, resolver: null, avatarUrl: null, bio: null };
  }

  const provider = getProvider();
  const registry = new Contract(DNNS_CONTRACTS.registry, REGISTRY_ABI, provider);
  const resolverAddr: string = await registry.resolver(node);

  if (!resolverAddr || resolverAddr === ZERO_ADDRESS) {
    return { address: null, resolver: null, avatarUrl: null, bio: null };
  }

  const resolver = new Contract(resolverAddr, RESOLVER_ABI, provider);
  // A resolver may not implement every record type — a missing
  // addr/text getter reverts, which we treat as "unset", not failure.
  const [address, avatar, bio] = await Promise.all([
    resolver.addr(node).catch(() => ZERO_ADDRESS) as Promise<string>,
    resolver.text(node, 'avatar').catch(() => '') as Promise<string>,
    resolver.text(node, 'description').catch(() => '') as Promise<string>,
  ]);

  return {
    address:   address && address !== ZERO_ADDRESS ? address : null,
    resolver:  resolverAddr,
    avatarUrl: avatar || null,
    bio:       bio || null,
  };
}

/**
 * Reverse-resolve an address to its primary DNNS name, with forward
 * verification. Returns null when no verified reverse record exists.
 * Throws only on a transport failure.
 */
export async function reverseResolve(address: string): Promise<string | null> {
  const reverseNode = namehash(`${address.toLowerCase().replace(/^0x/, '')}.addr.reverse`);

  const provider = getProvider();
  const registry = new Contract(DNNS_CONTRACTS.registry, REGISTRY_ABI, provider);
  const resolverAddr: string = await registry.resolver(reverseNode);

  if (!resolverAddr || resolverAddr === ZERO_ADDRESS) return null;

  const resolver = new Contract(resolverAddr, RESOLVER_ABI, provider);
  const claimed: string = await resolver.name(reverseNode).catch(() => '');
  if (!claimed) return null;

  // The reverse record is self-asserted — anyone can point their own
  // reverse node at any name. Only trust it if the name resolves
  // forward back to this exact address.
  const forward = await resolveName(claimed).catch(() => null);
  if (!forward?.address || forward.address.toLowerCase() !== address.toLowerCase()) {
    log.warn({ address, claimed }, 'dnns reverse record failed forward verification — ignoring');
    return null;
  }
  return claimed;
}
