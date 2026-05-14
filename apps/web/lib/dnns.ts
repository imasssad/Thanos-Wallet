/**
 * DNNS resolver — Lithosphere's name service.
 *
 * Resolves a human-readable name (e.g. "sora.litho") to an EVM address.
 *
 * Resolution path:
 *   1. Server-side endpoint (`/dnns/resolve`) — caches in `dnns_cache`
 *      and proxies an on-chain `dnns_resolve` RPC call.  Fast, shared
 *      across clients, and survives wallet refresh / app reinstall.
 *   2. Fallback: sdk-core's `DnnsService` (direct RPC) when the API is
 *      unreachable.  Keeps the wallet usable without the API.
 *
 * In-memory cache (5 min) layers on top of the server cache so rapid
 * keystrokes in the Send modal don't re-fetch on every change.
 */
import { DnnsService } from '@thanos/sdk-core';
import { MAKALU_CHAIN_ID } from './rpc';
import { apiClient } from './auth-client';

const CACHE_TTL_MS = 5 * 60 * 1000;

type Cached = { address: string | null; at: number };
const cache = new Map<string, Cached>();

let _service: DnnsService | null = null;
function getService(): DnnsService {
  if (_service) return _service;
  _service = new DnnsService();
  return _service;
}

/** True when the input looks like a DNNS-style name (has a dot, doesn't
 *  start with 0x or litho1). Used to gate the lookup so addresses don't
 *  trigger a needless network call. */
export function looksLikeName(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('0x'))     return false;
  if (trimmed.startsWith('litho1')) return false;
  return trimmed.includes('.');
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Resolve a DNNS name → checksummed EVM address, or null if unknown. */
export async function resolveName(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.address;

  // 1. Try the API. It has its own dnns_cache table + RPC fallback,
  //    so a 200 with `record.address: null` is an authoritative miss.
  try {
    const { record } = await apiClient.resolveDnnsName(key, MAKALU_CHAIN_ID);
    if (record) {
      const addr = record.address && record.address !== ZERO_ADDRESS ? record.address : null;
      cache.set(key, { address: addr, at: Date.now() });
      return addr;
    }
  } catch {
    /* API unreachable — fall through to the SDK path. */
  }

  // 2. Direct RPC fallback via sdk-core. Same semantics — zero address
  //    means "no record".
  try {
    const rec = await getService().resolve(MAKALU_CHAIN_ID, key);
    const addr = rec.address && rec.address !== ZERO_ADDRESS ? rec.address : null;
    cache.set(key, { address: addr, at: Date.now() });
    return addr;
  } catch {
    cache.set(key, { address: null, at: Date.now() });
    return null;
  }
}

/** Reverse-resolve an EVM address → DNNS name (e.g. for the "you're sending
 *  to alice.litho" label in the Send modal). Returns null on miss. */
export async function reverseLookup(address: string): Promise<string | null> {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) return null;
  try {
    const { record } = await apiClient.lookupDnnsAddress(address.trim(), MAKALU_CHAIN_ID);
    return record?.name ?? null;
  } catch {
    return null;
  }
}
