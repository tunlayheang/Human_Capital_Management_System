/**
 * Shared branding, metadata blocks, and download helpers for PDF / Excel / CSV exports.
 */
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type { DocumentBranding } from '../documentBranding';
import { resolveReportFooterText, stripRichTextToPlain } from '../documentBranding';
import { fetchPortalBranding } from '../../services/portalBranding';
import { resolveMediaUrl } from '../mediaUrl';
import {
  drawDocumentReportExcelChrome,
  drawDocumentReportExcelFooter,
  styleDocumentReportExcelTable,
} from './documentReportExcelChrome';

export const EXPORT_BRAND = {
  companyName: 'ROC Human Capital Management',
  companyShort: 'ROC HCMS',
  documentFooter: 'ROC Human Capital Management — Confidential',
  internalUseFooter: 'Internal use only',
  applicationLabel: 'ROC HCMS v5.8',
} as const;

export type ExportFileExt = 'pdf' | 'xlsx' | 'csv';

export type TabularMetadataField = {
  label: string;
  value: string | number;
};

/** Locale display timestamp — used in PDF footers, print HTML, and tabular metadata. */
export function exportGeneratedAtLabel(date: Date = new Date()): string {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function exportGeneratedAtIso(date: Date = new Date()): string {
  return date.toISOString();
}

export function exportSafeFilenamePart(value: string, maxLen = 48): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, maxLen) || 'Document';
}

export function exportFilename(
  module: string,
  parts: string[],
  ext: ExportFileExt
): string {
  const safeModule = exportSafeFilenamePart(module, 24);
  const safeParts = parts.map((p) => exportSafeFilenamePart(p, 32)).filter(Boolean);
  return `${safeModule}_${safeParts.join('_')}.${ext}`;
}

/** Metadata block for Excel (array-of-arrays). */
export function buildTabularMetadataAoa(
  reportTitle: string,
  fields: TabularMetadataField[],
  branding?: DocumentBranding
): (string | number)[][] {
  const companyName = branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const rows: (string | number)[][] = [[companyName], [reportTitle]];
  const headerNote = stripRichTextToPlain(branding?.reportHeader);
  if (headerNote) {
    rows.push([headerNote]);
  }
  for (const field of fields) {
    rows.push([field.label, field.value]);
  }
  rows.push(['Generated On', exportGeneratedAtLabel()]);
  rows.push(['Application', EXPORT_BRAND.applicationLabel]);
  rows.push([]);
  return rows;
}

/** Metadata block for CSV (pre-built lines). */
export function buildMetadataCsvLines(
  reportTitle: string,
  fields: TabularMetadataField[],
  branding?: DocumentBranding
): string[] {
  const companyName = branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const lines: string[] = [csvRow([companyName]), csvRow([reportTitle])];
  const headerNote = stripRichTextToPlain(branding?.reportHeader);
  if (headerNote) {
    lines.push(csvRow([headerNote]));
  }
  for (const field of fields) {
    lines.push(csvRow([field.label, field.value]));
  }
  lines.push(csvRow(['Generated On', exportGeneratedAtLabel()]));
  lines.push(csvRow(['Application', EXPORT_BRAND.applicationLabel]));
  lines.push('');
  return lines;
}

export function appendReportFooterCsvLines(lines: string[], branding?: DocumentBranding): string[] {
  const footer = resolveReportFooterText(branding);
  return [...lines, csvRow([footer]), csvRow([EXPORT_BRAND.internalUseFooter])];
}

export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function aoaToCsvLines(rows: (string | number)[][]): string[] {
  return rows.map((row) => csvRow(row));
}

export function downloadCsvContent(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsvLines(lines: string[], filename: string): void {
  downloadCsvContent(lines.join('\r\n'), filename);
}

/** Parse a simple CSV string into an array-of-arrays (handles quoted cells). */
export function csvStringToAoa(csv: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      rows.push([]);
      continue;
    }
    const cells: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

export function downloadAoaAsXlsx(
  rows: (string | number)[][],
  filename: string,
  sheetName = 'Export'
): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  ws['!cols'] = Array(Math.max(1, maxCols)).fill({ wch: 18 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

export type BrandedWorkbookSheet = {
  name: string;
  aoa: (string | number)[][];
  headerRows?: number[];
  sectionRows?: number[];
  columnWidths?: number[];
  freezeRowCount?: number;
  autoFilter?: { fromRow: number; toRow: number; fromCol?: number; toCol?: number };
  /** When true, last table row is styled as totals. */
  totalsLastRow?: boolean;
};

export type BrandedWorkbookChromeOptions = {
  fields?: Array<{ label: string; value: string }>;
  period?: { from: string; to: string };
  purpose?: string;
  note?: string;
  certification?: string;
  documentLabel?: string;
};

/** Excel / PDF shared brand palette (ARGB hex without `#`) — teal document chrome. */
export const EXPORT_BRAND_HEX = {
  blue: '46B1C2',
  blueLight: 'E6F4F7',
  border: 'B4B4B4',
  headerBg: '46B1C2',
  sectionBg: '7EC9D4',
  textMuted: '666666',
  textDark: '333333',
  white: 'FFFFFF',
  zebra: 'E6F4F7',
} as const;

/** RGB tuples for jsPDF (same values as Excel branding). */
export const EXPORT_BRAND_RGB = {
  blue: [70, 177, 194] as [number, number, number],
  blueLight: [230, 244, 247] as [number, number, number],
  border: [180, 180, 180] as [number, number, number],
  headerBg: [70, 177, 194] as [number, number, number],
  sectionBg: [126, 201, 212] as [number, number, number],
  textMuted: [102, 102, 102] as [number, number, number],
  textDark: [51, 51, 51] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  panel: [230, 244, 247] as [number, number, number],
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read logo image'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode logo image'));
    img.src = src;
  });
}

