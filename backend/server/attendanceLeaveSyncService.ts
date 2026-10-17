/**
 * Keep attendancerecords aligned when leave is approved (complements planning roster sync).
 */
import { LeaveRequest } from './db.js';
import { reconcileAttendanceAbsences } from './attendanceReconcileService.js';

export async function syncApprovedLeaveToAttendanceRecords(
  leaveId: string
): Promise<{ ok: boolean; from?: string; to?: string; message?: string }> {
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, message: 'Leave request not found' };
  const plain = leave.get({ plain: true }) as {
    status?: string;
    startDate?: string;
    endDate?: string;
  };
  if (String(plain.status ?? '').toUpperCase() !== 'APPROVED') {
    return { ok: false, message: 'Leave is not approved' };
  }
  const from = String(plain.startDate ?? '').slice(0, 10);
  const to = String(plain.endDate ?? '').slice(0, 10);
  if (!from || !to || to < from) {
    return { ok: false, message: 'Invalid leave date range' };
  }
  await reconcileAttendanceAbsences({ from, to });
  return { ok: true, from, to };
}
