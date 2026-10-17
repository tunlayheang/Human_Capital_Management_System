import {
  appendReportFooterCsvLines,
  aoaToCsvLines,
  buildMetadataCsvLines,
  buildTabularMetadataAoa,
  csvRow,
  csvStringToAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvContent,
  exportFilename,
  type ExportFileExt,
} from './export/exportDocumentStandard';
import { openTabularPrintWindow } from './export/downloadTabularPdf';
import { loadDocumentBranding, type DocumentBranding } from './documentBranding';

export type AnalyticsChartExportKind =
  | 'attendanceRate'
  | 'lateArrivals'
  | 'leaveUsage'
  | 'overtimeHours'
  | 'separations'
  | 'departmentRates';

export type AnalyticsChartExportLabels = {
  reportTitle: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  month: string;
  present: string;
  absent: string;
  late: string;
  attendanceRate: string;
  leaveDays: string;
  otHours: string;
  separations: string;
  department: string;
  summary: string;
  total: string;
  average: string;
  periodAverage: string;
  recordCount: string;
};

type AttendanceRateRow = {
  month: string;
  present?: number;
  absent?: number;
  late?: number;
  attendanceRatePct?: number;
};

type LateTrendRow = { month: string; late?: number };
type LeaveUsageRow = { month: string; days?: number };
type OvertimeRow = { month: string; hours?: number };
type SeparationRow = { month: string; count?: number };
type DepartmentRateRow = {
  name: string;
  present?: number;
  absent?: number;
  ratePct?: number;
};

const MODULE_BY_KIND: Record<AnalyticsChartExportKind, string> = {
  attendanceRate: 'Analytics_Attendance_Rate',
  lateArrivals: 'Analytics_Late_Arrivals',
  leaveUsage: 'Analytics_Leave_Usage',
  overtimeHours: 'Analytics_Overtime_Hours',
  separations: 'Analytics_Separations',
  departmentRates: 'Analytics_Department_Rates',
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildMetadataFields(labels: AnalyticsChartExportLabels) {
  return [
    { label: 'Report Period', value: labels.periodLabel },
    { label: 'Start Date', value: labels.startDate },
    { label: 'End Date', value: labels.endDate },
  ];
}

function buildAttendanceRateSheet(
  rows: AttendanceRateRow[],
  labels: AnalyticsChartExportLabels
): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [labels.month, labels.present, labels.absent, labels.late, labels.attendanceRate],
  ];

  let totalPresent = 0;
  let totalAbsent = 0;
  let totalLate = 0;

  for (const row of rows) {
    const present = num(row.present);
    const absent = num(row.absent);
    const late = num(row.late);
    totalPresent += present;
    totalAbsent += absent;
    totalLate += late;
    aoa.push([
      row.month,
      present,
      absent,
      late,
      `${round1(num(row.attendanceRatePct))}%`,
    ]);
  }

  const denom = totalPresent + totalAbsent;
  const periodAvg = denom > 0 ? round1((totalPresent / denom) * 100) : 0;

  aoa.push([]);
  aoa.push([labels.summary]);
  aoa.push([labels.total, labels.present, totalPresent, labels.absent, totalAbsent]);
  aoa.push([labels.total, labels.late, totalLate]);
  aoa.push([labels.periodAverage, labels.attendanceRate, `${periodAvg}%`]);
  aoa.push([labels.recordCount, rows.length]);

  return aoa;
}

function buildLateArrivalsSheet(
  rows: LateTrendRow[],
  labels: AnalyticsChartExportLabels
): (string | number)[][] {
  const aoa: (string | number)[][] = [[labels.month, labels.late]];
  let totalLate = 0;

  for (const row of rows) {
    const late = num(row.late);
    totalLate += late;
    aoa.push([row.month, late]);
  }

  const average = rows.length > 0 ? round1(totalLate / rows.length) : 0;

  aoa.push([]);
  aoa.push([labels.summary]);
  aoa.push([labels.total, labels.late, totalLate]);
  aoa.push([labels.average, labels.late, average]);
  aoa.push([labels.recordCount, rows.length]);

  return aoa;
}

function buildMonthlyMetricSheet(
  rows: Array<{ month: string; value: number }>,
  valueLabel: string,
  labels: AnalyticsChartExportLabels,
  valueSuffix = ''
): (string | number)[][] {
  const aoa: (string | number)[][] = [[labels.month, valueLabel]];
  let total = 0;

  for (const row of rows) {
    total += row.value;
    aoa.push([row.month, `${round1(row.value)}${valueSuffix}`]);
  }

  const average = rows.length > 0 ? round1(total / rows.length) : 0;

  aoa.push([]);
  aoa.push([labels.summary]);
  aoa.push([labels.total, `${round1(total)}${valueSuffix}`]);
  aoa.push([labels.average, `${average}${valueSuffix}`]);
  aoa.push([labels.recordCount, rows.length]);

  return aoa;
}

