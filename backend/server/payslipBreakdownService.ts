import { Op } from 'sequelize';
import { PayslipBreakdown } from './db.js';
import { parseReviewContextFromJson } from './payroll/payrollReviewEnrichment.js';
import { inferPaymentMethodFromBank, normalizePaymentMethod } from './paymentMethod.js';
import {
  breakdownToRow,
  rowToBreakdown,
  plainToBreakdownRow,
  type PayslipBreakdownRow,
} from './payslipBreakdownDb.js';
import type { PayrollBreakdown } from './payrollCalculation.js';
import { normalizePayrollBreakdown } from './payrollCalculation.js';

export async function loadBreakdownForPayslipId(
  payslipId: string,
  legacyJson?: unknown
): Promise<PayrollBreakdown | null> {
  const row = await PayslipBreakdown.findByPk(payslipId);
  if (row) {
    return rowToBreakdown(row.get({ plain: true }) as PayslipBreakdownRow);
  }
  if (legacyJson != null) {
    return normalizePayrollBreakdown(legacyJson);
  }
  return null;
}

/** Lightweight batch read — net pay only (payment queue, summaries). */
export async function loadNetSalaryByPayslipIds(
  payslipIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(payslipIds.map((id) => String(id).trim()).filter(Boolean))];
  const result = new Map<string, number>();
  if (!ids.length) return result;

  const rows = (await PayslipBreakdown.findAll({
    where: { payslipId: { [Op.in]: ids } },
    attributes: ['payslipId', 'netSalary'],
    raw: true,
  })) as Array<{ payslipId?: string; netSalary?: unknown }>;

  for (const row of rows) {
    const payslipId = String(row.payslipId ?? '').trim();
    if (!payslipId) continue;
    result.set(payslipId, Number(row.netSalary) || 0);
  }
  return result;
}

export type PayslipPaymentCompensation = {
  paymentMethod: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxId: string | null;
  nssfId: string | null;
  currency: string;
};

function pickTrimmedField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return null;
}

/** Ignore placeholder compliance IDs stored as "0". */
function pickComplianceId(row: Record<string, unknown>, ...keys: string[]): string | null {
  const value = pickTrimmedField(row, ...keys);
  if (!value || value === '0') return null;
  return value;
}

export function resolvePaymentCompensationFromRecord(
  record: Record<string, unknown> | null | undefined
): PayslipPaymentCompensation {
  if (!record) {
    return {
      paymentMethod: 'bank',
      bankName: null,
      bankAccountNumber: null,
      taxId: null,
      nssfId: null,
      currency: 'USD',
    };
  }

  const bankName = pickTrimmedField(record, 'bank_name', 'bankName');
  const bankAccountNumber = pickTrimmedField(record, 'bank_account_number', 'bankAccountNumber');
  const currency = pickTrimmedField(record, 'currency') || 'USD';
  const taxId = pickComplianceId(record, 'tax_id', 'taxId');
  const nssfId = pickComplianceId(record, 'nssf_id', 'nssfId');
  const rawMethod = pickTrimmedField(record, 'payment_method', 'paymentMethod');
  let paymentMethod = rawMethod
    ? normalizePaymentMethod(rawMethod)
    : inferPaymentMethodFromBank(bankName, bankAccountNumber);
  if (paymentMethod === 'cash' && (bankName || bankAccountNumber)) {
    paymentMethod = 'bank';
  }
  return { paymentMethod, bankName, bankAccountNumber, taxId, nssfId, currency };
}

export function mergePaymentCompensation(
  primary: PayslipPaymentCompensation,
  fallback?: PayslipPaymentCompensation | null
): PayslipPaymentCompensation {
  if (!fallback) return primary;

  const bankName = primary.bankName || fallback.bankName;
  const bankAccountNumber = primary.bankAccountNumber || fallback.bankAccountNumber;
  const taxId = primary.taxId || fallback.taxId;
  const nssfId = primary.nssfId || fallback.nssfId;
  const currency = primary.currency || fallback.currency || 'USD';
  const primaryHasBank = Boolean(primary.bankName || primary.bankAccountNumber);
  const fallbackHasBank = Boolean(fallback.bankName || fallback.bankAccountNumber);
  const source = primaryHasBank ? primary : fallbackHasBank ? fallback : primary;
  let paymentMethod = source.paymentMethod;
  if (bankName || bankAccountNumber) {
    paymentMethod = normalizePaymentMethod(paymentMethod);
    if (paymentMethod === 'cash') paymentMethod = 'bank';
  }
  return { paymentMethod, bankName, bankAccountNumber, taxId, nssfId, currency };
}

