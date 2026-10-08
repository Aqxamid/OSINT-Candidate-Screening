import crypto from 'node:crypto';

const PLACEHOLDER = 'your_secure_admin_token_here';

export const isKeyConfigured = (key) =>
  typeof key === 'string' && key.length > 0 && key !== PLACEHOLDER;

/** Constant-time string comparison (hash first so lengths always match). */
export const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const safeDecode = (v) => {
  try { return decodeURIComponent(v); } catch { return v; }
};

export const parseCookies = (header = '') => {
  const out = Object.create(null);
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = safeDecode(part.slice(i + 1).trim());
  }
  return out;
};
