// Mirrors osint-scanner/scanner_core.py (Python re-validates before every scan).
// Handles become CLI arguments: restrict charset and forbid a leading "-".
export const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const validateApplicant = ({ id, handle }) => {
  if (!ID_RE.test(String(id ?? ''))) return 'invalid or missing ID';
  if (!handle) return 'no handle provided';
  if (!HANDLE_RE.test(handle)) return 'invalid handle format';
  return null;
};
