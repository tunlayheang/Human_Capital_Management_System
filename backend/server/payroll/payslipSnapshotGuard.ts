import { Payslip } from '../db.js';
import { loadBreakdownForPayslipId } from '../payslipBreakdownService.js';

/** Block approval when calculated snapshots are missing — prevents locking empty historical records. */
export async function assertPayrollRunBreakdownSnapshots(runId: string): Promise<void> {
  const payslips = await Payslip.findAll({
    where: { payrollRunId: runId },
    attributes: ['id', 'userId'],
  });
  const missing: string[] = [];
  for (const ps of payslips) {
    const id = String(ps.get('id'));
    const breakdown = await loadBreakdownForPayslipId(id);
    if (!breakdown) {
      missing.push(String(ps.get('userId') ?? id));
    }
  }
  if (missing.length) {
    const err = new Error(
      `Cannot approve payroll: missing calculation snapshot for ${missing.slice(0, 5).join(', ')}${
        missing.length > 5 ? ` (+${missing.length - 5} more)` : ''
      }. Recalculate the run first.`
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
}
