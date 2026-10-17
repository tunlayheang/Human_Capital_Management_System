import { format, parseISO } from 'date-fns';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { normalizeEmployeeDisplayId } from '../../utils';
import { jsPDF } from 'jspdf';
import type { PayrollRun, Payslip } from '../../types';
import { buildPayrollItemRow, sumPayrollRows } from './payrollItemRows';
import { reconcilePayrollBreakdown, roundUsd } from './payrollBreakdownReconcile';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import {
  getPayrollEmployeeProfile,
  type PayrollEmployeeProfile,
} from './payrollEmployeeDisplay';
import {
  buildTabularMetadataAoa,
  buildMetadataCsvLines,
  aoaToCsvLines,
  downloadCsvLines,
  downloadBrandedWorkbookAsXlsx,
  exportFilename,
  exportGeneratedAtLabel,
  csvRow,
  type ExportFileExt,
  appendReportFooterCsvLines,
} from '../../utils/export/exportDocumentStandard';
import { openTabularPrintWindow } from '../../utils/export/downloadTabularPdf';
import { ensurePdfUnicodeFont, pdfSetFont } from '../../utils/export/pdfUnicodeFont';
import {
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
  loadBrandedPdfContext,
  BRANDED_PDF_COLOR,
} from '../../utils/export/brandedPdfBase';
import {
  loadDocumentBranding,
  resolvePayslipFooterText,
  type DocumentBranding,
} from '../../utils/documentBranding';
import {
  employmentFlagLabel,
  formatNetDelta,
  paymentStatusLabel,
  type PayrollReviewViewMode,
} from './payrollReviewFilters';

/** Coerce API/JSON money fields (often strings) for safe `.toFixed` / math. */
function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Payroll run month may be `YYYY-MM` or a longer date string from the API. */
function payrollMonthKey(month: string | null | undefined): string {
  const raw = String(month ?? '').trim();
  const key = raw.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : raw;
}

function payrollPeriodDate(month: string | null | undefined): Date {
  const key = payrollMonthKey(month);
  const d = parseISO(`${key}-01`);
  if (!Number.isNaN(d.getTime())) return d;
  return new Date();
}

function baseSalary(item: Payslip): number {
  return money(item.breakdown?.baseSalary ?? item.basicSalary);
}

function payslipBreakdown(item: Payslip) {
  if (!item.breakdown) return null;
  return reconcilePayrollBreakdown(item.breakdown);
}

function netSalary(item: Payslip): number {
  return money(payslipBreakdown(item)?.netSalary ?? item.netPay);
}

function netSalaryKhr(item: Payslip): number {
  const b = payslipBreakdown(item);
  const khr = b?.netSalaryKHR;
  if (khr != null && Number.isFinite(Number(khr))) return Math.round(Number(khr));
  return Math.round(netSalary(item) * resolveExchangeRateKhrPerUsd(b?.exchangeRate, 'active'));
}

export type PayrollExportOptions = {
  viewMode?: PayrollReviewViewMode;
  includeReviewerNotes?: boolean;
  branding?: DocumentBranding;
};

function profileForItem(
  item: Payslip,
  profiles: Record<string, PayrollEmployeeProfile>
) {
  return getPayrollEmployeeProfile(
    item.userId,
    profiles,
    item.employeeId,
    item.breakdown?.reviewSnapshot
  );
}

function buildPayrollExportMetadata(
  run: PayrollRun,
  itemCount: number,
  reportTitle: string,
  branding?: DocumentBranding
): (string | number)[][] {
  const periodDate = payrollPeriodDate(run.month);
  return buildTabularMetadataAoa(reportTitle, [
    { label: 'Payroll Month', value: format(periodDate, 'MMMM yyyy') },
    { label: 'Run ID', value: run.id },
    { label: 'Status', value: run.status },
    { label: 'Total Employees', value: itemCount },
  ], branding);
}

