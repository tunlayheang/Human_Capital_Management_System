/**
 * Shared expense-report Excel chrome — teal accent header/footer used by all
 * branded workbook exports (reports, lists, approvals, payroll registers, etc.).
 */
import type ExcelJS from 'exceljs';
import type { DocumentBranding } from '../documentBranding';
import { EXPORT_BRAND, exportGeneratedAtLabel } from './exportDocumentStandard';

/** Teal palette matching document PDF chrome (#46B1C2). */
export const DOC_REPORT_EXCEL_TEAL = {
  accent: '46B1C2',
  accentLight: '7EC9D4',
  rowAlt: 'E6F4F7',
  text: '333333',
  muted: '666666',
  line: 'A0A0A0',
  border: 'B4B4B4',
  white: 'FFFFFF',
} as const;

export type DocReportExcelField = { label: string; value: string };

export type DocReportExcelChromeOptions = {
  title: string;
  branding?: DocumentBranding;
  documentLabel?: string;
  fields?: DocReportExcelField[];
  period?: { from: string; to: string };
  purpose?: string;
  note?: string;
  certification?: string;
  generatedAt?: string;
  logoDataUrl?: string | null;
};

function applyBorder(cell: ExcelJS.Cell, color = DOC_REPORT_EXCEL_TEAL.border): void {
  cell.border = {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } },
  };
}

function fillSolid(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/**
 * Draw title/company, optional Period, field lines, then return the next free row
 * (where the data table should start).
 */
export function drawDocumentReportExcelChrome(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  colCount: number,
  options: DocReportExcelChromeOptions
): number {
  const TEAL = DOC_REPORT_EXCEL_TEAL;
  const company = options.branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const generatedAt = options.generatedAt || exportGeneratedAtLabel();
  const title = options.title || 'Report';
  let row = 1;

  const titleCell = sheet.getCell(row, 1);
  sheet.mergeCells(row, 1, row, Math.max(2, Math.floor(colCount / 2)));
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: TEAL.accent }, name: 'Arial' };
  titleCell.alignment = { vertical: 'middle' };

  const companyCol = Math.max(3, Math.floor(colCount / 2) + 1);
  const companyCell = sheet.getCell(row, companyCol);
  sheet.mergeCells(row, companyCol, row, colCount);
  companyCell.value = company;
  companyCell.font = { bold: true, size: 12, color: { argb: TEAL.accent }, name: 'Arial' };
  companyCell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(row).height = 26;

  if (options.logoDataUrl) {
    const imageId = workbook.addImage({
      base64: options.logoDataUrl,
      extension: options.logoDataUrl.includes('image/jpeg') ? 'jpeg' : 'png',
    });
    sheet.addImage(imageId, {
      tl: { col: Math.max(0, colCount - 0.85), row: 0.1 },
      ext: { width: 36, height: 36 },
    });
  }

  row += 1;
  for (let c = 1; c <= colCount; c += 1) {
    sheet.getCell(row, c).border = {
      bottom: { style: 'medium', color: { argb: TEAL.accent } },
    };
  }
  sheet.getRow(row).height = 6;

  row += 1;
  const metaStart = row;
  const fields: DocReportExcelField[] = options.fields?.length
    ? options.fields.slice(0, 6)
    : [
        { label: 'Document', value: title },
        { label: 'Generated', value: generatedAt },
        { label: 'Prepared by', value: '' },
      ];

  const leftSpan = options.period
    ? Math.max(2, Math.floor(colCount * 0.55))
    : colCount;

  fields.forEach((field, i) => {
    const r = metaStart + i;
    const labelCell = sheet.getCell(r, 1);
    labelCell.value = `${field.label}:`;
    labelCell.font = { bold: true, size: 9, color: { argb: TEAL.text }, name: 'Arial' };
    const valueCell = sheet.getCell(r, 2);
    if (leftSpan >= 2) {
      try {
        sheet.mergeCells(r, 2, r, leftSpan);
      } catch {
        /* already merged */
      }
    }
    valueCell.value = field.value || '—';
    valueCell.font = { size: 10, color: { argb: TEAL.text }, name: 'Arial' };
    valueCell.border = { bottom: { style: 'thin', color: { argb: TEAL.line } } };
  });

  let blockBottom = metaStart + fields.length - 1;

  if (options.period) {
    const periodCol = Math.max(Math.floor(colCount * 0.6) + 1, 4);
    const periodEnd = colCount;
    const periodHeader = sheet.getCell(metaStart, periodCol);
    try {
      sheet.mergeCells(metaStart, periodCol, metaStart, periodEnd);
    } catch {
      /* ignore */
    }
    periodHeader.value = 'Period';
    periodHeader.font = { bold: true, size: 9, color: { argb: TEAL.white }, name: 'Arial' };
    periodHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    fillSolid(periodHeader, TEAL.accent);
    applyBorder(periodHeader, TEAL.border);

    const fromRow = metaStart + 1;
    const toRow = metaStart + 2;
    try {
      sheet.mergeCells(fromRow, periodCol, fromRow, periodEnd);
      sheet.mergeCells(toRow, periodCol, toRow, periodEnd);
    } catch {
      /* ignore */
    }
    const fromCell = sheet.getCell(fromRow, periodCol);
    const toCell = sheet.getCell(toRow, periodCol);
    fromCell.value = `From:  ${options.period.from || '—'}`;
    toCell.value = `To:  ${options.period.to || '—'}`;
    [fromCell, toCell].forEach((cell) => {
      cell.font = { size: 10, color: { argb: TEAL.text }, name: 'Arial' };
      cell.alignment = { vertical: 'middle' };
      applyBorder(cell, TEAL.border);
    });
    blockBottom = Math.max(blockBottom, toRow);
  }

  row = blockBottom + 1;
  if (options.purpose?.trim()) {
    row += 1;
    const purposeLabel = sheet.getCell(row, 1);
    purposeLabel.value = 'Purpose:';
    purposeLabel.font = { bold: true, size: 9, color: { argb: TEAL.text }, name: 'Arial' };
    const purposeValue = sheet.getCell(row, 2);
    try {
      sheet.mergeCells(row, 2, row, colCount);
    } catch {
      /* ignore */
    }
    purposeValue.value = options.purpose.trim();
    purposeValue.font = { size: 10, color: { argb: TEAL.text }, name: 'Arial' };
    purposeValue.border = { bottom: { style: 'thin', color: { argb: TEAL.line } } };
    purposeValue.alignment = { wrapText: true };
    sheet.getRow(row).height = 22;
  }

  return row + 2;
}

