/**
 * Step-up authentication (THN-R1 M-04).
 *
 * A stolen but still-valid access token let a thief view/change a card PIN,
 * view full card details, or activate a card — requireAuth + ownsCard were
 * the only gates, and neither re-confirms anything closer to the sensitive
 * action itself. This adds a short-lived, scoped grant: the client
 * re-submits the account password (POST /auth/step-up), and only with that
 * fresh proof can it reach the gated routes, for a few minutes.
 *
 * Stateless — like lib/push-auth.ts's nonce — an HMAC-signed token carrying
 * {userId, sessionId, exp}, no DB row to manage. Scoped to the session that
 * requested it: a step-up token minted under one session can't be presented
 * under another, even for the same user.
 */
import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET ?? '';
const STEP_UP_TTL_MS = 5 * 60_000;

function hmac(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

interface StepUpPayload {
  userId:    string;
  sessionId: string;
  exp:       number;
}

export function issueStepUpToken(userId: string, sessionId: string): { token: string; expiresAt: string } {
  const payload: StepUpPayload = { userId, sessionId, exp: Date.now() + STEP_UP_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${hmac(body)}`, expiresAt: new Date(payload.exp).toISOString() };
}

/** True iff `token` is a step-up grant issued for exactly this userId +
 *  sessionId, and it hasn't expired. Any malformed/tampered/mismatched/
 *  expired input returns false — never partial trust. */
export function verifyStepUpToken(token: string, userId: string, sessionId: string): boolean {
  try {
    const [body, mac] = token.split('.');
    if (!body || !mac || !/^[0-9a-f]+$/i.test(mac) || !timingSafeEqualHex(hmac(body), mac)) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StepUpPayload;
    if (typeof payload.userId !== 'string' || typeof payload.sessionId !== 'string' || typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) return false;
    return payload.userId === userId && payload.sessionId === sessionId;
  } catch {
    return false;
  }
}
