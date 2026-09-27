/**
 * POST /push/notify — the internal, secret-gated fan-out endpoint.
 *
 * Same harness as auth.test.ts: the real Express app via supertest with the
 * Postgres + Redis layers mocked out.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

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
  query:    (...args: unknown[]) => dbQuery(...args),
  queryOne: (...args: unknown[]) => dbQueryOne(...args),
  checkDbConnection: () => Promise.resolve(true),
  db: { query: dbQuery },
}));

vi.mock('../lib/redis.js', () => ({
  checkRedisConnection: () => Promise.resolve(true),
  redis: { get: vi.fn(), set: vi.fn() },
}));

import request from 'supertest';
import { createApp } from '../app.js';

const SECRET = 'internal_push_secret_for_tests_0123456789';
const payload = { address: '0x1111111111111111111111111111111111111111', title: 'Received', body: '1 LITHO' };

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
  process.env.PUSH_INTERNAL_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.PUSH_INTERNAL_SECRET;
});

describe('POST /push/notify', () => {
  it('is disabled (503) when no internal secret is configured', async () => {
    delete process.env.PUSH_INTERNAL_SECRET;
    const res = await request(app).post('/push/notify').set('x-internal-secret', SECRET).send(payload);
    expect(res.status).toBe(503);
  });

  it('rejects a missing secret with 403', async () => {
    const res = await request(app).post('/push/notify').send(payload);
    expect(res.status).toBe(403);
  });

  it('rejects a wrong secret of the same length with 403', async () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith('9') ? '8' : '9');
    const res = await request(app).post('/push/notify').set('x-internal-secret', wrong).send(payload);
    expect(res.status).toBe(403);
  });

  it('rejects a wrong secret of a different length with 403', async () => {
    const res = await request(app).post('/push/notify').set('x-internal-secret', SECRET + 'x').send(payload);
    expect(res.status).toBe(403);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('fans out with the correct secret', async () => {
    dbQuery.mockResolvedValueOnce([]); // tokensForAddress — no devices registered
    const res = await request(app).post('/push/notify').set('x-internal-secret', SECRET).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, delivered: 0 });
  });
});