/** Style a data table starting at `tableStart` (1-based). */
export function styleDocumentReportExcelTable(
  sheet: ExcelJS.Worksheet,
  tableStart: number,
  table: (string | number)[][],
  colCount: number,
  options?: {
    /** Absolute offsets within `table` styled as teal headers. Defaults to [0]. */
    headerRowOffsets?: number[];
    sectionRowOffsets?: number[];
    totalsLastRow?: boolean;
  }
): void {
  const TEAL = DOC_REPORT_EXCEL_TEAL;
  const headerSet = new Set(
    options?.headerRowOffsets?.length ? options.headerRowOffsets : [0]
  );
  const sectionSet = new Set(options?.sectionRowOffsets || []);
  const hasTotals = Boolean(options?.totalsLastRow);

  table.forEach((tableRow, idx) => {
    const r = tableStart + idx;
    const excelRow = sheet.getRow(r);
    const isHeader = headerSet.has(idx);
    const isSection = sectionSet.has(idx);
    const isBlank = tableRow.every((cell) => String(cell ?? '').trim() === '');
    const isTotals = hasTotals && idx === table.length - 1;
    tableRow.forEach((value, c) => {
      const cell = excelRow.getCell(c + 1);
      cell.value = value as ExcelJS.CellValue;
      if (isBlank) return;
      applyBorder(cell, TEAL.border);
      cell.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: c === 0 ? 'left' : typeof value === 'number' ? 'right' : 'left',
      };
      cell.font = {
        name: 'Arial',
        size: isHeader ? 8.5 : 9,
        bold: isHeader || isSection || isTotals,
        color: {
          argb: isHeader || isTotals ? TEAL.white : TEAL.text,
        },
      };
      if (isHeader) fillSolid(cell, TEAL.accent);
      else if (isTotals) fillSolid(cell, TEAL.accentLight);
      else if (isSection) fillSolid(cell, TEAL.accentLight);
      else if (idx % 2 === 0) fillSolid(cell, TEAL.rowAlt);
    });
    if (!isBlank) {
      for (let c = tableRow.length + 1; c <= colCount; c += 1) {
        const cell = sheet.getCell(r, c);
        applyBorder(cell, TEAL.border);
        if (isHeader) fillSolid(cell, TEAL.accent);
        else if (isTotals) fillSolid(cell, TEAL.accentLight);
        else if (isSection) fillSolid(cell, TEAL.accentLight);
        else if (idx % 2 === 0) fillSolid(cell, TEAL.rowAlt);
      }
    }
    excelRow.height = isHeader ? 22 : 18;
  });
}

