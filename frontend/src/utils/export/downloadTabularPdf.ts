/**
 * Download a branded tabular PDF (jsPDF) — expense-report chrome shared with all document exports.
 */
import type { DocumentBranding } from '../documentBranding';
import { loadDocumentBranding } from '../documentBranding';
import {
  BRANDED_PDF_MARGIN,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
} from './brandedPdfBase';
import {
  DOC_REPORT_PDF_COLOR,
  DOC_REPORT_PDF_FONT,
  documentReportBodyBottom,
} from './documentReportPdfChrome';
import {
  exportFilename,
  exportGeneratedAtLabel,
  exportSafeFilenamePart,
  loadExportLogoImage,
} from './exportDocumentStandard';
import { ensurePdfUnicodeFont, pdfSetFont } from './pdfUnicodeFont';

export type DownloadTabularPdfOptions = {
  title: string;
  rows: (string | number)[][];
  subtitle?: string;
  branding?: DocumentBranding;
  /**
   * Page orientation. When omitted, prefers **portrait** and switches to
   * landscape only when the table is wide enough to need it.
   */
  orientation?: 'landscape' | 'portrait';
  filename?: string;
  module?: string;
  filenameParts?: string[];
  fields?: Array<{ label: string; value: string }>;
  period?: { from: string; to: string };
  purpose?: string;
  note?: string;
  documentLabel?: string;
};

function cellStr(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value);
}

function maxColumns(rows: (string | number)[][]): number {
  let max = 1;
  for (const row of rows) {
    if (row.length > max) max = row.length;
  }
  return Math.max(1, max);
}

function isSpacerRow(row: (string | number)[]): boolean {
  return row.length === 0 || row.every((c) => cellStr(c).trim() === '');
}

/** Prefer portrait; landscape only for wide tables (many columns). */
function resolveOrientation(
  cols: number,
  explicit?: 'landscape' | 'portrait'
): 'landscape' | 'portrait' {
  if (explicit) return explicit;
  return cols >= 8 ? 'landscape' : 'portrait';
}

/**
 * Render AOA rows as a multi-page PDF and trigger a local file download (like Excel).
 */
export async function downloadTabularPdfFromAoa(
  options: DownloadTabularPdfOptions
): Promise<boolean> {
  const branding = options.branding ?? (await loadDocumentBranding(true));
  const logo = await loadExportLogoImage();
  const generatedAt = exportGeneratedAtLabel();
  const cols = maxColumns(options.rows);
  const orientation = resolveOrientation(cols, options.orientation);
  const documentLabel = options.documentLabel || options.title;

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation });
  await ensurePdfUnicodeFont(doc);

  const margin = BRANDED_PDF_MARGIN;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const bodyBottom = documentReportBodyBottom(doc);

  const headerOpts = {
    title: options.title,
    subtitle: options.subtitle,
    branding,
    logo,
    margin,
    fields: options.fields,
    period: options.period,
    purpose: options.purpose,
    documentLabel,
  };

  let y = drawBrandedPdfHeader(doc, {
    ...headerOpts,
    fields: options.fields?.length
      ? options.fields
      : [{ label: 'Generated', value: generatedAt }],
  });

  const dataRowCount = options.rows.filter((row) => !isSpacerRow(row)).length;
  let fontSize = orientation === 'portrait' ? DOC_REPORT_PDF_FONT.table : 8.5;
  if (cols >= 12) fontSize -= 2;
  else if (cols >= 9) fontSize -= 1.25;
  else if (cols >= 7) fontSize -= 0.5;
  if (dataRowCount > 80) fontSize -= 1.5;
  else if (dataRowCount > 45) fontSize -= 1;
  else if (dataRowCount > 25) fontSize -= 0.5;
  fontSize = Math.max(6.5, Math.min(10, fontSize));
  const lineH = fontSize * 0.42;
  const padX = 1.2;
  const padY = 1.15;
  const colW = contentW / cols;

  const ensureSpace = (need: number) => {
    if (y + need <= bodyBottom) return;
    doc.addPage();
    y = drawBrandedPdfHeader(doc, {
      ...headerOpts,
      title: `${options.title} (continued)`,
      includeReportHeader: false,
      fields: options.fields?.length
        ? options.fields
        : [{ label: 'Generated', value: generatedAt }],
    });
  };

  let prevWasSpacer = true;
  let dataIndex = 0;
  for (const row of options.rows) {
    if (isSpacerRow(row)) {
      ensureSpace(3);
      y += 2.5;
      prevWasSpacer = true;
      continue;
    }

    const cells = Array.from({ length: cols }, (_, i) => cellStr(row[i]));
    const wrapped = cells.map((text) => {
      const maxW = Math.max(4, colW - padX * 2);
      return doc.splitTextToSize(text || ' ', maxW) as string[];
    });
    const linesUsed = Math.max(1, ...wrapped.map((w) => w.length));
    const rowH = Math.max(lineH + padY * 2, linesUsed * lineH + padY * 2);

    ensureSpace(rowH + 0.4);

    const isHeader = prevWasSpacer;
    if (isHeader) {
      doc.setFillColor(...DOC_REPORT_PDF_COLOR.accent);
      doc.rect(margin, y, contentW, rowH, 'F');
    } else if (dataIndex % 2 === 1) {
      doc.setFillColor(...DOC_REPORT_PDF_COLOR.rowAlt);
      doc.rect(margin, y, contentW, rowH, 'F');
    }

    doc.setDrawColor(...DOC_REPORT_PDF_COLOR.border);
    doc.setLineWidth(0.15);

    for (let i = 0; i < cols; i += 1) {
      const x = margin + i * colW;
      doc.rect(x, y, colW, rowH, 'S');
      pdfSetFont(doc, isHeader ? 'bold' : 'normal');
      doc.setFontSize(isHeader ? DOC_REPORT_PDF_FONT.tableHeader : fontSize);
      doc.setTextColor(
        ...(isHeader ? DOC_REPORT_PDF_COLOR.white : DOC_REPORT_PDF_COLOR.text)
      );
      const lines = wrapped[i] || [''];
      let ty = y + padY + lineH * 0.85;
      for (const line of lines) {
        doc.text(line, x + padX, ty);
        ty += lineH;
      }
    }

    y += rowH;
    if (!isHeader) dataIndex += 1;
    prevWasSpacer = false;
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    drawBrandedPdfFooter(doc, {
      generatedAt,
      branding,
      page,
      totalPages: total,
      margin,
      note: options.note,
      documentLabel,
    });
  }

  const filename =
    options.filename ||
    exportFilename(
      options.module || 'Report',
      options.filenameParts?.length
        ? options.filenameParts
        : [exportSafeFilenamePart(options.title, 40), new Date().toISOString().slice(0, 10)],
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

/** @deprecated Prefer downloadTabularPdfFromAoa — kept as alias for existing callers. */
export async function openTabularPrintWindow(
  title: string,
  rows: (string | number)[][],
  subtitle?: string,
  branding?: DocumentBranding
): Promise<boolean> {
  return downloadTabularPdfFromAoa({
    title,
    rows,
    subtitle,
    branding,
    module: 'Report',
    filenameParts: [exportSafeFilenamePart(title, 40), new Date().toISOString().slice(0, 10)],
  });
}
