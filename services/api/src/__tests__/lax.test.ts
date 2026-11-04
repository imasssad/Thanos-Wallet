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
  process.env.LAX_WEBHOOK_SECRET = 'test-webhook-secret';
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
// Real rate limiting is tested once, in isolation, in security.test.ts — a
// shared express-rate-limit counter keyed on the test runner's one IP would
// otherwise accumulate across every test in this file (and now across the
// step-up tests added for THN-R1 M-04 too) and start 429ing unrelated
// assertions. Pass-through no-ops here, same idea as the db/redis mocks above.
vi.mock('../middleware/rate-limit.js', () => ({
  laxOpLimiter:      (_req: unknown, _res: unknown, next: () => void) => next(),
  sensitiveOpLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter:        (_req: unknown, _res: unknown, next: () => void) => next(),
  generalLimiter:     (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../lib/redis.js', () => ({
  checkRedisConnection: () => Promise.resolve(true),
  redis: { get: vi.fn(), set: vi.fn() },
}));
// requireAuth's session lookup: the minted token's session is live (the
// revoked case is covered in auth.test.ts).
vi.mock('../lib/sessions.js', () => ({ isSessionLive: () => Promise.resolve(true) }));

import request from 'supertest';
import { createApp } from '../app.js';
import { signAccessToken } from '../lib/jwt.js';
import { issueStepUpToken } from '../lib/step-up.js';

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
const stepUp = () => issueStepUpToken('user-l', 'sess-l').token;
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
      configuredForIssuance: false,
      projectId: 612,
      virtualCard: { iframeId: false, productId: false, reloadable: false },
      reloadable: false,
      have: { apiKey: true, apiBase: true, projectId: true },
    });
    // The actual secret values must never appear in the response body.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('test-lax-key');
    expect(body).not.toContain('lax.test.invalid');
  });
});

/* ─── card ownership — the lax_cards scoping check ──────────────────── */

describe('GET /lax/products', () => {
  it('rejects an unauthenticated call with 401', async () => {
    const res = await request(app).get('/lax/products');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies Zypto get-products so the product_id can be read', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { data: [{ product_id: 7, name: 'LAX Visa' }] }));
    const res = await request(app).get('/lax/products').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ product_id: 7, name: 'LAX Visa' }] });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/cards/get-products');
  });
});

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

  it('refuses a top-up when the card product is non-reloadable (default)', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    const res = await request(app)
      .post('/lax/card/topup')
      .set('Authorization', auth())
      .send({ cardNumber: 'card-1', amount: 25 });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a user-paid refill checkout when the product is reloadable', async () => {
    process.env.LAX_CARD_RELOADABLE = 'true';
    try {
      dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
      fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, checkout_page_url: 'https://checkout.lax.test/refill/1', order_id: 'R1' }));
      dbQuery.mockResolvedValueOnce([]);
      const res = await request(app)
        .post('/lax/card/topup')
        .set('Authorization', auth())
        .send({ cardNumber: 'card-1', amount: 25 });
      expect(res.status).toBe(200);
      expect(res.body.checkout_url).toBe('https://checkout.lax.test/refill/1');
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/cards/create-refill-card-order-api');
      // never the merchant-funded physical load
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/physical-cards/load');
    } finally { delete process.env.LAX_CARD_RELOADABLE; }
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

  it('returns 503 until the virtual-card dashboard ids are configured', async () => {
    const res = await request(app)
      .post('/lax/card/issue')
      .set('Authorization', auth())
      .send({ amount: 100, currency: 'USDC', email: 'user@example.com' });
    expect(res.status).toBe(503);
    expect(res.body.projectId).toBe(612);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('physical card upstream paths', () => {
  it('proxies balance to the virtual-card /api/cards/get-card-balance', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, message: '10.00' }));
    const res = await request(app).get('/lax/card/card-1/balance').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/cards/get-card-balance');
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
    const res = await request(app).get('/lax/card/not-mine/pin').set('Authorization', auth()).set('x-step-up-token', stepUp());
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('step-up auth on card PIN/details/activate (THN-R1 M-04)', () => {
  it('refuses PIN/details/activate without a step-up token, even with a valid session', async () => {
    const noStepUp = await request(app).get('/lax/card/card-1/pin').set('Authorization', auth());
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.code).toBe('step_up_required');
    expect(fetchMock).not.toHaveBeenCalled();

    const details = await request(app).get('/lax/card/card-1/details').set('Authorization', auth());
    expect(details.status).toBe(403);

    const activate = await request(app).post('/lax/card/card-1/activate').set('Authorization', auth());
    expect(activate.status).toBe(403);
  });

  it('refuses a step-up token minted for a different session', async () => {
    const wrongSession = issueStepUpToken('user-l', 'some-other-session').token;
    const res = await request(app).get('/lax/card/card-1/pin').set('Authorization', auth()).set('x-step-up-token', wrongSession);
    expect(res.status).toBe(403);
  });

  it('succeeds with a valid step-up token', async () => {
    dbQueryOne.mockResolvedValueOnce({ id: 'lc-1', user_id: 'user-l', card_number: 'card-1' });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { success: true, message: '1234' }));
    const res = await request(app).get('/lax/card/card-1/pin').set('Authorization', auth()).set('x-step-up-token', stepUp());
    expect(res.status).toBe(200);
  });
});

describe('LAX webhook (THN-R1 M-05: redaction)', () => {
  it('masks card_number and fully redacts a PIN-like field before persisting the raw payload', async () => {
    dbQuery.mockResolvedValueOnce([]); // insert into lax_webhook_events
    const res = await request(app)
      .post('/lax-webhook')
      .set('x-lax-webhook-secret', 'test-webhook-secret')
      .send({ event: 'card.issued', card_number: '4111111111111234', pin: '1234', nested: { cvv: '999' } });
    expect(res.status).toBe(200);
    const [sql, values] = dbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into lax_webhook_events/);
    const stored = JSON.parse(values[2] as string);
    expect(stored.card_number).toBe('••••••••••••1234');
    expect(stored.pin).toBe('[redacted]');
    expect(stored.nested.cvv).toBe('[redacted]');
    // The extracted column (used for reconciliation) is the real number, unredacted.
    expect(values[1]).toBe('4111111111111234');
  });

  it('rejects a wrong webhook secret', async () => {
    const res = await request(app)
      .post('/lax-webhook')
      .set('x-lax-webhook-secret', 'wrong-secret')
      .send({ event: 'card.issued' });
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });
});
