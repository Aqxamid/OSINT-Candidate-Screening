/** Tiny in-memory failure limiter (per key, e.g. client IP). */
export const createFailureLimiter = ({ windowMs = 10 * 60_000, max = 5 } = {}) => {
  const hits = new Map(); // key -> { count, resetAt }

  const prune = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, 60_000);
  prune.unref();

  const entry = (key) => {
    const e = hits.get(key);
    if (e && e.resetAt > Date.now()) return e;
    hits.delete(key);
    return null;
  };

  return {
    retryAfterSeconds(key) {
      const e = entry(key);
      return e && e.count >= max ? Math.ceil((e.resetAt - Date.now()) / 1000) : 0;
    },
    recordFailure(key) {
      const e = entry(key) ?? { count: 0, resetAt: Date.now() + windowMs };
      e.count += 1;
      hits.set(key, e);
    },
    clear(key) { hits.delete(key); }
  };
};
