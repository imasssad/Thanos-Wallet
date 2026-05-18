/**
 * DNNS resolver — Lithosphere's decentralised name service.
 *
 * Resolves human-readable names (alice.litho → 0x…) and the reverse
 * (0x… → name). DNNS is an ENS-style name service whose contracts live
 * on the Kamet chain (900523); see services/api/src/lib/dnns-chain.ts
 * for the on-chain resolution itself.
 *
 * Every lookup goes through the dnns_cache table:
 *
 *   1. Hit cache (name + chain). If the entry hasn't expired, return it.
 *   2. Miss: resolve on-chain through the DNNS Registry + Resolver
 *      contracts on Kamet (with RPC failover).
 *   3. Write the result back to cache with TTL (default 5 minutes for
 *      a positive hit, 30s for a "not found" so a freshly-registered
 *      name shows up soon).
 *
 * Endpoints:
 *   GET /dnns/resolve?name=alice.litho
 *   GET /dnns/lookup?address=0x…
 *
 * The optional `chainId` query param is accepted for API
 * back-compatibility but does not change resolution — DNNS records
 * always live on Kamet.
 *
 * Public: no auth required. Anti-abuse is the general rate limiter
 * applied at app.use() level.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { log } from '../lib/log.js';
import { DNNS_CHAIN_ID, resolveName, reverseResolve } from '../lib/dnns-chain.js';

export const dnnsRouter = Router();

/* ─── Constants ──────────────────────────────────────────────────── */

const POSITIVE_TTL_SEC =
  Number(process.env.DNNS_POSITIVE_TTL_SEC || 300);  // 5 min
const NEGATIVE_TTL_SEC =
  Number(process.env.DNNS_NEGATIVE_TTL_SEC || 30);

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

/* ─── Async error guard ──────────────────────────────────────────── */

/** Wrap an async handler so a rejection — most importantly the DB or an
 *  RPC endpoint being unreachable — becomes a 503 response instead of an
 *  unhandled promise rejection that crashes the whole api process. */
function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    handler(req, res).catch((err: unknown) => {
      log.error(
        { err: (err as Error)?.message, route: req.originalUrl },
        'dnns route failed',
      );
      if (!res.headersSent) {
        res.status(503).json({ error: 'DNNS resolver temporarily unavailable' });
      }
    });
  };
}

/* ─── GET /dnns/resolve ─────────────────────────────────────────── */

dnnsRouter.get('/resolve', wrap(async (req, res: Response) => {
  const parse = ResolveSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const name = parse.data.name.trim().toLowerCase();

  const cached = await readCache(DNNS_CHAIN_ID, name);
  if (cached) { res.json({ record: cached }); return; }

  // Cache miss — resolve through the DNNS contracts on Kamet. A
  // transport failure throws; treat it as a (negatively-cached)
  // not-found so a flapping RPC doesn't 500 the wallet UI.
  const chain = await resolveName(name).catch(err => {
    log.warn({ name, err: (err as Error).message }, 'dnns on-chain resolve failed');
    return null;
  });

  await writeCache({
    name,
    chainId:   DNNS_CHAIN_ID,
    address:   chain?.address ?? null,
    resolver:  chain?.resolver,
    avatarUrl: chain?.avatarUrl,
    bio:       chain?.bio,
  });
  res.json({
    record: {
      name,
      chainId:   DNNS_CHAIN_ID,
      address:   chain?.address ?? null,
      bech32:    null,
      resolver:  chain?.resolver ?? null,
      avatarUrl: chain?.avatarUrl ?? null,
      bio:       chain?.bio ?? null,
      cachedAt:  new Date().toISOString(),
      source:    'chain' as const,
    } satisfies DnnsRecord,
  });
}));

/* ─── GET /dnns/lookup ──────────────────────────────────────────── */

dnnsRouter.get('/lookup', wrap(async (req, res: Response) => {
  const parse = LookupSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }
  const address = parse.data.address.toLowerCase();

  // Reverse lookup is keyed on address in the same cache table.
  const cachedRow = await queryOne<CacheRow>(
    `select * from dnns_cache
       where chain_id = $1 and lower(address) = $2 and expires_at > now()
       order by cached_at desc
       limit 1`,
    [DNNS_CHAIN_ID, address],
  );
  if (cachedRow) {
    res.json({
      record: {
        name:      cachedRow.name,
        chainId:   Number(cachedRow.chain_id),
        address:   cachedRow.address,
        bech32:    cachedRow.address_bech32,
        resolver:  cachedRow.resolver,
        avatarUrl: cachedRow.avatar_url,
        bio:       cachedRow.bio,
        cachedAt:  cachedRow.cached_at,
        source:    'cache' as const,
      } satisfies DnnsRecord,
    });
    return;
  }

  // Cache miss — reverse-resolve on-chain (forward-verified inside
  // reverseResolve). A transport failure throws; surface it as a plain
  // "no name" rather than a 500.
  const name = await reverseResolve(address).catch(err => {
    log.warn({ address, err: (err as Error).message }, 'dnns on-chain reverse lookup failed');
    return null;
  });
  if (!name) { res.json({ record: null }); return; }

  // Fetch the full forward record so the cache row carries the
  // resolver / avatar / bio, then return it.
  const forward = await resolveName(name).catch(() => null);
  await writeCache({
    name,
    chainId:   DNNS_CHAIN_ID,
    address:   forward?.address ?? address,
    resolver:  forward?.resolver,
    avatarUrl: forward?.avatarUrl,
    bio:       forward?.bio,
  });
  res.json({
    record: {
      name,
      chainId:   DNNS_CHAIN_ID,
      address:   forward?.address ?? address,
      bech32:    null,
      resolver:  forward?.resolver ?? null,
      avatarUrl: forward?.avatarUrl ?? null,
      bio:       forward?.bio ?? null,
      cachedAt:  new Date().toISOString(),
      source:    'chain' as const,
    } satisfies DnnsRecord,
  });
}));