function buildPayrollExportMetadataFields(run: PayrollRun, itemCount: number) {
  const periodDate = payrollPeriodDate(run.month);
  return [
    { label: 'Payroll Month', value: format(periodDate, 'MMMM yyyy') },
    { label: 'Run ID', value: run.id },
    { label: 'Status', value: run.status },
    { label: 'Total Employees', value: itemCount },
  ];
}

function buildRegisterSheet(
  items: Payslip[],
  profiles: Record<string, PayrollEmployeeProfile>,
  includeReviewerNotes: boolean
): (string | number)[][] {
  const header = [
    '#',
    'Employee',
    'Job Title',
    'Dept',
    'Base',
    'Prorated Pay',
    'Payable Days',
    'Flags',
    'Allowance Total',
    'OT Total',
    'Gross (USD)',
    'Taxable Base',
    'Tax Rate (%)',
    'NSSF Employee',
    'NSSF Employer',
    'Tax (ToS)',
    'Other Deductions',
    'Prior Net',
    'Δ vs Prior',
    'FX',
    'NSSF ID',
    'Tax ID',
    'NSSF Assumed Wage (KHR)',
    'Total Employer Cost',
    'Payment Status',
    'Net (USD)',
    'Bank / Payment',
    ...(includeReviewerNotes ? ['Reviewer Note'] : []),
  ];

  const dataRows = items.map((item, index) => {
    const profile = profileForItem(item, profiles);
    const r = buildPayrollItemRow(item, profile);
    const otTotal = roundUsd(r.otAmount150 + r.otAmount200);
    return [
      index + 1,
      r.employeeName,
      r.jobTitle,
      r.departmentName,
      roundUsd(r.base),
      roundUsd(r.proratedPay),
      r.prorationLabel,
      r.employmentFlags.map(employmentFlagLabel).join(', ') || '—',
      roundUsd(r.allowanceTotal),
      otTotal,
      roundUsd(r.gross),
      roundUsd(r.taxableBase),
      r.taxRatePct,
      roundUsd(r.nssf),
      roundUsd(r.employerNssf),
      roundUsd(r.tax),
      roundUsd(r.otherDeductions),
      r.priorMonthNetUsd != null ? roundUsd(r.priorMonthNetUsd) : '—',
      formatNetDelta(r.netChangeVsPriorMonthUsd, r.netChangeVsPriorMonthPct),
      r.exchangeRate,
      r.nssfId,
      r.taxId,
      r.nssfAssumedWageKhr ?? '—',
      roundUsd(r.totalEmployerCostUsd),
      paymentStatusLabel(r.paymentStatus),
      roundUsd(r.net),
      r.bankDisplay,
      ...(includeReviewerNotes ? [item.reviewerNote ?? ''] : []),
    ];
  });

  const totals = sumPayrollRows(
    items.map((item) => buildPayrollItemRow(item, profileForItem(item, profiles)))
  );
  const totalsRow: (string | number)[] = [
    'TOTALS',
    '',
    '',
    '',
    roundUsd(totals.base),
    roundUsd(totals.proratedPay),
    '',
    '',
    roundUsd(totals.allowanceTotal),
    roundUsd(totals.otAmount150 + totals.otAmount200),
    roundUsd(totals.gross),
    '',
    '',
    roundUsd(totals.nssf),
    roundUsd(totals.employerNssf),
    roundUsd(totals.tax),
    roundUsd(totals.otherDeductions),
    '',
    '',
    '',
    '',
    '',
    roundUsd(totals.totalEmployerCostUsd),
    '',
    roundUsd(totals.net),
    '',
    ...(includeReviewerNotes ? [''] : []),
  ];

  return [header, ...dataRows, [], totalsRow];
}

