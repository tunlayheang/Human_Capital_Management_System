import { format, parseISO } from 'date-fns';
import type { PayrollPaymentQueueItem, PayrollPaymentRunOption } from '../types';
import {
  buildTabularMetadataAoa,
  csvRow,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvLines,
  exportFilename,
  exportGeneratedAtLabel,
  type ExportFileExt,
  type TabularMetadataField,
} from './export/exportDocumentStandard';
import { normalizePaymentMethod, paymentMethodLabel } from './paymentMethod';
import { normalizeEmployeeDisplayId } from './index';

/** Full payment register — every payslip with payroll and disbursement fields. */
const REGISTER_HEADERS = [
  'No.',
  'Payment Reference',
  'Payslip ID',
  'Employee ID',
  'Employee Name',
  'Job Title',
  'Department',
  'Email',
  'Phone',
  'Payment Method',
  'Bank Name',
  'Account Number',
  'Tax ID',
  'NSSF ID',
  'Currency',
  'Base Salary (USD)',
  'Allowances (USD)',
  'OT (USD)',
  'Gross Pay (USD)',
  'NSSF Employee (USD)',
  'Tax (USD)',
  'Total Deductions (USD)',
  'Net Pay (USD)',
  'Net Pay (KHR)',
  'Exchange Rate',
  'Disbursement Status',
  'Hold Note',
  'Status Updated',
  'Payroll Period',
] as const;

/** Bank-upload subset (ABA / ACLEDA-style import). */
const BANK_TRANSFER_HEADERS = [
  'Payment Reference',
  'Employee ID',
  'Beneficiary Name',
  'Job Title',
  'Department',
  'Bank Name',
  'Account Number',
  'Tax ID',
  'Currency',
  'Amount (USD)',
  'Amount (KHR)',
  'Remarks',
] as const;

function paymentReference(month: string, employeeId: string): string {
  const period = String(month).slice(0, 7).replace(/-/g, '');
  const id = String(employeeId).trim().replace(/\s+/g, '');
  return `SAL-${period}-${id}`;
}

function roundUsd(value: number): string {
  return Number(value || 0).toFixed(2);
}

function roundKhr(value: number): string {
  return String(Math.round(Number(value || 0)));
}

function disbursementStatusLabel(status: string): string {
  const upper = String(status).toUpperCase();
  if (upper === 'PAID') return 'Paid';
  if (upper === 'HOLDING') return 'Holding';
  return 'Pending';
}

function formatStatusUpdated(value: string | null): string {
  if (!value) return '';
  try {
    return format(parseISO(value), 'yyyy-MM-dd HH:mm');
  } catch {
    return value;
  }
}

export function bankTransferRows(rows: PayrollPaymentQueueItem[]): PayrollPaymentQueueItem[] {
  return rows.filter((row) => normalizePaymentMethod(row.paymentMethod) === 'bank');
}

export function bankUploadRows(rows: PayrollPaymentQueueItem[]): PayrollPaymentQueueItem[] {
  return bankTransferRows(rows).filter((row) =>
    Boolean(String(row.bankAccountNumber ?? '').trim())
  );
}

export type PayrollPaymentBankExportResult = {
  totalRowCount: number;
  bankRowCount: number;
  bankRowsWithAccountCount: number;
  cashRowCount: number;
};

function summarizeExport(rows: PayrollPaymentQueueItem[]): PayrollPaymentBankExportResult {
  const bankRows = bankTransferRows(rows);
  const bankRowsWithAccountCount = bankUploadRows(rows).length;
  const cashRowCount = rows.filter(
    (row) => normalizePaymentMethod(row.paymentMethod) === 'cash'
  ).length;
  return {
    totalRowCount: rows.length,
    bankRowCount: bankRows.length,
    bankRowsWithAccountCount,
    cashRowCount,
  };
}

function buildMetadataFields(
  run: PayrollPaymentRunOption,
  rows: PayrollPaymentQueueItem[],
  summary: PayrollPaymentBankExportResult
): TabularMetadataField[] {
  const grandTotalUsd = rows.reduce((sum, row) => sum + Number(row.netPay || 0), 0);
  const grandTotalKhr = rows.reduce((sum, row) => sum + Number(row.netPayKhr || 0), 0);
  const bankTotalUsd = bankTransferRows(rows).reduce(
    (sum, row) => sum + Number(row.netPay || 0),
    0
  );
  return [
    { label: 'Payroll Period', value: run.monthLabel },
    { label: 'Run ID', value: run.runId },
    { label: 'Run Status', value: run.status },
    { label: 'Total payslips', value: summary.totalRowCount },
    { label: 'Bank transfer', value: summary.bankRowCount },
    { label: 'Cash', value: summary.cashRowCount },
    { label: 'Bank rows with account number', value: summary.bankRowsWithAccountCount },
    { label: 'Grand total (USD)', value: roundUsd(grandTotalUsd) },
    { label: 'Grand total (KHR)', value: roundKhr(grandTotalKhr) },
    { label: 'Bank transfer total (USD)', value: roundUsd(bankTotalUsd) },
    { label: 'Exported at', value: format(new Date(), 'yyyy-MM-dd HH:mm') },
  ];
}

function buildBankTransferRow(row: PayrollPaymentQueueItem): string[] {
  const employeeId = normalizeEmployeeDisplayId(row.employeeId);
  return [
    paymentReference(row.month, employeeId),
    employeeId,
    row.employeeName,
    row.positionTitle ?? '',
    row.departmentName ?? '',
    row.bankName ?? '',
    row.bankAccountNumber ?? '',
    row.taxId ?? '',
    row.currency || 'USD',
    roundUsd(row.netPay),
    roundKhr(row.netPayKhr),
    `Salary ${row.monthLabel}`,
  ];
}

