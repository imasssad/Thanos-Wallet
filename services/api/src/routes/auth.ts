import { Router, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from '../lib/jwt.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { authLimiter, sensitiveOpLimiter } from '../middleware/rate-limit.js';

export const authRouter = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email:       z.string().email(),
  password:    z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(64).optional(),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getClientMeta(req: Request) {
  return {
    ip:        req.ip ?? req.socket.remoteAddress ?? 'unknown',
    userAgent: req.headers['user-agent'] ?? 'unknown',
    platform:  (req.headers['x-platform'] as string) ?? 'web',
  };
}

async function logAuthEvent(
  userId: string | null,
  eventType: string,
  meta: Record<string, unknown>
) {
  await query(
    `INSERT INTO auth_events (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, eventType, meta.ip, meta.userAgent, JSON.stringify(meta)]
  );
}

// ─── POST /auth/register ────────────────────────────────────────────────────

authRouter.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parse = RegisterSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }

  const { email, password, displayName } = parse.data;
  const meta = getClientMeta(req);

  // Check existing user
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  // Hash password with Argon2id
  const passwordHash = await argon2.hash(password, {
    type:        argon2.argon2id,
    memoryCost:  65536,  // 64 MB
    timeCost:    3,
    parallelism: 4,
  });

  // Create user
  const [user] = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [email, passwordHash, displayName ?? null]
  );

  // Register device
  const [device] = await query<{ id: string }>(
    `INSERT INTO devices (user_id, platform, user_agent)
     VALUES ($1, $2, $3) RETURNING id`,
    [user.id, meta.platform, meta.userAgent]
  );

  // Create session
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  await query(
    `INSERT INTO sessions (user_id, device_id, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, device.id, refreshHash, meta.ip, meta.userAgent, refreshTokenExpiresAt()]
  );

  const [session] = await query<{ id: string }>(
    `SELECT id FROM sessions WHERE refresh_token = $1`,
    [refreshHash]
  );

  const accessToken = await signAccessToken({
    sub:       user.id,
    sessionId: session.id,
    deviceId:  device.id,
  });

  await logAuthEvent(user.id, 'register', meta);

  res.status(201).json({
    accessToken,
    refreshToken: refreshRaw,
    user: { id: user.id, email, displayName: displayName ?? null },
  });
});

// ─── POST /auth/login ───────────────────────────────────────────────────────

authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', issues: parse.error.issues });
    return;
  }

  const { email, password } = parse.data;
  const meta = getClientMeta(req);

  const user = await queryOne<{ id: string; password_hash: string; display_name: string | null; is_active: boolean }>(
    `SELECT id, password_hash, display_name, is_active FROM users WHERE email = $1`,
    [email]
  );

  if (!user || !user.is_active) {
    await logAuthEvent(null, 'failed_login', { ...meta, email, reason: 'user_not_found' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    await logAuthEvent(user.id, 'failed_login', { ...meta, reason: 'wrong_password' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Upsert device
  let device = await queryOne<{ id: string }>(
    `SELECT id FROM devices WHERE user_id = $1 AND user_agent = $2 AND platform = $3 LIMIT 1`,
    [user.id, meta.userAgent, meta.platform]
  );

  if (!device) {
    [device] = await query<{ id: string }>(
      `INSERT INTO devices (user_id, platform, user_agent) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, meta.platform, meta.userAgent]
    );
  } else {
    await query(`UPDATE devices SET last_seen_at = NOW() WHERE id = $1`, [device.id]);
  }

  // Create session
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken();
  const [session] = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, device_id, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [user.id, device.id, refreshHash, meta.ip, meta.userAgent, refreshTokenExpiresAt()]
  );

  const accessToken = await signAccessToken({
    sub:       user.id,
    sessionId: session.id,
    deviceId:  device.id,
  });

  await logAuthEvent(user.id, 'login', meta);

  res.json({
    accessToken,
    refreshToken: refreshRaw,
    user: { id: user.id, email, displayName: user.display_name },
  });
});

// ─── POST /auth/refresh ─────────────────────────────────────────────────────

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const parse = RefreshSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'refreshToken required' });
    return;
  }

  const hash = hashRefreshToken(parse.data.refreshToken);

  const session = await queryOne<{
    id: string; user_id: string; device_id: string | null;
    expires_at: Date; revoked: boolean;
  }>(
    `SELECT id, user_id, device_id, expires_at, revoked
     FROM sessions WHERE refresh_token = $1`,
    [hash]
  );

  if (!session || session.revoked || session.expires_at < new Date()) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  // Rotate refresh token
  const { raw: newRaw, hash: newHash } = generateRefreshToken();
  await query(
    `UPDATE sessions SET refresh_token = $1, expires_at = $2 WHERE id = $3`,
    [newHash, refreshTokenExpiresAt(), session.id]
  );

  const accessToken = await signAccessToken({
    sub:       session.user_id,
    sessionId: session.id,
    deviceId:  session.device_id ?? undefined,
  });

  res.json({ accessToken, refreshToken: newRaw });
});

// ─── POST /auth/logout ──────────────────────────────────────────────────────

authRouter.post('/logout', requireAuth, async (req: Request, res: Response) => {
  const { sessionId } = req as AuthRequest;
  await query(
    `UPDATE sessions SET revoked = true, revoked_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  await logAuthEvent((req as AuthRequest).userId, 'logout', getClientMeta(req));
  res.json({ ok: true });
});

// ─── GET /auth/me ───────────────────────────────────────────────────────────

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req as AuthRequest;
  const user = await queryOne<{ id: string; email: string; display_name: string | null; mfa_enabled: boolean; created_at: Date }>(
    `SELECT id, email, display_name, mfa_enabled, created_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// ─── GET /auth/sessions ─────────────────────────────────────────────────────

authRouter.get('/sessions', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req as AuthRequest;
  const sessions = await query(
    `SELECT s.id, s.ip_address, s.user_agent, d.platform, s.created_at, s.expires_at
     FROM sessions s
     LEFT JOIN devices d ON d.id = s.device_id
     WHERE s.user_id = $1 AND s.revoked = false AND s.expires_at > NOW()
     ORDER BY s.created_at DESC`,
    [userId]
  );
  res.json({ sessions });
});

// ─── DELETE /auth/sessions/:id ──────────────────────────────────────────────

authRouter.delete('/sessions/:id', requireAuth, sensitiveOpLimiter, async (req: Request, res: Response) => {
  const { userId } = req as AuthRequest;
  await query(
    `UPDATE sessions SET revoked = true, revoked_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId]
  );
  res.json({ ok: true });
});
