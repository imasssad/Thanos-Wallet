/**
 * Push-notification endpoints.
 *
 *   POST /push/register    { token, address, platform? }  → store device token
 *   POST /push/unregister  { token }                       → drop device token
 *   POST /push/notify      { address, title, body, data? } → fan out (internal)
 *
 * register/unregister are unauthenticated on purpose: the mobile wallet
 * is local-first and has no server session, so the device keys its token
 * to its own wallet address. notify is INTERNAL — gated by the
 * PUSH_INTERNAL_SECRET header so only the indexer/worker on the Docker
 * network can trigger sends (never exposed via nginx).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isExpoToken, registerToken, removeToken, notifyAddress } from '../lib/push.js';

export const pushRouter = Router();

const RegisterSchema = z.object({
  token:    z.string().min(8).max(256),
  address:  z.string().min(8).max(128),
  platform: z.string().max(16).optional(),
});

pushRouter.post('/register', async (req: Request, res: Response) => {
  const parse = RegisterSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation failed', issues: parse.error.issues }); return; }
  const { token, address, platform } = parse.data;
  if (!isExpoToken(token)) { res.status(400).json({ error: 'Not an Expo push token' }); return; }
  await registerToken(token, address, platform);
  res.status(201).json({ ok: true });
});

pushRouter.post('/unregister', async (req: Request, res: Response) => {
  const token = (req.body as { token?: unknown })?.token;
  if (typeof token !== 'string') { res.status(400).json({ error: 'token required' }); return; }
  await removeToken(token);
  res.status(200).json({ ok: true });
});

const NotifySchema = z.object({
  address: z.string().min(8).max(128),
  title:   z.string().min(1).max(120),
  body:    z.string().min(1).max(240),
  data:    z.record(z.unknown()).optional(),
});

pushRouter.post('/notify', async (req: Request, res: Response) => {
  const secret = process.env.PUSH_INTERNAL_SECRET;
  // Disabled unless a secret is configured — never an open push relay.
  if (!secret) { res.status(503).json({ error: 'push notify disabled (no PUSH_INTERNAL_SECRET)' }); return; }
  if (req.header('x-internal-secret') !== secret) { res.status(403).json({ error: 'forbidden' }); return; }
  const parse = NotifySchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation failed', issues: parse.error.issues }); return; }
  const { address, title, body, data } = parse.data;
  const count = await notifyAddress(address, { title, body, data });
  res.json({ ok: true, delivered: count });
});
