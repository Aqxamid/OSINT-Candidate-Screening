import { isKeyConfigured, safeEqual } from '../utils/security.js';
import { createFailureLimiter } from '../utils/rateLimiter.js';
import { buildSessionCookie, clearSessionCookie } from '../services/sessionService.js';
import { passesCsrf } from '../middleware/authMiddleware.js';

const limiter = createFailureLimiter({ windowMs: 10 * 60_000, max: 5 });

export const login = (req, res) => {
  if (!passesCsrf(req)) return res.status(403).json({ error: 'Forbidden: CSRF check failed' });

  const adminKey = process.env.ADMIN_API_KEY;
  if (!isKeyConfigured(adminKey)) {
    return res.status(500).json({ error: 'Server authentication is not configured (set ADMIN_API_KEY)' });
  }

  const wait = limiter.retryAfterSeconds(req.ip);
  if (wait > 0) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` });
  }

  const key = req.body?.key;
  if (typeof key !== 'string' || !key || !safeEqual(key, adminKey)) {
    limiter.recordFailure(req.ip);
    console.warn(`[audit] failed dashboard login from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid admin key' });
  }

  limiter.clear(req.ip);
  console.log(`[audit] dashboard login from ${req.ip}`);
  res.setHeader('Set-Cookie', buildSessionCookie());
  return res.json({ ok: true });
};

export const logout = (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.json({ ok: true });
};

export const me = (req, res) => res.json({ authenticated: true });
