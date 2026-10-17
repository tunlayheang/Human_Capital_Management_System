import type { jsPDF } from 'jspdf';
import {
  BRANDED_PDF_BODY_BOTTOM,
  BRANDED_PDF_COLOR,
  BRANDED_PDF_CONTENT_W,
  BRANDED_PDF_FOOTER_Y,
  BRANDED_PDF_MARGIN,
  BRANDED_PDF_PAGE_H,
  BRANDED_PDF_PAGE_W,
  createBrandedPdf,
  drawBrandedKeyValueCell,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
  loadBrandedPdfContext,
  type BrandedPdfContext,
} from './export/brandedPdfBase';
import {
  exportGeneratedAtLabel,
  exportSafeFilenamePart,
  type ExportLogoImage,
} from './export/exportDocumentStandard';
import { pdfSetFont } from './export/pdfUnicodeFont';
import type { DocumentBranding } from './documentBranding';

export type { BrandedPdfContext, ExportLogoImage };

export const PDF_PAGE_W = BRANDED_PDF_PAGE_W;
export const PDF_PAGE_H = BRANDED_PDF_PAGE_H;
export const PDF_MARGIN = BRANDED_PDF_MARGIN;
export const PDF_CONTENT_W = BRANDED_PDF_CONTENT_W;
export const PDF_FOOTER_Y = BRANDED_PDF_FOOTER_Y;
export const PDF_BODY_BOTTOM = BRANDED_PDF_BODY_BOTTOM;

/** Brand palette (Excel-matched #0F5BA7). */
export const PDF_COLOR = BRANDED_PDF_COLOR;

export function pdfDisplay(val: unknown): string {
  if (val == null || val === '') return '—';
  const s = String(val).trim();
  return s || '—';
}

export function pdfSafeFilenamePart(value: string): string {
  return exportSafeFilenamePart(value);
}

export function pdfGeneratedAtLabel(): string {
  return exportGeneratedAtLabel();
}

export async function createApprovalPdf(): Promise<jsPDF> {
  return createBrandedPdf();
}

export async function loadApprovalPdfContext(): Promise<BrandedPdfContext> {
  return loadBrandedPdfContext(true);
}

export function pdfDrawFooter(
  doc: jsPDF,
  page: number,
  total: number,
  generatedAt: string,
  branding?: DocumentBranding,
  documentLabel?: string
) {
  drawBrandedPdfFooter(doc, {
    generatedAt,
    branding,
    page,
    totalPages: total,
    documentLabel,
  });
}

export function pdfEnsureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PDF_BODY_BOTTOM) return y;
  doc.addPage();
  return PDF_MARGIN + 4;
}

/**
 * Expense-report cover: title + company, optional subtitle/meta fields.
 */
export function pdfDrawCover(
  doc: jsPDF,
  _y: number,
  title: string,
  subtitle: string,
  metaLines: string[] = [],
  branding?: DocumentBranding,
  logo?: ExportLogoImage | null
): number {
  return drawBrandedPdfHeader(doc, {
    title,
    branding,
    logo: logo ?? null,
    fields: [
      { label: 'Document', value: title },
      ...(subtitle ? [{ label: 'Details', value: subtitle }] : []),
      ...(metaLines.length ? [{ label: 'Meta', value: metaLines.join(' · ') }] : []),
    ],
    documentLabel: title,
  });
}

export function pdfDrawSectionTitle(doc: jsPDF, y: number, title: string): number {
  y = pdfEnsureSpace(doc, y, 10);
  doc.setDrawColor(...PDF_COLOR.border);
  doc.setLineWidth(0.2);
  doc.line(PDF_MARGIN, y, PDF_PAGE_W - PDF_MARGIN, y);
  y += 4;
  pdfSetFont(doc, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLOR.primary);
  doc.text(title.toUpperCase(), PDF_MARGIN, y);
  return y + 5;
}

export function pdfDrawKeyValueGrid(
  doc: jsPDF,
  y: number,
  rows: Array<{ label: string; value: string }>,
  columns = 2
): number {
  const colW = PDF_CONTENT_W / columns;
  const rowH = 7;
  let col = 0;
  let rowY = y;

  for (const item of rows) {
    rowY = pdfEnsureSpace(doc, rowY, rowH);
    const x = PDF_MARGIN + col * colW;
    drawBrandedKeyValueCell(doc, x, rowY + 3, colW - 2, item.label, pdfDisplay(item.value));
    col += 1;
    if (col >= columns) {
      col = 0;
      rowY += rowH;
    }
  }
  if (col > 0) rowY += rowH;
  return rowY + 2;
}

export function pdfDrawParagraph(doc: jsPDF, y: number, label: string, text: string): number {
  const body = pdfDisplay(text);
  if (body === '—') return y;
  y = pdfEnsureSpace(doc, y, 10);
  pdfSetFont(doc, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_COLOR.muted);
  doc.text(`${label}:`, PDF_MARGIN, y);
  y += 3.5;
  pdfSetFont(doc, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLOR.text);
  const lines = doc.splitTextToSize(body, PDF_CONTENT_W);
  y = pdfEnsureSpace(doc, y, lines.length * 4 + 2);
  doc.text(lines, PDF_MARGIN, y);
  return y + lines.length * 4 + 3;
}

export function pdfFinalizeAndSave(
  doc: jsPDF,
  filename: string,
  generatedAt: string,
  branding?: DocumentBranding,
  documentLabel?: string
) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    pdfDrawFooter(doc, page, total, generatedAt, branding, documentLabel);
  }
  doc.save(filename);
}
