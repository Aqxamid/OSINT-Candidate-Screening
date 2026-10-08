import { deriveHandleFromName, normalizeHandle } from '../services/applicantService.js';

/**
 * Robust CSV parser that extracts full name and handle with fallbacks.
 * Handles quoted fields, semicolons, tabs, commas, BOM, and arbitrary column names.
 * Supports separate First Name / Last Name columns.
 * Fallback: if no handle is given, derives handle from full name (first + last).
 */
export function parseApplicantsCsv(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];

  const rawLines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  // Detect delimiter: comma, semicolon, tab
  const firstLine = rawLines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter = tabCount > commaCount && tabCount > semiCount ? '\t' : semiCount > commaCount ? ';' : ',';

  const parseRow = (line) => {
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    return row.map((cell) => {
      let v = cell;
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (v.length > 1 && v[0] === "'" && '=+-@'.includes(v[1])) {
        v = v.slice(1);
      }
      return v.trim();
    });
  };

  const headerRow = parseRow(rawLines[0]);
  const normHeaders = headerRow.map((h) =>
    h.toLowerCase().replace(/[\s_\-./\\]+/g, '')
  );

  const idIdx = normHeaders.findIndex((h) =>
    ['id', 'applicantid', 'candidateid', 'num', 'no', 'number', 'entry', 'row'].includes(h)
  );

  const fullNameIdx = normHeaders.findIndex((h) =>
    ['fullname', 'name', 'applicantname', 'candidatename', 'studentname', 'person', 'applicant'].includes(h)
  );

  const firstNameIdx = normHeaders.findIndex((h) =>
    ['firstname', 'first', 'givenname', 'fname'].includes(h)
  );

  const lastNameIdx = normHeaders.findIndex((h) =>
    ['lastname', 'last', 'surname', 'familyname', 'lname'].includes(h)
  );

  const handleIdx = normHeaders.findIndex((h) =>
    [
      'targethandle', 'handle', 'username', 'user', 'socialhandle',
      'socials', 'social', 'github', 'githubhandle', 'twitter', 'instagram',
      'telegram', 'target', 'account'
    ].includes(h)
  );

  const results = [];
  const startIdx = (fullNameIdx !== -1 || firstNameIdx !== -1 || handleIdx !== -1) ? 1 : 0;

  for (let i = startIdx; i < rawLines.length; i++) {
    const row = parseRow(rawLines[i]);
    if (!row || row.every((c) => !c)) continue;

    let fullName = '';
    if (fullNameIdx !== -1 && row[fullNameIdx]) {
      fullName = row[fullNameIdx];
    } else if (firstNameIdx !== -1 || lastNameIdx !== -1) {
      const first = (firstNameIdx !== -1 ? row[firstNameIdx] : '') || '';
      const last = (lastNameIdx !== -1 ? row[lastNameIdx] : '') || '';
      fullName = `${first} ${last}`.trim();
    } else if (row[0] && isNaN(Number(row[0])) && !row[0].startsWith('@')) {
      fullName = row[0];
    }

    let rawHandle = handleIdx !== -1 && row[handleIdx] !== undefined ? row[handleIdx] : '';
    let handle = normalizeHandle(rawHandle);

    // Fallback: If no handle was provided or handle is invalid, derive from full name or first + last
    if (!handle && fullName) {
      handle = deriveHandleFromName(fullName);
    }

    const rawId = (idIdx !== -1 && row[idIdx]) ? row[idIdx] : String(results.length + 1);

    if (fullName || handle) {
      results.push({
        id: String(rawId),
        fullname: fullName || handle,
        target_handle: handle || (fullName ? deriveHandleFromName(fullName) : '')
      });
    }
  }

  return results;
}
