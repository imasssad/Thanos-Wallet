/**
 * DNNS resolver — Lithosphere's name service.
 *
 * Resolves a human-readable name (e.g. "sora.litho") to an EVM address.
 *
 * Today this is a thin wrapper around sdk-core's DnnsService whose
 * on-chain resolution is still stubbed. The wallet UI calls into this
 * module so that swapping in the real resolver later is a one-file change.
 *
 * Lookup rules:
 *   - Inputs that already look like an address (0x… / litho1…) skip the
 *     resolver entirely.
 *   - A name with at least one dot is treated as a candidate name.
 *   - Resolution is cached for 5 minutes in memory so the user can switch
 *     between modals without re-resolving every keystroke.
 */
import { DnnsService } from '@thanos/sdk-core';
import { MAKALU_CHAIN_ID } from './rpc';

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

/** Resolve a DNNS name → checksummed EVM address, or null if unknown. */
export async function resolveName(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.address;

  try {
    const rec = await getService().resolve(MAKALU_CHAIN_ID, key);
    const addr = rec.address && rec.address !== '0x0000000000000000000000000000000000000000'
      ? rec.address
      : null;
    cache.set(key, { address: addr, at: Date.now() });
    return addr;
  } catch {
    cache.set(key, { address: null, at: Date.now() });
    return null;
  }
}