/** Payroll-run snapshot fallback for payment queue bank export fields. */
export async function loadPaymentCompensationByPayslipIds(
  payslipIds: string[]
): Promise<Map<string, PayslipPaymentCompensation>> {
  const ids = [...new Set(payslipIds.map((id) => String(id).trim()).filter(Boolean))];
  const result = new Map<string, PayslipPaymentCompensation>();
  if (!ids.length) return result;

  const rows = (await PayslipBreakdown.findAll({
    where: { payslipId: { [Op.in]: ids } },
    attributes: ['payslipId', 'reviewContextJson'],
    raw: true,
  })) as Array<{ payslipId?: string; reviewContextJson?: string | null }>;

  for (const row of rows) {
    const payslipId = String(row.payslipId ?? '').trim();
    if (!payslipId) continue;
    const review = parseReviewContextFromJson(row.reviewContextJson);
    if (!review) continue;
    result.set(
      payslipId,
      resolvePaymentCompensationFromRecord(review as unknown as Record<string, unknown>)
    );
  }
  return result;
}

export type PaymentExportBreakdown = {
  grossPay: number;
  baseSalary: number;
  contractBaseSalary: number;
  allowanceTotal: number;
  otTotal: number;
  deductionsTotal: number;
  nssfEmployee: number;
  taxOnSalary: number;
  netPay: number;
  netPayKhr: number;
  exchangeRate: number;
  positionTitle: string | null;
  departmentName: string | null;
  taxId: string | null;
  nssfId: string | null;
};

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function allowanceTotalFromRow(row: Record<string, unknown>): number {
  return (
    num(row.allowanceTransport) +
    num(row.allowanceAttendance) +
    num(row.allowanceMeal) +
    num(row.allowanceSeniority) +
    num(row.allowanceSeniorityIndemnity) +
    num(row.allowancePosition) +
    num(row.allowanceCommission) +
    num(row.allowanceOtMeal)
  );
}

