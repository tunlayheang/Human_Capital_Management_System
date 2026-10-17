import {
  aoaToCsvLines,
  buildMetadataCsvLines,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvContent,
  exportFilename,
  type ExportFileExt,
  type TabularMetadataField,
} from './export/exportDocumentStandard';
import { downloadTabularPdfFromAoa } from './export/downloadTabularPdf';
import { downloadLeaveUtilizationReportPdf } from './export/downloadLeaveReportPdf';
import { downloadLeaveUtilizationReportExcel } from './export/downloadLeaveReportExcel';
import { loadDocumentBranding } from './documentBranding';
import type { ReportColumn, ReportRow, ReportRunResult } from '../types/reportCatalog';

function cellText(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value);
}

function buildMetadataFields(result: ReportRunResult): TabularMetadataField[] {
  const fields: TabularMetadataField[] = [
    { label: 'Rows', value: result.meta.rowCount },
    { label: 'Generated', value: new Date(result.meta.generatedAt).toLocaleString() },
    ...(result.summary?.cards || []).map((c) => ({
      label: c.label,
      value: formatSummaryValue(c.value, c.format),
    })),
    ...Object.entries(result.meta.filtersApplied || {}).map(([label, value]) => ({
      label,
      value: value || 'All',
    })),
  ];
  if (result.meta.note) fields.push({ label: 'Note', value: result.meta.note });
  return fields;
}

function buildTableAoa(result: ReportRunResult, forDisplay: boolean): (string | number)[][] {
  const headers = result.columns.map((c) => c.label);
  const dataRows = result.rows.map((row) =>
    result.columns.map((col) =>
      forDisplay ? formatReportCell(col, row) : cellText(row[col.key])
    )
  );
  const totals = result.summary?.totalsRow;
  if (totals) {
    dataRows.push(
      result.columns.map((col) =>
        forDisplay ? formatReportCell(col, totals) : cellText(totals[col.key])
      )
    );
  }
  return [headers, ...dataRows];
}

export async function exportReportRun(
  result: ReportRunResult,
  format: ExportFileExt
): Promise<void> {
  const branding = await loadDocumentBranding(true);
  const fields = buildMetadataFields(result);
  const filename = exportFilename(
    'Report_Catalog',
    [result.reportId, result.meta.generatedAt.slice(0, 10)],
    format === 'pdf' ? 'pdf' : format === 'csv' ? 'csv' : 'xlsx'
  );

  if (format === 'pdf') {
    // Leave report uses expense-report style header/footer (pilot layout).
    if (result.reportId === 'leave-utilization') {
      await downloadLeaveUtilizationReportPdf(result);
      return;
    }
    // Branded header already covers title/company — export only the data table.
    const aoa = buildTableAoa(result, true);
    await downloadTabularPdfFromAoa({
      title: result.title,
      rows: aoa,
      branding,
      filename,
      module: 'Report_Catalog',
      filenameParts: [result.reportId, result.meta.generatedAt.slice(0, 10)],
      // Prefer portrait; wide reports (≥8 columns) auto-switch to landscape.
      orientation: result.columns.length >= 8 ? 'landscape' : 'portrait',
    });
    return;
  }

  if (format === 'csv') {
    const lines = [
      ...buildMetadataCsvLines(result.title, fields, branding),
      ...aoaToCsvLines(buildTableAoa(result, false)),
    ];
    downloadCsvContent(lines.join('\n'), filename);
    return;
  }

  // Leave report Excel uses the same expense-report chrome as the PDF.
  if (result.reportId === 'leave-utilization') {
    await downloadLeaveUtilizationReportExcel(result, branding);
    return;
  }

  const chromeFields = fields.slice(0, 6).map((f) => ({
    label: f.label,
    value: String(f.value ?? ''),
  }));
  const filterMap = result.meta.filtersApplied || {};
  const fromDate =
    filterMap.startDate || filterMap.From || filterMap.from || '';
  const toDate = filterMap.endDate || filterMap.To || filterMap.to || '';
  const tableAoa = buildTableAoa(result, false);
  await downloadBrandedWorkbookAsXlsx({
    branding,
    filename,
    reportTitle: result.title,
    fields: chromeFields.length
      ? chromeFields
      : [
          { label: 'Document', value: result.title },
          { label: 'Generated', value: new Date(result.meta.generatedAt).toLocaleString() },
          { label: 'Prepared by', value: '' },
        ],
    period: fromDate || toDate ? { from: fromDate || '—', to: toDate || '—' } : undefined,
    purpose: result.meta.note?.trim() || undefined,
    sheets: [
      {
        name: 'Report',
        aoa: tableAoa,
        headerRows: [0],
        totalsLastRow: Boolean(result.summary?.totalsRow),
      },
    ],
  });
}

function formatSummaryValue(
  value: string | number,
  format?: 'text' | 'number' | 'currency' | 'percent'
): string {
  if (format === 'currency' || format === 'number' || format === 'percent') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (format === 'currency') {
      return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    }
    if (format === 'percent') return `${n}%`;
    return n.toLocaleString();
  }
  return String(value);
}

export function formatReportCell(column: ReportColumn, row: ReportRow): string {
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
