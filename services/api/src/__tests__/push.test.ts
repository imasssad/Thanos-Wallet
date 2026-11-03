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
import { Wallet } from 'ethers';
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

describe('push registration proof of ownership (THN-R1 M-01)', () => {
  const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const address = wallet.address;
  const EXPO_TOKEN = 'ExponentPushToken[abc123DEF456]';

  async function nonceAndSignature(forAddress = address) {
    const r = await request(app).get('/push/nonce').query({ address: forAddress });
    expect(r.status).toBe(200);
    const signature = await wallet.signMessage(r.body.message);
    return { nonceToken: r.body.nonceToken, signature };
  }

  it('issues a nonce for a well-formed address and rejects a malformed one', async () => {
    const ok = await request(app).get('/push/nonce').query({ address });
    expect(ok.status).toBe(200);
    expect(ok.body.nonceToken).toEqual(expect.any(String));
    expect(ok.body.message).toContain(address.toLowerCase());
    const bad = await request(app).get('/push/nonce').query({ address: 'not-an-address' });
    expect(bad.status).toBe(400);
  });

  it('registers a token when the signature proves ownership of the address', async () => {
    const { nonceToken, signature } = await nonceAndSignature();
    dbQuery.mockResolvedValueOnce([]); // insert into push_tokens
    const res = await request(app).post('/push/register').send({ token: EXPO_TOKEN, address, nonceToken, signature });
    expect(res.status).toBe(201);
    expect(dbQuery).toHaveBeenCalled();
  });

  it('refuses to register when the signature is for a DIFFERENT address than claimed', async () => {
    const other = '0x2222222222222222222222222222222222222222';
    // Sign a nonce that was issued for `other`, but claim `address` in the request body.
    const { nonceToken, signature } = await nonceAndSignature(other);
    const res = await request(app).post('/push/register').send({ token: EXPO_TOKEN, address, nonceToken, signature });
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('refuses a tampered nonce token', async () => {
    const { nonceToken, signature } = await nonceAndSignature();
    const tampered = nonceToken.slice(0, -2) + (nonceToken.endsWith('0') ? '1' : '0') + nonceToken.slice(-1);
    const res = await request(app).post('/push/register').send({ token: EXPO_TOKEN, address, nonceToken: tampered, signature });
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('refuses a signature from a different wallet entirely', async () => {
    const { nonceToken } = await nonceAndSignature();
    const impostor = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
    const r = await request(app).get('/push/nonce').query({ address });
    const badSignature = await impostor.signMessage(r.body.message);
    const res = await request(app).post('/push/register').send({ token: EXPO_TOKEN, address, nonceToken, signature: badSignature });
    expect(res.status).toBe(401);
  });

  it('unregisters only a token actually owned by the proven address', async () => {
    const { nonceToken, signature } = await nonceAndSignature();
    dbQuery.mockResolvedValueOnce([{ token: EXPO_TOKEN }]); // delete ... returning token — owned
    const ok = await request(app).post('/push/unregister').send({ token: EXPO_TOKEN, address, nonceToken, signature });
    expect(ok.status).toBe(200);

    const { nonceToken: n2, signature: s2 } = await nonceAndSignature();
    dbQuery.mockResolvedValueOnce([]); // delete ... returning token — no row (not owned / wrong token)
    const notOwned = await request(app).post('/push/unregister').send({ token: 'ExponentPushToken[notmine]', address, nonceToken: n2, signature: s2 });
    expect(notOwned.status).toBe(404);
  });

  it('rejects register/unregister with no proof at all', async () => {
    const res = await request(app).post('/push/register').send({ token: EXPO_TOKEN, address });
    expect(res.status).toBe(400); // schema requires nonceToken + signature
    expect(dbQuery).not.toHaveBeenCalled();
  });
});
