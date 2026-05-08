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
