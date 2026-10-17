/**
 * Shared branded PDF chrome — expense-report style header/footer (teal accent)
 * used by all jsPDF document exports.
 */
import type { jsPDF } from 'jspdf';
import {
  EXPORT_BRAND,
  exportGeneratedAtLabel,
  loadExportLogoImage,
  type ExportLogoImage,
} from './exportDocumentStandard';
import { ensurePdfUnicodeFont, pdfSetFont } from './pdfUnicodeFont';
import { loadDocumentBranding, type DocumentBranding } from '../documentBranding';
import {
  DOC_REPORT_PDF_COLOR,
  DOC_REPORT_PDF_FOOTER_RESERVE_MM,
  DOC_REPORT_PDF_MARGIN,
  drawDocumentReportFooter,
  drawDocumentReportHeader,
} from './documentReportPdfChrome';

export const BRANDED_PDF_PAGE_W = 210;
export const BRANDED_PDF_PAGE_H = 297;
export const BRANDED_PDF_MARGIN = DOC_REPORT_PDF_MARGIN;
export const BRANDED_PDF_CONTENT_W = BRANDED_PDF_PAGE_W - BRANDED_PDF_MARGIN * 2;
export const BRANDED_PDF_FOOTER_Y = BRANDED_PDF_PAGE_H - 8;
export const BRANDED_PDF_BODY_BOTTOM = BRANDED_PDF_PAGE_H - DOC_REPORT_PDF_FOOTER_RESERVE_MM;
export const BRANDED_PDF_LOGO_MM = 22;

/** Teal brand palette shared by all document PDFs. */
export const BRANDED_PDF_COLOR = {
  primary: DOC_REPORT_PDF_COLOR.accent,
  text: DOC_REPORT_PDF_COLOR.text,
  muted: DOC_REPORT_PDF_COLOR.muted,
  border: DOC_REPORT_PDF_COLOR.border,
  panel: DOC_REPORT_PDF_COLOR.rowAlt,
  blueLight: DOC_REPORT_PDF_COLOR.rowAlt,
  section: DOC_REPORT_PDF_COLOR.rowAlt,
  white: DOC_REPORT_PDF_COLOR.white,
  accent: DOC_REPORT_PDF_COLOR.accent,
};

export type BrandedPdfContext = {
  branding: DocumentBranding;
  logo: ExportLogoImage | null;
  generatedAt: string;
};

export async function loadBrandedPdfContext(forceBranding = true): Promise<BrandedPdfContext> {
  const [branding, logo] = await Promise.all([
    loadDocumentBranding(forceBranding),
    loadExportLogoImage(),
  ]);
  return {
    branding,
    logo,
    generatedAt: exportGeneratedAtLabel(),
  };
}

export async function createBrandedPdf(): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  await ensurePdfUnicodeFont(doc);
  return doc;
}

export function pdfTruncateOneLine(doc: jsPDF, text: string, maxW: number): string {
  const lines = doc.splitTextToSize(text || '—', maxW);
  return lines[0] || '—';
}

export function drawBrandedPdfLogo(
  doc: jsPDF,
  logo: ExportLogoImage | null,
  x: number,
  y: number,
  sizeMm = BRANDED_PDF_LOGO_MM
): void {
  if (!logo?.dataUrl) {
    doc.setFillColor(...BRANDED_PDF_COLOR.blueLight);
    doc.setDrawColor(...BRANDED_PDF_COLOR.border);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, sizeMm, sizeMm, 1.2, 1.2, 'FD');
    pdfSetFont(doc, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BRANDED_PDF_COLOR.primary);
    doc.text(EXPORT_BRAND.companyShort, x + sizeMm / 2, y + sizeMm / 2 + 1, { align: 'center' });
    return;
  }
  try {
    doc.addImage(logo.dataUrl, logo.format, x, y, sizeMm, sizeMm, undefined, 'FAST');
  } catch (err) {
    console.warn('[pdf] Logo embed failed; using text fallback', err);
    drawBrandedPdfLogo(doc, null, x, y, sizeMm);
  }
}

export type BrandedPdfHeaderOptions = {
  title: string;
  subtitle?: string;
  metaLines?: string[];
  branding?: DocumentBranding;
  logo?: ExportLogoImage | null;
  margin?: number;
  logoSizeMm?: number;
  /** When false, skip Company Profile report header even if set. Default true. */
  includeReportHeader?: boolean;
  fields?: Array<{ label: string; value: string }>;
  period?: { from: string; to: string };
  purpose?: string;
  documentLabel?: string;
};

/**
 * Expense-report style header (title + company, fields, optional Period).
 * Returns Y where body content should start.
 */
export function drawBrandedPdfHeader(doc: jsPDF, options: BrandedPdfHeaderOptions): number {
  const fields = [...(options.fields || [])];
  if (!fields.length && options.subtitle) {
    fields.push({ label: 'Details', value: options.subtitle });
  }
  return drawDocumentReportHeader(doc, {
    title: options.title,
    branding: options.branding,
    logo: options.logo,
    fields,
    period: options.period,
    purpose: options.purpose,
    metaLines: options.metaLines,
    documentLabel: options.documentLabel || options.title,
    margin: options.margin,
    includeReportHeader: options.includeReportHeader,
  });
}

export type BrandedPdfFooterOptions = {
  generatedAt: string;
  branding?: DocumentBranding;
  page?: number;
  totalPages?: number;
  margin?: number;
  /** Override footer note (right of certification). */
  footerText?: string;
  note?: string;
  certification?: string;
  documentLabel?: string;
};

/** Draw certification + signature blocks + page meta on the current page. */
export function drawBrandedPdfFooter(doc: jsPDF, options: BrandedPdfFooterOptions): void {
  drawDocumentReportFooter(doc, {
    branding: options.branding,
    page: options.page ?? 1,
    totalPages: options.totalPages ?? 1,
    generatedAt: options.generatedAt,
    note: options.note || options.footerText,
    certification: options.certification,
    documentLabel: options.documentLabel,
    margin: options.margin,
  });
}

/** Apply branded footer to every page, then save. */
export function finalizeBrandedPdf(
  doc: jsPDF,
  filename: string,
  generatedAt: string,
  branding?: DocumentBranding,
  footerText?: string
): void {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    drawBrandedPdfFooter(doc, {
      generatedAt,
      branding,
      page,
      totalPages: total,
      footerText,
    });
  }
  doc.save(filename);
}

/** `Label: value` cell — form-field style. */
export function drawBrandedKeyValueCell(
  doc: jsPDF,
  x: number,
  y: number,
  colW: number,
  label: string,
  value: string,
  labelW = 32
): void {
  const valueX = x + labelW;
  const valueMaxW = Math.max(12, colW - labelW - 1);
  pdfSetFont(doc, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...BRANDED_PDF_COLOR.muted);
  doc.text(`${label}:`, x, y);

  pdfSetFont(doc, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BRANDED_PDF_COLOR.text);
  doc.text(pdfTruncateOneLine(doc, value || '—', valueMaxW), valueX, y);
}