export async function exportPayrollRunExcel(
  run: PayrollRun,
  items: Payslip[],
  profiles: Record<string, PayrollEmployeeProfile>,
  options: PayrollExportOptions = {}
): Promise<void> {
  const viewMode = options.viewMode ?? 'detailed';
  const includeReviewerNotes = options.includeReviewerNotes ?? true;
  const headerRows = buildPayrollExportMetadata(
    run,
    items.length,
    viewMode === 'simple' ? 'Payroll Register' : 'Payroll Report',
    options.branding
  );

  if (viewMode === 'simple') {
    const registerSheet = buildRegisterSheet(items, profiles, includeReviewerNotes);
    await downloadBrandedWorkbookAsXlsx({
      filename: exportFilename('Payroll_Register', [run.month], 'xlsx'),
      reportTitle: 'Payroll Register',
      branding: options.branding,
      fields: buildPayrollExportMetadataFields(run, items.length).map((f) => ({
        label: f.label,
        value: String(f.value ?? ''),
      })),
      period: {
        from: format(payrollPeriodDate(run.month), 'MMMM yyyy'),
        to: format(payrollPeriodDate(run.month), 'MMMM yyyy'),
      },
      purpose: 'Payroll register for the selected run.',
      sheets: [
        {
          name: 'Payroll Register',
          aoa: [...headerRows, ...registerSheet],
          headerRows: [headerRows.length],
          totalsLastRow: true,
        },
      ],
    });
    return;
  }

  const tableHeader = [
    'Employee ID',
    'Name',
    'Job Title',
    'Department',
    'Prorated Pay (USD)',
    'Payable Days',
    'Employment Flags',
    'Prior Net (USD)',
    'Δ vs Prior',
    'FX Rate',
    'NSSF ID',
    'Tax ID',
    'NSSF Assumed Wage (KHR)',
    'Total Employer Cost (USD)',
    'Payment Status',
    'Scheduled Work Days',
    'Paid Leave Days',
    'Unpaid Leave Days',
    'Present Days',
    'Absent Days',
    'Work Hours',
    'Std Hrs/Day',
    'Hourly Rate',
    'Daily Rate',
    'Dependents',
    'Dep. relief (USD)',
    'Base (USD)',
    'Transport',
    'Meal',
    'Attendance Bonus',
    'Siniority (Jun/Dec)',
    'Allowance Total',
    'OT Hrs 1.5x',
    'OT Hrs 2x',
    'OT Pay 1.5x',
    'OT Pay 2x',
    'Gross (USD)',
    'Taxable Base (USD)',
    'Tax Rate (%)',
    'NSSF Employee',
    'NSSF Employer',
    'Tax (ToS)',
    'Absences',
    'Other Deductions',
    'Total Deductions',
    'Net (USD)',
    'Net (KHR)',
    'Bank / Payment',
    ...(includeReviewerNotes ? ['Reviewer Note'] : []),
  ];

  const dataRows = items.map((item) => {
    const profile = profileForItem(item, profiles);
    const r = buildPayrollItemRow(item, profile);
    return [
      normalizeEmployeeDisplayId(profile.employeeId),
      r.employeeName,
      r.jobTitle,
      r.departmentName,
      roundUsd(r.proratedPay),
      r.prorationLabel,
      r.employmentFlags.map(employmentFlagLabel).join(', ') || '—',
      r.priorMonthNetUsd != null ? roundUsd(r.priorMonthNetUsd) : '—',
      formatNetDelta(r.netChangeVsPriorMonthUsd, r.netChangeVsPriorMonthPct),
      r.exchangeRate,
      r.nssfId,
      r.taxId,
      r.nssfAssumedWageKhr ?? '—',
      roundUsd(r.totalEmployerCostUsd),
      paymentStatusLabel(r.paymentStatus),
      r.scheduledWorkingDays,
      r.paidLeaveDays,
      r.unpaidLeaveDays,
      r.presentDays,
      r.absentDays,
      r.totalWorkHours,
      r.standardHoursPerDay,
      r.hourlyRate,
      roundUsd(r.dailyRate),
      r.dependents,
      roundUsd(r.dependentRelief),
      roundUsd(r.base),
      r.transport,
      r.meal,
      r.attendanceBonus,
      r.seniorityIndemnity,
      roundUsd(r.allowanceTotal),
      r.otHours150,
      r.otHours200,
      roundUsd(r.otAmount150),
      roundUsd(r.otAmount200),
      roundUsd(r.gross),
      roundUsd(r.taxableBase),
      r.taxRatePct,
      roundUsd(r.nssf),
      roundUsd(r.employerNssf),
      roundUsd(r.tax),
      roundUsd(r.absences),
      roundUsd(r.otherDeductions),
      roundUsd(r.deductionsTotal),
      roundUsd(r.net),
      Math.round(r.netKhr),
      r.bankDisplay,
      ...(includeReviewerNotes ? [item.reviewerNote ?? ''] : []),
    ];
  });

  const t = sumPayrollRows(
    items.map((i) => buildPayrollItemRow(i, profileForItem(i, profiles)))
  );

  /** One cell per header column — avoids misaligned financial totals. */
  const totalsRow: (string | number)[] = [
    'TOTALS',
    '',
    '',
    '',
    roundUsd(t.proratedPay),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    roundUsd(t.totalEmployerCostUsd),
    '',
    '',
    t.paidLeaveDays,
    t.unpaidLeaveDays,
    t.presentDays,
    t.absentDays,
    t.totalWorkHours,
    '',
    '',
    '',
    '',
    roundUsd(t.dependentRelief),
    roundUsd(t.base),
    roundUsd(t.transport),
    roundUsd(t.meal),
    roundUsd(t.attendanceBonus),
    roundUsd(t.seniorityIndemnity),
    roundUsd(t.allowanceTotal),
    '',
    '',
    roundUsd(t.otAmount150),
    roundUsd(t.otAmount200),
    roundUsd(t.gross),
    '',
    '',
    roundUsd(t.nssf),
    roundUsd(t.employerNssf),
    roundUsd(t.tax),
    roundUsd(t.absences),
    roundUsd(t.otherDeductions),
    roundUsd(t.deductionsTotal),
    roundUsd(t.net),
    Math.round(t.netKhr),
    '',
    ...(includeReviewerNotes ? [''] : []),
  ];

  const sheetData = [
    ...headerRows,
    tableHeader,
    ...dataRows,
    [],
    totalsRow,
  ];

  await downloadBrandedWorkbookAsXlsx({
    filename: exportFilename('Payroll_Report', [run.month], 'xlsx'),
    reportTitle: 'Payroll Report',
    branding: options.branding,
    fields: buildPayrollExportMetadataFields(run, items.length).map((f) => ({
      label: f.label,
      value: String(f.value ?? ''),
    })),
    period: {
      from: format(payrollPeriodDate(run.month), 'MMMM yyyy'),
      to: format(payrollPeriodDate(run.month), 'MMMM yyyy'),
    },
    purpose: 'Detailed payroll report for the selected run.',
    sheets: [
      {
        name: 'Payroll Report',
        aoa: sheetData,
        headerRows: [headerRows.length],
        columnWidths: tableHeader.map((header, index) =>
          index === 0 ? 12 : index === 1 ? 22 : Math.min(Math.max(header.length + 2, 12), 28)
        ),
      },
      {
        name: 'Payroll Register',
        aoa: [...headerRows, ...buildRegisterSheet(items, profiles, includeReviewerNotes)],
        headerRows: [headerRows.length],
        totalsLastRow: true,
      },
    ],
  });
}

