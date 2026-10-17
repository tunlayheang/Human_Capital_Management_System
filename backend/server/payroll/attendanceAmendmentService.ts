import { createPayrollAdjustment } from './payrollAdjustmentService.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { isAttendanceDateFrozen } from './attendanceFreezeGuard.js';
import type { PayrollAdjustmentType } from './hybridPayrollTypes.js';

export async function createAttendanceAmendment(params: {
  userId: string;
  workDate: string;
  description: string;
  proposedChanges: Record<string, unknown>;
  originalValues?: Record<string, unknown>;
  createdBy: string;
  amountUsd?: number;
  payrollGroupId?: string;
}) {
  const date = params.workDate.slice(0, 10);
  const frozen = await isAttendanceDateFrozen(date, params.payrollGroupId ?? 'default');
  if (!frozen) {
    const err = new Error(
      'Attendance amendment is only required after the payroll cutoff freeze. Edit attendance directly while the period is open.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const month = date.slice(0, 7);
  const adjustment = await createPayrollAdjustment({
    userId: params.userId,
    month,
    adjustmentType: 'ATTENDANCE_CORRECTION' as PayrollAdjustmentType,
    amountUsd: params.amountUsd ?? 0,
    description: params.description,
    oldValues: params.originalValues ?? { workDate: date },
    newValues: { workDate: date, ...params.proposedChanges },
    createdBy: params.createdBy,
  });

  await writePayrollAuditLog({
    entityType: 'attendance_amendment',
    entityId: String(adjustment.id),
    actionType: 'ATTENDANCE_AMENDMENT_CREATED',
    userId: params.createdBy,
    newValue: adjustment,
    metadata: { applyTo: 'next_payroll_or_adjustment_module', payrollGroupId: params.payrollGroupId },
  });

  return adjustment;
}
