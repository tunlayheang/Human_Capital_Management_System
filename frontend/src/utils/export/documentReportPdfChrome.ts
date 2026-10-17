/**
 * Shared expense-report PDF chrome — teal accent header/footer used by all
 * document PDF exports (reports, approvals, employee profile, payroll tables, etc.).
 */
import type { jsPDF } from 'jspdf';
import type { DocumentBranding } from '../documentBranding';
import { stripRichTextToPlain } from '../documentBranding';
import {
  EXPORT_BRAND,
  type ExportLogoImage,
} from './exportDocumentStandard';
import { pdfSetFont } from './pdfUnicodeFont';

function pdfTruncateOneLine(doc: jsPDF, text: string, maxW: number): string {
  const lines = doc.splitTextToSize(text || '—', maxW);
  return lines[0] || '—';
}

function drawLogo(
  doc: jsPDF,
  logo: ExportLogoImage | null | undefined,
  x: number,
  y: number,
  sizeMm = 12
): void {
  if (!logo?.dataUrl) return;
  try {
    doc.addImage(logo.dataUrl, logo.format, x, y, sizeMm, sizeMm, undefined, 'FAST');
  } catch {
    /* text company name is enough */
  }
}

/** Brand shield teal #46B1C2 and supporting tones. */
export const DOC_REPORT_PDF_COLOR = {
  accent: [70, 177, 194] as [number, number, number],
  accentLight: [126, 201, 212] as [number, number, number],
  rowAlt: [230, 244, 247] as [number, number, number],
  text: [51, 51, 51] as [number, number, number],
  muted: [102, 102, 102] as [number, number, number],
  line: [160, 160, 160] as [number, number, number],
  border: [180, 180, 180] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

export const DOC_REPORT_PDF_MARGIN = 14;

/** Arial-like sizes from the expense-report template. */
export const DOC_REPORT_PDF_FONT = {
  title: 14,
  company: 12,
  label: 9,
  body: 10,
  table: 9,
  tableHeader: 8.5,
  italic: 9,
  meta: 7,
  signature: 9,
  section: 9,
};

/** Space reserved at page bottom for certification + signatures + meta. */
export const DOC_REPORT_PDF_FOOTER_RESERVE_MM = 34;

export type DocReportField = { label: string; value: string };

export type DocReportHeaderOptions = {
  title: string;
  branding?: DocumentBranding;
  logo?: ExportLogoImage | null;
  /** Left-column labeled fields (Report, Generated, etc.). */
  fields?: DocReportField[];
  /** Optional Period box (From / To). */
  period?: { from: string; to: string };
  purpose?: string;
  subtitle?: string;
  metaLines?: string[];
  /** Document label under company meta line in the footer. */
  documentLabel?: string;
  margin?: number;
  /** When false, skip Company Profile report header note. Default true. */
  includeReportHeader?: boolean;
};

export type DocReportFooterOptions = {
  branding?: DocumentBranding;
  page?: number;
  totalPages?: number;
  /** Italic certification under the divider. */
  certification?: string;
  /** Right-side note next to certification. */
  note?: string;
  /** Left meta line (defaults to company — documentLabel). */
  documentLabel?: string;
  margin?: number;
  generatedAt?: string;
};

function drawFieldLine(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  lineW: number
): number {
  pdfSetFont(doc, 'bold');
  doc.setFontSize(DOC_REPORT_PDF_FONT.label);
  doc.setTextColor(...DOC_REPORT_PDF_COLOR.text);
  doc.text(`${label}:`, x, y);
  const labelW = doc.getTextWidth(`${label}: `);
  pdfSetFont(doc, 'normal');
  doc.setFontSize(DOC_REPORT_PDF_FONT.body);
  const valueX = x + labelW;
  const maxW = Math.max(20, lineW - labelW);
  doc.text(pdfTruncateOneLine(doc, value || '—', maxW), valueX, y);
  doc.setDrawColor(...DOC_REPORT_PDF_COLOR.line);
  doc.setLineWidth(0.2);
  doc.line(valueX, y + 1.2, x + lineW, y + 1.2);
  return y + 6;
}

function drawPeriodBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  fromDate: string,
  toDate: string
): number {
  const headerH = 6.5;
  const rowH = 7;
  const boxH = headerH + rowH * 2;

  doc.setFillColor(...DOC_REPORT_PDF_COLOR.accent);
  doc.rect(x, y, w, headerH, 'F');
  pdfSetFont(doc, 'bold');
  doc.setFontSize(DOC_REPORT_PDF_FONT.label);
  doc.setTextColor(...DOC_REPORT_PDF_COLOR.white);
  doc.text('Period', x + w / 2, y + 4.4, { align: 'center' });

  doc.setDrawColor(...DOC_REPORT_PDF_COLOR.border);
  doc.setLineWidth(0.25);
  doc.setFillColor(...DOC_REPORT_PDF_COLOR.white);
  doc.rect(x, y + headerH, w, rowH * 2, 'FD');
  doc.line(x, y + headerH + rowH, x + w, y + headerH + rowH);

  const labelColW = 14;
  (
    [
      ['From', fromDate || '—'],
      ['To', toDate || '—'],
    ] as Array<[string, string]>
  ).forEach(([label, value], i) => {
    const rowY = y + headerH + rowH * i + 4.6;
    pdfSetFont(doc, 'bold');
    doc.setFontSize(DOC_REPORT_PDF_FONT.label);
    doc.setTextColor(...DOC_REPORT_PDF_COLOR.text);
    doc.text(label, x + 2.5, rowY);
    pdfSetFont(doc, 'normal');
    doc.setFontSize(DOC_REPORT_PDF_FONT.body);
    doc.text(pdfTruncateOneLine(doc, value, w - labelColW - 4), x + labelColW, rowY);
  });

  return y + boxH;
}

