/**
 * Format applicants into a CSV string containing ONLY:
 *   ID, Full_Name, Target_Handle
 * Any other property on the input objects is ignored by design.
 */
export const CSV_HEADERS = Object.freeze(['ID', 'Full_Name', 'Target_Handle']);

const escapeCell = (cell) => {
  if (cell === null || cell === undefined) return '""';
  let str = String(cell).replace(/[\r\n]+/g, ' ');
  // Neutralise spreadsheet formula injection (=, +, -, @, tab, CR)
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
};

export const formatApplicantsToCSV = (applicants) => {
  const rows = applicants.map((a) =>
    [a.id, a.fullname, a.target_handle].map(escapeCell).join(',')
  );
  // Leading BOM helps Excel read UTF-8 names correctly; the Python scanner uses utf-8-sig.
  return '\uFEFF' + [CSV_HEADERS.join(','), ...rows].join('\r\n') + '\r\n';
};
