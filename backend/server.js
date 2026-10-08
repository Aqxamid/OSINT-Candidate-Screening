import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import osintRoutes from './routes/osintRoutes.js';
import { pool } from './config/db.js';
import { isKeyConfigured } from './utils/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '50mb' }));

// Web dashboard (static, locked-down CSP: no inline scripts, no third-party hosts)
const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "frame-ancestors *",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');
app.use(
  '/dashboard',
  (req, res, next) => {
    res.setHeader('Content-Security-Policy', DASHBOARD_CSP);
    res.setHeader('Cache-Control', 'no-store');
    next();
  },
  express.static(path.join(__dirname, 'public'))
);
app.get('/', (req, res) => res.redirect('/dashboard/'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// APIs
app.use('/api/admin/auth', authRoutes);
app.use('/api/admin/osint', osintRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('Unhandled error:', err);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`[PCS Backend] Server running on port ${PORT}`);
  console.log(`[PCS Backend] Dashboard: http://localhost:${PORT}/dashboard/`);
  const key = process.env.ADMIN_API_KEY;
  if (!isKeyConfigured(key)) console.warn('[PCS Backend] WARNING: ADMIN_API_KEY is not set; admin endpoints will refuse requests.');
  else if (key.length < 16) console.warn('[PCS Backend] WARNING: ADMIN_API_KEY is shorter than 16 characters.');
});

const shutdown = (signal) => {
  console.log(`[PCS Backend] ${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref(); // SSE streams keep connections open
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
