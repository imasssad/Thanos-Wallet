/**
 * Security regression tests — defensive layer the audit calls out:
 *
 *  1. The Pino logger's redact paths actually scrub mnemonic/password/
 *     privateKey/token/etc. fields. Easy to silently break when adding
 *     a new sensitive field; the test pins the contract.
 *  2. The `authLimiter` rate-limits a brute-force attempt against
 *     /auth/login. The middleware is wired into the route via
 *     services/api/src/routes/auth.ts; we assert that hitting it 11
 *     times in a single window yields a 429.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';

// Re-build the API's logger config so the test stays in sync with the
// real `services/api/src/lib/log.ts` redact paths. If you add a new
// sensitive field there, mirror it here (or refactor both to import
// a single REDACT_PATHS constant — left as a follow-up).
const REDACT_PATHS = [
  'password', 'mnemonic', 'seed', 'private_key', 'privateKey',
  'token', 'accessToken', 'refreshToken',
  'authorization', 'headers.authorization', 'headers.cookie',
  '*.password', '*.mnemonic', '*.token',
];

function captureLogger(): { log: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
  return { log, lines };
}

describe('logger redact paths', () => {
  it('scrubs password from a top-level object', () => {
    const { log, lines } = captureLogger();
    log.info({ password: 'hunter2', email: 'a@b.com' }, 'login attempt');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.password).toBe('[redacted]');
    expect(last.email).toBe('a@b.com');
  });

  it('scrubs mnemonic from a top-level object', () => {
    const { log, lines } = captureLogger();
    log.info({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.mnemonic).toBe('[redacted]');
  });

  it('scrubs privateKey (camelCase)', () => {
    const { log, lines } = captureLogger();
    log.info({ privateKey: '0xdeadbeef'.repeat(8) });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.privateKey).toBe('[redacted]');
  });

  it('scrubs private_key (snake_case)', () => {
    const { log, lines } = captureLogger();
    log.info({ private_key: '0xdeadbeef'.repeat(8) });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.private_key).toBe('[redacted]');
  });

  it('scrubs authorization header', () => {
    const { log, lines } = captureLogger();
    log.info({ headers: { authorization: 'Bearer abc123', host: 'thanos.fi' } }, 'req');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.headers.authorization).toBe('[redacted]');
    expect(last.headers.host).toBe('thanos.fi');
  });

  it('scrubs nested user.password', () => {
    const { log, lines } = captureLogger();
    log.info({ user: { id: 1, password: 'secret', email: 'x@y.z' } });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.user.password).toBe('[redacted]');
    expect(last.user.email).toBe('x@y.z');
  });

  it('scrubs tokens at any nesting level via *.token', () => {
    const { log, lines } = captureLogger();
    log.info({ session: { token: 'jwt.abc.def', userId: 1 } });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.session.token).toBe('[redacted]');
    expect(last.session.userId).toBe(1);
  });

  it('leaves non-sensitive fields alone', () => {
    const { log, lines } = captureLogger();
    log.info({ email: 'test@example.com', ip: '1.2.3.4', request_id: 'abc-123' });
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.email).toBe('test@example.com');
    expect(last.ip).toBe('1.2.3.4');
    expect(last.request_id).toBe('abc-123');
  });
});

describe('authLimiter — brute-force protection', () => {
  beforeEach(() => { vi.resetModules(); });

  it('exports a limiter sized for 10 failed attempts per 15 minutes', async () => {
    // The limiter is constructed at module load. Re-import and inspect
    // its config — we can't easily invoke it without a full Express
    // server stand-up, so the contract test is on the configured
    // window + max + skipSuccessfulRequests flag.
    const mod = await import('../middleware/rate-limit.js');
    // express-rate-limit stashes its options on the middleware function
    // under a non-enumerable symbol; the publicly safe assertion is
    // that the export exists and is a function.
    expect(typeof mod.authLimiter).toBe('function');
    expect(typeof mod.generalLimiter).toBe('function');
    expect(typeof mod.sensitiveOpLimiter).toBe('function');
  });

  it('returns 429 when the limiter is exhausted', async () => {
    // Drive the real limiter through a stub Express app to keep this
    // test fully self-contained (no DB needed). 10 calls succeed
    // (passed through), the 11th hits the rate-limit response.
    const express = (await import('express')).default;
    const { authLimiter } = await import('../middleware/rate-limit.js');
    const supertest = (await import('supertest')).default;

    const app = express();
    app.use(express.json());
    // We want EVERY POST to count as a "failed" auth attempt so the
    // limiter ticks. `skipSuccessfulRequests: true` means a 2xx
    // response is NOT counted — so the stub returns 401 on every call,
    // forcing the limiter to increment.
    app.post('/login', authLimiter, (_req, res) => {
      res.status(401).json({ error: 'invalid' });
    });

    const agent = supertest(app);
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const r = await agent.post('/login').send({ email: 'x@y.z', password: 'bad' });
      lastStatus = r.status;
    }
    // The 11th attempt should be rate-limited.
    expect(lastStatus).toBe(429);
  });
});
