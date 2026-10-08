import path from 'node:path';
import {
  clearImportedApplicants,
  getImportedSource,
  getOsintApplicants,
  setImportedApplicants
} from '../services/applicantService.js';
import { scanJobService } from '../services/scanJobService.js';
import { deleteAllReports, deleteReport, getReportIndex, resolveReportFile } from '../services/reportService.js';
import { runSetupChecks } from '../services/setupService.js';
import { validateApplicant } from '../utils/handleValidator.js';
import { parseApplicantsCsv } from '../utils/csvParser.js';

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status || err.status >= 500) console.error(`[osint] ${req.method} ${req.originalUrl}:`, err);
    res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Internal server error' });
  });

const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// Reports hold scraped third-party content: render them with scripts disabled and no origin.
const REPORT_CSP = [
  'sandbox allow-popups allow-popups-to-escape-sandbox',
  "default-src 'none'",
  'img-src data: https: http:',
  "style-src 'unsafe-inline' https:",
  'font-src data: https:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

export const listApplicants = wrap(async (req, res) => {
  const [rows, reports] = await Promise.all([getOsintApplicants(), getReportIndex()]);
  const source = getImportedSource();
  const applicants = rows.map((r) => {
    const id = String(r.id);
    return {
      id,
      name: String(r.fullname ?? ''),
      handle: r.target_handle,
      is_fallback: Boolean(r.is_fallback),
      problem: validateApplicant({ id, handle: r.target_handle }),
      report: reports.get(id) ?? { has: false, html: false, json: false, found: null }
    };
  });
  res.json({ applicants, source });
});

export const importCsvApplicants = wrap(async (req, res) => {
  const { csv, filename } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content provided.' });
  }

  const parsed = parseApplicantsCsv(csv);
  if (!parsed.length) {
    return res.status(400).json({ error: 'Could not find any valid applicant rows in the CSV.' });
  }

  setImportedApplicants(parsed, filename || 'Uploaded CSV');
  console.log(`[audit] CSV imported: ${parsed.length} applicants from "${filename || 'custom CSV'}" by ${req.ip}`);
  res.json({ success: true, count: parsed.length, source: filename || 'Uploaded CSV' });
});

export const clearImported = wrap(async (req, res) => {
  clearImportedApplicants();
  res.json({ success: true, message: 'Reverted to database applicants.' });
});

export const startScan = wrap(async (req, res) => {
  const body = req.body ?? {};
  if (body.confirmed !== true) {
    return res.status(400).json({ error: 'Confirm that applicants were informed and the handles were supplied by them.' });
  }
  const options = {
    force: body.force === true,
    topSites: clampInt(body.topSites, 10, 1000, 200),
    timeoutMinutes: clampInt(body.timeoutMinutes, 1, 120, 15)
  };

  let applicants = await getOsintApplicants();
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length > 20000) return res.status(400).json({ error: 'ids must be an array' });
    const wanted = new Set(body.ids.map(String));
    applicants = applicants.filter((a) => wanted.has(String(a.id)));
  }
  if (!applicants.length) return res.status(400).json({ error: 'No applicants selected.' });

  await scanJobService.start([...applicants].reverse(), options); // oldest first
  console.log(`[audit] scan started: ${applicants.length} applicants, force=${options.force}, from ${req.ip}`);
  res.status(202).json({ started: true, total: applicants.length });
});

export const cancelScan = wrap(async (req, res) => {
  res.json({ cancelling: scanJobService.cancel() });
});

export const currentJob = wrap(async (req, res) => res.json({ job: scanJobService.snapshot() }));

export const streamJob = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  send({ type: 'snapshot', state: scanJobService.snapshot() });
  scanJobService.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    scanJobService.off('event', send);
  });
};

export const serveReport = wrap(async (req, res) => {
  const { id, kind } = req.params;
  const file = await resolveReportFile(id, kind);
  if (!file) return res.status(404).json({ error: 'Report not found' });

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (kind === 'html') {
    res.setHeader('Content-Security-Policy', REPORT_CSP);
    res.type('html');
  } else {
    res.type('application/json');
    res.setHeader('Content-Disposition', `attachment; filename="applicant_${id}.json"`);
  }
  // `root` avoids Express rejecting paths that contain dot-directories.
  res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'allow' });
});

export const removeReport = wrap(async (req, res) => {
  if (scanJobService.snapshot().running) return res.status(409).json({ error: 'A scan is running.' });
  if (!(await deleteReport(req.params.id))) return res.status(400).json({ error: 'Invalid applicant ID' });
  console.log(`[audit] report deleted: applicant ${req.params.id} by ${req.ip}`);
  res.json({ deleted: true });
});

export const removeAllReports = wrap(async (req, res) => {
  if (scanJobService.snapshot().running) return res.status(409).json({ error: 'A scan is running.' });
  const removed = await deleteAllReports();
  console.log(`[audit] all reports deleted (${removed} items) by ${req.ip}`);
  res.json({ deleted: removed });
});

export const setupStatus = wrap(async (req, res) => res.json(await runSetupChecks()));