function buildDepartmentRatesSheet(
  rows: DepartmentRateRow[],
  labels: AnalyticsChartExportLabels
): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [labels.department, labels.present, labels.absent, labels.attendanceRate],
  ];

  let totalPresent = 0;
  let totalAbsent = 0;

  for (const row of rows) {
    const present = num(row.present);
    const absent = num(row.absent);
    totalPresent += present;
    totalAbsent += absent;
    aoa.push([
      row.name,
      present,
      absent,
      `${round1(num(row.ratePct))}%`,
    ]);
  }

  const denom = totalPresent + totalAbsent;
  const orgRate = denom > 0 ? round1((totalPresent / denom) * 100) : 0;

  aoa.push([]);
  aoa.push([labels.summary]);
  aoa.push([labels.total, labels.present, totalPresent, labels.absent, totalAbsent]);
  aoa.push([labels.periodAverage, labels.attendanceRate, `${orgRate}%`]);
  aoa.push([labels.recordCount, rows.length]);

  return aoa;
}

function buildDataSheet(
  kind: AnalyticsChartExportKind,
  rows: unknown[],
  labels: AnalyticsChartExportLabels
): (string | number)[][] {
  switch (kind) {
    case 'attendanceRate':
      return buildAttendanceRateSheet(rows as AttendanceRateRow[], labels);
    case 'lateArrivals':
      return buildLateArrivalsSheet(rows as LateTrendRow[], labels);
    case 'leaveUsage':
      return buildMonthlyMetricSheet(
        (rows as LeaveUsageRow[]).map((row) => ({ month: row.month, value: num(row.days) })),
        labels.leaveDays,
        labels
      );
    case 'overtimeHours':
      return buildMonthlyMetricSheet(
        (rows as OvertimeRow[]).map((row) => ({ month: row.month, value: num(row.hours) })),
        labels.otHours,
        labels,
        'h'
      );
    case 'separations':
      return buildMonthlyMetricSheet(
        (rows as SeparationRow[]).map((row) => ({ month: row.month, value: num(row.count) })),
        labels.separations,
        labels
      );
    case 'departmentRates':
      return buildDepartmentRatesSheet(rows as DepartmentRateRow[], labels);
    default:
      return [];
  }
}

function buildFullAoa(
  kind: AnalyticsChartExportKind,
  rows: unknown[],
  labels: AnalyticsChartExportLabels,
  branding?: DocumentBranding
): (string | number)[][] {
  const metadata = buildTabularMetadataAoa(labels.reportTitle, buildMetadataFields(labels), branding);
  return [...metadata, ...buildDataSheet(kind, rows, labels)];
}

function buildCsvContent(
  kind: AnalyticsChartExportKind,
  rows: unknown[],
  labels: AnalyticsChartExportLabels,
  branding?: DocumentBranding
): string {
  const lines = [
    ...buildMetadataCsvLines(labels.reportTitle, buildMetadataFields(labels), branding),
    ...aoaToCsvLines(buildDataSheet(kind, rows, labels)),
  ];
  return appendReportFooterCsvLines(lines, branding).join('\r\n');
}

export async function exportAnalyticsChartReport(
  format: ExportFileExt,
  kind: AnalyticsChartExportKind,
  rows: unknown[],
  labels: AnalyticsChartExportLabels
): Promise<boolean> {
  if (!rows.length) return false;

  const branding = await loadDocumentBranding(true);
  const filename = exportFilename(MODULE_BY_KIND[kind], [labels.startDate, labels.endDate], format);
  const sheetName = labels.reportTitle.slice(0, 31);

  if (format === 'pdf') {
    return openTabularPrintWindow(
      labels.reportTitle,
      buildFullAoa(kind, rows, labels, branding),
      labels.periodLabel,
      branding
    );
  }

  if (format === 'csv') {
    downloadCsvContent(`\uFEFF${buildCsvContent(kind, rows, labels, branding)}`, filename);
    return true;
  }

  const aoa = csvStringToAoa(buildCsvContent(kind, rows, labels, branding).replace(/^\uFEFF/, ''));
  const headerRowIndex = buildTabularMetadataAoa(
    labels.reportTitle,
    buildMetadataFields(labels),
    branding
  ).length;
  await downloadBrandedWorkbookAsXlsx({
    filename,
    reportTitle: labels.reportTitle,
    branding,
    fields: buildMetadataFields(labels)
      .slice(0, 5)
      .map((f) => ({ label: f.label, value: String(f.value ?? '') })),
    period:
      labels.startDate || labels.endDate
        ? { from: labels.startDate || '—', to: labels.endDate || '—' }
        : undefined,
    purpose: labels.periodLabel || undefined,
    sheets: [
      {
        name: sheetName,
        aoa,
        headerRows: [headerRowIndex],
      },
    ],
  });
  return true;
}