export function exportPayrollRunCsv(
  run: PayrollRun,
  items: Payslip[],
  profiles: Record<string, PayrollEmployeeProfile>,
  options: PayrollExportOptions = {}
): void {
  const viewMode = options.viewMode ?? 'detailed';
  const includeReviewerNotes = options.includeReviewerNotes ?? true;
  const reportTitle = viewMode === 'simple' ? 'Payroll Register' : 'Payroll Report';
  const metadataFields = buildPayrollExportMetadataFields(run, items.length);
  const lines = buildMetadataCsvLines(reportTitle, metadataFields, options.branding);

  if (viewMode === 'simple') {
    lines.push(...aoaToCsvLines(buildRegisterSheet(items, profiles, includeReviewerNotes)));
    downloadCsvLines(lines, exportFilename('Payroll_Register', [run.month], 'csv'));
    return;
  }

  const tableHeader = [
    'Employee ID',
    'Name',
    'Job Title',
    'Department',
    'Prorated Pay (USD)',
    'Payable Days',
    'Employment Flags',
    'Prior Net (USD)',
    'Δ vs Prior',
    'FX Rate',
    'NSSF ID',
    'Tax ID',
    'NSSF Assumed Wage (KHR)',
    'Total Employer Cost (USD)',
    'Payment Status',
    'Scheduled Work Days',
    'Paid Leave Days',
    'Unpaid Leave Days',
    'Present Days',
    'Absent Days',
    'Work Hours',
    'Std Hrs/Day',
    'Hourly Rate',
    'Daily Rate',
    'Dependents',
    'Dep. relief (USD)',
    'Base (USD)',
    'Transport',
    'Meal',
    'Attendance Bonus',
    'Siniority (Jun/Dec)',
    'Allowance Total',
    'OT Hrs 1.5x',
    'OT Hrs 2x',
    'OT Pay 1.5x',
    'OT Pay 2x',
    'Gross (USD)',
    'Taxable Base (USD)',
    'Tax Rate (%)',
    'NSSF Employee',
    'NSSF Employer',
    'Tax (ToS)',
    'Absences',
    'Other Deductions',
    'Total Deductions',
    'Net (USD)',
    'Net (KHR)',
    'Bank / Payment',
    ...(includeReviewerNotes ? ['Reviewer Note'] : []),
  ];

  const dataRows = items.map((item) => {
    const profile = profileForItem(item, profiles);
    const r = buildPayrollItemRow(item, profile);
    return [
      normalizeEmployeeDisplayId(profile.employeeId),
      r.employeeName,
      r.jobTitle,
      r.departmentName,
      roundUsd(r.proratedPay),
      r.prorationLabel,
      r.employmentFlags.map(employmentFlagLabel).join(', ') || '—',
      r.priorMonthNetUsd != null ? roundUsd(r.priorMonthNetUsd) : '—',
      formatNetDelta(r.netChangeVsPriorMonthUsd, r.netChangeVsPriorMonthPct),
      r.exchangeRate,
      r.nssfId,
      r.taxId,
      r.nssfAssumedWageKhr ?? '—',
      roundUsd(r.totalEmployerCostUsd),
      paymentStatusLabel(r.paymentStatus),
      r.scheduledWorkingDays,
      r.paidLeaveDays,
      r.unpaidLeaveDays,
      r.presentDays,
      r.absentDays,
      r.totalWorkHours,
      r.standardHoursPerDay,
      r.hourlyRate,
      r.dailyRate,
      r.dependents,
      roundUsd(r.dependentRelief),
      roundUsd(r.base),
      roundUsd(r.transport),
      roundUsd(r.meal),
      roundUsd(r.attendanceBonus),
      roundUsd(r.seniorityIndemnity),
      roundUsd(r.allowanceTotal),
      r.otHours150,
      r.otHours200,
      roundUsd(r.otAmount150),
      roundUsd(r.otAmount200),
      roundUsd(r.gross),
      roundUsd(r.taxableBase),
      r.taxRatePct,
      roundUsd(r.nssf),
      roundUsd(r.employerNssf),
      roundUsd(r.tax),
      roundUsd(r.absences),
      roundUsd(r.otherDeductions),
      roundUsd(r.deductionsTotal),
      roundUsd(r.net),
      Math.round(r.netKhr),
      r.bankDisplay,
      ...(includeReviewerNotes ? [item.reviewerNote ?? ''] : []),
    ];
  });

  lines.push(csvRow(tableHeader));
  dataRows.forEach((row) => lines.push(csvRow(row)));
  lines.push('');
  lines.push(csvRow(['Section', 'Payroll Register']));
  lines.push(...aoaToCsvLines(buildRegisterSheet(items, profiles, includeReviewerNotes)));
  lines.push('');
  downloadCsvLines(
    appendReportFooterCsvLines(lines, options.branding),
    exportFilename('Payroll_Report', [run.month], 'csv')
  );
}

