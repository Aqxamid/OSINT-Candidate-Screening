import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(BACKEND_DIR, '..');

export const getScannerDir = () =>
  process.env.SCANNER_DIR ? path.resolve(process.env.SCANNER_DIR) : path.join(PROJECT_ROOT, 'osint-scanner');
export const getReportsDir = () => path.join(getScannerDir(), 'reports');
export const getWorkerPath = () => path.join(getScannerDir(), 'scan_worker.py');

/** PYTHON_BIN, else the scanner's .venv, else python3 / python. */
export const resolvePython = () => {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const win = process.platform === 'win32';
  
  // Check local .venv first
  const venvPy = win
    ? path.join(getScannerDir(), '.venv', 'Scripts', 'python.exe')
    : path.join(getScannerDir(), '.venv', 'bin', 'python');
    
  if (fs.existsSync(venvPy)) return venvPy;

  // Fallback directly to 'python' (uses Windows PATH)
  return win ? 'python' : 'python3';
};
