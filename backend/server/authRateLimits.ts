import rateLimit from 'express-rate-limit';

const isProd = process.env.NODE_ENV === 'production';

/** Login, OTP, and password-reset endpoints — brute-force protection. */
export const loginAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 40 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
  skip: () => !isProd,
});

/** PIN verify / recovery OTP — authenticated but guessable. */
export const pinBruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 80 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many PIN attempts. Please wait a few minutes and try again.' },
  skip: () => !isProd,
});
