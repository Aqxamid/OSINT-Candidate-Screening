import { isKeyConfigured, safeEqual } from '../utils/security.js';
import { hasValidSession } from '../services/sessionService.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated, state-changing requests: requires a custom header
 * (which browsers will not send cross-origin without a CORS preflight, and we send no CORS
 * headers) and, when an Origin header is present, that it matches this host.
 */
export const passesCsrf = (req) => {
  if (SAFE_METHODS.has(req.method)) return true;
  if (req.headers['x-requested-with'] !== 'pcs-dashboard') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
};

/** Accepts `Authorization: Bearer <ADMIN_API_KEY>` (API clients) or a valid dashboard session cookie. */
export const requireAdminAuth = (req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY;

  // Fail closed: never allow access if the server is misconfigured.
  if (!isKeyConfigured(adminKey)) {
    console.error('[auth] ADMIN_API_KEY is not configured. Rejecting request.');
    return res.status(500).json({ error: 'Server authentication is not configured' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || !safeEqual(token, adminKey)) {
      return res.status(403).json({ error: 'Forbidden: Invalid administrative credentials' });
    }
    req.authMethod = 'bearer';
    return next();
  }

  if (hasValidSession(req)) {
    if (!passesCsrf(req)) return res.status(403).json({ error: 'Forbidden: CSRF check failed' });
    req.authMethod = 'session';
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: sign in or provide a Bearer token' });
};
