import { Op, QueryTypes } from 'sequelize';
import { PayrollRun, Payslip, User, sequelize } from '../db.js';
import { createNotification } from '../notificationService.js';
import {
  loadPaymentCompensationByPayslipIds,
  loadPaymentExportBreakdownByPayslipIds,
  mergePaymentCompensation,
  resolvePaymentCompensationFromRecord,
  type PayslipPaymentCompensation,
} from '../payslipBreakdownService.js';
import { serializePayslipForApi } from '../payrollCalculation.js';
import {
  USER_ACCOUNT_ATTRIBUTES,
  type EmployeeProfilePayload,
} from '../userAccountService.js';
import { findEmployeeWithCompensation } from '../salaryStructureService.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { transitionPayrollRun } from './payrollWorkflowService.js';
import { assertPayrollPaymentUpdatesAllowed, resolvePayrollPaymentUpdateWindow } from './payrollPaymentUpdateWindow.js';

export type PayslipDisbursementStatus = 'PENDING' | 'PAID' | 'HOLDING';

const APPROVED_RUN_STATUSES = [
  'APPROVED',
  'LOCKED',
  'PAYMENT_PROCESSING',
  'PAID',
  'COMPLETED',
];

let disbursementSchemaReady = false;
let disbursementBackfillDone = false;

function formatMonthLabel(month: string): string {
  const raw = String(month ?? '').trim();
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (!match) return raw || 'Payroll period';
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const date = new Date(year, monthIndex, 1);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function ensurePayslipDisbursementSchema(): Promise<void> {
  if (!disbursementSchemaReady) {
    const [columns] = (await sequelize.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payslips' AND COLUMN_NAME = 'disbursementStatus' LIMIT 1`
    )) as [{ COLUMN_NAME?: string }[], unknown];

    if (!columns?.length) {
      await sequelize.query(
        `ALTER TABLE payslips
         ADD COLUMN disbursementStatus VARCHAR(16) NOT NULL DEFAULT 'PENDING' AFTER status,
         ADD COLUMN disbursementStatusAt VARCHAR(32) NULL AFTER disbursementStatus,
         ADD COLUMN disbursementStatusBy VARCHAR(64) NULL AFTER disbursementStatusAt,
         ADD COLUMN disbursementHoldNote TEXT NULL AFTER disbursementStatusBy`
      );
      console.log('[payroll] Added payslips disbursement columns.');
    }
    disbursementSchemaReady = true;
  }

  if (!disbursementBackfillDone) {
    await sequelize.query(
      `UPDATE payslips ps
       INNER JOIN payrollruns run ON run.id = ps.payrollRunId
       SET ps.disbursementStatus = 'PENDING'
       WHERE UPPER(run.status) IN ('APPROVED','LOCKED','PAYMENT_PROCESSING','PAID','COMPLETED')
         AND (ps.disbursementStatus IS NULL OR ps.disbursementStatus = '')`
    );
    disbursementBackfillDone = true;
  }
}

export async function initializePayslipDisbursementForRun(runId: string): Promise<void> {
  await ensurePayslipDisbursementSchema();
  await sequelize.query(
    `UPDATE payslips
     SET disbursementStatus = 'PENDING'
     WHERE payrollRunId = :runId
       AND (disbursementStatus IS NULL OR disbursementStatus = '')`,
    { replacements: { runId } }
  );
}

export type PayrollPaymentRunOption = {
  runId: string;
  month: string;
  monthLabel: string;
  status: string;
  totalEmployees: number;
  pendingCount: number;
  paidCount: number;
  holdingCount: number;
  /** Payment status mutations allowed until this ICT date (inclusive). */
  paymentEditableUntil: string | null;
  paymentUpdatesAllowed: boolean;
};

type DisbursementCountRow = {
  payrollRunId: string;
  totalEmployees: number;
  pendingCount: number;
  paidCount: number;
  holdingCount: number;
};

