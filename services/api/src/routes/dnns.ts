/**
 * DNNS resolver — Lithosphere's name service.
 *
 * Resolves human-readable names (alice.litho → 0x…) and the reverse
 * (0x… → name). Every lookup goes through the dnns_cache table:
 *
 *   1. Hit cache (name + chain). If the entry hasn't expired, return it.
 *   2. Miss: call the on-chain RPC method `dnns_resolve(name)` on the
 *      requested chain's RPC URL. The Lithic transport sends a standard
 *      JSON-RPC request — our DnnsRegistry contract responds with the
 *      record or an empty payload.
 *   3. Write the result back to cache with TTL (default 5 minutes for
 *      a positive hit, 30s for a "not found" so a freshly-registered
 *      name shows up soon).
 *
 * Endpoints:
 *   GET /dnns/resolve?name=alice.litho&chainId=700777
 *   GET /dnns/lookup?address=0x…&chainId=700777
 *
 * Public: no auth required. Anti-abuse is the general rate limiter
 * applied at app.use() level.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { log } from '../lib/log.js';

export const dnnsRouter = Router();

/* ─── Constants ──────────────────────────────────────────────────── */

const DEFAULT_CHAIN_ID = 700777;          // Makalu
const POSITIVE_TTL_SEC =
  Number(process.env.DNNS_POSITIVE_TTL_SEC || 300);  // 5 min
const NEGATIVE_TTL_SEC =
  Number(process.env.DNNS_NEGATIVE_TTL_SEC || 30);

/** Per-chain RPC URLs. Mirrors the indexer's chain config — we read
 *  the env if set, fall back to the public Lithosphere RPC. */
const CHAIN_RPC: Record<number, string> = {
  700777: process.env.LITHO_RPC_PRIMARY?.split(',')[0]?.trim()
       || 'https://rpc.litho.ai',
  900523: process.env.KAMET_RPC?.split(',')[0]?.trim()
       || 'https://rpc.kamet.litho.ai',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/* ─── Schemas ────────────────────────────────────────────────────── */

const ResolveSchema = z.object({
  name:    z.string().min(2).max(255),
  chainId: z.coerce.number().int().positive().optional(),
});
const LookupSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'address must be 0x… 40 hex chars'),
  chainId: z.coerce.number().int().positive().optional(),
});

/* ─── DTO ────────────────────────────────────────────────────────── */

interface DnnsRecord {
  name:    string;
  chainId: number;
  address: string | null;
  bech32?: string | null;
  resolver?: string | null;
  avatarUrl?: string | null;
  bio?:       string | null;
  cachedAt:   string;
  source:     'cache' | 'chain';
}

interface CacheRow {
  name:           string;
  chain_id:       string;
  address:        string;
  address_bech32: string | null;
  resolver:       string | null;
  avatar_url:     string | null;
  bio:            string | null;
  cached_at:      string;
  expires_at:     string;
}

/* ─── Chain call (JSON-RPC) ──────────────────────────────────────── */

