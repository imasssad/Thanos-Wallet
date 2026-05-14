/**
 * Contacts CRUD integration tests.
 *
 * Same pattern as auth.test.ts — supertest against the real Express
 * app with the pg layer mocked at the lib/db.js seam. The test mints
 * a real JWT via signAccessToken so the requireAuth middleware path
 * is exercised end-to-end.
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
import { signAccessToken } from '../lib/jwt.js';

let app: ReturnType<typeof createApp>;
let token: string;

beforeAll(async () => {
  app = createApp();
  token = await signAccessToken({
    sub:       'user-c',
    sessionId: 'sess-c',
    deviceId:  'dev-c',
  });
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
});

const auth = () => `Bearer ${token}`;

/* Helper — shape of a row the DB returns so the projector hits all fields. */
function mockRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id:            'c-1',
    user_id:       'user-c',
    name:          'Alice',
    address:       '0xAbC0000000000000000000000000000000000001',
    address_type:  'evm',
    chain_id:      '700777',
    notes:         null,
    is_favourite:  false,
    created_at:    '2026-05-01T00:00:00Z',
    updated_at:    '2026-05-01T00:00:00Z',
    ...over,
  };
}

/* ─── GET /contacts ──────────────────────────────────────────────── */

describe('GET /contacts', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/contacts');
    expect(res.status).toBe(401);
  });

  it('returns contacts for the authed user', async () => {
    dbQuery.mockResolvedValueOnce([mockRow(), mockRow({ id: 'c-2', name: 'Bob' })]);
    const res = await request(app).get('/contacts').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      id: 'c-1', name: 'Alice', addressType: 'evm', chainId: 700777,
    });
    // The SQL parameter must be the userId from the JWT.
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('from contacts'), ['user-c']);
  });

  it('returns an empty list when the user has no contacts', async () => {
    dbQuery.mockResolvedValueOnce([]);
    const res = await request(app).get('/contacts').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

/* ─── POST /contacts ─────────────────────────────────────────────── */

describe('POST /contacts', () => {
  it('rejects a missing name with 400', async () => {
    const res = await request(app)
      .post('/contacts')
      .set('Authorization', auth())
      .send({ address: '0xabc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects an empty body with 400', async () => {
    const res = await request(app)
      .post('/contacts')
      .set('Authorization', auth())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 when (user_id, address) already exists', async () => {
    dbQueryOne.mockResolvedValueOnce(mockRow());     // duplicate-check returns a row
    const res = await request(app)
      .post('/contacts')
      .set('Authorization', auth())
      .send({ name: 'Alice', address: '0xAbC0000000000000000000000000000000000001' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(res.body.item.id).toBe('c-1');
  });

  it('creates a new contact and returns 201', async () => {
    dbQueryOne.mockResolvedValueOnce(null);          // duplicate check — none
    dbQueryOne.mockResolvedValueOnce(mockRow({ id: 'c-99', name: 'Carol' })); // insert returning
    const res = await request(app)
      .post('/contacts')
      .set('Authorization', auth())
      .send({
        name: 'Carol',
        address: '0xCAR000000000000000000000000000000000FEED',
        addressType: 'evm',
        chainId: 700777,
        notes: 'pays gas in litho',
        isFavourite: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      id: 'c-99', name: 'Carol', addressType: 'evm', chainId: 700777,
    });
    // INSERT was called with the userId from the JWT.
    expect(dbQueryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('insert into contacts'),
      expect.arrayContaining(['user-c', 'Carol']),
    );
  });
});

/* ─── PUT /contacts/:id ──────────────────────────────────────────── */

describe('PUT /contacts/:id', () => {
  it('rejects an empty patch with 400', async () => {
    const res = await request(app)
      .put('/contacts/c-1')
      .set('Authorization', auth())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when the contact does not exist (or belongs to another user)', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .put('/contacts/c-missing')
      .set('Authorization', auth())
      .send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });

  it('updates and returns the new contact on success', async () => {
    dbQueryOne.mockResolvedValueOnce(mockRow({ name: 'Renamed', is_favourite: true }));
    const res = await request(app)
      .put('/contacts/c-1')
      .set('Authorization', auth())
      .send({ name: 'Renamed', isFavourite: true });
    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Renamed');
    expect(res.body.item.isFavourite).toBe(true);
    // WHERE clause includes both user_id and id, in that order.
    const [, values] = dbQueryOne.mock.calls.at(-1)!;
    expect(values).toEqual(expect.arrayContaining(['user-c', 'c-1']));
  });
});

/* ─── DELETE /contacts/:id ───────────────────────────────────────── */

describe('DELETE /contacts/:id', () => {
  it('returns 204 when the row was deleted', async () => {
    dbQuery.mockResolvedValueOnce([{ id: 'c-1' }]);
    const res = await request(app)
      .delete('/contacts/c-1')
      .set('Authorization', auth());
    expect(res.status).toBe(204);
  });

  it('returns 404 when the row was not found / not owned', async () => {
    dbQuery.mockResolvedValueOnce([]);
    const res = await request(app)
      .delete('/contacts/c-other-user')
      .set('Authorization', auth());
    expect(res.status).toBe(404);
  });
});