export async function exportPayrollRunPdf(
  run: PayrollRun,
  items: Payslip[],
  profiles: Record<string, PayrollEmployeeProfile>,
  options: PayrollExportOptions = {}
): Promise<boolean> {
  const viewMode = options.viewMode ?? 'detailed';
  const includeReviewerNotes = options.includeReviewerNotes ?? true;
  const reportTitle = viewMode === 'simple' ? 'Payroll Register' : 'Payroll Report';
  const headerRows = buildPayrollExportMetadata(run, items.length, reportTitle, options.branding);
  const sheet =
    viewMode === 'simple'
      ? buildRegisterSheet(items, profiles, includeReviewerNotes)
      : buildRegisterSheet(items, profiles, includeReviewerNotes);
  const aoa = [...headerRows, ...sheet];
  return openTabularPrintWindow(`${reportTitle} — ${run.month}`, aoa, `Run ${run.id}`, options.branding);
}

export async function exportPayrollRun(
  format: ExportFileExt,
  run: PayrollRun,
  items: Payslip[],
  profiles: Record<string, PayrollEmployeeProfile>,
  options: PayrollExportOptions = {}
): Promise<boolean> {
  const branding = options.branding ?? (await loadDocumentBranding(true));
  const resolvedOptions = { ...options, branding };
  if (format === 'pdf') return exportPayrollRunPdf(run, items, profiles, resolvedOptions);
  if (format === 'csv') {
    exportPayrollRunCsv(run, items, profiles, resolvedOptions);
    return true;
  }
  await exportPayrollRunExcel(run, items, profiles, resolvedOptions);
  return true;
}

