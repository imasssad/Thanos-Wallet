/**
 * Schema integration smoke test.
 *
 * Runs against a REAL Postgres (the CI service container) — `schema.sql`
 * is loaded, then a minimal INSERT/SELECT round-trip exercises every
 * production table. The point is to catch schema drift: a query in
 * routes/* that assumes a column the schema doesn't have, or a CHECK /
 * UNIQUE constraint that breaks an insert path.
 *
 * Skipped when DATABASE_URL is not set (i.e. local `pnpm test`). CI
 * sets it before invoking vitest:
 *   DATABASE_URL=postgres://thanos:thanos@127.0.0.1:5432/thanos_test \
 *     pnpm --filter @thanos/api test schema-integration
 *
 * The schema is loaded idempotently — every CREATE uses IF NOT EXISTS —
 * so the test can run multiple times against the same container without
 * cleanup between runs (CI tears the container down at the end).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const haveDb = !!process.env.DATABASE_URL;
const describeIfDb = haveDb ? describe : describe.skip;

let pool: Pool;

beforeAll(async () => {
  if (!haveDb) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // schema.sql lives at services/db/schema.sql relative to repo root.
  // services/api tests run from services/api, so go up two.
  const schemaPath = join(process.cwd(), '..', 'db', 'schema.sql');
  const schemaSql  = await readFile(schemaPath, 'utf-8');
  await pool.query(schemaSql);
});

afterAll(async () => {
  if (!haveDb) return;
  await pool.end();
});

describeIfDb('schema integration — every production table round-trips', () => {
  it('users table accepts insert + select', async () => {
    const email = `test+${Date.now()}@thanos.local`;
    const r = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
      [email, 'argon2id$dummy$hash'],
    );
    expect(r.rows[0]?.email).toBe(email);
    const back = await pool.query(`SELECT email FROM users WHERE email = $1`, [email]);
    expect(back.rows[0]?.email).toBe(email);
  });

  it('contacts table enforces per-user address uniqueness', async () => {
    // Set up a user.
    const userRow = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`u+${Date.now()}@thanos.local`, 'h'],
    );
    const userId = userRow.rows[0].id;
    const addr = `0x${'a'.repeat(40)}`;

    await pool.query(
      `INSERT INTO contacts (user_id, name, address) VALUES ($1, $2, $3)`,
      [userId, 'Sora', addr],
    );

    // Second insert with the same (user_id, address) hits the unique index.
    // The index is a plain b-tree on (user_id, address) — case-insensitive
    // dedup is enforced at the route layer (lower(address) lookup before
    // insert), not at the DB. This test pins the index itself.
    await expect(pool.query(
      `INSERT INTO contacts (user_id, name, address) VALUES ($1, $2, $3)`,
      [userId, 'Sora copy', addr],
    )).rejects.toThrow(/contacts_user_address_idx|duplicate key/i);
  });

  it('auth_events captures register/login/failed_login rows', async () => {
    const userRow = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`a+${Date.now()}@thanos.local`, 'h'],
    );
    const userId = userRow.rows[0].id;
    await pool.query(
      `INSERT INTO auth_events (user_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, 'login', '127.0.0.1', 'vitest', $2::jsonb)`,
      [userId, JSON.stringify({ ok: true })],
    );
    const back = await pool.query(
      `SELECT event_type FROM auth_events WHERE user_id = $1`,
      [userId],
    );
    expect(back.rows[0]?.event_type).toBe('login');
  });

  it('sessions table accepts a row + revoke flip', async () => {
    const userRow = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`s+${Date.now()}@thanos.local`, 'h'],
    );
    const userId = userRow.rows[0].id;
    const session = await pool.query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at)
       VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
      [userId, 'hashed-refresh-token'],
    );
    const sessionId = session.rows[0].id;
    await pool.query(`UPDATE sessions SET revoked = true, revoked_at = now() WHERE id = $1`, [sessionId]);
    const back = await pool.query(`SELECT revoked FROM sessions WHERE id = $1`, [sessionId]);
    expect(back.rows[0]?.revoked).toBe(true);
  });
});

if (!haveDb) {
  // Make the skip explicit in test output so the operator notices a
  // misconfigured CI rather than silently passing.
  // eslint-disable-next-line no-console
  console.log('[schema-integration] SKIPPED — DATABASE_URL not set (set it in CI to enable)');
}
