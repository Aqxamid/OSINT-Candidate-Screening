import { Router } from 'express';
import { requireAdminAuth } from '../middleware/authMiddleware.js';
import {
  cancelScan, clearImported, currentJob, importCsvApplicants, listApplicants,
  removeAllReports, removeReport, serveReport, setupStatus, startScan, streamJob
} from '../controllers/osintScanController.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/setup', setupStatus);
router.get('/applicants', listApplicants);
router.post('/applicants/import-csv', importCsvApplicants);
router.post('/applicants/clear-import', clearImported);

router.post('/scan', startScan);
router.post('/scan/cancel', cancelScan);
router.get('/jobs/current', currentJob);
router.get('/jobs/stream', streamJob);

router.get('/reports/:id/:kind', serveReport);
router.delete('/reports/:id', removeReport);
router.delete('/reports', removeAllReports);

export default router;
