import { Router } from 'express';
import { exportOsintCsv } from '../controllers/osintExportController.js';
import { requireAdminAuth } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/admin/export-osint-csv
router.get('/export-osint-csv', requireAdminAuth, exportOsintCsv);

export default router;