/**
 * Expense-report style header. Returns Y where body content should start.
 */
export function drawDocumentReportHeader(
  doc: jsPDF,
  options: DocReportHeaderOptions
): number {
  const margin = options.margin ?? DOC_REPORT_PDF_MARGIN;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  let y = 12;

  pdfSetFont(doc, 'bold');
  doc.setFontSize(DOC_REPORT_PDF_FONT.title);
  doc.setTextColor(...DOC_REPORT_PDF_COLOR.accent);
  doc.text(options.title, margin, y + 2);
  doc.text(options.title, margin + 0.15, y + 2);

  const company = options.branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const logoSize = 12;
  const companyMaxW = contentW * 0.42;
  if (options.logo?.dataUrl) {
    drawLogo(doc, options.logo, pageW - margin - logoSize, y - 4, logoSize);
    pdfSetFont(doc, 'bold');
    doc.setFontSize(DOC_REPORT_PDF_FONT.company);
    doc.setTextColor(...DOC_REPORT_PDF_COLOR.accent);
    doc.text(
      pdfTruncateOneLine(doc, company, companyMaxW - logoSize - 3),
      pageW - margin - logoSize - 2,
      y + 2,
      { align: 'right' }
    );
  } else {
    pdfSetFont(doc, 'bold');
    doc.setFontSize(DOC_REPORT_PDF_FONT.company);
    doc.setTextColor(...DOC_REPORT_PDF_COLOR.accent);
    doc.text(pdfTruncateOneLine(doc, company, companyMaxW), pageW - margin, y + 2, {
      align: 'right',
    });
  }

  y += 6;
  doc.setDrawColor(...DOC_REPORT_PDF_COLOR.accent);
  doc.setLineWidth(0.45);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  const fields = [...(options.fields || [])];
  if (options.subtitle?.trim()) {
    fields.unshift({ label: 'Subtitle', value: options.subtitle.trim() });
  }
  if (options.metaLines?.length) {
    fields.push({ label: 'Details', value: options.metaLines.join(' · ') });
  }
  const includeHeader = options.includeReportHeader !== false;
  const headerNote = includeHeader
    ? stripRichTextToPlain(options.branding?.reportHeader)
    : '';
  if (headerNote) {
    fields.push({ label: 'Header note', value: headerNote });
  }

  const hasPeriod = Boolean(options.period);
  const leftW = hasPeriod ? contentW * 0.55 : contentW;
  const rightW = contentW * 0.38;
  const rightX = pageW - margin - rightW;
  const fieldsStartY = y;
  let leftY = y;

  if (fields.length) {
    for (const field of fields.slice(0, 6)) {
      leftY = drawFieldLine(doc, field.label, field.value, margin, leftY, leftW);
    }
  } else {
    leftY = drawFieldLine(doc, 'Document', options.title, margin, leftY, leftW);
  }

  let periodBottom = fieldsStartY;
  if (options.period) {
    periodBottom = drawPeriodBox(
      doc,
      rightX,
      fieldsStartY - 1,
      rightW,
      options.period.from,
      options.period.to
    );
  }

  let metaY = Math.max(leftY, periodBottom) + 2;
  if (options.purpose?.trim()) {
    metaY = drawFieldLine(doc, 'Purpose', options.purpose.trim(), margin, metaY, contentW);
  }

  return metaY + 3;
}

