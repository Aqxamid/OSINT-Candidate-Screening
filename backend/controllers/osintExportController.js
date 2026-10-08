import { getOsintApplicants } from '../services/applicantService.js';
import { formatApplicantsToCSV } from '../utils/csvFormatter.js';

export const exportOsintCsv = async (req, res) => {
  try {
    const rows = await getOsintApplicants();

    if (!rows.length) {
      return res.status(404).json({ message: 'No applicant records found for export.' });
    }

    const csvData = formatApplicantsToCSV(rows);
    const filename = `pcs_recruitment_osint_${new Date().toISOString().split('T')[0]}.csv`;

    // Lightweight audit trail: when/how many (no personal data logged).
    console.log(`[audit] OSINT CSV exported: ${rows.length} rows at ${new Date().toISOString()} from ${req.ip}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(csvData);
  } catch (error) {
    console.error('Error generating OSINT CSV:', error);
    return res.status(500).json({ error: 'Failed to generate OSINT CSV report.' });
  }
};
