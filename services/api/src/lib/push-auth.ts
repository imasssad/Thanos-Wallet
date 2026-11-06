/**
 * Proof of wallet-address ownership for push-token registration (THN-R1
 * M-01).
 *
 * POST /push/register and /push/unregister take a plausible Expo token
 * plus an arbitrary address, with no server session (the mobile wallet is
 * local-first — there's nothing else to authenticate against). Nothing
 * previously proved the caller actually controls that address: anyone
 * holding their own valid Expo token could register it against someone
 * else's publicly-known wallet address and receive notifications meant for
 * them, and the unregister endpoint could drop a token it doesn't own.
 *
 * Fix: a short-lived, stateless, HMAC-signed nonce (no DB/Redis row to
 * manage) the client signs with personal_sign from the address being
 * registered/unregistered. The server reconstructs the exact message from
 * the nonce's own embedded fields and verifies the EIP-191 recovery
 * (ethers' verifyMessage) matches that address.
 */
import crypto from 'crypto';
import { verifyMessage } from 'ethers';

// Reused from the session JWT secret — already required to be present and
// >=32 chars by lib/jwt.ts, which the app always loads first; no new ops
// config needed for a second secret with the same trust level.
const SECRET = process.env.JWT_SECRET ?? '';
const NONCE_TTL_MS = 5 * 60_000;

function hmac(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

interface PushNoncePayload {
  address: string;
  nonce: string;
  exp: number;
}

function messageFor(p: PushNoncePayload): string {
  return `Thanos Wallet push notifications\n\nAddress: ${p.address}\nNonce: ${p.nonce}\nExpires: ${new Date(p.exp).toISOString()}`;
}

/** Issue a nonce for `address` (already expected lowercase) — the token is
 *  opaque to the client; `message` is what it must sign with personal_sign. */
export function issuePushNonce(address: string): { token: string; message: string } {
  const payload: PushNoncePayload = {
    address,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Date.now() + NONCE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${hmac(body)}`, message: messageFor(payload) };
}

/** True iff `token` was issued for `address`, hasn't expired, and
 *  `signature` is a valid personal_sign of its message by exactly that
 *  address. Every failure mode (malformed token, tampered HMAC, expired,
 *  wrong address, bad signature, recovered address mismatch) returns
 *  false — callers treat false as a flat reject, never partial trust. */
export function verifyPushProof(token: string, address: string, signature: string): boolean {
  try {
    const [body, mac] = token.split('.');
    if (!body || !mac || !/^[0-9a-f]+$/i.test(mac) || !timingSafeEqualHex(hmac(body), mac)) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PushNoncePayload;
    if (typeof payload.address !== 'string' || typeof payload.nonce !== 'string' || typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) return false;
    if (payload.address !== address.toLowerCase()) return false;
    const recovered = verifyMessage(messageFor(payload), signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}
