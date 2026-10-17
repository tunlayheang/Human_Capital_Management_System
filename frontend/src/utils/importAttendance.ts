import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  csvStringToAoa,
  downloadAoaAsXlsx,
  downloadCsvLines,
  exportFilename,
  exportGeneratedAtLabel,
} from './export/exportDocumentStandard';
import { loadDocumentBranding } from './documentBranding';
import { fetchPortalBranding } from '../services/portalBranding';
import { resolveMediaUrl } from './mediaUrl';

export const ATTENDANCE_IMPORT_COLUMNS = [
  'Employee ID',
  'Date',
  'Check In',
  'Check Out',
  'Status',
] as const;

/** Keep in sync with backend `MAX_ATTENDANCE_IMPORT_ROWS`. */
export const MAX_ATTENDANCE_IMPORT_ROWS = 2000;

export type AttendanceImportColumn = (typeof ATTENDANCE_IMPORT_COLUMNS)[number];

export type ParsedAttendanceImportRow = {
  rowNumber: number;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: string;
};

export type AttendanceImportParseResult = {
  rows: ParsedAttendanceImportRow[];
  errors: Array<{ row: number; message: string }>;
  skippedBlank: number;
};

const TEMPLATE_EXAMPLE_ROWS: (string | number)[][] = [
  [...ATTENDANCE_IMPORT_COLUMNS],
  ['ROC00001', '01/07/2026', '08:00', '17:00', 'PRESENT'],
  ['ROC00002', '01/07/2026', '08:15', '17:05', 'LATE'],
  ['ROC00003', '01/07/2026', '', '', 'ABSENT'],
];

const HEADER_ALIASES: Record<string, AttendanceImportColumn> = {
  'employee id': 'Employee ID',
  employeeid: 'Employee ID',
  employee_id: 'Employee ID',
  'employee code': 'Employee ID',
  date: 'Date',
  'check in': 'Check In',
  checkin: 'Check In',
  'check_in': 'Check In',
  'check out': 'Check Out',
  checkout: 'Check Out',
  'check_out': 'Check Out',
  status: 'Status',
};

function normalizeHeaderCell(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapHeaderCell(cell: unknown): AttendanceImportColumn | null {
  const normalized = normalizeHeaderCell(cell);
  const compact = normalized.replace(/\s/g, '');
  return HEADER_ALIASES[normalized] ?? HEADER_ALIASES[compact] ?? null;
}

function findHeaderRowIndex(aoa: (string | number)[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 30); i += 1) {
    const row = aoa[i] ?? [];
    const mapped = new Set(row.map((cell) => mapHeaderCell(cell)).filter(Boolean));
    if (mapped.has('Employee ID') && mapped.has('Date')) return i;
  }
  return -1;
}

function buildColumnIndex(headerRow: (string | number)[]): Partial<Record<AttendanceImportColumn, number>> {
  const index: Partial<Record<AttendanceImportColumn, number>> = {};
  headerRow.forEach((cell, colIdx) => {
    const alias = mapHeaderCell(cell);
    if (alias) index[alias] = colIdx;
  });
  return index;
}

function formatExcelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = String(value ?? '').trim();
  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return text;
}