async function loadDisbursementCountsByRunId(
  runIds: string[]
): Promise<Map<string, DisbursementCountRow>> {
  const ids = [...new Set(runIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, DisbursementCountRow>();
  if (!ids.length) return map;

  const rows = (await sequelize.query(
    `SELECT payrollRunId,
            COUNT(*) AS totalEmployees,
            SUM(CASE WHEN UPPER(COALESCE(disbursementStatus, 'PENDING')) = 'PENDING' THEN 1 ELSE 0 END) AS pendingCount,
            SUM(CASE WHEN UPPER(disbursementStatus) = 'PAID' THEN 1 ELSE 0 END) AS paidCount,
            SUM(CASE WHEN UPPER(disbursementStatus) = 'HOLDING' THEN 1 ELSE 0 END) AS holdingCount
     FROM payslips
     WHERE payrollRunId IN (:runIds)
     GROUP BY payrollRunId`,
    { replacements: { runIds: ids }, type: QueryTypes.SELECT }
  )) as DisbursementCountRow[];

  for (const row of rows) {
    map.set(String(row.payrollRunId), {
      payrollRunId: String(row.payrollRunId),
      totalEmployees: Number(row.totalEmployees) || 0,
      pendingCount: Number(row.pendingCount) || 0,
      paidCount: Number(row.paidCount) || 0,
      holdingCount: Number(row.holdingCount) || 0,
    });
  }
  return map;
}

export async function listPayrollPaymentRuns(): Promise<PayrollPaymentRunOption[]> {
  await ensurePayslipDisbursementSchema();
  const runs = (await PayrollRun.findAll({
    where: { status: { [Op.in]: APPROVED_RUN_STATUSES } },
    order: [
      ['calculatedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: 100,
    raw: true,
  })) as Array<Record<string, unknown>>;

  if (!runs.length) return [];

  const countsByRunId = await loadDisbursementCountsByRunId(
    runs.map((run) => String(run.id ?? ''))
  );

  return runs.map((run) => {
    const runId = String(run.id ?? '');
    const counts = countsByRunId.get(runId);
    const window = resolvePayrollPaymentUpdateWindow(run);
    return {
      runId,
      month: String(run.month ?? ''),
      monthLabel: formatMonthLabel(String(run.month ?? '')),
      status: String(run.status ?? ''),
      totalEmployees: counts?.totalEmployees ?? 0,
      pendingCount: counts?.pendingCount ?? 0,
      paidCount: counts?.paidCount ?? 0,
      holdingCount: counts?.holdingCount ?? 0,
      paymentEditableUntil: window.paymentEditableUntil,
      paymentUpdatesAllowed: window.paymentUpdatesAllowed,
    };
  });
}

export type PayrollPaymentQueueItem = {
  payslipId: string;
  payrollRunId: string;
  userId: string;
  employeeId: string;
  employeeName: string;
  positionTitle: string | null;
  departmentName: string | null;
  email: string | null;
  phone: string | null;
  month: string;
  monthLabel: string;
  grossPay: number;
  baseSalary: number;
  allowanceTotal: number;
  otTotal: number;
  deductionsTotal: number;
  nssfEmployee: number;
  taxOnSalary: number;
  netPay: number;
  netPayKhr: number;
  exchangeRate: number;
  disbursementStatus: PayslipDisbursementStatus;
  disbursementStatusAt: string | null;
  disbursementHoldNote: string | null;
  runStatus: string;
  paymentMethod: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxId: string | null;
  nssfId: string | null;
  currency: string;
};

type PaymentQueueProfileEntry = {
  employee: EmployeeProfilePayload | null;
  displayName: string;
  userEmail: string | null;
  userPhone: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxId: string | null;
  nssfId: string | null;
  currency: string;
};

function profileFromEmployeePlain(plain: Record<string, unknown>): EmployeeProfilePayload {
  const firstKh = String(plain.first_name_kh || '').trim();
  const lastKh = String(plain.last_name_kh || '').trim();
  const dept = plain.department as { id?: string; name?: string } | undefined;
  const pos = plain.position as { id?: string; title?: string } | undefined;
  const positionTitle =
    String(pos?.title ?? '').trim() ||
    String(plain.job_position ?? '').trim() ||
    String(plain.position_title ?? '').trim() ||
    null;
  const departmentName =
    String(dept?.name ?? '').trim() ||
    String(plain.department_name ?? '').trim() ||
    null;
  return {
    id: String(plain.id ?? ''),
    employee_id: String(plain.employee_id || ''),
    first_name: String(plain.first_name || ''),
    last_name: String(plain.last_name || ''),
    full_name: `${String(plain.last_name || '').trim()} ${String(plain.first_name || '').trim()}`.trim(),
    first_name_kh: firstKh,
    last_name_kh: lastKh,
    full_name_kh: `${lastKh} ${firstKh}`.trim(),
    email: String(plain.email || ''),
    phone: String(plain.phone || ''),
    avatar_url: (plain.avatar_url as string) || null,
    department_id: String(plain.department_id || dept?.id || ''),
    department_name: departmentName,
    position_id: String(plain.position_id || pos?.id || ''),
    position_title: positionTitle,
    employment_type: (plain.employment_type as string) || null,
    work_location: (plain.work_location as string) || null,
    join_date: plain.join_date ? String(plain.join_date).split('T')[0] : null,
    status: (plain.status as string) || null,
  };
}

function resolveEmployeeDisplay(
  userId: string,
  profileByUserId: Map<string, PaymentQueueProfileEntry>
): {
  employeeId: string;
  employeeName: string;
  positionTitle: string | null;
  departmentName: string | null;
  email: string | null;
  phone: string | null;
  paymentMethod: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxId: string | null;
  nssfId: string | null;
  currency: string;
} {
  const entry = profileByUserId.get(userId);
  if (!entry) {
    return {
      employeeId: userId,
      employeeName: 'Employee',
      positionTitle: null,
      departmentName: null,
      email: null,
      phone: null,
      paymentMethod: 'bank',
      bankName: null,
      bankAccountNumber: null,
      taxId: null,
      nssfId: null,
      currency: 'USD',
    };
  }
  const emp = entry.employee;
  const employeeId = emp?.employee_id?.trim() || userId;
  const employeeName = emp?.full_name?.trim() || entry.displayName || 'Employee';
  const departmentName = emp?.department_name?.trim() || null;
  return {
    employeeId,
    employeeName,
    positionTitle: emp?.position_title?.trim() || null,
    departmentName,
    email: emp?.email?.trim() || entry.userEmail,
    phone: emp?.phone?.trim() || entry.userPhone,
    paymentMethod: entry.paymentMethod,
    bankName: entry.bankName,
    bankAccountNumber: entry.bankAccountNumber,
    taxId: entry.taxId,
    nssfId: entry.nssfId,
    currency: entry.currency,
  };
}

function resolveCompensationFromStructure(
  structure: Record<string, unknown> | undefined
): PayslipPaymentCompensation {
  return resolvePaymentCompensationFromRecord(structure);
}

function pickTrimmedField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return null;
}

async function buildPaymentQueueProfiles(userIds: string[]): Promise<Map<string, PaymentQueueProfileEntry>> {
  const ids = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, PaymentQueueProfileEntry>();
  if (!ids.length) return map;

  const users = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
    raw: true,
  });
  const userById = new Map(
    users.map((row) => [String((row as { id?: string }).id ?? ''), row as Record<string, unknown>])
  );

  await Promise.all(
    ids.map(async (userId) => {
      const userPlain = userById.get(userId);
      if (!userPlain) return;

      const merged = (await findEmployeeWithCompensation(userId)) as Record<string, unknown> | null;
      const employee = merged ? profileFromEmployeePlain(merged) : null;
      const compensation = resolveCompensationFromStructure(merged ?? undefined);
      const displayName =
        employee?.full_name?.trim() ||
        pickTrimmedField(userPlain, 'display_name', 'displayName') ||
        pickTrimmedField(userPlain, 'email') ||
        userId;

      map.set(userId, {
        employee,
        displayName,
        userEmail: pickTrimmedField(userPlain, 'email'),
        userPhone: pickTrimmedField(userPlain, 'phone'),
        ...compensation,
      });
    })
  );

  return map;
}

export async function listPayrollPaymentQueue(runId: string): Promise<PayrollPaymentQueueItem[]> {
  await ensurePayslipDisbursementSchema();
  const run = await PayrollRun.findByPk(runId, {
    attributes: ['id', 'month', 'status'],
    raw: true,
  });
  if (!run) {
    throw Object.assign(new Error('Payroll run not found.'), { statusCode: 404 });
  }
  const runStatus = String((run as { status?: string }).status ?? '').toUpperCase();
  if (!APPROVED_RUN_STATUSES.includes(runStatus)) {
    throw Object.assign(new Error('Only approved payroll runs can be paid out.'), { statusCode: 409 });
  }

  const payslips = (await Payslip.findAll({
    where: { payrollRunId: runId },
    attributes: [
      'id',
      'userId',
      'disbursementStatus',
      'disbursementStatusAt',
      'disbursementHoldNote',
    ],
    order: [['generatedAt', 'DESC']],
    raw: true,
  })) as Array<Record<string, unknown>>;

  if (!payslips.length) return [];

  const month = String((run as { month?: string }).month ?? '');
  const monthLabel = formatMonthLabel(month);
  const payslipIds = payslips.map((row) => String(row.id ?? ''));
  const userIds = payslips.map((row) => String(row.userId ?? ''));

  const [profileByUserId, compensationByPayslipId, breakdownByPayslipId] = await Promise.all([
    buildPaymentQueueProfiles(userIds),
    loadPaymentCompensationByPayslipIds(payslipIds),
    loadPaymentExportBreakdownByPayslipIds(payslipIds),
  ]);

  const items: PayrollPaymentQueueItem[] = payslips.map((plain) => {
    const payslipId = String(plain.id ?? '');
    const userId = String(plain.userId ?? '');
    const profile = resolveEmployeeDisplay(userId, profileByUserId);
    const compensation = mergePaymentCompensation(
      {
        paymentMethod: profile.paymentMethod,
        bankName: profile.bankName,
        bankAccountNumber: profile.bankAccountNumber,
        taxId: profile.taxId,
        nssfId: profile.nssfId,
        currency: profile.currency,
      },
      compensationByPayslipId.get(payslipId)
    );
    const breakdown = breakdownByPayslipId.get(payslipId);
    const {
      employeeId,
      employeeName,
      positionTitle,
      departmentName,
      email,
      phone,
    } = profile;

    return {
      payslipId,
      payrollRunId: runId,
      userId,
      employeeId,
      employeeName,
      positionTitle: positionTitle || breakdown?.positionTitle || null,
      departmentName: departmentName || breakdown?.departmentName || null,
      email,
      phone,
      paymentMethod: compensation.paymentMethod,
      bankName: compensation.bankName,
      bankAccountNumber: compensation.bankAccountNumber,
      taxId: compensation.taxId || breakdown?.taxId || null,
      nssfId: compensation.nssfId || breakdown?.nssfId || null,
      currency: compensation.currency,
      month,
      monthLabel,
      grossPay: breakdown?.grossPay ?? 0,
      baseSalary: breakdown?.baseSalary ?? 0,
      allowanceTotal: breakdown?.allowanceTotal ?? 0,
      otTotal: breakdown?.otTotal ?? 0,
      deductionsTotal: breakdown?.deductionsTotal ?? 0,
      nssfEmployee: breakdown?.nssfEmployee ?? 0,
      taxOnSalary: breakdown?.taxOnSalary ?? 0,
      netPay: breakdown?.netPay ?? 0,
      netPayKhr: breakdown?.netPayKhr ?? 0,
      exchangeRate: breakdown?.exchangeRate ?? 4100,
      disbursementStatus: normalizeDisbursementStatus(plain.disbursementStatus),
      disbursementStatusAt: plain.disbursementStatusAt ? String(plain.disbursementStatusAt) : null,
      disbursementHoldNote: plain.disbursementHoldNote ? String(plain.disbursementHoldNote) : null,
      runStatus,
    };
  });

  return items.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function normalizeDisbursementStatus(value: unknown): PayslipDisbursementStatus {
  const upper = String(value ?? 'PENDING').toUpperCase();
  if (upper === 'PAID' || upper === 'HOLDING') return upper;
  return 'PENDING';
}

async function maybeMarkRunPaid(runId: string, actorUserId: string): Promise<void> {
  const payslips = await Payslip.findAll({
    where: { payrollRunId: runId },
    attributes: ['disbursementStatus'],
    raw: true,
  });
  if (!payslips.length) return;
  const allPaid = payslips.every(
    (row) => String((row as { disbursementStatus?: string }).disbursementStatus ?? '').toUpperCase() === 'PAID'
  );
  if (!allPaid) return;

  const run: any = await PayrollRun.findByPk(runId);
  if (!run) return;
  const runStatus = String(run.status ?? '').toUpperCase();
  if (runStatus === 'PAID') return;
  if (!['APPROVED', 'LOCKED', 'PAYMENT_PROCESSING', 'COMPLETED'].includes(runStatus)) return;

  const reconciledAt = new Date().toISOString();
  await run.update({ paymentReconciledAt: reconciledAt });

  await transitionPayrollRun({
    runId,
    toStatus: 'PAID',
    actorUserId,
  });
}

export async function setPayslipDisbursementStatus(input: {
  payslipId: string;
  status: PayslipDisbursementStatus;
  actorUserId: string;
  holdNote?: string | null;
}): Promise<Record<string, unknown>> {
  await ensurePayslipDisbursementSchema();
  const payslip: any = await Payslip.findByPk(input.payslipId);
  if (!payslip) {
    throw Object.assign(new Error('Payslip not found.'), { statusCode: 404 });
  }

  const run: any = await PayrollRun.findByPk(String(payslip.payrollRunId ?? ''));
  if (!run) {
    throw Object.assign(new Error('Payroll run not found.'), { statusCode: 404 });
  }
  const runStatus = String(run.status ?? '').toUpperCase();
  if (!APPROVED_RUN_STATUSES.includes(runStatus)) {
    throw Object.assign(new Error('Payroll run must be approved before salary payment.'), {
      statusCode: 409,
    });
  }
  assertPayrollPaymentUpdatesAllowed(run.get ? run.get({ plain: true }) : run);

  const status = normalizeDisbursementStatus(input.status);
  const now = new Date().toISOString();
  const month = String(payslip.month ?? run.month ?? '');
  const monthLabel = formatMonthLabel(month);
  const userId = String(payslip.userId ?? '');

  await payslip.update({
    disbursementStatus: status,
    disbursementStatusAt: now,
    disbursementStatusBy: input.actorUserId,
    disbursementHoldNote: status === 'HOLDING' ? String(input.holdNote ?? '').trim() || null : null,
    ...(status === 'PAID' ? { status: 'PAID' } : {}),
  });

  if (status === 'PAID' && userId) {
    await createNotification({
      id: `payslip-paid-${payslip.id}`,
      userId,
      title: 'Salary payment released',
      message: `Your payslip for ${monthLabel} has been marked as paid. Open My Pay to view your payslip.`,
      type: 'SUCCESS',
      link: '/my-pay',
    });
  }

  if (status === 'HOLDING' && userId) {
    const note = String(input.holdNote ?? '').trim();
    await createNotification({
      id: `payslip-hold-${payslip.id}`,
      userId,
      title: 'Payslip on hold',
      message: note
        ? `Your payslip for ${monthLabel} has been placed on hold. ${note}`
        : `Your payslip for ${monthLabel} has been placed on hold. Please contact HR for details.`,
      type: 'WARNING',
      link: '/my-pay',
    });
  }

  await writePayrollAuditLog({
    entityType: 'payslip',
    entityId: String(payslip.id),
    actionType: `DISBURSEMENT_${status}`,
    userId: input.actorUserId,
    newValue: {
      disbursementStatus: status,
      disbursementStatusAt: now,
      disbursementHoldNote: status === 'HOLDING' ? input.holdNote ?? null : null,
    },
  });

  if (status === 'PAID') {
    await maybeMarkRunPaid(String(payslip.payrollRunId), input.actorUserId);
  }

  const serialized = await serializePayslipForApi(payslip, month, { runStatus });
  return {
    ...serialized,
    disbursementStatus: status,
    disbursementStatusAt: now,
    disbursementHoldNote: status === 'HOLDING' ? input.holdNote ?? null : null,
  };
}

export function employeeCanViewPayslipDisbursement(status: unknown): boolean {
  const normalized = normalizeDisbursementStatus(status);
  return normalized === 'PAID' || normalized === 'HOLDING';
}
