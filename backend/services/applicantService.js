import { pool } from '../config/db.js';

export const normalizeHandle = (h) => {
  if (!h) return '';
  let str = String(h).trim();
  // Strip URL if user pasted a profile link like https://github.com/username or instagram.com/username/
  str = str.replace(/^https?:\/\/[^/]+\/?/i, '');
  str = str.replace(/^[a-z0-9.-]+\.[a-z]{2,}\/?/i, '');
  // Remove query params or trailing slashes
  str = str.split('?')[0].split('#')[0].replace(/\/+$/, '');
  // Remove leading @ or symbols
  str = str.replace(/^[@/]+/, '').trim();
  // Keep only alphanumeric and . _ -
  str = str.replace(/[^A-Za-z0-9._-]/g, '');
  return str;
};

/**
 * Derives a candidate handle from a full name (e.g. "Myah Nicholai Estacio" -> "myahestacio")
 * Uses first + last name, or full cleaned name if only one word.
 */
export const deriveHandleFromName = (fullName) => {
  if (!fullName) return '';
  // Remove non-alphanumeric characters except spaces
  const clean = String(fullName).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  
  return last ? `${first}${last}` : first;
};

let importedApplicants = null;
let importedSource = null;

export const setImportedApplicants = (applicants, sourceName = 'CSV import') => {
  importedApplicants = applicants;
  importedSource = sourceName;
};

export const clearImportedApplicants = () => {
  importedApplicants = null;
  importedSource = null;
};

export const getImportedSource = () => importedSource;

/**
 * Returns applicants with id, fullname, and target_handle (no division).
 * If a CSV was imported in-memory, returns the imported applicants instead of querying the DB.
 */
export const getOsintApplicants = async () => {
  if (importedApplicants && importedApplicants.length > 0) {
    return importedApplicants.map((r, idx) => {
      let handle = normalizeHandle(r.target_handle);
      const isFallback = !handle && Boolean(r.fullname);
      if (!handle && r.fullname) {
        handle = deriveHandleFromName(r.fullname);
      }
      return {
        id: String(r.id || (idx + 1)),
        fullname: String(r.fullname || 'Unknown').trim(),
        target_handle: handle,
        is_fallback: isFallback
      };
    });
  }

  const { rows } = await pool.query(`
    SELECT
      id,
      fullname,
      handle AS target_handle
    FROM applicants
    ORDER BY id DESC
  `);

  return rows.map((r) => {
    let handle = normalizeHandle(r.target_handle);
    const isFallback = !handle && Boolean(r.fullname);
    if (!handle && r.fullname) {
      handle = deriveHandleFromName(r.fullname);
    }

    return {
      id: String(r.id),
      fullname: String(r.fullname || 'Unknown').trim(),
      target_handle: handle,
      is_fallback: isFallback
    };
  });
};