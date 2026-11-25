import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AccessTokenPayload } from '../lib/jwt.js';
import { isSessionLive } from '../lib/sessions.js';
import { verifyStepUpToken } from '../lib/step-up.js';

export interface AuthRequest extends Request {
  userId:    string;
  sessionId: string;
  deviceId?: string;
}

/**
 * Express middleware that validates the Bearer JWT and that its session is
 * still live (not logged out / revoked — see lib/sessions.ts).
 * Attaches userId + sessionId to the request object.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  let payload: AccessTokenPayload;
  try {
    payload = await verifyAccessToken(token);
  } catch (err: any) {
    if (err?.code === 'ERR_JWT_EXPIRED') {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
    return;
  }

  // A database error is not a bad token: hand it to the error handler (500)
  // rather than answer 401, which clients treat as "signed out".
  let live: boolean;
  try {
    live = await isSessionLive(payload.sessionId, payload.sub);
  } catch (err) {
    next(err);
    return;
  }
  if (!live) {
    res.status(401).json({ error: 'Session revoked' });
    return;
  }

  (req as AuthRequest).userId    = payload.sub;
  (req as AuthRequest).sessionId = payload.sessionId;
  (req as AuthRequest).deviceId  = payload.deviceId;
  next();
}

/**
 * THN-R1 M-04: require a fresh step-up grant (POST /auth/step-up, which
 * re-confirms the account password) on top of requireAuth, for routes
 * where a stolen-but-valid access token alone shouldn't be enough — card
 * PIN view/change, full card details, card activation. Mount requireAuth
 * first; this reads req.userId/sessionId it set.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction): void {
  const { userId, sessionId } = req as AuthRequest;
  const token = req.header('x-step-up-token');
  if (!token || !verifyStepUpToken(token, userId, sessionId)) {
    res.status(403).json({ error: 'Re-confirm your password to continue', code: 'step_up_required' });
    return;
  }
  next();
}
