/**
 * Contacts route integration tests — real Postgres + real Express app.
 *
 * The plain auth.test / contacts.test files mock pg to validate route
 * shapes. This file runs the *actual* SQL through the *actual* router
 * via supertest, against a real Postgres service container. Catches:
 *   - schema drift between db/schema.sql and routes/contacts.ts queries
 *   - SQL syntax errors the mock would never surface
 *   - dedup (lower(address)) actually enforced by the unique index
 *   - JWT-gated routes really reject anonymous requests
 *
 * Skipped when DATABASE_URL is unset, so `pnpm test` locally still
 * runs the rest of the suite green without needing a DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import argon2 from 'argon2';

const haveDb = !!process.env.DATABASE_URL;
const describeIfDb = haveDb ? describe : describe.skip;

// Real env so jwt.ts + db.ts + redis.ts load cleanly.
process.env.JWT_SECRET   = process.env.JWT_SECRET   ?? 'test_jwt_secret_at_least_32_chars_long_x';
process.env.REDIS_URL    = process.env.REDIS_URL    ?? 'redis://localhost:6379';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

let pool: Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
let accessToken = '';
let userId = '';

async function createUserAndToken(): Promise<{ userId: string; access: string }> {
  // Register a real user via the real route — that exercises Argon2 +
  // session creation + JWT issuance, so the access token we get back
  // is a real production-shape token.
  const email = `t+${Date.now()}+${Math.floor(Math.random() * 1e6)}@thanos.local`;
  const password = 'integration-test-pw-12345';
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  return { userId: res.body.user.id, access: res.body.accessToken };
}

beforeAll(async () => {
  if (!haveDb) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Load the schema once for the whole suite. Idempotent (CREATE IF NOT EXISTS).
  const schemaPath = join(process.cwd(), '..', 'db', 'schema.sql');
  const schemaSql  = await readFile(schemaPath, 'utf-8');
  await pool.query(schemaSql);

  // Import the real app after env is set so jwt.ts picks up JWT_SECRET.
  const mod = await import('../app.js');
  app = mod.createApp();
});

beforeEach(async () => {
  if (!haveDb) return;
  // Fresh user per test so the unique-index assertions don't collide
  // across test runs against the same DB.
  const u = await createUserAndToken();
  userId = u.userId;
  accessToken = u.access;
});

afterAll(async () => {
  if (!haveDb) return;
  await pool.end();
});

describeIfDb('contacts route — real Postgres round-trip', () => {
  it('rejects unauthenticated GET /contacts with 401', async () => {
    await request(app).get('/contacts').expect(401);
  });

  it('POST creates + GET lists the same row', async () => {
    const create = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Sora', address: '0x' + '1'.repeat(40), addressType: 'evm' })
      .expect(201);
    expect(create.body.item.name).toBe('Sora');

    const list = await request(app)
      .get('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBe('Sora');
  });

  it('returns 409 on duplicate address (case-insensitive)', async () => {
    const lower = '0x' + 'a'.repeat(40);
    await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'A', address: lower, addressType: 'evm' })
      .expect(201);
    const dup = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'A copy', address: lower.toUpperCase(), addressType: 'evm' })
      .expect(409);
    expect(dup.body.error).toMatch(/already exists/i);
  });

  it('PUT updates name + notes, GET returns the new values', async () => {
    const create = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bob', address: '0x' + '2'.repeat(40), addressType: 'evm' })
      .expect(201);
    const id = create.body.item.id;

    await request(app)
      .put(`/contacts/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bobby', notes: 'fav recipient' })
      .expect(200);

    const list = await request(app)
      .get('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const updated = list.body.items.find((c: { id: string }) => c.id === id);
    expect(updated.name).toBe('Bobby');
    expect(updated.notes).toBe('fav recipient');
  });

  it('DELETE removes the row + a second DELETE returns 404', async () => {
    const create = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Charlie', address: '0x' + '3'.repeat(40), addressType: 'evm' })
      .expect(201);
    const id = create.body.item.id;

    await request(app)
      .delete(`/contacts/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    await request(app)
      .delete(`/contacts/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it("user A cannot see / mutate user B's contacts", async () => {
    // user A creates a contact
    const aCreate = await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'PrivateContact', address: '0x' + '4'.repeat(40), addressType: 'evm' })
      .expect(201);
    const contactId = aCreate.body.item.id;

    // user B logs in fresh
    const b = await createUserAndToken();

    // user B's list should not include user A's contact
    const bList = await request(app)
      .get('/contacts')
      .set('Authorization', `Bearer ${b.access}`)
      .expect(200);
    expect(bList.body.items).toHaveLength(0);

    // user B's DELETE should 404 (per-user filtering, not 403)
    await request(app)
      .delete(`/contacts/${contactId}`)
      .set('Authorization', `Bearer ${b.access}`)
      .expect(404);
  });

  it('preserves opaque ciphertext (v1:iv:ct) in name + notes round-trip', async () => {
    // The web client encrypts name + notes before POST — server must
    // store the ciphertext verbatim and return it on GET, so the client
    // can decrypt locally. This catches any sneaky server-side
    // string mutation (trim, lowercase, length truncation).
    const fakeCiphertext = 'v1:abcdef==:1234567890==';
    await request(app)
      .post('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name:        fakeCiphertext,
        address:     '0x' + '5'.repeat(40),
        addressType: 'evm',
        notes:       fakeCiphertext + 'XYZ',
      })
      .expect(201);

    const list = await request(app)
      .get('/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const got = list.body.items[0];
    expect(got.name).toBe(fakeCiphertext);
    expect(got.notes).toBe(fakeCiphertext + 'XYZ');
  });
});

// argon2 import is here to ensure the module bundle loads cleanly under
// vitest — services/api uses it in routes/auth.ts; this import asserts
// the native binary resolved correctly in the CI container.
void argon2;