async function callDnnsRpc(chainId: number, name: string): Promise<{
  address?: string;
  bech32?:  string;
  resolver?: string;
  avatarUrl?: string;
  bio?: string;
} | null> {
  const rpcUrl = CHAIN_RPC[chainId];
  if (!rpcUrl) return null;
  try {
    const res = await fetch(rpcUrl, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({
        jsonrpc: '2.0',
        id:      Date.now(),
        method:  'dnns_resolve',
        params:  [name],
      }),
      signal:  AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { result?: unknown; error?: { message?: string } };
    if (json.error) {
      log.debug({ chainId, name, err: json.error.message }, 'dnns_resolve rpc error');
      return null;
    }
    /* Two response shapes accepted: a bare address string OR a full
       record object. Both are valid against the current resolver. */
    if (typeof json.result === 'string') {
      return /^0x[a-fA-F0-9]{40}$/.test(json.result) ? { address: json.result } : null;
    }
    if (json.result && typeof json.result === 'object') {
      const r = json.result as Record<string, unknown>;
      return {
        address:   typeof r.address   === 'string' ? r.address   : undefined,
        bech32:    typeof r.bech32    === 'string' ? r.bech32    : undefined,
        resolver:  typeof r.resolver  === 'string' ? r.resolver  : undefined,
        avatarUrl: typeof r.avatarUrl === 'string' ? r.avatarUrl : undefined,
        bio:       typeof r.bio       === 'string' ? r.bio       : undefined,
      };
    }
    return null;
  } catch (e) {
    log.debug({ chainId, name, err: (e as Error).message }, 'dnns rpc fetch failed');
    return null;
  }
}

/* ─── Cache helpers ──────────────────────────────────────────────── */

async function readCache(chainId: number, name: string): Promise<DnnsRecord | null> {
  const row = await queryOne<CacheRow>(
    `select * from dnns_cache
       where chain_id = $1 and name = $2 and expires_at > now()`,
    [chainId, name.toLowerCase()],
  );
  if (!row) return null;
  return {
    name:      row.name,
    chainId:   Number(row.chain_id),
    address:   row.address === ZERO_ADDRESS ? null : row.address,
    bech32:    row.address_bech32,
    resolver:  row.resolver,
    avatarUrl: row.avatar_url,
    bio:       row.bio,
    cachedAt:  row.cached_at,
    source:    'cache',
  };
}

async function writeCache(args: {
  name: string; chainId: number; address: string | null;
  bech32?: string | null; resolver?: string | null;
  avatarUrl?: string | null; bio?: string | null;
}): Promise<void> {
  const ttl = args.address ? POSITIVE_TTL_SEC : NEGATIVE_TTL_SEC;
  await query(
    `insert into dnns_cache
       (name, chain_id, address, address_bech32, resolver, avatar_url, bio, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)
     on conflict (name, chain_id) do update
       set address        = excluded.address,
           address_bech32 = excluded.address_bech32,
           resolver       = excluded.resolver,
           avatar_url     = excluded.avatar_url,
           bio            = excluded.bio,
           cached_at      = now(),
           expires_at     = excluded.expires_at`,
    [
      args.name.toLowerCase(),
      args.chainId,
      args.address ?? ZERO_ADDRESS,
      args.bech32 ?? null,
      args.resolver ?? null,
      args.avatarUrl ?? null,
      args.bio ?? null,
      String(ttl),
    ],
  );
}

/* ─── GET /dnns/resolve ─────────────────────────────────────────── */

dnnsRouter.get('/resolve', async (req, res: Response) => {
  const parse = ResolveSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const name = parse.data.name.trim().toLowerCase();
  const chainId = parse.data.chainId ?? DEFAULT_CHAIN_ID;

  const cached = await readCache(chainId, name);
  if (cached) { res.json({ record: cached }); return; }

  const chain = await callDnnsRpc(chainId, name);
  const addr = chain?.address && /^0x[a-fA-F0-9]{40}$/.test(chain.address) ? chain.address : null;
  await writeCache({
    name,
    chainId,
    address:   addr,
    bech32:    chain?.bech32,
    resolver:  chain?.resolver,
    avatarUrl: chain?.avatarUrl,
    bio:       chain?.bio,
  });
  res.json({
    record: {
      name,
      chainId,
      address:   addr,
      bech32:    chain?.bech32 ?? null,
      resolver:  chain?.resolver ?? null,
      avatarUrl: chain?.avatarUrl ?? null,
      bio:       chain?.bio ?? null,
      cachedAt:  new Date().toISOString(),
      source:    'chain' as const,
    } satisfies DnnsRecord,
  });
});

/* ─── GET /dnns/lookup ──────────────────────────────────────────── */

dnnsRouter.get('/lookup', async (req, res: Response) => {
  const parse = LookupSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const address = parse.data.address.toLowerCase();
  const chainId = parse.data.chainId ?? DEFAULT_CHAIN_ID;

  // Reverse lookup uses the same cache table — first match by address.
  // If absent we'd need a reverse RPC call (`dnns_lookup`), but that
  // method isn't standardised yet; return null and let the wallet UI
  // skip the badge until the cache fills naturally.
  const row = await queryOne<CacheRow>(
    `select * from dnns_cache
       where chain_id = $1 and lower(address) = $2 and expires_at > now()
       order by cached_at desc
       limit 1`,
    [chainId, address],
  );
  if (!row) { res.json({ record: null }); return; }
  res.json({
    record: {
      name:      row.name,
      chainId:   Number(row.chain_id),
      address:   row.address,
      bech32:    row.address_bech32,
      resolver:  row.resolver,
      avatarUrl: row.avatar_url,
      bio:       row.bio,
      cachedAt:  row.cached_at,
      source:    'cache' as const,
    } satisfies DnnsRecord,
  });
});
