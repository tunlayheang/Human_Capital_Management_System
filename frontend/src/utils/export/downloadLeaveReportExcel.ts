/**
 * Leave utilization Excel export — expense-report chrome via shared workbook helper.
 */
import type { DocumentBranding } from '../documentBranding';
import { loadDocumentBranding } from '../documentBranding';
import type { ReportColumn, ReportRow, ReportRunResult } from '../../types/reportCatalog';
import {
  downloadBrandedWorkbookAsXlsx,
  exportFilename,
  exportGeneratedAtLabel,
} from './exportDocumentStandard';

function formatLeaveCell(column: ReportColumn, row: ReportRow): string {
  const raw = row[column.key];
  if (raw == null || raw === '') return '—';
  if (column.format === 'currency') {
    const n = Number(raw);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
      : String(raw);
  }
  if (column.format === 'number' || column.format === 'percent') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    return column.format === 'percent' ? `${n}%` : n.toLocaleString();
  }
  return String(raw);
}

function filterValue(filters: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = filters[key];
    if (direct?.trim()) return direct.trim();
    const match = Object.entries(filters).find(
      ([k]) => k.toLowerCase() === key.toLowerCase()
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function buildTableRows(result: ReportRunResult): (string | number)[][] {
  const headers = result.columns.map((c) => c.label);
  const dataRows = result.rows.map((row) =>
    result.columns.map((col) => {
      const formatted = formatLeaveCell(col, row);
      if (col.format === 'number' || col.format === 'percent' || col.format === 'currency') {
        const n = Number(row[col.key]);
        return Number.isFinite(n) ? n : formatted;
      }
      return formatted === '—' ? '' : formatted;
    })
  );
  const totals = result.summary?.totalsRow;
  if (totals) {
    dataRows.push(
      result.columns.map((col) => {
        const formatted = formatLeaveCell(col, totals);
        if (col.format === 'number' || col.format === 'percent' || col.format === 'currency') {
          const n = Number(totals[col.key]);
          return Number.isFinite(n) ? n : formatted;
        }
        return formatted === '—' ? '' : formatted;
      })
    );
  }
  return [headers, ...dataRows];
}

export async function downloadLeaveUtilizationReportExcel(
  result: ReportRunResult,
  brandingOverride?: DocumentBranding
): Promise<void> {
  const branding = brandingOverride ?? (await loadDocumentBranding(true));
  const generatedAt = exportGeneratedAtLabel(
    result.meta.generatedAt ? new Date(result.meta.generatedAt) : new Date()
  );
  const filters = result.meta.filtersApplied || {};
  const fromDate = filterValue(filters, 'startDate', 'From', 'from') || '—';
  const toDate = filterValue(filters, 'endDate', 'To', 'to') || '—';
  const departmentRaw = filterValue(filters, 'departmentId', 'department', 'Department');
  const department =
    !departmentRaw || /^all$/i.test(departmentRaw)
      ? 'All departments'
      : departmentRaw.length > 36
        ? 'Selected department'
        : departmentRaw;

  const title = result.title?.trim() || 'Leave Report';
  const purpose =
    result.meta.note?.trim() ||
    'Leave utilization by department for the selected period.';
  const table = buildTableRows(result);

  await downloadBrandedWorkbookAsXlsx({
    filename: exportFilename(
      'Report_Leave',
      [result.reportId, result.meta.generatedAt.slice(0, 10)],
      'xlsx'
    ),
    reportTitle: title,
    branding,
    documentLabel: 'Leave Report',
    fields: [
      { label: 'Report', value: title },
      { label: 'Department', value: department },
      { label: 'Generated', value: generatedAt },
      { label: 'Prepared by', value: '' },
    ],
    period: { from: fromDate, to: toDate },
    purpose,
    note: 'Note: All leave figures are in days',
    sheets: [
      {
        name: 'Leave Report',
        aoa: table,
        headerRows: [0],
        totalsLastRow: Boolean(result.summary?.totalsRow),
        columnWidths: result.columns.map((_, i) => (i === 0 ? 28 : 14)),
      },
    ],
  });
}
