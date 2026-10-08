import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { PROJECT_ROOT, getScannerDir, getWorkerPath, resolvePython } from '../utils/paths.js';
import { isKeyConfigured } from '../utils/security.js';

const runWorkerCheck = () =>
  new Promise((resolve) => {
    const worker = getWorkerPath();
    if (!fs.existsSync(worker)) return resolve({ ok: false, error: `Worker not found: ${worker}` });
    let out = '';
    let err = '';
    const child = spawn(resolvePython(), [worker, '--check'], {
      cwd: getScannerDir(), windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' }
    });
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `Cannot start Python (${resolvePython()}): ${e.message}` }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const last = out.trim().split('\n').filter(Boolean).pop();
        resolve({ ok: true, checks: JSON.parse(last).checks });
      } catch {
        resolve({ ok: false, error: err.trim().split('\n').pop() || 'No output from scanner worker' });
      }
    });
  });

const patternExists = async (rel) => {
  const full = path.join(PROJECT_ROOT, rel);
  if (!rel.includes('*')) return fs.existsSync(full);
  const re = new RegExp('^' + path.basename(rel).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try {
    return (await fsp.readdir(path.dirname(full))).some((n) => re.test(n));
  } catch {
    return false;
  }
};

const loadFileChecklist = async () => {
  let list = [];
  try {
    list = JSON.parse(await fsp.readFile(path.join(PROJECT_ROOT, 'project-files.json'), 'utf8'));
  } catch { /* checklist file missing */ }
  return Promise.all(list.map(async (f) => ({ ...f, present: await patternExists(f.path) })));
};

export async function runSetupChecks() {
  const checks = [];
  const key = process.env.ADMIN_API_KEY;
  checks.push({
    label: 'ADMIN_API_KEY',
    ok: isKeyConfigured(key) && key.length >= 16,
    detail: !isKeyConfigured(key) ? 'Not set (or still the placeholder)' : key.length < 16 ? 'Set, but shorter than 16 characters' : 'Configured'
  });
  try {
    await pool.query('SELECT 1');
    checks.push({ label: 'Database', ok: true, detail: 'Connected' });
  } catch (e) {
    checks.push({ label: 'Database', ok: false, detail: `Cannot connect: ${e.message}` });
  }

  const worker = await runWorkerCheck();
  if (worker.ok) checks.push(...worker.checks);
  else checks.push({ label: 'Python scanner', ok: false, detail: `${worker.error}. Run: npm run setup:scanner` });

  return { checks, files: await loadFileChecklist(), python: resolvePython() };
}
