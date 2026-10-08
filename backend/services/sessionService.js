import crypto from 'node:crypto';
import { parseCookies, safeEqual } from '../utils/security.js';

const COOKIE_NAME = 'pcs_admin';
let generatedSecret = null;

const getSecret = () => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  generatedSecret ??= crypto.randomBytes(32).toString('hex'); // sessions end on restart
  return generatedSecret;
};
const ttlMs = () => (Number(process.env.SESSION_TTL_HOURS) > 0 ? Number(process.env.SESSION_TTL_HOURS) : 8) * 3_600_000;
const useSecure = () =>
  process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

export const createSessionToken = () => {
  const exp = String(Date.now() + ttlMs());
  return `${exp}.${sign(exp)}`;
};

export const verifySessionToken = (token) => {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) <= Date.now()) return false;
  return safeEqual(sig, sign(exp));
};

export const hasValidSession = (req) => verifySessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);

const attrs = (maxAge) =>
  ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAge}`, useSecure() ? 'Secure' : null].filter(Boolean).join('; ');

export const buildSessionCookie = () => `${COOKIE_NAME}=${createSessionToken()}; ${attrs(Math.floor(ttlMs() / 1000))}`;
export const clearSessionCookie = () => `${COOKIE_NAME}=; ${attrs(0)}`;
