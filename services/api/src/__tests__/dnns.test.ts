/**
 * DNNS resolver integration tests.
 *
 * Covers the branches in services/api/src/routes/dnns.ts:
 *   1. Cache hit  → DB row returned with `source: 'cache'`, no chain call.
 *   2. Cache miss → on-chain resolution via the DNNS contracts, result
 *                   written back to dnns_cache, returned with
 *                   `source: 'chain'`.
 *   3. Not found  → cache writeback with the zero address (negative
 *                   TTL), `record.address === null`.
 *
 * Plus reverse lookup: cache hit, cache-miss → on-chain reverse
 * resolution, and the no-record case.
 *
 * The on-chain layer (services/api/src/lib/dnns-chain.ts) is mocked so
 * tests never open an RPC socket — the ENS contract calls themselves
 * are exercised by that module's own concerns, not here.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET   = process.env.JWT_SECRET   ?? 'test_jwt_secret_at_least_32_chars_long_x';
  process.env.NODE_ENV     = 'test';
  process.env.REDIS_URL    = process.env.REDIS_URL    ?? 'redis://localhost:6379';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
});

const { dbQuery, dbQueryOne } = vi.hoisted(() => ({
  dbQuery:    vi.fn() as ReturnType<typeof vi.fn>,
  dbQueryOne: vi.fn() as ReturnType<typeof vi.fn>,
}));

const { resolveName, reverseResolve } = vi.hoisted(() => ({
  resolveName:    vi.fn() as ReturnType<typeof vi.fn>,
  reverseResolve: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock('../lib/db.js', () => ({
  query:             (...args: unknown[]) => dbQuery(...args),
  queryOne:          (...args: unknown[]) => dbQueryOne(...args),
  checkDbConnection: () => Promise.resolve(true),
  db: { query: dbQuery },
}));
vi.mock('../lib/redis.js', () => ({
  checkRedisConnection: () => Promise.resolve(true),
  redis: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('../lib/dnns-chain.js', () => ({
  DNNS_CHAIN_ID:  900523,
  resolveName:    (...args: unknown[]) => resolveName(...args),
  reverseResolve: (...args: unknown[]) => reverseResolve(...args),
}));

import request from 'supertest';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
  resolveName.mockReset();
  reverseResolve.mockReset();
});

const ALICE = '0x1234567890123456789012345678901234567890';
const ZERO  = '0x0000000000000000000000000000000000000000';

/** DNNS lives on Kamet — chain 900523. */
const DNNS_CHAIN = 900523;

function cachedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    name:            'alice.litho',
    chain_id:        String(DNNS_CHAIN),
    address:         ALICE,
    address_bech32:  null,
    resolver:        '0x9999999999999999999999999999999999999999',
    avatar_url:      null,
    bio:             null,
    cached_at:       '2026-05-01T00:00:00Z',
    expires_at:      '2099-01-01T00:00:00Z',
    ...over,
  };
}

/* ─── GET /dnns/resolve ──────────────────────────────────────────── */

