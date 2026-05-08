import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';

export interface AuthRequest extends Request {
  userId:    string;
  sessionId: string;
  deviceId?: string;
}

/**
 * Express middleware that validates the Bearer JWT.
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
  try {
    const payload = await verifyAccessToken(token);
    (req as AuthRequest).userId    = payload.sub;
    (req as AuthRequest).sessionId = payload.sessionId;
    (req as AuthRequest).deviceId  = payload.deviceId;
    next();
  } catch (err: any) {
    if (err?.code === 'ERR_JWT_EXPIRED') {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}
