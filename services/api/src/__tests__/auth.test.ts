/**
 * Auth route integration tests.
 *
 * These run the real Express app via supertest with the Postgres layer
 * mocked out. The point is to validate the route + middleware behaviour —
 * status codes, schemas, token issuance, brute-force gating — not the SQL
 * itself. Schema correctness is its own concern.
 *
 * To extend coverage to real SQL paths later, swap the vi.mock for pg-mem.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// ─── Env required by lib/db.ts + lib/jwt.ts on import ─────────────────────
// jwt.ts evaluates JWT_SECRET at module load. Static ES imports (below) are
// hoisted, so this env setup must hoist too — vi.hoisted runs first.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET   = process.env.JWT_SECRET   ?? 'test_jwt_secret_at_least_32_chars_long_x';
  process.env.NODE_ENV     = 'test';
  process.env.REDIS_URL    = process.env.REDIS_URL    ?? 'redis://localhost:6379';
  process.env.CORS_ORIGINS = 'http://localhost:3000';
});

// ─── Mock pg + ioredis BEFORE importing the app ───────────────────────────
// Each test sets up the query responses it needs via dbQuery.mockResolvedValueOnce.
// Use vi.hoisted so the mocks are initialised before vi.mock() runs them.
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

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Set up the dbQuery sequence for a successful POST /auth/register call. */
function mockRegisterDbCalls(userId = 'user-1', deviceId = 'dev-1', sessionId = 'sess-1') {
  // 1) check existing user (queryOne) -> null
  dbQueryOne.mockResolvedValueOnce(null);
  // 2) insert user RETURNING id (query)
  dbQuery.mockResolvedValueOnce([{ id: userId }]);
  // 3) insert device RETURNING id (query)
  dbQuery.mockResolvedValueOnce([{ id: deviceId }]);
  // 4) insert session (query) — no return value used
  dbQuery.mockResolvedValueOnce([]);
  // 5) SELECT session id (query)
  dbQuery.mockResolvedValueOnce([{ id: sessionId }]);
  // 6) auth_events insert (query) — fire-and-forget
  dbQuery.mockResolvedValueOnce([]);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('rejects an invalid email with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'longenough' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects a short password with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'a@b.co', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 409 when the email already exists', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'existing-user' });
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'taken@example.com', password: 'longenoughpassword' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('issues access + refresh tokens on a fresh email', async () => {
    mockRegisterDbCalls();
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'fresh@example.com', password: 'longenoughpassword', displayName: 'Sora' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toMatch(/^eyJ/); // JWT prefix
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken.length).toBeGreaterThanOrEqual(64);
    expect(res.body.user).toEqual({
      id:          'user-1',
      email:       'fresh@example.com',
      displayName: 'Sora',
    });
  }, 15_000); // argon2.hash with t=3 m=64MB is slow
});

describe('POST /auth/login', () => {
  it('returns 401 for an unknown email', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 for a wrong password (no leak about which is wrong)', async () => {
    // Pre-compute a hash for a known password so argon2.verify can run.
    const argon2 = (await import('argon2')).default;
    const goodHash = await argon2.hash('the_correct_password', { type: argon2.argon2id });

    dbQueryOne.mockResolvedValueOnce({
      id:            'user-2',
      password_hash: goodHash,
      display_name:  'Sora',
      is_active:     true,
    });
    // logAuthEvent insert
    dbQuery.mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'sora@example.com', password: 'NOT_the_correct_password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  }, 15_000);

  it('issues tokens on correct credentials', async () => {
    const argon2 = (await import('argon2')).default;
    const goodHash = await argon2.hash('the_correct_password', { type: argon2.argon2id });

    dbQueryOne.mockResolvedValueOnce({
      id:            'user-3',
      password_hash: goodHash,
      display_name:  'Sora',
      is_active:     true,
    });
    // Upsert device — first queryOne returns null (no existing), then insert
    dbQueryOne.mockResolvedValueOnce(null);
    dbQuery.mockResolvedValueOnce([{ id: 'dev-3' }]); // insert device
    dbQuery.mockResolvedValueOnce([{ id: 'sess-3' }]); // insert session
    dbQuery.mockResolvedValueOnce([]); // log auth event

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'sora@example.com', password: 'the_correct_password' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toMatch(/^eyJ/);
    expect(res.body.refreshToken.length).toBeGreaterThanOrEqual(64);
    expect(res.body.user.email).toBe('sora@example.com');
  }, 20_000);
});

describe('GET /auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('returns the user with a valid token', async () => {
    // Mint a token directly via the same signer the routes use.
    const { signAccessToken } = await import('../lib/jwt.js');
    const token = await signAccessToken({
      sub:       'user-9',
      sessionId: 'sess-9',
      deviceId:  'dev-9',
    });

    // /auth/me does a queryOne(SELECT … FROM users WHERE id = $1)
    dbQueryOne.mockResolvedValueOnce({
      id:           'user-9',
      email:        'me@example.com',
      display_name: 'Me',
      mfa_enabled:  false,
      created_at:   new Date('2026-01-01'),
    });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-9');
    expect(res.body.email).toBe('me@example.com');
  });
});

describe('POST /auth/refresh', () => {
  it('rejects a missing refresh token with 400', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unknown refresh token with 401', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'no_such_token_here' });
    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token with 401', async () => {
    dbQueryOne.mockResolvedValueOnce({
      id:         'sess-x',
      user_id:    'user-x',
      device_id:  'dev-x',
      expires_at: new Date(Date.now() - 1000), // past
      revoked:    false,
    });
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rotates tokens on a valid refresh', async () => {
    dbQueryOne.mockResolvedValueOnce({
      id:         'sess-y',
      user_id:    'user-y',
      device_id:  'dev-y',
      expires_at: new Date(Date.now() + 60_000),
      revoked:    false,
    });
    dbQuery.mockResolvedValueOnce([]); // UPDATE sessions SET refresh_token = ...

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'oldRefresh' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toMatch(/^eyJ/);
    // New refresh token is fresh, not equal to the one sent.
    expect(res.body.refreshToken).not.toBe('oldRefresh');
  });
});
