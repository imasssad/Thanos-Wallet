/**
 * LAX card proxy — hardening tests (auth, ownership, validation).
 *
 * Same pattern as contacts.test.ts: supertest against the real Express
 * app with lib/db.js mocked and a real JWT minted via signAccessToken so
 * requireAuth is exercised end-to-end. Also mocks global fetch, since
 * laxFetch() talks to the upstream LAX/FCFpay API directly rather than
 * through a wrapped client.
 *
 * LAX_API_KEY/BASE/PROJECT_ID are set here so routes run past their 503
 * "not configured" gate and exercise the actual hardening logic.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL  = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET    = process.env.JWT_SECRET   ?? 'test_jwt_secret_at_least_32_chars_long_x';
  process.env.NODE_ENV      = 'test';
  process.env.REDIS_URL     = process.env.REDIS_URL    ?? 'redis://localhost:6379';
  process.env.CORS_ORIGINS  = 'http://localhost:3000';
  process.env.LAX_API_KEY   = 'test-lax-key';
  process.env.LAX_API_BASE  = 'https://lax.test.invalid';
  process.env.LAX_PROJECT_ID = '612';
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
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  app = createApp();
  token = await signAccessToken({ sub: 'user-l', sessionId: 'sess-l', deviceId: 'dev-l' });
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
  fetchMock.mockReset();
});

const auth = () => `Bearer ${token}`;
function jsonRes(status: number, body: unknown) {
  return { status, json: () => Promise.resolve(body) };
}

/* ─── requireAuth applies to the whole router ───────────────────────── */

describe('auth gate', () => {
  it('rejects an unauthenticated GET /lax/cards with 401', async () => {
    const res = await request(app).get('/lax/cards');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated POST /lax/card/topup with 401', async () => {
    const res = await request(app).post('/lax/card/topup').send({ cardNumber: 'c1', amount: 10 });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated GET /lax/status with 401', async () => {
    const res = await request(app).get('/lax/status');
    expect(res.status).toBe(401);
  });
});

/* ─── status — readiness without leaking secret values ──────────────── */

describe('GET /lax/status', () => {
  it('reports configured booleans and presence flags, never the actual values', async () => {
    const res = await request(app).get('/lax/status').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      configuredForIssuance: false, // Project 612 has no virtual instant-issue
      projectId: 612,
      have: { apiKey: true, apiBase: true, projectId: true },
    });
    // The actual secret values must never appear in the response body.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-lax-key');
    expect(body).not.toContain('lax.test.invalid');
  });
});

/* ─── card ownership — the lax_cards scoping check ──────────────────── */

describe('GET /lax/card/:cardNumber/balance', () => {
  it('404s a card the caller does not own, without calling upstream', async () => {
    dbQueryOne.mockResolvedValueOnce(null); // not found in lax_cards for this user
    const res = await request(app).get('/lax/card/not-mine/balance').set('Authorization', auth());
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies to LAX for a card the caller does own', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { balance: 42 }));
    const res = await request(app).get('/lax/card/card-1/balance').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 42 });
    expect(dbQueryOne).toHaveBeenCalledWith(expect.stringContaining('from lax_cards'), ['user-l', 'card-1']);
  });
});

describe('POST /lax/card/topup', () => {
  it('rejects a non-positive amount with 400 before touching the DB or upstream', async () => {
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: -5 });
    expect(res.status).toBe(400);
    expect(dbQueryOne).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an amount below LAX\'s real $20 minimum, before touching the DB or upstream', async () => {
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: 19.99 });
    expect(res.status).toBe(400);
    expect(dbQueryOne).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an amount with more than 2 decimal places', async () => {
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: 20.123 });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s a card the caller does not own, without calling upstream', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'not-mine', amount: 25 }); // >= LAX's real $20 floor — this test is about ownership, not amount validity
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies a top-up for a card the caller owns', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: 25 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ─── card list — must never leak other users' merchant cards ───────── */

describe('GET /lax/cards', () => {
  it('returns an empty list when the caller owns no cards, without calling upstream', async () => {
    dbQuery.mockResolvedValueOnce([]);
    const res = await request(app).get('/lax/cards').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cards: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only this caller\'s lax_cards rows (no virtual get-my-cards)', async () => {
    dbQuery.mockResolvedValueOnce([
      { card_number: 'mine-1', currency: 'USDC' },
    ]);
    const res = await request(app).get('/lax/cards').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([{ card_number: 'mine-1', currency: 'USDC' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /lax/currencies', () => {
  it('proxies available_currencies and filters enabled_on_account when present', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, {
      data: [
        { ticker: 'USDC', enabled_on_account: true },
        { ticker: 'BTC', enabled_on_account: false },
      ],
    }));
    const res = await request(app).get('/lax/currencies').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ ticker: 'USDC', enabled_on_account: true }]);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/general/available_currencies');
  });
});

/* ─── issuance — Project 612 has no virtual issue path ──────────────── */

describe('POST /lax/card/issue', () => {
  it('rejects an invalid email with 400', async () => {
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 501 — no virtual product_id / instant issue for this project', async () => {
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'user@example.com' });
    expect(res.status).toBe(501);
    expect(res.body.projectId).toBe(612);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('physical card upstream paths', () => {
  it('proxies balance to /api/physical-cards/get-balance', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, message: '10.00' }));
    const res = await request(app).get('/lax/card/card-1/balance').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/physical-cards/get-balance');
  });

  it('proxies top-up to /api/physical-cards/load', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: 25 });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/physical-cards/load');
  });

  it('creates and records a physical card holder', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, message: 'holder-123' }));
    dbQuery.mockResolvedValueOnce([]);
    const res = await request(app).post('/lax/physical/holder').set('Authorization', auth()).send({
      name: 'Test Holder', NFT_holder: 0, Card_color: 'Matte black (stainless)', firstName: 'Test', lastName: 'Holder',
      address_line1: '1 Test Street', city: 'London', state: 'LD', country: 'GB', zip: 'SW1A 1AA',
      phone: '+44123456789', email: 'test@example.com', cellPhoneNumber: '+44123456789', callingCode: '044',
      countryCallingCode: '44', birth_date: '1990-01-01', genderId: 0,
    });
    expect(res.status).toBe(201);
    expect(res.body.holderId).toBe('holder-123');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/physical-cards/create-card-holder');
  });

  it('ownership-gates PIN reads', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app).get('/lax/card/not-mine/pin').set('Authorization', auth());
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
