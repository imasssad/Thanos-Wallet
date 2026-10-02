/**
 * LAX proxy — how Zypto's failure replies reach the apps.
 *
 * Zypto answers errors with HTTP 401 ("Something went wrong!") or with
 * `{ success: false }` on a 2xx, in text/plain bodies that can arrive
 * double-encoded. A forwarded 401 made the apps' API client treat it as an
 * expired Thanos session, refresh, and re-send the card order.
 *
 * Separate file from lax.test.ts so these calls get their own laxOpLimiter
 * (10/hour per IP, a module singleton).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

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
vi.mock('../lib/sessions.js', () => ({ isSessionLive: () => Promise.resolve(true) }));

import request from 'supertest';
import { createApp } from '../app.js';
import { signAccessToken } from '../lib/jwt.js';

let app: ReturnType<typeof createApp>;
let token: string;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  app = createApp();
  token = await signAccessToken({ sub: 'user-u', sessionId: 'sess-u', deviceId: 'dev-u' });
});

beforeEach(() => {
  dbQuery.mockReset();
  dbQueryOne.mockReset();
  fetchMock.mockReset();
  process.env.LAX_IFRAME_ID = '13524';
  process.env.LAX_PRODUCT_ID = '9';
});

afterEach(() => {
  delete process.env.LAX_IFRAME_ID;
  delete process.env.LAX_PRODUCT_ID;
  delete process.env.LAX_CARD_RELOADABLE;
});

const auth = () => `Bearer ${token}`;
const jsonRes = (status: number, body: unknown) => ({ status, json: () => Promise.resolve(body) });
const order = { amount: 25, currency: 'usdt', email: 'a@b.co' };

describe('POST /lax/card/issue — upstream failures', () => {
  it('turns Zypto\'s 401 into a 502 with the reason, and calls upstream once', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(401, { success: false, message: 'Something went wrong!' }));
    const res = await request(app).post('/lax/card/issue').set('Authorization', auth()).send(order);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/LAX card ordering is unavailable/);
    expect(res.body.detail).toBe('Something went wrong!');
    expect(res.body.upstreamStatus).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('treats success:false on a 200 as a failure, not a missing checkout page', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: false, message: 'No products are available for this widget' }));
    const res = await request(app).post('/lax/card/issue').set('Authorization', auth()).send(order);
    expect(res.status).toBe(502);
    expect(res.body.detail).toBe('No products are available for this widget');
  });

  it('surfaces the first Laravel validation message on a 422', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(422, { message: 'The given data was invalid.', errors: { product_id: ['The selected product id is invalid.'] } }));
    const res = await request(app).post('/lax/card/issue').set('Authorization', auth()).send(order);
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('The given data was invalid.');
  });
});

describe('POST /lax/card/issue — success', () => {
  it('reads a double-encoded text/plain reply and sends a numeric product_id as a number', async () => {
    const inner = JSON.stringify({ success: true, message: 'https://checkout.fcfpay.com/pay-cards/abc', order_id: 'Idjfr43' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, inner));
    const res = await request(app).post('/lax/card/issue').set('Authorization', auth()).send(order);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, order_id: 'Idjfr43', checkout_url: 'https://checkout.fcfpay.com/pay-cards/abc' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ iframe_id: 13524, product_id: 9, amount: 25, currency: 'USDT', email: 'a@b.co' });
    expect(String(dbQuery.mock.calls[0][0])).toContain('insert into lax_card_orders');
  });

  it('keeps an alphanumeric product_id as a string', async () => {
    process.env.LAX_PRODUCT_ID = 'OB03362';
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, message: 'https://checkout.fcfpay.com/pay-cards/x', order_id: 'O2' }));
    await request(app).post('/lax/card/issue').set('Authorization', auth()).send(order);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).product_id).toBe('OB03362');
  });
});

describe('other routes never pass on Zypto\'s 401', () => {
  it('GET /lax/products', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(401, { success: false, message: 'Something went wrong!' }));
    const res = await request(app).get('/lax/products').set('Authorization', auth());
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'LAX product list unavailable.', detail: 'Something went wrong!', upstreamStatus: 401 });
  });

  it('POST /lax/card/topup', async () => {
    process.env.LAX_CARD_RELOADABLE = 'true';
    dbQueryOne.mockResolvedValueOnce({ id: '1', user_id: 'user-u', card_number: '251290559709857' });
    fetchMock.mockResolvedValueOnce(jsonRes(401, { success: false, message: 'Something went wrong!' }));
    const res = await request(app).post('/lax/card/topup').set('Authorization', auth()).send({ cardNumber: '251290559709857', amount: 30 });
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GET /lax/card/:n/balance', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: '1', user_id: 'user-u', card_number: '251290559709857' });
    fetchMock.mockResolvedValueOnce(jsonRes(403, { message: 'Forbidden' }));
    const res = await request(app).get('/lax/card/251290559709857/balance').set('Authorization', auth());
    expect(res.status).toBe(502);
    expect(res.body.detail).toBe('Forbidden');
  });
});
