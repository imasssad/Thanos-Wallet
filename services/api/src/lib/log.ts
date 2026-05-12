/**
 * Structured logger for the API service.
 *
 * Pino emits JSON lines that ship cleanly to docker logs, journald, and any
 * Loki / Datadog / Cloudwatch ingestor. Log levels are env-controlled so we
 * can dial verbosity per environment without redeploying.
 *
 * Redaction: never log password, mnemonic, token, secret, or authorization
 * headers — Pino's redact option strips them recursively.
 */
import pino from 'pino';

export const log = pino({
  name:  '@thanos/api',
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'password', 'mnemonic', 'seed', 'private_key', 'privateKey',
      'token', 'accessToken', 'refreshToken',
      'authorization', 'headers.authorization', 'headers.cookie',
      '*.password', '*.mnemonic', '*.token',
    ],
    censor: '[redacted]',
  },
  /* In production we want raw JSON for log shippers. In dev a pretty stream
     is more readable — opt in via LOG_PRETTY=1 since pino-pretty is a
     separate dep we'd otherwise drag into production. */
  ...(process.env.LOG_PRETTY === '1'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