/** Certification + signature blocks + company meta under the table. */
export function drawDocumentReportExcelFooter(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  colCount: number,
  options: DocReportExcelChromeOptions
): void {
  const TEAL = DOC_REPORT_EXCEL_TEAL;
  const company = options.branding?.companyName?.trim() || EXPORT_BRAND.companyName;
  const docLabel = options.documentLabel?.trim() || options.title || 'Document';
  let row = startRow + 1;

  for (let c = 1; c <= colCount; c += 1) {
    sheet.getCell(row, c).border = {
      top: { style: 'medium', color: { argb: TEAL.accent } },
    };
  }
  row += 1;

  const certCell = sheet.getCell(row, 1);
  const certEnd = Math.max(2, Math.floor(colCount * 0.65));
  try {
    sheet.mergeCells(row, 1, row, certEnd);
  } catch {
    /* ignore */
  }
  certCell.value =
    options.certification?.trim() ||
    'I certify that the above information is accurate and complete.';
  certCell.font = { italic: true, size: 9, color: { argb: TEAL.text }, name: 'Arial' };

  const noteStart = Math.max(3, certEnd + 1);
  const noteCell = sheet.getCell(row, noteStart);
  try {
    sheet.mergeCells(row, noteStart, row, colCount);
  } catch {
    /* ignore */
  }
  noteCell.value =
    options.note?.trim() ||
    (options.generatedAt ? `Generated ${options.generatedAt}` : `Generated ${exportGeneratedAtLabel()}`);
  noteCell.font = { bold: true, size: 9, color: { argb: TEAL.muted }, name: 'Arial' };
  noteCell.alignment = { horizontal: 'right' };

  row += 3;
  const sigRow = row;
  const leftSigEnd = Math.max(2, Math.floor(colCount * 0.35));
  const leftDateStart = leftSigEnd + 1;
  const leftDateEnd = Math.min(leftDateStart + 1, Math.floor(colCount * 0.48));
  const rightSigStart = Math.max(leftDateEnd + 2, Math.floor(colCount * 0.55));
  const rightSigEnd = Math.max(rightSigStart + 1, Math.floor(colCount * 0.82));
  const rightDateStart = Math.min(rightSigEnd + 1, colCount);

  const drawSig = (
    lineRow: number,
    labelRow: number,
    fromCol: number,
    toCol: number,
    label: string
  ) => {
    if (fromCol > toCol || fromCol < 1 || toCol > colCount) return;
    try {
      sheet.mergeCells(lineRow, fromCol, lineRow, toCol);
      sheet.mergeCells(labelRow, fromCol, labelRow, toCol);
    } catch {
      /* ignore */
    }
    sheet.getCell(lineRow, fromCol).border = {
      bottom: { style: 'thin', color: { argb: TEAL.line } },
    };
    const labelCell = sheet.getCell(labelRow, fromCol);
    labelCell.value = label;
    labelCell.font = { size: 9, color: { argb: TEAL.text }, name: 'Arial' };
  };

  drawSig(sigRow, sigRow + 1, 1, leftSigEnd, 'Prepared By');
  drawSig(sigRow, sigRow + 1, leftDateStart, leftDateEnd, 'Date');
  drawSig(sigRow, sigRow + 1, rightSigStart, rightSigEnd, 'Authorized By');
  if (rightDateStart <= colCount) {
    drawSig(sigRow, sigRow + 1, rightDateStart, colCount, 'Date');
  }

  row = sigRow + 3;
  const metaCell = sheet.getCell(row, 1);
  try {
    sheet.mergeCells(row, 1, row, Math.max(2, Math.floor(colCount * 0.65)));
  } catch {
    /* ignore */
  }
  metaCell.value = `${company} — ${docLabel}`;
  metaCell.font = { size: 7, color: { argb: TEAL.muted }, name: 'Arial' };

  const pageCell = sheet.getCell(row, Math.max(3, Math.floor(colCount * 0.65) + 1));
  try {
    sheet.mergeCells(
      row,
      Math.max(3, Math.floor(colCount * 0.65) + 1),
      row,
      colCount
    );
  } catch {
    /* ignore */
  }
  pageCell.value = 'Page 1 of 1';
  pageCell.font = { size: 7, color: { argb: TEAL.muted }, name: 'Arial' };
  pageCell.alignment = { horizontal: 'right' };
}
