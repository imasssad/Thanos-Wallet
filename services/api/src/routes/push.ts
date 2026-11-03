/**
 * Push-notification endpoints.
 *
 *   GET  /push/nonce       ?address=0x...                   → a proof-of-
 *                                                              ownership
 *                                                              nonce to sign
 *   POST /push/register    { token, address, platform?,
 *                             nonceToken, signature }        → store device token
 *   POST /push/unregister  { token, address,
 *                             nonceToken, signature }        → drop device token
 *   POST /push/notify      { address, title, body, data? }   → fan out (internal)
 *
 * register/unregister take no server session — the mobile wallet is
 * local-first and has none — but DO require proof the caller controls
 * `address`: a nonce from /push/nonce signed with personal_sign (THN-R1
 * M-01; see lib/push-auth.ts). Without it, anyone holding their own Expo
 * token could register it against someone else's publicly-known address,
 * or drop a token they don't own. notify is INTERNAL — gated by the
 * PUSH_INTERNAL_SECRET header so only the indexer/worker on the Docker
 * network can trigger sends (never exposed via nginx).
 */
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isExpoToken, registerToken, removeTokenOwnedBy, notifyAddress } from '../lib/push.js';
import { issuePushNonce, verifyPushProof } from '../lib/push-auth.js';

export const pushRouter = Router();

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'address must be 0x… 40 hex chars');

pushRouter.get('/nonce', (req: Request, res: Response) => {
  const parse = AddressSchema.safeParse(req.query.address);
  if (!parse.success) { res.status(400).json({ error: 'address must be 0x… 40 hex chars' }); return; }
  const { token, message } = issuePushNonce(parse.data.toLowerCase());
  res.json({ nonceToken: token, message });
});

const RegisterSchema = z.object({
  token:       z.string().min(8).max(256),
  address:     AddressSchema,
  platform:    z.string().max(16).optional(),
  nonceToken:  z.string().min(1).max(512),
  signature:   z.string().min(1).max(512),
});

pushRouter.post('/register', async (req: Request, res: Response) => {
  const parse = RegisterSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation failed', issues: parse.error.issues }); return; }
  const { token, address, platform, nonceToken, signature } = parse.data;
  if (!isExpoToken(token)) { res.status(400).json({ error: 'Not an Expo push token' }); return; }
  if (!verifyPushProof(nonceToken, address, signature)) { res.status(401).json({ error: 'Invalid or expired proof of address ownership' }); return; }
  await registerToken(token, address, platform);
  res.status(201).json({ ok: true });
});

const UnregisterSchema = z.object({
  token:      z.string().min(8).max(256),
  address:    AddressSchema,
  nonceToken: z.string().min(1).max(512),
  signature:  z.string().min(1).max(512),
});

pushRouter.post('/unregister', async (req: Request, res: Response) => {
  const parse = UnregisterSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation failed', issues: parse.error.issues }); return; }
  const { token, address, nonceToken, signature } = parse.data;
  if (!verifyPushProof(nonceToken, address, signature)) { res.status(401).json({ error: 'Invalid or expired proof of address ownership' }); return; }
  const removed = await removeTokenOwnedBy(token, address);
  if (!removed) { res.status(404).json({ error: 'Token not found for this address' }); return; }
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
  const supplied = Buffer.from(req.header('x-internal-secret') ?? '');
  const expected = Buffer.from(secret);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parse = NotifySchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: 'Validation failed', issues: parse.error.issues }); return; }
  const { address, title, body, data } = parse.data;
  const count = await notifyAddress(address, { title, body, data });
  res.json({ ok: true, delivered: count });
});