function formatAttendanceDateDisplay(dateKey: string): string {
  const iso = String(dateKey ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = String(dateKey ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${String(Number(dmy[1])).padStart(2, '0')}/${String(Number(dmy[2])).padStart(2, '0')}/${dmy[3]}`;
  }
  return String(dateKey ?? '').trim();
}

function formatExcelTime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return String(value ?? '').trim();
}

function rowIsBlank(cells: (string | number)[]): boolean {
  return cells.every((cell) => String(cell ?? '').trim() === '');
}

export function parseAttendanceImportAoa(aoa: (string | number)[][]): AttendanceImportParseResult {
  const headerIndex = findHeaderRowIndex(aoa);
  if (headerIndex < 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'Missing header row (Employee ID, Date, …)' }],
      skippedBlank: 0,
    };
  }

  const columnIndex = buildColumnIndex(aoa[headerIndex] ?? []);
  if (columnIndex['Employee ID'] == null || columnIndex.Date == null) {
    return {
      rows: [],
      errors: [{ row: headerIndex + 1, message: 'Employee ID and Date columns are required' }],
      skippedBlank: 0,
    };
  }

  const rows: ParsedAttendanceImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skippedBlank = 0;

  for (let i = headerIndex + 1; i < aoa.length; i += 1) {
    const line = aoa[i] ?? [];
    if (rowIsBlank(line)) {
      skippedBlank += 1;
      continue;
    }

    const sheetRow = i + 1;
    const employeeId = String(line[columnIndex['Employee ID']!] ?? '').trim();
    const date = formatExcelDate(line[columnIndex.Date!]);
    const checkIn =
      columnIndex['Check In'] != null ? formatExcelTime(line[columnIndex['Check In']]) : '';
    const checkOut =
      columnIndex['Check Out'] != null ? formatExcelTime(line[columnIndex['Check Out']]) : '';
    const status =
      columnIndex.Status != null ? String(line[columnIndex.Status] ?? '').trim().toUpperCase() : '';

    if (!employeeId) {
      errors.push({ row: sheetRow, message: 'Employee ID is required' });
      continue;
    }
    if (!date) {
      errors.push({ row: sheetRow, message: 'Date is required' });
      continue;
    }
    if (!checkIn && !checkOut && !status) {
      errors.push({ row: sheetRow, message: 'Provide Check In, Check Out, and/or Status' });
      continue;
    }

    rows.push({
      rowNumber: sheetRow,
      employeeId,
      date,
      checkIn,
      checkOut,
      status,
    });
  }

  if (rows.length > MAX_ATTENDANCE_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message: `Import is limited to ${MAX_ATTENDANCE_IMPORT_ROWS} rows per file (found ${rows.length}). Split the file and try again.`,
        },
      ],
      skippedBlank,
    };
  }

  return { rows, errors, skippedBlank };
}

export async function readAttendanceImportFile(file: File): Promise<(string | number)[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = await file.text();
    return csvStringToAoa(text);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as (
    | string
    | number
  )[][];
}

export function downloadAttendanceImportTemplate(format: 'csv' | 'xlsx'): void {
  const filename = exportFilename('Attendance_Import_Template', [], format);
  if (format === 'xlsx') {
    downloadAoaAsXlsx(TEMPLATE_EXAMPLE_ROWS, filename, 'Attendance Import');
    return;
  }
  const lines = TEMPLATE_EXAMPLE_ROWS.map((row) => row.map((cell) => String(cell)).join(','));
  downloadCsvLines(lines, filename);
}

export type AttendanceListExportRow = {
  employeeId: string;
  employeeName?: string;
  date: string;
  checkIn: string;
  checkOut: string;
  hours?: string;
  location?: string;
  status: string;
  statusLabel?: string;
};

type AttendanceListExportOptions = {
  reportTitle?: string;
  filters?: Array<{ label: string; value: string }>;
};

/** Export list rows in the same column layout as the import template (real data, not demo). */
export async function exportAttendanceList(
  format: 'csv' | 'xlsx',
  rows: AttendanceListExportRow[],
  options: AttendanceListExportOptions = {}
): Promise<void> {
  const reportTitle = options.reportTitle?.trim() || 'Attendance List';
  const aoa: (string | number)[][] = [
    ['Employee ID', 'Employee', 'Date', 'Check In', 'Check Out', 'Hours', 'Location', 'Status'],
    ...rows.map((row) => [
      row.employeeId,
      row.employeeName ?? '',
      formatAttendanceDateDisplay(row.date),
      row.checkIn,
      row.checkOut,
      row.hours ?? '',
      row.location ?? '',
      row.statusLabel || row.status,
    ]),
  ];
  const filename = exportFilename('Attendance_List', [], format);
  if (format === 'xlsx') {
    await downloadAttendanceListAsStyledXlsx(aoa, rows, filename, reportTitle, options.filters ?? []);
    return;
  }
  const lines = aoa.map((line) => line.map((cell) => String(cell)).join(','));
  downloadCsvLines(lines, filename);
}

const BRAND_BLUE = '0F5BA7';
const BRAND_BLUE_LIGHT = 'EAF3FF';
const BORDER = 'D9E2F1';
const HEADER_BG = 'F3F7FC';
const TEXT_MUTED = '64748B';
const TEXT_DARK = '0F172A';

function statusPalette(status: string): { fill: string; font: string } {
  switch (String(status).toUpperCase()) {
    case 'PRESENT':
      return { fill: 'DCFCE7', font: '166534' };
    case 'LATE':
      return { fill: 'FEF3C7', font: '92400E' };
    case 'ABSENT':
    case 'AWAITING':
      return { fill: 'FEE2E2', font: 'B91C1C' };
    case 'DAY_OFF':
      return { fill: 'EDE9FE', font: '6D28D9' };
    case 'PH':
      return { fill: 'DBEAFE', font: '1D4ED8' };
    case 'MISSION':
      return { fill: 'E0F2FE', font: '0369A1' };
    case 'PAID_LEAVE':
    case 'ON_LEAVE':
      return { fill: 'E0F2FE', font: '0369A1' };
    case 'UNPAID_LEAVE':
      return { fill: 'FFE4E6', font: 'BE123C' };
    default:
      return { fill: 'E2E8F0', font: '334155' };
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read logo image'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const branding = await fetchPortalBranding();
    const logoUrl = resolveMediaUrl(branding.logo);
    if (!logoUrl) return null;
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

async function downloadAttendanceListAsStyledXlsx(
  aoa: (string | number)[][],
  rows: AttendanceListExportRow[],
  filename: string,
  reportTitle: string,
  filters: Array<{ label: string; value: string }>
): Promise<void> {
  const [documentBranding, logoDataUrl] = await Promise.all([
    loadDocumentBranding(),
    loadLogoDataUrl(),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ROC HCMS';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('Attendance');
  sheet.properties.defaultRowHeight = 22;
  sheet.views = [{ state: 'frozen', ySplit: 7 }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  sheet.columns = [
    { key: 'employeeId', width: 16 },
    { key: 'employeeName', width: 28 },
    { key: 'date', width: 14 },
    { key: 'checkIn', width: 12 },
    { key: 'checkOut', width: 12 },
    { key: 'hours', width: 10 },
    { key: 'location', width: 28 },
    { key: 'status', width: 18 },
  ];

  if (logoDataUrl) {
    const imageId = workbook.addImage({
      base64: logoDataUrl,
      extension: logoDataUrl.includes('image/jpeg') ? 'jpeg' : 'png',
    });
    sheet.addImage(imageId, {
      tl: { col: 0.15, row: 0.15 },
      ext: { width: 72, height: 72 },
    });
  }

  sheet.mergeCells('B1:H1');
  sheet.getCell('B1').value = documentBranding.companyName || 'ROC Human Capital Management';
  sheet.getCell('B1').font = { bold: true, size: 18, color: { argb: BRAND_BLUE } };
  sheet.getCell('B1').alignment = { vertical: 'middle' };

  sheet.mergeCells('B2:H2');
  sheet.getCell('B2').value = reportTitle;
  sheet.getCell('B2').font = { bold: true, size: 13, color: { argb: TEXT_DARK } };
  sheet.getCell('B2').alignment = { vertical: 'middle' };

  sheet.mergeCells('B3:H3');
  sheet.getCell('B3').value =
    documentBranding.reportHeader?.trim() || 'Branded attendance export generated from the live attendance list.';
  sheet.getCell('B3').font = { size: 10, color: { argb: TEXT_MUTED }, italic: true };
  sheet.getCell('B3').alignment = { wrapText: true };

  const generatedLabel = `Generated on: ${exportGeneratedAtLabel()}`;
  sheet.mergeCells('F4:H4');
  sheet.getCell('F4').value = generatedLabel;
  sheet.getCell('F4').font = { size: 10, color: { argb: TEXT_MUTED } };
  sheet.getCell('F4').alignment = { horizontal: 'right' };

  const activeFilters = filters.filter((item) => item.value.trim());
  const filterText = activeFilters.length
    ? activeFilters.map((item) => `${item.label}: ${item.value}`).join('   |   ')
    : 'Filters: none';
  sheet.mergeCells('A5:H5');
  const filterCell = sheet.getCell('A5');
  filterCell.value = filterText;
  filterCell.font = { size: 10, color: { argb: BRAND_BLUE } };
  filterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BLUE_LIGHT } };
  filterCell.border = {
    top: { style: 'thin', color: { argb: BORDER } },
    left: { style: 'thin', color: { argb: BORDER } },
    bottom: { style: 'thin', color: { argb: BORDER } },
    right: { style: 'thin', color: { argb: BORDER } },
  };
  filterCell.alignment = { vertical: 'middle', wrapText: true };

  const headerRowIndex = 7;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = aoa[0];
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BRAND_BLUE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER } },
      left: { style: 'thin', color: { argb: BORDER } },
      bottom: { style: 'thin', color: { argb: BORDER } },
      right: { style: 'thin', color: { argb: BORDER } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  rows.forEach((row, index) => {
    const rowIndex = headerRowIndex + 1 + index;
    const excelRow = sheet.getRow(rowIndex);
    excelRow.values = [
      row.employeeId,
      row.employeeName ?? '',
      formatAttendanceDateDisplay(row.date),
      row.checkIn || '—',
      row.checkOut || '—',
      row.hours || '—',
      row.location || 'No Data',
      row.statusLabel || row.status,
    ];
    excelRow.height = 22;

    excelRow.eachCell((cell, colNumber) => {
      const zebra = index % 2 === 0 ? 'FFFFFF' : 'FAFCFF';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
      cell.font = {
        color: { argb: TEXT_DARK },
        bold: colNumber === 2,
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber >= 3 && colNumber <= 6 ? 'center' : 'left',
        wrapText: colNumber === 2 || colNumber === 7,
      };
    });

    const statusCell = excelRow.getCell(8);
    const palette = statusPalette(row.status);
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palette.fill } };
    statusCell.font = { bold: true, color: { argb: palette.font } };
    statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  if (rows.length === 0) {
    sheet.mergeCells(`A8:H8`);
    const emptyCell = sheet.getCell('A8');
    emptyCell.value = 'No attendance rows matched the current filters. Header structure is preserved for reuse.';
    emptyCell.font = { italic: true, color: { argb: TEXT_MUTED } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    emptyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2' } };
    emptyCell.border = {
      top: { style: 'thin', color: { argb: BORDER } },
      left: { style: 'thin', color: { argb: BORDER } },
      bottom: { style: 'thin', color: { argb: BORDER } },
      right: { style: 'thin', color: { argb: BORDER } },
    };
    sheet.getRow(8).height = 24;
  }

  const footerRowIndex = Math.max(headerRowIndex + rows.length + 3, 11);
  sheet.mergeCells(`A${footerRowIndex}:H${footerRowIndex}`);
  const footerCell = sheet.getCell(`A${footerRowIndex}`);
  footerCell.value = documentBranding.reportFooter?.trim() || 'ROC Human Capital Management — Confidential';
  footerCell.font = { size: 10, color: { argb: TEXT_MUTED }, italic: true };
  footerCell.alignment = { horizontal: 'center' };

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: Math.max(headerRowIndex, headerRowIndex + rows.length), column: 8 },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
