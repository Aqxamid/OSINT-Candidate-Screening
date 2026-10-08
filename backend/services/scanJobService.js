import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { getScannerDir, getWorkerPath, resolvePython } from '../utils/paths.js';
import { formatApplicantsToCSV } from '../utils/csvFormatter.js';
import { validateApplicant } from '../utils/handleValidator.js';
import { deriveHandleFromName, normalizeHandle } from './applicantService.js';

const MAX_LOGS = 500;
const KILL_AFTER_CANCEL_MS = 15_000;

const freshState = () => ({
  running: false, startedAt: null, finishedAt: null, total: 0, done: 0,
  options: null, rows: {}, logs: [], counts: null, summary: null, error: null, cancelled: false
});

/** One scan at a time. Runs osint-scanner/scan_worker.py and relays its NDJSON events. */
class ScanJobService extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.state = freshState();
    this.child = null;
    this.killTimer = null;
  }

  snapshot() { return this.state; }
  broadcast(event) { this.emit('event', event); }

  pushLog(message) {
    const logs = this.state.logs;
    logs.push(String(message).slice(0, 2000));
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
    this.broadcast({ type: 'log', message: logs[logs.length - 1] });
  }

  async start(applicants, options) {
    if (this.state.running) throw Object.assign(new Error('A scan is already running'), { status: 409 });

    // Handle fallback: when the handle is missing, derive one from the full name.
    const processedApplicants = applicants.map((a) => {
      let handle = normalizeHandle(a.target_handle);
      if (!handle && a.fullname) handle = deriveHandleFromName(a.fullname);
      return { ...a, target_handle: handle };
    });

    const rows = {};
    for (const a of processedApplicants) {
      const problem = validateApplicant({ id: a.id, handle: a.target_handle });
      rows[String(a.id)] = problem ? { status: 'skipped', detail: problem, found: null } : { status: 'queued', detail: '', found: null };
    }
    this.state = { ...freshState(), running: true, startedAt: new Date().toISOString(), total: processedApplicants.length, options, rows };
    this.broadcast({ type: 'snapshot', state: this.state });

    let tmpDir;
    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pcs-osint-'));
      const csvPath = path.join(tmpDir, 'applicants.csv');
      await fs.writeFile(csvPath, formatApplicantsToCSV(processedApplicants), { encoding: 'utf8', mode: 0o600 });
      this.spawnWorker(csvPath, options, tmpDir);
    } catch (err) {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      this.finish(`Could not start scan: ${err.message}`);
    }
  }

  spawnWorker(csvPath, { force, topSites, timeoutMinutes }, tmpDir) {
    const args = [getWorkerPath(), csvPath, '--watch-stdin', '--top-sites', String(topSites), '--timeout', String(timeoutMinutes)];
    if (force) args.push('--force');

    const child = spawn(resolvePython(), args, {
      cwd: getScannerDir(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    this.child = child;
    let sawDone = false;
    let spawnError = null;

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return this.pushLog(line); }
      if (ev.type === 'done') sawDone = true;
      this.handleWorkerEvent(ev);
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => this.pushLog(`[stderr] ${line}`));
    child.stdin.on('error', () => {});

    child.on('error', (err) => { spawnError = `Cannot start Python (${resolvePython()}): ${err.message}`; });
    child.on('close', async (code) => {
      clearTimeout(this.killTimer);
      this.child = null;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (spawnError) return this.finish(spawnError);
      if (!sawDone && !this.state.error) return this.finish(`Scanner exited unexpectedly (code ${code}). Check the log and the Setup tab.`);
      this.finish(null);
    });
  }

  handleWorkerEvent(ev) {
    const s = this.state;
    switch (ev.type) {
      case 'log': this.pushLog(ev.message); break;
      case 'status': {
        const id = String(ev.id);
        s.rows[id] = { status: ev.status, detail: ev.detail || '', found: ev.found ?? null };
        this.broadcast({ type: 'status', id, status: ev.status, detail: ev.detail || '', found: ev.found ?? null });
        break;
      }
      case 'progress':
        s.done = ev.done; s.total = ev.total;
        this.broadcast({ type: 'progress', done: ev.done, total: ev.total });
        break;
      case 'done': s.counts = ev.counts; s.summary = ev.summary; s.cancelled = Boolean(ev.cancelled); break;
      case 'error': s.error = ev.message; break;
      default: break;
    }
  }

  finish(error) {
    if (error) this.state.error = error;
    this.state.running = false;
    this.state.finishedAt = new Date().toISOString();
    this.broadcast({ type: 'finished', state: this.state });
  }

  cancel() {
    if (!this.state.running || !this.child) return false;
    this.pushLog('Cancel requested...');
    try { this.child.stdin.write('cancel\n'); } catch { /* worker already gone */ }
    const child = this.child;
    this.killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_CANCEL_MS);
    return true;
  }
}

export const scanJobService = new ScanJobService();
