/**
 * DNNS resolver integration tests.
 *
 * Covers the three branches in services/api/src/routes/dnns.ts:
 *   1. Cache hit  → DB row returned with `source: 'cache'`, no RPC call.
 *   2. Cache miss → JSON-RPC call against the chain's RPC URL, result
 *                   written back to dnns_cache, returned with
 *                   `source: 'chain'`.
 *   3. RPC fail   → cache writeback with the zero address (negative
 *                   TTL), `record.address === null`.
 *
 * Plus the reverse lookup which is cache-only today.
 *
 * Fetch is mocked at the global level so the upstream RPC POST never
 * leaves the test process.
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

import request from 'supertest';
import { createApp } from '../app.js';

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
  vi.unstubAllGlobals();
});

const ALICE      = '0x1234567890123456789012345678901234567890';
const ZERO       = '0x0000000000000000000000000000000000000000';

function cachedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    name:            'alice.litho',
    chain_id:        '700777',
    address:         ALICE,
    address_bech32:  'litho1alice',
    resolver:        'thanos-default-resolver',
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

  it('returns a cache hit without calling the RPC', async () => {
    dbQueryOne.mockResolvedValueOnce(cachedRow());
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const res = await request(app).get('/dnns/resolve?name=alice.litho');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:    'alice.litho',
      address: ALICE,
      chainId: 700777,
      source:  'cache',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats the zero address in cache as a "not found"', async () => {
    dbQueryOne.mockResolvedValueOnce(cachedRow({ address: ZERO, address_bech32: null }));
    vi.stubGlobal('fetch', vi.fn());
    const res = await request(app).get('/dnns/resolve?name=missing.litho');
    expect(res.status).toBe(200);
    expect(res.body.record.address).toBeNull();
    expect(res.body.record.source).toBe('cache');
  });

  it('falls back to the RPC on a cache miss, then writes back the result', async () => {
    dbQueryOne.mockResolvedValueOnce(null);              // cache miss
    dbQuery.mockResolvedValueOnce([]);                   // writeback insert
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: ALICE }),
    }));

    const res = await request(app).get('/dnns/resolve?name=fresh.litho');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      name:    'fresh.litho',
      address: ALICE,
      source:  'chain',
    });
    // Writeback INSERT happened — first parameter is name, second is chainId.
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into dnns_cache'),
      expect.arrayContaining(['fresh.litho', 700777, ALICE]),
    );
  });

  it('accepts an object-shaped RPC response (full record)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    dbQuery.mockResolvedValueOnce([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0', id: 1,
        result: {
          address:  ALICE,
          bech32:   'litho1full',
          resolver: 'custom-resolver',
          avatarUrl: 'https://example/avatar.png',
          bio:      'Hi from Lithosphere',
        },
      }),
    }));

    const res = await request(app).get('/dnns/resolve?name=full.litho');
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      address:   ALICE,
      bech32:    'litho1full',
      resolver:  'custom-resolver',
      avatarUrl: 'https://example/avatar.png',
      bio:       'Hi from Lithosphere',
      source:    'chain',
    });
  });

  it('returns address: null on an RPC fail (and writes a negative cache row)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);     // cache miss
    dbQuery.mockResolvedValueOnce([]);          // writeback still happens
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { message: 'name not registered' } }),
    }));

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

  it('rejects junk-shaped RPC responses (string but not an address)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    dbQuery.mockResolvedValueOnce([]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: 'definitely-not-an-address' }),
    }));

    const res = await request(app).get('/dnns/resolve?name=junk.litho');
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

  it('returns null when no cache row matches', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app).get(`/dnns/lookup?address=${ALICE}`);
    expect(res.status).toBe(200);
    expect(res.body.record).toBeNull();
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
  });
});
