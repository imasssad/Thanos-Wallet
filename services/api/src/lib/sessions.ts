import { queryOne } from './db.js';

/**
 * Whether the session an access token was minted for is still live: it
 * exists, belongs to the token's user, hasn't been revoked (logout, or
 * DELETE /auth/sessions/:id from another device) and hasn't expired.
 *
 * requireAuth checks this on every request, so revoking a session cuts its
 * access tokens off at once — a JWT alone stays valid until it expires, up
 * to JWT_EXPIRES_IN (15 min) after the user signed out.
 */
export async function isSessionLive(sessionId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM sessions
      WHERE id = $1 AND user_id = $2 AND revoked = false AND expires_at > NOW()`,
    [sessionId, userId]
  );
  return row !== null;
}