export async function downloadPayslipPdf(
  run: PayrollRun,
  item: Payslip,
  profile?: PayrollEmployeeProfile
): Promise<void> {
  const { branding, logo, generatedAt } = await loadBrandedPdfContext(true);
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  await ensurePdfUnicodeFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const primary = BRANDED_PDF_COLOR.primary;
  const slate = BRANDED_PDF_COLOR.muted;
  const lightGray = BRANDED_PDF_COLOR.blueLight;
  const rowGray = BRANDED_PDF_COLOR.panel;
  const usd = (value: unknown) => `$${money(value).toFixed(2)}`;

  const monthKey = payrollMonthKey(run.month);
  const periodDate = payrollPeriodDate(monthKey);
  const [y, m] = monthKey.split('-').map(Number);
  const payDate = Number.isFinite(y) && Number.isFinite(m) ? new Date(y, m, 0) : periodDate;

  const hybrid = item.breakdown?.hybrid;
  const base = money(hybrid?.fixed?.fixedBaseSalary ?? baseSalary(item));
  const contractBase = money(
    hybrid?.fixed?.contractBaseSalary ?? item.breakdown?.contractBaseSalary ?? base
  );
  const allow = item.breakdown?.allowances;
  const transport = money(hybrid?.fixed?.transportAllowance ?? allow?.transport);
  const attendance = money(
    hybrid?.variableAdditions?.attendanceIncentive ?? allow?.attendance
  );
  const meal = money(hybrid?.fixed?.mealAllowance ?? allow?.meal);
  const position = money(hybrid?.fixed?.positionAllowance ?? allow?.position);
  const seniority = money(hybrid?.fixed?.seniorityAllowance ?? allow?.seniority);
  const indemnity = money(hybrid?.fixed?.seniorityIndemnity ?? item.breakdown?.seniorityIndemnity);
  const fixedTotal = money(
    hybrid?.fixed?.total ?? base + transport + meal + seniority + position + indemnity
  );
  const overtime = money(hybrid?.variableAdditions?.overtime?.total ?? item.breakdown?.overtime?.total);
  const unpaidLeave = money(hybrid?.variableDeductions?.unpaidLeave);
  const unexcused = money(hybrid?.variableDeductions?.unexcusedAbsence);
  const latePenalty = money(hybrid?.variableDeductions?.latePenalty);
  const attendanceDeductions = unpaidLeave + unexcused + latePenalty;
  const nssf = money(item.breakdown?.deductions?.nssf);
  const tax = money(item.breakdown?.deductions?.taxOnSalary);
  const net = netSalary(item);
  const khr = netSalaryKhr(item);

  const employeeId = normalizeEmployeeDisplayId(profile?.employeeId ?? item.userId);
  const employeeName = profile?.displayName ?? item.userId;

  let yPos = drawBrandedPdfHeader(doc, {
    title: 'Official Payslip',
    branding,
    logo,
    margin: 20,
    fields: [
      { label: 'Document', value: 'Official Payslip' },
      { label: 'Employee', value: employeeName },
      { label: 'Employee ID', value: employeeId },
      { label: 'Pay period', value: format(periodDate, 'MMMM yyyy') },
      { label: 'Generated', value: generatedAt },
    ],
    period: {
      from: formatDateOnlyDisplay(new Date(y, m - 1, 1)),
      to: formatDateOnlyDisplay(payDate),
    },
    documentLabel: 'Payslip',
  });

  doc.setFillColor(...lightGray);
  doc.rect(20, yPos, pageWidth - 110, 34, 'F');
  doc.setTextColor(...BRANDED_PDF_COLOR.text);
  doc.setFontSize(9);
  pdfSetFont(doc, 'bold');
  doc.text('EMPLOYEE INFORMATION', 24, yPos + 8);
  pdfSetFont(doc, 'normal');
  doc.text(`Employee ID: ${employeeId}`, 24, yPos + 16);
  doc.text(`Name: ${employeeName}`, 24, yPos + 22);
  doc.text(`Pay Period: ${format(periodDate, 'MMMM yyyy')}`, 24, yPos + 28);
  doc.text('Currency: USD / KHR', 24, yPos + 34);

  const rightX = pageWidth - 25;
  doc.text(`Run Date: ${formatDateOnlyDisplay(run.createdAt)}`, rightX, yPos + 8, { align: 'right' });
  doc.text(`Pay Date: ${formatDateOnlyDisplay(payDate)}`, rightX, yPos + 16, { align: 'right' });
  doc.text(`Run ID: ${run.id}`, rightX, yPos + 22, { align: 'right' });
  doc.text(`Status: ${run.status}`, rightX, yPos + 28, { align: 'right' });

  yPos += 44;
  const marginX = 20;
  const midX = pageWidth / 2;
  const earningsLabelX = 24;
  const earningsValueX = midX - 14;
  const deductionsLabelX = midX + 8;
  const deductionsValueX = rightX;
  const rowHeight = 9;

  type LineItem = { label: string; value: string };

  const drawColumnItem = (
    label: string,
    value: string,
    side: 'earnings' | 'deductions',
    rowY: number
  ) => {
    const labelX = side === 'earnings' ? earningsLabelX : deductionsLabelX;
    const valueX = side === 'earnings' ? earningsValueX : deductionsValueX;
    const maxLabelWidth =
      side === 'earnings'
        ? earningsValueX - labelX - 6
        : deductionsValueX - labelX - 28;

    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    pdfSetFont(doc, 'normal');
    const labelLines = doc.splitTextToSize(label, Math.max(24, maxLabelWidth));
    doc.text(labelLines, labelX, rowY);
    pdfSetFont(doc, 'bold');
    doc.text(value, valueX, rowY, { align: 'right' });
    pdfSetFont(doc, 'normal');
  };

  const drawPairedRow = (
    earnings: LineItem,
    deductions: LineItem | null,
    alt: boolean
  ) => {
    if (alt) {
      doc.setFillColor(...rowGray);
      doc.rect(marginX, yPos - 5, pageWidth - marginX * 2, rowHeight, 'F');
    }
    drawColumnItem(earnings.label, earnings.value, 'earnings', yPos);
    if (deductions) {
      drawColumnItem(deductions.label, deductions.value, 'deductions', yPos);
    }
    yPos += rowHeight;
  };

  pdfSetFont(doc, 'bold');
  doc.setFontSize(11);
  doc.text('Earnings', earningsLabelX, yPos);
  doc.text('Deductions', deductionsLabelX, yPos);
  yPos += 8;
  pdfSetFont(doc, 'normal');
  doc.setFontSize(10);

  drawPairedRow(
    { label: `Fixed base (contract ${usd(contractBase)})`, value: usd(base) },
    { label: 'NSSF Contribution (Employee)', value: usd(nssf) },
    false
  );
  drawPairedRow(
    {
      label: 'Fixed allowances (transport, meal, seniority, position)',
      value: usd(transport + meal + seniority + position + indemnity),
    },
    { label: 'Tax on Salary (ToS)', value: usd(tax) },
    true
  );
  drawPairedRow(
    { label: 'Overtime & variable additions', value: usd(overtime) },
    {
      label: 'Attendance deductions (leave / late)',
      value: usd(attendanceDeductions),
    },
    false
  );
  if (hybrid) {
    drawPairedRow(
      { label: 'Attendance incentive', value: usd(attendance) },
      null,
      true
    );
  }

  yPos += 4;
  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, yPos, pageWidth - marginX, yPos);
  yPos += 8;

  const totalEarnings = hybrid
    ? fixedTotal + overtime + attendance
    : base + transport + meal + attendance + overtime;
  const totalDeductions = nssf + tax + attendanceDeductions;
  pdfSetFont(doc, 'bold');
  drawPairedRow(
    { label: 'Total Earnings', value: usd(totalEarnings) },
    { label: 'Total Deductions', value: usd(totalDeductions) },
    false
  );
  pdfSetFont(doc, 'normal');

  yPos += 6;
  const boxW = pageWidth / 2 - 30;
  const boxX = pageWidth / 2 + 5;
  doc.setFillColor(...lightGray);
  doc.setDrawColor(...primary);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, yPos, boxW, 28, 2, 2, 'FD');
  doc.setTextColor(...slate);
  doc.setFontSize(12);
  doc.text('NET PAY', boxX + 6, yPos + 10);
  doc.setTextColor(...primary);
  doc.setFontSize(18);
  pdfSetFont(doc, 'bold');
  doc.text(usd(net), boxX + boxW - 6, yPos + 12, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(...slate);
  pdfSetFont(doc, 'normal');
  doc.text(`${khr.toLocaleString()} KHR`, boxX + boxW - 6, yPos + 22, { align: 'right' });

  yPos += 40;
  drawBrandedPdfFooter(doc, {
    generatedAt,
    branding,
    page: 1,
    totalPages: 1,
    margin: 20,
    documentLabel: 'Payslip',
    note: resolvePayslipFooterText(branding) || 'Confidential payroll document',
  });

  const employeeIdForFile = normalizeEmployeeDisplayId(profile?.employeeId ?? item.userId);
  doc.save(exportFilename('Payslip', [employeeIdForFile, monthKey || 'Export'], 'pdf'));
}