function buildRegisterRow(row: PayrollPaymentQueueItem, index: number): string[] {
  const employeeId = normalizeEmployeeDisplayId(row.employeeId);
  return [
    String(index + 1),
    paymentReference(row.month, employeeId),
    row.payslipId,
    employeeId,
    row.employeeName,
    row.positionTitle ?? '',
    row.departmentName ?? '',
    row.email ?? '',
    row.phone ?? '',
    paymentMethodLabel(normalizePaymentMethod(row.paymentMethod)),
    row.bankName ?? '',
    row.bankAccountNumber ?? '',
    row.taxId ?? '',
    row.nssfId ?? '',
    row.currency || 'USD',
    roundUsd(row.baseSalary),
    roundUsd(row.allowanceTotal),
    roundUsd(row.otTotal),
    roundUsd(row.grossPay),
    roundUsd(row.nssfEmployee),
    roundUsd(row.taxOnSalary),
    roundUsd(row.deductionsTotal),
    roundUsd(row.netPay),
    roundKhr(row.netPayKhr),
    roundUsd(row.exchangeRate),
    disbursementStatusLabel(row.disbursementStatus),
    row.disbursementHoldNote ?? '',
    formatStatusUpdated(row.disbursementStatusAt),
    row.monthLabel,
  ];
}

function buildRegisterTotalsRow(rows: PayrollPaymentQueueItem[]): string[] {
  const sum = (pick: (row: PayrollPaymentQueueItem) => number) =>
    rows.reduce((acc, row) => acc + pick(row), 0);
  return [
    'TOTALS',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    roundUsd(sum((row) => row.baseSalary)),
    roundUsd(sum((row) => row.allowanceTotal)),
    roundUsd(sum((row) => row.otTotal)),
    roundUsd(sum((row) => row.grossPay)),
    roundUsd(sum((row) => row.nssfEmployee)),
    roundUsd(sum((row) => row.taxOnSalary)),
    roundUsd(sum((row) => row.deductionsTotal)),
    roundUsd(sum((row) => row.netPay)),
    roundKhr(sum((row) => row.netPayKhr)),
    '',
    '',
    '',
    '',
    '',
  ];
}

function registerCsvLines(rows: PayrollPaymentQueueItem[]): string[] {
  return [
    csvRow([...REGISTER_HEADERS]),
    ...rows.map((row, index) => csvRow(buildRegisterRow(row, index))),
    csvRow(buildRegisterTotalsRow(rows)),
  ];
}

export function exportPayrollPaymentBankCsv(
  rows: PayrollPaymentQueueItem[],
  run: PayrollPaymentRunOption
): PayrollPaymentBankExportResult {
  const summary = summarizeExport(rows);
  downloadCsvLines(
    registerCsvLines(rows),
    exportFilename('Payroll_Payment_Register', [run.month], 'csv')
  );
  return summary;
}

export async function exportPayrollPaymentBankExcel(
  rows: PayrollPaymentQueueItem[],
  run: PayrollPaymentRunOption
): Promise<PayrollPaymentBankExportResult> {
  const summary = summarizeExport(rows);
  const bankRows = bankTransferRows(rows);
  const metadataFields = buildMetadataFields(run, rows, summary);
  const metadata = buildTabularMetadataAoa('Payroll Payment Register', metadataFields);

  const registerSheet: (string | number)[][] = [
    ...metadata,
    [...REGISTER_HEADERS],
    ...rows.map((row, index) => buildRegisterRow(row, index)),
    buildRegisterTotalsRow(rows),
  ];

  const bankSheet: (string | number)[][] = [
    ...buildTabularMetadataAoa('Bank Transfer Register', metadataFields),
    [...BANK_TRANSFER_HEADERS],
    ...bankRows.map((row) => buildBankTransferRow(row)),
  ];

  await downloadBrandedWorkbookAsXlsx({
    filename: exportFilename('Payroll_Payment_Register', [run.month], 'xlsx'),
    reportTitle: 'Payroll Payment Register',
    fields: metadataFields.slice(0, 6).map((f) => ({
      label: f.label,
      value: String(f.value ?? ''),
    })),
    period: { from: run.month, to: run.month },
    purpose: 'Payroll payment and bank transfer register.',
    note: `Generated ${exportGeneratedAtLabel()}`,
    sheets: [
      {
        name: 'All Payslips',
        aoa: registerSheet,
        headerRows: [metadata.length],
        totalsLastRow: true,
        columnWidths: REGISTER_HEADERS.map((header) => Math.min(Math.max(header.length + 2, 12), 28)),
      },
      {
        name: 'Bank Transfer',
        aoa: bankSheet,
        headerRows: [buildTabularMetadataAoa('Bank Transfer Register', metadataFields).length],
        columnWidths: BANK_TRANSFER_HEADERS.map((header) => Math.min(Math.max(header.length + 2, 12), 28)),
      },
    ],
  });
  return summary;
}

export async function exportPayrollPaymentBankFile(
  format: ExportFileExt,
  rows: PayrollPaymentQueueItem[],
  run: PayrollPaymentRunOption
): Promise<PayrollPaymentBankExportResult> {
  if (format === 'xlsx') return exportPayrollPaymentBankExcel(rows, run);
  return exportPayrollPaymentBankCsv(rows, run);
}
