import fs from 'node:fs/promises';
import path from 'node:path';
import { getReportsDir } from '../utils/paths.js';
import { ID_RE } from '../utils/handleValidator.js';

const folderFor = (id) => path.join(getReportsDir(), `applicant_${id}`);

async function walk(dir, depth = 3) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory() && depth > 0) out.push(...(await walk(p, depth - 1)));
  }
  return out.sort();
}

async function inspect(dir) {
  const files = await walk(dir);
  const htmlPath = files.find((f) => f.toLowerCase().endsWith('.html')) ?? null;
  const jsonPath = files.find((f) => f.toLowerCase().endsWith('.json')) ?? null;
  let found = null;
  if (jsonPath) {
    try {
      const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      if (Array.isArray(data)) found = data.length;
      else if (data && typeof data === 'object') found = Object.values(data).filter((v) => v && typeof v === 'object').length;
    } catch { /* unreadable JSON: leave null */ }
  }
  return { has: Boolean(htmlPath || jsonPath), html: Boolean(htmlPath), json: Boolean(jsonPath), found, htmlPath, jsonPath };
}

/** Map of applicantId -> { has, html, json, found } for every report folder on disk. */
export async function getReportIndex() {
  const index = new Map();
  let names = [];
  try {
    names = await fs.readdir(getReportsDir());
  } catch {
    return index;
  }
  for (const name of names) {
    const m = /^applicant_(.+)$/.exec(name);
    if (!m || !ID_RE.test(m[1])) continue;
    const { htmlPath, jsonPath, ...pub } = await inspect(path.join(getReportsDir(), name));
    if (pub.has) index.set(m[1], pub);
  }
  return index;
}

/** Absolute path of a report file, or null. `kind` must be 'html' or 'json'. */
export async function resolveReportFile(id, kind) {
  if (!ID_RE.test(String(id)) || !['html', 'json'].includes(kind)) return null;
  const info = await inspect(folderFor(id));
  const file = kind === 'html' ? info.htmlPath : info.jsonPath;
  if (!file) return null;
  try {
    const [realFile, realBase] = await Promise.all([fs.realpath(file), fs.realpath(getReportsDir())]);
    return realFile.startsWith(realBase + path.sep) ? realFile : null; // block symlink escapes
  } catch {
    return null;
  }
}

export async function deleteReport(id) {
  if (!ID_RE.test(String(id))) return false;
  await fs.rm(folderFor(id), { recursive: true, force: true });
  return true;
}

/** Deletes every applicant report folder and every run summary (retention clean-up). */
export async function deleteAllReports() {
  let names = [];
  try {
    names = await fs.readdir(getReportsDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (/^applicant_[A-Za-z0-9_-]+$/.test(name) || /^summary_.+\.csv$/.test(name)) {
      await fs.rm(path.join(getReportsDir(), name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