/** Financial + compliance snapshot for payment register export. */
export async function loadPaymentExportBreakdownByPayslipIds(
  payslipIds: string[]
): Promise<Map<string, PaymentExportBreakdown>> {
  const ids = [...new Set(payslipIds.map((id) => String(id).trim()).filter(Boolean))];
  const result = new Map<string, PaymentExportBreakdown>();
  if (!ids.length) return result;

  const rows = (await PayslipBreakdown.findAll({
    where: { payslipId: { [Op.in]: ids } },
    attributes: [
      'payslipId',
      'baseSalary',
      'contractBaseSalary',
      'grossSalary',
      'netSalary',
      'netSalaryKhr',
      'exchangeRate',
      'allowanceTransport',
      'allowanceAttendance',
      'allowanceMeal',
      'allowanceSeniority',
      'allowanceSeniorityIndemnity',
      'allowancePosition',
      'allowanceCommission',
      'allowanceOtMeal',
      'otTotal',
      'otAmount150',
      'otAmount200',
      'deductionNssf',
      'deductionTaxOnSalary',
      'deductionTotal',
      'reviewContextJson',
    ],
    raw: true,
  })) as Array<Record<string, unknown>>;

  for (const row of rows) {
    const payslipId = String(row.payslipId ?? '').trim();
    if (!payslipId) continue;
    const review = parseReviewContextFromJson(row.reviewContextJson);
    const otTotal =
      num(row.otTotal) > 0
        ? num(row.otTotal)
        : num(row.otAmount150) + num(row.otAmount200);
    const proratedBase = num(row.baseSalary);
    const contractBase = num(row.contractBaseSalary);
    const exportBaseSalary = proratedBase > 0 ? proratedBase : contractBase;
    result.set(payslipId, {
      grossPay: num(row.grossSalary),
      baseSalary: exportBaseSalary,
      contractBaseSalary: contractBase,
      allowanceTotal: allowanceTotalFromRow(row),
      otTotal,
      deductionsTotal: num(row.deductionTotal),
      nssfEmployee: num(row.deductionNssf),
      taxOnSalary: num(row.deductionTaxOnSalary),
      netPay: num(row.netSalary),
      netPayKhr: num(row.netSalaryKhr),
      exchangeRate: num(row.exchangeRate, 4100),
      positionTitle: review?.positionTitle?.trim() || null,
      departmentName: review?.departmentName?.trim() || null,
      taxId: review?.taxId?.trim() && review.taxId.trim() !== '0' ? review.taxId.trim() : null,
      nssfId: review?.nssfId?.trim() && review.nssfId.trim() !== '0' ? review.nssfId.trim() : null,
    });
  }

  const missingIds = ids.filter((id) => !result.has(id));
  if (missingIds.length) {
    await Promise.all(
      missingIds.map(async (payslipId) => {
        const breakdown = await loadBreakdownForPayslipId(payslipId);
        if (!breakdown) return;
        const review = breakdown.reviewContext;
        const allowances = breakdown.allowances ?? {
          transport: 0,
          attendance: 0,
          meal: 0,
          seniority: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        };
        const allowanceTotal =
          num(allowances.transport) +
          num(allowances.attendance) +
          num(allowances.meal) +
          num(allowances.seniority) +
          num(breakdown.seniorityIndemnity) +
          num(allowances.position) +
          num(allowances.commission) +
          num(allowances.otMeal);
        const otTotal = num(breakdown.overtime?.total);
        const proratedBase = num(breakdown.baseSalary);
        const contractBase = num(
          breakdown.contractBaseSalary ?? breakdown.hybrid?.fixed?.contractBaseSalary
        );
        const exportBaseSalary = proratedBase > 0 ? proratedBase : contractBase;
        result.set(payslipId, {
          grossPay: num(breakdown.grossSalary),
          baseSalary: exportBaseSalary,
          contractBaseSalary: contractBase,
          allowanceTotal,
          otTotal,
          deductionsTotal: num(breakdown.deductions?.total),
          nssfEmployee: num(breakdown.deductions?.nssf),
          taxOnSalary: num(breakdown.deductions?.taxOnSalary),
          netPay: num(breakdown.netSalary),
          netPayKhr: num(breakdown.netSalaryKHR),
          exchangeRate: num(breakdown.exchangeRate, 4100),
          positionTitle: review?.positionTitle?.trim() || null,
          departmentName: review?.departmentName?.trim() || null,
          taxId: review?.taxId?.trim() && review.taxId.trim() !== '0' ? review.taxId.trim() : null,
          nssfId: review?.nssfId?.trim() && review.nssfId.trim() !== '0' ? review.nssfId.trim() : null,
        });
      })
    );
  }

  return result;
}

export async function upsertBreakdownForPayslip(
  payslipId: string,
  breakdown: PayrollBreakdown
): Promise<void> {
  const payload = breakdownToRow(payslipId, breakdown);
  const existing = await PayslipBreakdown.findByPk(payslipId);
  if (existing) {
    await existing.update(payload);
  } else {
    await PayslipBreakdown.create(payload);
  }
}

export async function bulkUpsertBreakdowns(
  rows: PayslipBreakdownRow[]
): Promise<void> {
  for (const row of rows) {
    await upsertBreakdownForPayslip(row.payslipId, rowToBreakdown(row));
  }
}

async function ensurePayslipBreakdownColumn(column: string, ddl: string): Promise<void> {
  const { sequelize } = await import('./db.js');
  const [rows]: any = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payslipbreakdowns' AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [column] }
  );
  if (Array.isArray(rows) && rows.length) return;
  await sequelize.query(ddl);
  console.log(`[db] Added payslipbreakdowns.${column} column.`);
}

