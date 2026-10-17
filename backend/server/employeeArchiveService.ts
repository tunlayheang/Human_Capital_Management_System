import { Op } from 'sequelize';
import {
  AttendanceRecord,
  Employee,
  EmployeeMovement,
  EmployeeStatusHistory,
  HistoryEmployee,
  LeaveRequest,
  OvertimeRequest,
  Payslip,
  User,
} from './db.js';
import { countEmployeeDocuments } from './employeeDocumentService.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';
import { employeeLookupWhere, toCanonicalEmployeeDisplayId } from './employeeIdFormat.js';

const OFFBOARDED_STATUSES = ['terminated', 'resigned', 'absconded', 'retired', 'inactive'] as const;

export { OFFBOARDED_STATUSES };

function parseSnapshot(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function resolvePortalUserId(employee: InstanceType<typeof Employee>): Promise<string | null> {
  const linked = await User.findOne({
    where: { employeeId: String(employee.get('id')) },
    attributes: ['id'],
  });
  if (linked) return String(linked.get('id'));

  const email = String(employee.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  const byEmail = await User.findOne({ where: { email }, attributes: ['id'] });
  return byEmail ? String(byEmail.get('id')) : null;
}

export type EmployeeDataRetentionCounts = {
  attendanceRecords: number;
  leaveRequests: number;
  payslips: number;
  overtimeRequests: number;
  documents: number;
  movements: number;
  statusHistory: number;
};

export async function countEmployeeDataRetention(params: {
  employeePk: string;
  displayEmployeeId: string;
  portalUserId?: string | null;
}): Promise<EmployeeDataRetentionCounts> {
  const userId = params.portalUserId ?? null;
  const payslipWhere = userId
    ? { [Op.or]: [{ employeeId: params.displayEmployeeId }, { userId }] }
    : { employeeId: params.displayEmployeeId };

  const [attendanceRecords, leaveRequests, payslips, overtimeRequests, documents, movements, statusHistory] =
    await Promise.all([
      userId ? AttendanceRecord.count({ where: { userId } }) : 0,
      userId ? LeaveRequest.count({ where: { userId } }) : 0,
      Payslip.count({ where: payslipWhere }),
      userId ? OvertimeRequest.count({ where: { userId } }) : 0,
      countEmployeeDocuments(params.employeePk),
      EmployeeMovement.count({ where: { employee_id: params.displayEmployeeId } }),
      EmployeeStatusHistory.count({ where: { employee_id: params.employeePk } }),
    ]);

  return {
    attendanceRecords,
    leaveRequests,
    payslips,
    overtimeRequests,
    documents,
    movements,
    statusHistory,
  };
}

export async function listArchivedEmployees(limit = 100) {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = await HistoryEmployee.findAll({
    order: [['terminated_at', 'DESC']],
    limit: capped,
  });

  return rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const snap = parseSnapshot(plain.employee_snapshot);
    const name = snap
      ? joinEmployeeNameParts(
          (snap.first_name ?? snap.firstName) as string | undefined,
          (snap.last_name ?? snap.lastName) as string | undefined
        )
      : '';
    const terminatedAt = plain.terminated_at;
    return {
      id: plain.id,
      employeeId: plain.employee_id,
      employeePk: plain.employee_pk,
      employeeName: name,
      terminatedAt:
        terminatedAt instanceof Date
          ? terminatedAt.toISOString()
          : terminatedAt
            ? String(terminatedAt)
            : null,
      terminationReason: plain.termination_reason,
      terminatedBy: plain.terminated_by,
      restoredAt: plain.restored_at,
      isCurrentlyArchived: Boolean(plain.is_currently_terminated),
      hasSnapshot: Boolean(plain.employee_snapshot),
    };
  });
}

export async function getEmployeeArchiveDetail(displayEmployeeId: string) {
  const employee = await Employee.findOne({ where: employeeLookupWhere(displayEmployeeId) as never });
  if (!employee) {
    const err = new Error('Employee not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const portalUserId = await resolvePortalUserId(employee);
  const employeePk = String(employee.get('id'));
  const canonicalDisplayId =
    toCanonicalEmployeeDisplayId(employee.get('employee_id')) || displayEmployeeId;

  let retention: EmployeeDataRetentionCounts = {
    attendanceRecords: 0,
    leaveRequests: 0,
    payslips: 0,
    overtimeRequests: 0,
    documents: 0,
    movements: 0,
    statusHistory: 0,
  };
  try {
    retention = await countEmployeeDataRetention({
      employeePk,
      displayEmployeeId: canonicalDisplayId,
      portalUserId,
    });
  } catch (retentionErr) {
    console.warn(
      '[archive-detail] retention counts failed:',
      retentionErr instanceof Error ? retentionErr.message : retentionErr
    );
  }

  const archiveIdCandidates = [...new Set([displayEmployeeId, canonicalDisplayId, employeePk].filter(Boolean))];
  let archives: Awaited<ReturnType<typeof HistoryEmployee.findAll>> = [];
  try {
    archives = await HistoryEmployee.findAll({
      where: { employee_id: { [Op.in]: archiveIdCandidates } },
      order: [['terminated_at', 'DESC']],
      limit: 20,
    });
  } catch (archiveErr) {
    console.warn(
      '[archive-detail] history lookup failed:',
      archiveErr instanceof Error ? archiveErr.message : archiveErr
    );
  }

  const archiveRows = archives.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const snap = parseSnapshot(plain.employee_snapshot);
    const name = snap
      ? joinEmployeeNameParts(
          (snap.first_name ?? snap.firstName) as string | undefined,
          (snap.last_name ?? snap.lastName) as string | undefined
        )
      : '';
    const terminatedAt = plain.terminated_at;
    return {
      id: plain.id,
      terminatedAt:
        terminatedAt instanceof Date
          ? terminatedAt.toISOString()
          : terminatedAt
            ? String(terminatedAt)
            : null,
      terminationReason: plain.termination_reason,
      terminatedBy: plain.terminated_by,
      restoredAt: plain.restored_at,
      restoredBy: plain.restored_by,
      isCurrentlyArchived: Boolean(plain.is_currently_terminated),
      snapshotName: name,
      departmentName:
        (snap?.department as { name?: string } | undefined)?.name ??
        (snap?.department_name as string | undefined) ??
        null,
      positionTitle:
        (snap?.position as { title?: string } | undefined)?.title ??
        (snap?.position_title as string | undefined) ??
        null,
    };
  });

  const status = String(employee.get('status') ?? '').toLowerCase();
  const isOffboarded = OFFBOARDED_STATUSES.includes(
    status as (typeof OFFBOARDED_STATUSES)[number]
  );

  return {
    employeeId: canonicalDisplayId,
    employeePk,
    portalUserId,
    currentStatus: status,
    isOffboarded,
    retention,
    archives: archiveRows,
    dataRetained: true,
    retentionNote:
      'Historical attendance, payroll, leave, overtime, documents, and movement records are retained and linked to this employee.',
  };
}
