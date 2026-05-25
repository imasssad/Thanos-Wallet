import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { log } from '../lib/log.js';

/**
 * Request-ID middleware.
 *
 * Honours an incoming `x-request-id` if the upstream (nginx, CDN) set
 * one, otherwise mints a fresh UUIDv4. The ID is:
 *   - attached to `req.id` for downstream handlers + error middleware,
 *   - echoed in the response's `x-request-id` header so clients can
 *     correlate, and
 *   - bound to a child Pino logger at `req.log` that includes
 *     `requestId` on every line — handlers then do `req.log.info(...)`
 *     and the output is correlated without each one re-passing the ID.
 *
 * Express types don't include `id` / `log` natively. Consumers cast
 * the request to `LoggedRequest` (defined here) at the boundary —
 * works across both ESM + CJS without needing a global module
 * augmentation, which is fragile under monorepo path aliasing.
 *
 * Mount early — before route handlers and before the error middleware —
 * so even rate-limit rejections get a request ID.
 */
export interface LoggedRequest extends Request {
  id:  string;
  log: typeof log;
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9_.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  (req as LoggedRequest).id  = id;
  (req as LoggedRequest).log = log.child({ requestId: id });
  res.setHeader('x-request-id', id);
  next();
}