/**
 * jsPDF only embeds JPEG/PNG reliably. Convert WebP/GIF (common on deploy uploads)
 * via canvas; skip SVG and anything that cannot be rasterized.
 */
async function logoBlobToPdfDataUrl(blob: Blob): Promise<string | null> {
  const type = (blob.type || '').toLowerCase();
  if (type.includes('svg')) return null;
  if (type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png') {
    return blobToDataUrl(blob);
  }
  if (!type.startsWith('image/')) return null;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadHtmlImage(objectUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Portal logo as a data URL — shared by Excel and branded PDF exports. */
export async function loadExportLogoDataUrl(): Promise<string | null> {
  try {
    const branding = await fetchPortalBranding();
    const logoUrl = resolveMediaUrl(branding.logo);
    if (!logoUrl) return null;
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await logoBlobToPdfDataUrl(blob);
  } catch {
    return null;
  }
}

function logoImageFormat(dataUrl: string): 'JPEG' | 'PNG' {
  return dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg') ? 'JPEG' : 'PNG';
}

export type ExportLogoImage = { dataUrl: string; format: 'JPEG' | 'PNG' };

export async function loadExportLogoImage(): Promise<ExportLogoImage | null> {
  const dataUrl = await loadExportLogoDataUrl();
  if (!dataUrl) return null;
  return { dataUrl, format: logoImageFormat(dataUrl) };
}

function sheetMaxCols(sheet: BrandedWorkbookSheet): number {
  return Math.max(1, ...sheet.aoa.map((row) => row.length), sheet.columnWidths?.length ?? 0);
}

/**
 * Content start within AOA: strip legacy metadata prepended via `buildTabularMetadataAoa`
 * (callers mark the first real header/section with `headerRows` / `sectionRows`).
 */
function aoaContentStartIndex(sheet: BrandedWorkbookSheet): number {
  const markers = [...(sheet.headerRows ?? []), ...(sheet.sectionRows ?? [])];
  if (!markers.length) return 0;
  return Math.max(0, Math.min(...markers));
}

export async function downloadBrandedWorkbookAsXlsx(options: {
  filename: string;
  reportTitle: string;
  branding?: DocumentBranding;
  sheets: BrandedWorkbookSheet[];
} & BrandedWorkbookChromeOptions): Promise<void> {
  const branding = options.branding;
  const logoDataUrl = await loadExportLogoDataUrl();
  const generatedAt = exportGeneratedAtLabel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = EXPORT_BRAND.companyShort;
  workbook.created = new Date();
  workbook.modified = new Date();

  const chromeFields =
    options.fields?.length
      ? options.fields
      : [
          { label: 'Document', value: options.reportTitle },
          { label: 'Generated', value: generatedAt },
          { label: 'Prepared by', value: '' },
        ];

  for (const sheetConfig of options.sheets) {
    const sheet = workbook.addWorksheet(sheetConfig.name.slice(0, 31));
    const contentStart = aoaContentStartIndex(sheetConfig);
    const tableAoa = sheetConfig.aoa.slice(contentStart);
    const maxCols = Math.max(
      6,
      sheetMaxCols({ ...sheetConfig, aoa: tableAoa.length ? tableAoa : sheetConfig.aoa })
    );
    const headerOffsets = (sheetConfig.headerRows ?? [contentStart]).map(
      (r) => r - contentStart
    );
    const sectionOffsets = (sheetConfig.sectionRows ?? []).map((r) => r - contentStart);

    sheet.properties.defaultRowHeight = 18;
    sheet.pageSetup = {
      orientation: maxCols >= 8 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.2 },
    };
    sheet.columns = Array.from({ length: maxCols }, (_, index) => ({
      width: Math.max(sheetConfig.columnWidths?.[index] ?? (index === 0 ? 28 : 14), 10),
    }));

    const tableStart = drawDocumentReportExcelChrome(workbook, sheet, maxCols, {
      title: options.reportTitle,
      branding,
      documentLabel: options.documentLabel || options.reportTitle,
      fields: chromeFields,
      period: options.period,
      purpose: options.purpose,
      note: options.note,
      certification: options.certification,
      generatedAt,
      logoDataUrl,
    });

    if (tableAoa.length) {
      styleDocumentReportExcelTable(sheet, tableStart, tableAoa, maxCols, {
        headerRowOffsets: headerOffsets,
        sectionRowOffsets: sectionOffsets,
        totalsLastRow: sheetConfig.totalsLastRow,
      });
    }

    const freezeAt =
      tableStart +
      (sheetConfig.freezeRowCount != null
        ? Math.max(0, sheetConfig.freezeRowCount - 1)
        : Math.min(...(headerOffsets.length ? headerOffsets : [0])));
    sheet.views = [{ state: 'frozen', ySplit: freezeAt }];

    if (sheetConfig.autoFilter && tableAoa.length) {
      sheet.autoFilter = {
        from: {
          row: tableStart + sheetConfig.autoFilter.fromRow - contentStart,
          column: sheetConfig.autoFilter.fromCol ?? 1,
        },
        to: {
          row: tableStart + sheetConfig.autoFilter.toRow - contentStart,
          column: sheetConfig.autoFilter.toCol ?? maxCols,
        },
      };
    }

    drawDocumentReportExcelFooter(sheet, tableStart + Math.max(tableAoa.length, 1), maxCols, {
      title: options.reportTitle,
      branding,
      documentLabel: options.documentLabel || sheetConfig.name || options.reportTitle,
      note: options.note,
      certification: options.certification,
      generatedAt,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options.filename;
  link.click();
  URL.revokeObjectURL(url);
}
