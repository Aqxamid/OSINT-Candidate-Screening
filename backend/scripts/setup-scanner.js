// `npm run setup:scanner`: creates osint-scanner/.venv and installs Maigret.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getScannerDir } from '../utils/paths.js';

const scannerDir = getScannerDir();
const venvDir = path.join(scannerDir, '.venv');
const win = process.platform === 'win32';
const candidates = process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : win ? ['py', 'python'] : ['python3', 'python'];

const okPython = (bin) =>
  spawnSync(bin, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { stdio: 'ignore' }).status === 0;

const python = candidates.find(okPython);
if (!python) {
  console.error('Python 3.9+ was not found. Install it from https://www.python.org/downloads/ (tick "Add to PATH"), then retry.');
  process.exit(1);
}

const run = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: 'inherit', cwd: scannerDir });
  if (r.status !== 0) {
    console.error(`\nCommand failed: ${bin} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

if (!fs.existsSync(venvDir)) {
  console.log(`Creating virtual environment with "${python}"...`);
  run(python, ['-m', 'venv', venvDir]);
}
const venvPy = win ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
console.log('Installing scanner requirements (this can take a minute)...');
run(venvPy, ['-m', 'pip', 'install', '-r', path.join(scannerDir, 'requirements.txt')]);
console.log('\nScanner ready. Start the backend with: npm start');