export async function ensurePayslipAllowanceColumns(): Promise<void> {
  await ensurePayslipBreakdownColumn(
    'allowancePosition',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `allowancePosition` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'allowanceCommission',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `allowanceCommission` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'allowanceOtMeal',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `allowanceOtMeal` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'allowanceBreakdownJson',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `allowanceBreakdownJson` longtext NULL'
  );
}

export async function ensurePayslipBreakdownSchema(): Promise<void> {
  const { sequelize } = await import('./db.js');
  await PayslipBreakdown.sync();

  await ensurePayslipBreakdownColumn(
    'allowanceSeniorityIndemnity',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `allowanceSeniorityIndemnity` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipAllowanceColumns();
  await ensurePayslipBreakdownColumn(
    'hybridComponentsJson',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `hybridComponentsJson` longtext NULL'
  );
  await ensurePayslipBreakdownColumn(
    'contractBaseSalary',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `contractBaseSalary` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'attendancePaidLeaveDays',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `attendancePaidLeaveDays` int(11) NOT NULL DEFAULT 0 AFTER `attendancePresentDays`'
  );
  await ensurePayslipBreakdownColumn(
    'attendancePaidDays',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `attendancePaidDays` int(11) NOT NULL DEFAULT 0 AFTER `attendancePaidLeaveDays`'
  );
  await ensurePayslipBreakdownColumn(
    'payrollAuditJson',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `payrollAuditJson` longtext NULL'
  );
  await ensurePayslipBreakdownColumn(
    'backPaymentUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `backPaymentUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'backPaymentSourceMonth',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `backPaymentSourceMonth` varchar(7) NULL'
  );
  await ensurePayslipBreakdownColumn(
    'reviewContextJson',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `reviewContextJson` longtext NULL'
  );
  await ensurePayslipBreakdownColumn(
    'taxableIncomeKhr',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `taxableIncomeKhr` decimal(14,0) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'taxableIncomeUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `taxableIncomeUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'taxAmountKhr',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `taxAmountKhr` decimal(14,0) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'taxAmountUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `taxAmountUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'exchangeRateUsed',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `exchangeRateUsed` decimal(10,2) NOT NULL DEFAULT 4100'
  );
  await ensurePayslipBreakdownColumn(
    'nssfSalaryKhr',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `nssfSalaryKhr` decimal(14,0) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'nssfSalaryUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `nssfSalaryUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'employeeContributionKhr',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `employeeContributionKhr` decimal(14,0) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'employeeContributionUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `employeeContributionUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'employerContributionKhr',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `employerContributionKhr` decimal(14,0) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'employerContributionUsd',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `employerContributionUsd` decimal(12,2) NOT NULL DEFAULT 0'
  );
  await ensurePayslipBreakdownColumn(
    'attendanceAbsentDays',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `attendanceAbsentDays` int(11) NOT NULL DEFAULT 0 AFTER `attendancePaidDays`'
  );
  await ensurePayslipBreakdownColumn(
    'attendanceScheduledWorkDays',
    'ALTER TABLE `payslipbreakdowns` ADD COLUMN `attendanceScheduledWorkDays` int(11) NOT NULL DEFAULT 0 AFTER `attendanceAbsentDays`'
  );

  const [columns] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payslips' AND COLUMN_NAME = 'breakdown'`
  )) as [{ COLUMN_NAME: string }[], unknown];

  if (!columns?.length) return;

  const [rows] = (await sequelize.query(
    `SELECT id, breakdown FROM payslips WHERE breakdown IS NOT NULL`
  )) as [{ id: string; breakdown: string | object }[], unknown];

  for (const row of rows ?? []) {
    const existing = await PayslipBreakdown.findByPk(row.id);
    if (existing) continue;
    let parsed: unknown = row.breakdown;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }
    const breakdownRow = plainToBreakdownRow({ payslipId: row.id, ...(parsed as object) });
    if (breakdownRow) {
      await PayslipBreakdown.create(breakdownRow);
    }
  }

  await sequelize.query(`ALTER TABLE payslips DROP COLUMN breakdown`);
  console.log('[db] Migrated payslips.breakdown JSON → payslipbreakdowns and dropped JSON column.');
}
