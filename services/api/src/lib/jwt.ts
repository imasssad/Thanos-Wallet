import * as jose from 'jose';
import crypto from 'crypto';

const JWT_SECRET  = process.env.JWT_SECRET;
const EXPIRES_IN  = process.env.JWT_EXPIRES_IN   ?? '15m';
const REFRESH_EXP = process.env.REFRESH_EXPIRES_IN ?? '30d';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

const secret = new TextEncoder().encode(JWT_SECRET);

export interface AccessTokenPayload {
  sub: string;          // user ID
  sessionId: string;
  deviceId?: string;
  iat?: number;
  exp?: number;
}

/**
 * Issue a signed JWT access token (short-lived — default 15 min).
 */
export async function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secret);
}

/**
 * Verify and decode an access token.
 * Throws JWTExpired or JWTInvalid on failure.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  // Pin the algorithm to exactly what signAccessToken issues. Without
  // the allowlist, jose accepts any HMAC variant the token header
  // claims — pinning closes off algorithm-confusion tricks outright.
  const { payload } = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload as unknown as AccessTokenPayload;
}

/**
 * Generate a secure opaque refresh token.
 * Returns both the raw token (sent to client) and its SHA-256 hash (stored in DB).
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw  = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Hash a raw refresh token for DB lookup.
 */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Parse a duration string like '30d', '15m', '7h' into milliseconds.
 */
export function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  const n = parseInt(match[1], 10);
  const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * map[match[2]];
}

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + parseDurationMs(REFRESH_EXP));
}
