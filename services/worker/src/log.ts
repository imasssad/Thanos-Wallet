/**
 * Structured logger for the BullMQ worker.
 *
 * Per-job spans benefit from `log.child({ jobId, queue })` so all logs for
 * a single job share a correlation id — easy to filter in Grafana / Loki.
 */
import pino from 'pino';

export const log = pino({
  name:  '@thanos/worker',
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['password', 'mnemonic', 'seed', 'private_key', 'privateKey'],
    censor: '[redacted]',
  },
});