describe('GET /dnns/resolve', () => {
  it('rejects a missing name with 400', async () => {
    const res = await request(app).get('/dnns/resolve');
    expect(res.status).toBe(400);
  });

  it('returns a cache hit without touching the chain', async () => {
    dbQueryOne.mockResolvedValueOnce(cachedRow());

    const res = await request(app).get('/dnns/resolve?name=alice.litho');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:    'alice.litho',
      address: ALICE,
      chainId: DNNS_CHAIN,
      source:  'cache',
    });
    expect(resolveName).not.toHaveBeenCalled();
  });

  it('treats the zero address in cache as a "not found"', async () => {
    dbQueryOne.mockResolvedValueOnce(cachedRow({ address: ZERO }));
    const res = await request(app).get('/dnns/resolve?name=missing.litho');
    expect(res.status).toBe(200);
    expect(res.body.record.address).toBeNull();
    expect(res.body.record.source).toBe('cache');
  });

  it('resolves on-chain on a cache miss, then writes back the result', async () => {
    dbQueryOne.mockResolvedValueOnce(null);              // cache miss
    dbQuery.mockResolvedValueOnce([]);                   // writeback insert
    resolveName.mockResolvedValueOnce({
      address:   ALICE,
      resolver:  '0xResolver',
      avatarUrl: 'https://example/avatar.png',
      bio:       'Hi from Lithosphere',
    });

    const res = await request(app).get('/dnns/resolve?name=fresh.litho');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:      'fresh.litho',
      address:   ALICE,
      avatarUrl: 'https://example/avatar.png',
      bio:       'Hi from Lithosphere',
      source:    'chain',
    });
    expect(resolveName).toHaveBeenCalledWith('fresh.litho');
    // Writeback INSERT happened — keyed on the Kamet DNNS chain.
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into dnns_cache'),
      expect.arrayContaining(['fresh.litho', DNNS_CHAIN, ALICE]),
    );
  });

  it('returns address: null when the name is unregistered (negative cache)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);     // cache miss
    dbQuery.mockResolvedValueOnce([]);          // writeback still happens
    resolveName.mockResolvedValueOnce({ address: null, resolver: null, avatarUrl: null, bio: null });

    const res = await request(app).get('/dnns/resolve?name=nobody.litho');
    expect(res.status).toBe(200);
    expect(res.body.record.address).toBeNull();
    expect(res.body.record.source).toBe('chain');
    // Negative cache stores the zero address sentinel.
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into dnns_cache'),
      expect.arrayContaining([ZERO]),
    );
  });

  it('returns address: null when the on-chain call throws (RPC down)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    dbQuery.mockResolvedValueOnce([]);
    resolveName.mockRejectedValueOnce(new Error('all endpoints failed'));

    const res = await request(app).get('/dnns/resolve?name=flaky.litho');
    expect(res.status).toBe(200);
    expect(res.body.record.address).toBeNull();
  });
});

/* ─── GET /dnns/lookup ───────────────────────────────────────────── */

describe('GET /dnns/lookup', () => {
  it('rejects a non-0x address with 400', async () => {
    const res = await request(app).get('/dnns/lookup?address=cosmos1xxx');
    expect(res.status).toBe(400);
  });

  it('returns the cached record on a hit', async () => {
    dbQueryOne.mockResolvedValueOnce(cachedRow());
    const res = await request(app).get(`/dnns/lookup?address=${ALICE}`);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:    'alice.litho',
      address: ALICE,
      source:  'cache',
    });
    expect(reverseResolve).not.toHaveBeenCalled();
  });

  it('returns null when no cache row matches and the chain has no name', async () => {
    dbQueryOne.mockResolvedValueOnce(null);   // cache miss
    reverseResolve.mockResolvedValueOnce(null);
    const res = await request(app).get(`/dnns/lookup?address=${ALICE}`);
    expect(res.status).toBe(200);
    expect(res.body.record).toBeNull();
  });

  it('reverse-resolves on-chain on a cache miss, then writes back', async () => {
    dbQueryOne.mockResolvedValueOnce(null);   // cache miss
    dbQuery.mockResolvedValueOnce([]);        // writeback insert
    reverseResolve.mockResolvedValueOnce('alice.litho');
    resolveName.mockResolvedValueOnce({
      address: ALICE, resolver: '0xResolver', avatarUrl: null, bio: null,
    });

    const res = await request(app).get(`/dnns/lookup?address=${ALICE}`);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:    'alice.litho',
      address: ALICE,
      source:  'chain',
    });
    expect(reverseResolve).toHaveBeenCalledWith(ALICE.toLowerCase());
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into dnns_cache'),
      expect.arrayContaining(['alice.litho', DNNS_CHAIN, ALICE]),
    );
  });
});
