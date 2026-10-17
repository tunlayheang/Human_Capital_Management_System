/**
 * Leave utilization report PDF — uses shared expense-report chrome + teal table.
 */
import type { ReportColumn, ReportRow, ReportRunResult } from '../../types/reportCatalog';
import { loadDocumentBranding } from '../documentBranding';
import { drawBrandedPdfFooter, drawBrandedPdfHeader } from './brandedPdfBase';
import {
  DOC_REPORT_PDF_COLOR,
  DOC_REPORT_PDF_FONT,
  DOC_REPORT_PDF_MARGIN,
  documentReportBodyBottom,
} from './documentReportPdfChrome';
import {
  exportFilename,
  exportGeneratedAtLabel,
  loadExportLogoImage,
} from './exportDocumentStandard';
import { ensurePdfUnicodeFont, pdfSetFont } from './pdfUnicodeFont';

const MARGIN = DOC_REPORT_PDF_MARGIN;

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

function buildLeaveTableAoa(result: ReportRunResult): string[][] {
  const headers = result.columns.map((c) => c.label);
  const dataRows = result.rows.map((row) =>
    result.columns.map((col) => formatLeaveCell(col, row))
  );
  const totals = result.summary?.totalsRow;
  if (totals) {
    dataRows.push(result.columns.map((col) => formatLeaveCell(col, totals)));
  }
  return [headers, ...dataRows];
}

export async function downloadLeaveUtilizationReportPdf(
  result: ReportRunResult
): Promise<boolean> {
  const branding = await loadDocumentBranding(true);
  const logo = await loadExportLogoImage();
  const generatedAt = exportGeneratedAtLabel(
    result.meta.generatedAt ? new Date(result.meta.generatedAt) : new Date()
  );
  const filters = result.meta.filtersApplied || {};
  const fromDate = filterValue(filters, 'startDate', 'From', 'from');
  const toDate = filterValue(filters, 'endDate', 'To', 'to');
  const departmentRaw = filterValue(filters, 'departmentId', 'department', 'Department');
  const department =
    !departmentRaw || /^all$/i.test(departmentRaw)
      ? 'All departments'
      : departmentRaw.length > 36
        ? 'Selected department'
        : departmentRaw;

  const cols = Math.max(1, result.columns.length);
  const orientation = cols >= 8 ? 'landscape' : 'portrait';

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation });
  await ensurePdfUnicodeFont(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - MARGIN * 2;
  const bodyBottom = documentReportBodyBottom(doc);
  const title = result.title?.trim() || 'Leave Report';
  const purpose =
    result.meta.note?.trim() ||
    'Leave utilization by department for the selected period.';

  const headerOpts = {
    title,
    branding,
    logo,
    margin: MARGIN,
    fields: [
      { label: 'Report', value: title },
      { label: 'Department', value: department },
      { label: 'Generated', value: generatedAt },
      { label: 'Prepared by', value: '' },
    ],
    period: { from: fromDate, to: toDate },
    purpose,
    documentLabel: 'Leave Report',
  };

  const aoa = buildLeaveTableAoa(result);
  const tableCols = Math.max(1, ...aoa.map((r) => r.length));
  const colW = contentW / tableCols;

  let fontSize = DOC_REPORT_PDF_FONT.table;
  if (tableCols >= 12) fontSize = 7;
  else if (tableCols >= 9) fontSize = 7.5;
  else if (tableCols >= 7) fontSize = 8;
  const lineH = fontSize * 0.42;
  const padX = 1.1;
  const padY = 1.1;

  let y = drawBrandedPdfHeader(doc, headerOpts);

  const ensureSpace = (need: number) => {
    if (y + need <= bodyBottom) return;
    doc.addPage();
    y = drawBrandedPdfHeader(doc, {
      ...headerOpts,
      title: `${title} (continued)`,
      includeReportHeader: false,
    });
  };

  aoa.forEach((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const isTotals = rowIndex === aoa.length - 1 && Boolean(result.summary?.totalsRow);
    const cells = Array.from({ length: tableCols }, (_, i) => String(row[i] ?? ''));
    const wrapped = cells.map((text) => {
      const maxW = Math.max(4, colW - padX * 2);
      return doc.splitTextToSize(text || ' ', maxW) as string[];
    });
    const linesUsed = Math.max(1, ...wrapped.map((w) => w.length));
    const rowH = Math.max(lineH + padY * 2, linesUsed * lineH + padY * 2);

    ensureSpace(rowH + 0.3);

    if (isHeader) {
      doc.setFillColor(...DOC_REPORT_PDF_COLOR.accent);
      doc.rect(MARGIN, y, contentW, rowH, 'F');
    } else if (isTotals) {
      doc.setFillColor(...DOC_REPORT_PDF_COLOR.accentLight);
      doc.rect(MARGIN, y, contentW, rowH, 'F');
    } else if (rowIndex % 2 === 0) {
      doc.setFillColor(...DOC_REPORT_PDF_COLOR.rowAlt);
      doc.rect(MARGIN, y, contentW, rowH, 'F');
    }

    doc.setDrawColor(...DOC_REPORT_PDF_COLOR.border);
    doc.setLineWidth(0.12);

    for (let i = 0; i < tableCols; i += 1) {
      const x = MARGIN + i * colW;
      doc.rect(x, y, colW, rowH, 'S');
      pdfSetFont(doc, isHeader || isTotals ? 'bold' : 'normal');
      doc.setFontSize(isHeader ? DOC_REPORT_PDF_FONT.tableHeader : fontSize);
      doc.setTextColor(
        ...(isHeader || isTotals ? DOC_REPORT_PDF_COLOR.white : DOC_REPORT_PDF_COLOR.text)
      );
      const lines = wrapped[i] || [''];
      let ty = y + padY + lineH * 0.85;
      for (const line of lines) {
        doc.text(line, x + padX, ty);
        ty += lineH;
      }
    }

    y += rowH;
  });

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    drawBrandedPdfFooter(doc, {
      branding,
      page,
      totalPages: total,
      generatedAt,
      note: 'Note: All leave figures are in days',
      documentLabel: 'Leave Report',
      margin: MARGIN,
    });
  }

  const filename = exportFilename(
    'Report_Leave',
    [result.reportId, result.meta.generatedAt.slice(0, 10)],
    'pdf'
  );

  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    doc.save(filename);
  }
  return true;
}
