/**
 * LAX card proxy — hardening tests (auth, ownership, validation).
 *
 * Same pattern as contacts.test.ts: supertest against the real Express
 * app with lib/db.js mocked and a real JWT minted via signAccessToken so
 * requireAuth is exercised end-to-end. Also mocks global fetch, since
 * laxFetch() talks to the upstream LAX/FCFpay API directly rather than
 * through a wrapped client.
 *
 * LAX_API_KEY/BASE/WIDGET_ID/PRODUCT_ID are set here so routes run past
 * their 503 "not configured" gate and exercise the actual hardening logic
 * this file is testing — that gate itself is trivial and, as of this
 * writing, is what every route in production actually returns (no real
 * values are configured yet).
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
  process.env.LAX_WIDGET_ID = '42';
  process.env.LAX_PRODUCT_ID = '7';
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

  it('404s a card the caller does not own, without calling upstream', async () => {
    dbQueryOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'not-mine', amount: 10 });
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

/* ─── issuance — validation + recording ownership on success ───────── */

describe('POST /lax/card/issue', () => {
  it('rejects an invalid email with 400', async () => {
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records ownership in lax_cards when the upstream response has a card number', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(201, { card_number: 'new-card-9' }));
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'user@example.com' });
    expect(res.status).toBe(201);
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into lax_cards'),
      ['user-l', 'new-card-9', 'USDC', 100],
    );
  });

  it('never sends iframe_id/product_id from the request body — only the server-configured values', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(201, { card_number: 'new-card-1' }));
    await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      // A malicious/confused client trying to pick its own widget/product —
      // must be silently ignored (IssueSchema doesn't even parse these).
      .send({ amount: 100, currency: 'USDC', email: 'user@example.com', iframe_id: 999, product_id: 999 });
    const [, opts] = fetchMock.mock.calls.at(-1)!;
    const sentBody = JSON.parse((opts as { body: string }).body);
    expect(sentBody.iframe_id).toBe(42);   // LAX_WIDGET_ID from env, not the request
    expect(sentBody.product_id).toBe(7);   // LAX_PRODUCT_ID from env, not the request
  });

  it('still returns the upstream response when no card number field is recognized', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(201, { unexpected: 'shape' }));
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'user@example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ unexpected: 'shape' });
    expect(dbQuery).not.toHaveBeenCalled();
  });
});
