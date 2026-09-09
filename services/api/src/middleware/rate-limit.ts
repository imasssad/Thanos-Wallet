import rateLimit from 'express-rate-limit';

const WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000', 10);
const MAX    = parseInt(process.env.RATE_LIMIT_MAX    ?? '100', 10);

/** General API rate limit */
export const generalLimiter = rateLimit({
  windowMs: WINDOW,
  max: MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Strict limiter for auth endpoints — prevents brute force */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,                      // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

/** Very strict limiter for password-change / sensitive ops */
export const sensitiveOpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sensitive requests. Please wait 1 hour.' },
});

/** Separate budget for LAX card fund-movement (topup/issue) — deliberately
 *  NOT the same instance as sensitiveOpLimiter. express-rate-limit shares
 *  one counter per IP across every route a given limiter instance is
 *  attached to, so reusing sensitiveOpLimiter here would silently couple
 *  a user's LAX card actions to their unrelated auth.ts session-revocation
 *  budget (and to each other) — burning attempts on one feature would
 *  throttle the other. With no LAX sandbox to rehearse against, real
 *  fund-moving calls need their own headroom. */
export const laxOpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many card requests. Please wait 1 hour.' },
});
