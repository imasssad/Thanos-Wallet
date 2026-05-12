/**
 * Structured logger for the indexer.
 *
 * Same shape as services/api/src/lib/log.ts so log shippers can index
 * across services on consistent fields. Critical for grep'ing chain sync
 * errors across the stack.
 */
import pino from 'pino';

export const log = pino({
  name:  '@thanos/indexer',
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['password', 'mnemonic', 'seed', 'private_key', 'privateKey'],
    censor: '[redacted]',
  },
});
