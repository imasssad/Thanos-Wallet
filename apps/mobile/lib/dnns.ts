/**
 * DNNS — Lithosphere's ENS-compatible name service (mobile).
 *
 * A detached, dependency-light mirror of apps/web's DNNS flow, kept local
 * because EAS Cloud builds can't resolve workspace packages (same policy as
 * lib/pricing.ts, lib/indexer.ts, …).
 *
 *   • Availability / resolution → the API's GET /dnns/resolve (cached +
 *     forward-verified server-side; same endpoint lib/address.ts already
 *     uses for Send recipients).
 *   • Registration → the chain RPC's custom `lithic_callContract` method,
 *     exactly as the web's DnnsService.register() does. The Makalu node
 *     submits register(name, owner, years) on the Kamet registry; there is
 *     no API endpoint for this. Failure throws (no fabricated tx hash) so
 *     the UI can surface it honestly.
 */
import { getAddress } from 'ethers';

const API_BASE = String(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_API_URL) ||
    'https://thanos.fi/api',
).replace(/\/$/, '');

// Registration is submitted via the Makalu RPC (chain 700777), matching the
// web (svc.register uses MAKALU_TESTNET.chainId). The node bridges to the
// Kamet registry internally.
const MAKALU_CHAIN_ID = 700777;
const MAKALU_RPCS = ['https://rpc.litho.ai', 'https://rpc-2.litho.ai'];

const NAME_RE = /^[a-z0-9-]+\.litho$/;

/** True when the input is a syntactically valid `name.litho`. */
export function looksLikeDnnsName(input: string): boolean {
  return NAME_RE.test((input || '').trim().toLowerCase());
}

export type Availability =
  | { status: 'available' }
  | { status: 'taken'; address: string }
  | { status: 'error' };

/**
 * Resolve a `name.litho` for the availability check. A registered name
 * returns its owner address ("taken"); an unregistered/zero name is
 * "available". Network/parse failure is "error" so the UI can distinguish
 * "couldn't check" from "free".
 */
export async function checkDnnsAvailability(name: string): Promise<Availability> {
  const key = (name || '').trim().toLowerCase();
  if (!NAME_RE.test(key)) return { status: 'error' };
  try {
    const res = await fetch(
      `${API_BASE}/dnns/resolve?name=${encodeURIComponent(key)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return { status: 'error' };
    const json = (await res.json()) as { record?: { address?: string | null } };
    const addr = json.record?.address;
    if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return { status: 'taken', address: getAddress(addr) };
    }
    return { status: 'available' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Reverse-resolve an address → its primary `name.litho`, via the API's
 * forward-verified GET /dnns/lookup. Returns null on miss / error so the
 * "you currently own X" hint just stays hidden.
 */
export async function reverseLookupDnns(address: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test((address || '').trim())) return null;
  try {
    const res = await fetch(
      `${API_BASE}/dnns/lookup?address=${encodeURIComponent(address.trim())}`,
      { headers: { accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { record?: { name?: string | null } };
    return json.record?.name || null;
  } catch {
    return null;
  }
}

/**
 * Register `name.litho` to `owner` for `years`. Mirrors the web's
 * DnnsService.register(): a `lithic_callContract` JSON-RPC call to the
 * Makalu node. Returns the submitted tx hash. Throws on RPC error or a
 * malformed hash — never fabricates success.
 */
export async function registerDnnsName(args: {
  name: string;
  owner: string;
  years: number;
}): Promise<string> {
  const name = args.name.trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error('Name must look like "alice.litho" (a-z, 0-9, hyphens).');
  const owner = getAddress(args.owner); // throws on a bad address
  const years = Math.floor(args.years);
  if (!Number.isFinite(years) || years < 1 || years > 10) throw new Error('Years must be between 1 and 10.');

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'lithic_callContract',
    params: [{ chainId: MAKALU_CHAIN_ID, contract: 'dnns-registry', method: 'register', args: [name, owner, years] }],
  });

  let lastErr: unknown = null;
  for (const url of MAKALU_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      });
      if (!res.ok) { lastErr = new Error(`RPC ${res.status}`); continue; }
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) { lastErr = new Error(json.error.message || 'Registration failed'); continue; }
      const txHash = json.result;
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        lastErr = new Error('Registry returned an invalid transaction hash.');
        continue;
      }
      return txHash;
    } catch (e) {
      lastErr = e; // try the next RPC
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error('Could not reach the Lithosphere RPC.'));
}