/**
 * Certification + dual signature blocks + page meta.
 */
export function drawDocumentReportFooter(
  doc: jsPDF,
  options: DocReportFooterOptions
): void {
  const margin = options.margin ?? DOC_REPORT_PDF_MARGIN;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const footerTop = pageH - 32;
  const contentW = pageW - margin * 2;

  doc.setDrawColor(...DOC_REPORT_PDF_COLOR.accent);
  doc.setLineWidth(0.35);
  doc.line(margin, footerTop, pageW - margin, footerTop);

  let y = footerTop + 5;
  const certification =
    options.certification?.trim() ||
    'I certify that the above information is accurate and complete.';
  pdfSetFont(doc, 'italic');
  doc.setFontSize(DOC_REPORT_PDF_FONT.italic);
  doc.setTextColor(...DOC_REPORT_PDF_COLOR.text);
  doc.text(
    pdfTruncateOneLine(doc, certification, contentW * 0.62),
    margin,
    y
  );

  const note =
    options.note?.trim() ||
    (options.generatedAt ? `Generated ${options.generatedAt}` : '');
  if (note) {
    pdfSetFont(doc, 'bold');
    doc.setFontSize(DOC_REPORT_PDF_FONT.label);
    doc.setTextColor(...DOC_REPORT_PDF_COLOR.muted);
    doc.text(pdfTruncateOneLine(doc, note, contentW * 0.35), pageW - margin, y, {
      align: 'right',
    });
  }

  y = pageH - 12;
  const sigLineW = 42;
  const dateLineW = 22;
  const pairGap = 4;
  const pairW = sigLineW + pairGap + dateLineW;
  const leftX = margin;
  const rightX = pageW - margin - pairW;

  const drawSigBlock = (x: number, title: string) => {
    doc.setDrawColor(...DOC_REPORT_PDF_COLOR.line);
    doc.setLineWidth(0.25);
    doc.line(x, y, x + sigLineW, y);
    pdfSetFont(doc, 'normal');
    doc.setFontSize(DOC_REPORT_PDF_FONT.signature);
    doc.setTextColor(...DOC_REPORT_PDF_COLOR.text);
    doc.text(title, x, y + 4);

    const dateX = x + sigLineW + pairGap;
    doc.line(dateX, y, dateX + dateLineW, y);
    doc.text('Date', dateX, y + 4);
  };

  drawSigBlock(leftX, 'Prepared By');
  drawSigBlock(rightX, 'Authorized By');

  const metaY = pageH - 4;
  pdfSetFont(doc, 'normal');
  doc.setFontSize(DOC_REPORT_PDF_FONT.meta);
  doc.setTextColor(...DOC_REPORT_PDF_COLOR.muted);
  const company = options.branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const docLabel = options.documentLabel?.trim() || 'Document';
  doc.text(
    pdfTruncateOneLine(doc, `${company} — ${docLabel}`, contentW * 0.62),
    margin,
    metaY
  );
  if (options.totalPages && options.page) {
    doc.text(`Page ${options.page} of ${options.totalPages}`, pageW - margin, metaY, {
      align: 'right',
    });
  }
}

/** Body content should stop above this Y to avoid overlapping the footer. */
export function documentReportBodyBottom(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - DOC_REPORT_PDF_FOOTER_RESERVE_MM;
}
