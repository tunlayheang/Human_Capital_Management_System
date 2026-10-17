import {
  EXPORT_BRAND,
  csvRow,
  csvStringToAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvContent,
  exportFilename,
  exportGeneratedAtLabel,
  exportSafeFilenamePart,
  appendReportFooterCsvLines,
  type ExportFileExt,
} from './export/exportDocumentStandard';
import { downloadTabularPdfFromAoa } from './export/downloadTabularPdf';
import { loadDocumentBranding, resolveReportFooterText, stripRichTextToPlain, type DocumentBranding } from './documentBranding';
import { getCambodiaPublicHolidays } from '../constants/cambodiaPublicHolidays';
import type { LeaveType } from '../types';
import { MonthlyFixedRoster } from '../types/roster';
import { monthName } from './leaveCalendar';
import { rosterToGridData, type RosterEmployee, type RosterGrid } from './rosterGrid';
import {
  buildRosterPaintTypesWithHoliday,
  findRosterPaintType,
  type RosterPaintType,
} from './rosterPaintTypes';

type RosterUser = RosterEmployee;

function paintTypesForExport(leaveTypes?: LeaveType[]): RosterPaintType[] {
  return buildRosterPaintTypesWithHoliday(leaveTypes ?? []);
}

function holidayOnDay(
  year: number,
  monthIndex: number,
  day: number
): { name: string } | undefined {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const hit = getCambodiaPublicHolidays(year).find((h) => h.date === `${prefix}-${String(day).padStart(2, '0')}`);
  return hit ? { name: hit.nameEn } : undefined;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function coverageClass(pct: number): string {
  if (pct >= 80) return 'cov-good';
  if (pct >= 60) return 'cov-warn';
  return 'cov-bad';
}

function cellStyle(paintTypes: RosterPaintType[], tid: string): string {
  const rt =
    findRosterPaintType(paintTypes, tid) ?? findRosterPaintType(paintTypes, 'working');
  const s = rt!.exportStyle;
  return `background:${s.bg};color:${s.color};border-color:${s.border}`;
}

function coverageForDay(
  users: RosterUser[],
  rosterData: Record<string, Record<number, string>>,
  day: number
): { working: number; total: number; off: number; pct: number } {
  const total = users.length;
  let working = 0;
  users.forEach((emp) => {
    const tid = rosterData[emp.id]?.[day] || 'working';
    if (tid === 'working') working++;
  });
  const off = total - working;
  const pct = total > 0 ? Math.round((working / total) * 100) : 0;
  return { working, total, off, pct };
}

function buildRosterPrintHtml(
  roster: MonthlyFixedRoster,
  rosterData: Record<string, Record<number, string>>,
  users: RosterUser[],
  paintTypes: RosterPaintType[],
  branding?: DocumentBranding
): string {
  const days = new Date(roster.year, roster.month + 1, 0).getDate();
  const generated = exportGeneratedAtLabel();
  const title = escapeHtml(roster.name || 'Team Leave Roster');
  const period = `${monthName(roster.month)} ${roster.year}`;
  const companyName = escapeHtml(branding?.companyName?.trim() || EXPORT_BRAND.companyName);
  const headerNote = stripRichTextToPlain(branding?.reportHeader);

  const legendItems = paintTypes
    .map((t) => {
      const s = t.exportStyle;
      return `<span class="legend-item"><span class="legend-swatch" style="background:${s.bg};border-color:${s.border};color:${s.color}">${t.code}</span>${escapeHtml(t.name)}</span>`;
    })
    .join('');

  let headerCells = `<th class="col-employee">Employee</th><th class="col-dept">Department</th>`;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(roster.year, roster.month, d, 12, 0, 0).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const hol = holidayOnDay(roster.year, roster.month, d);
    const isHol = Boolean(hol);
    const cls = ['day-head', isWeekend ? 'weekend' : '', isHol ? 'holiday-col' : ''].filter(Boolean).join(' ');
    const holLabel = hol ? `<span class="hol-tag">PH</span>` : '';
    headerCells += `<th class="${cls}" title="${hol ? escapeHtml(hol.name) : ''}"><span class="day-num">${d}</span><span class="day-dow">${WEEKDAYS[dow]}</span>${holLabel}</th>`;
  }

  let bodyRows = '';
  users.forEach((emp, idx) => {
    bodyRows += `<tr class="${idx % 2 === 1 ? 'row-alt' : ''}"><td class="col-employee">${escapeHtml(emp.name)}</td><td class="col-dept">${escapeHtml(emp.department || '—')}</td>`;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(roster.year, roster.month, d, 12, 0, 0).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const tid = rosterData[emp.id]?.[d] || 'working';
      const rt = findRosterPaintType(paintTypes, tid);
      const code = rt?.code || 'W';
      const cls = ['cell', isWeekend ? 'weekend' : ''].filter(Boolean).join(' ');
      bodyRows += `<td class="${cls}" style="${cellStyle(paintTypes, tid)}">${code}</td>`;
    }
    bodyRows += '</tr>';
  });

  let coverageCells = `<td class="col-employee coverage-label" colspan="2">Coverage</td>`;
  for (let d = 1; d <= days; d++) {
    const cov = coverageForDay(users, rosterData, d);
    const cls = coverageClass(cov.pct);
    coverageCells += `<td class="coverage-cell ${cls}"><span class="cov-ratio">${cov.working}/${cov.total}</span><span class="cov-pct">${cov.pct}%</span><span class="cov-off">${cov.off} off</span></td>`;
  }

  let workingCells = `<td class="col-employee coverage-label" colspan="2">Working</td>`;
  for (let d = 1; d <= days; d++) {
    const cov = coverageForDay(users, rosterData, d);
    workingCells += `<td class="coverage-cell"><span class="cov-ratio">${cov.working}</span></td>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — ${period}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Kantumruy+Pro:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4 landscape; margin: 10mm 8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Kantumruy Pro', 'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      font-size: 9px;
      color: #1e293b;
      background: #fff;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report { max-width: 100%; }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #0f5ba7;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      width: 44px; height: 44px;
      background: #0f5ba7;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 14px; letter-spacing: -0.5px;
    }
    .brand h1 {
      font-size: 20px; font-weight: 700; color: #0f172a;
      line-height: 1.2; margin-bottom: 2px;
    }
    .brand .subtitle { font-size: 11px; color: #64748b; font-weight: 500; }
    .brand .company { font-size: 12px; color: #0f5ba7; font-weight: 600; }
    .report-note { color: #64748b; font-size: 11px; font-style: italic; margin: -6px 0 12px; }
    .meta-box {
      text-align: right; font-size: 10px; color: #64748b; line-height: 1.6;
    }
    .meta-box strong { color: #334155; display: block; font-size: 11px; }
    .stats-row {
      display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;
    }
    .stat-pill {
      flex: 1; min-width: 120px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 8px; padding: 8px 12px;
    }
    .stat-pill .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
    .stat-pill .value { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .legend {
      display: flex; flex-wrap: wrap; gap: 8px 14px;
      padding: 10px 12px; background: #f8fafc;
      border: 1px solid #e2e8f0; border-radius: 8px;
      margin-bottom: 12px; align-items: center;
    }
    .legend-title { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-right: 4px; }
    .legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: #475569; }
    .legend-swatch {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 22px; height: 18px; padding: 0 4px;
      border-radius: 4px; border: 1px solid;
      font-weight: 700; font-size: 8px;
    }
    .table-wrap { overflow: hidden; border: 1px solid #cbd5e1; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e2e8f0; text-align: center; vertical-align: middle; }
    thead th {
      background: #f1f5f9; font-weight: 600; color: #334155;
      padding: 4px 2px; font-size: 8px;
    }
    th.col-employee, td.col-employee {
      text-align: left; padding-left: 8px; width: 110px;
      font-weight: 600; font-size: 9px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    th.col-dept, td.col-dept {
      text-align: left; padding-left: 6px; width: 72px;
      font-size: 8px; color: #64748b;
    }
    th.day-head { min-width: 22px; }
    th.day-head.weekend { background: #eff6ff; }
    th.day-head.holiday-col { background: #fef2f2; }
    .day-num { display: block; font-size: 9px; font-weight: 700; color: #0f172a; }
    .day-dow { display: block; font-size: 7px; color: #94a3b8; font-weight: 500; }
    .hol-tag { display: block; font-size: 6px; color: #dc2626; font-weight: 700; }
    td.cell {
      font-weight: 700; font-size: 8px; padding: 3px 1px;
      border-width: 1px; border-style: solid;
    }
    td.cell.weekend { opacity: 0.95; }
    tr.row-alt td.col-employee, tr.row-alt td.col-dept { background: #fafafa; }
    tfoot td {
      background: #f8fafc; font-size: 7px; padding: 4px 2px; line-height: 1.35;
      border-top: 2px solid #cbd5e1;
    }
    tfoot .coverage-label {
      text-align: right; font-weight: 700; font-size: 8px;
      color: #475569; text-transform: uppercase; letter-spacing: 0.03em;
    }
    .cov-ratio { display: block; font-weight: 700; font-size: 8px; }
    .cov-pct { display: block; font-weight: 800; font-size: 9px; }
    .cov-off { display: block; font-size: 7px; color: #64748b; }
    tfoot .cov-good .cov-pct { color: #15803d; }
    tfoot .cov-warn .cov-pct { color: #a16207; }
    tfoot .cov-bad .cov-pct { color: #b91c1c; }
    .report-footer {
      margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 8px; color: #94a3b8;
    }
    .report-footer .confidential { font-style: italic; }
    @media print {
      body { padding: 0; }
      .report-header { break-after: avoid; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report">
    <header class="report-header">
      <div class="brand">
        <div class="brand-mark">ROC</div>
        <div>
          <p class="company">${companyName}</p>
          <h1>${title}</h1>
          <p class="subtitle">Team Leave &amp; Staffing Roster</p>
        </div>
      </div>
      <div class="meta-box">
        <strong>${escapeHtml(period)}</strong>
        ${users.length} employees · ${days} days<br />
        Generated ${escapeHtml(generated)}
      </div>
    </header>
    ${
      headerNote
        ? `<p class="report-note">${escapeHtml(headerNote)}</p>`
        : ''
    }

    <div class="stats-row">
      <div class="stat-pill"><div class="label">Period</div><div class="value">${escapeHtml(period)}</div></div>
      <div class="stat-pill"><div class="label">Team size</div><div class="value">${users.length}</div></div>
      <div class="stat-pill"><div class="label">Calendar days</div><div class="value">${days}</div></div>
      <div class="stat-pill"><div class="label">Roster entries</div><div class="value">${roster.entries.length}</div></div>
    </div>

    <div class="legend">
      <span class="legend-title">Legend</span>
      ${legendItems}
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr>${coverageCells}</tr><tr>${workingCells}</tr></tfoot>
      </table>
    </div>

    <footer class="report-footer">
      <span>${escapeHtml(resolveReportFooterText(branding))}</span>
      <span class="confidential">${escapeHtml(EXPORT_BRAND.internalUseFooter)}</span>
    </footer>
  </div>
</body>
</html>`;
}

function buildRosterCsvContent(
  roster: MonthlyFixedRoster,
  rosterData: RosterGrid,
  users: RosterUser[],
  paintTypes: RosterPaintType[],
  branding?: DocumentBranding
): string {
  const days = new Date(roster.year, roster.month + 1, 0).getDate();
  const period = `${monthName(roster.month)} ${roster.year}`;
  const generated = exportGeneratedAtLabel();
  const title = roster.name || 'Team Leave Roster';
  const lines: string[] = [];

  lines.push(csvRow([branding?.companyName?.trim() || EXPORT_BRAND.companyName]));
  lines.push(csvRow(['Team Leave & Staffing Roster']));
  lines.push(csvRow(['Roster Name', title]));
  lines.push(csvRow(['Report Type', 'Team Leave & Staffing Roster']));
  lines.push(csvRow(['Period', period]));
  lines.push(csvRow(['Team Size', users.length]));
  lines.push(csvRow(['Calendar Days', days]));
  lines.push(csvRow(['Roster Entries', roster.entries.length]));
  lines.push(csvRow(['Generated', generated]));
  lines.push(csvRow(['Application', EXPORT_BRAND.applicationLabel]));
  lines.push('');

  lines.push(csvRow(['Legend']));
  lines.push(csvRow(['Code', 'Leave Type']));
  paintTypes.forEach((t) => lines.push(csvRow([t.code, t.name])));
  lines.push('');

  const dayHeaders: string[] = [];
  const daySubHeaders: string[] = [];
  for (let d = 1; d <= days; d++) {
    const dow = new Date(roster.year, roster.month, d, 12, 0, 0).getDay();
    const hol = holidayOnDay(roster.year, roster.month, d);
    dayHeaders.push(String(d));
    daySubHeaders.push(hol ? `${WEEKDAYS[dow]} (PH: ${hol.name})` : WEEKDAYS[dow]);
  }

  lines.push(csvRow(['Employee', 'Department', ...dayHeaders]));
  lines.push(csvRow(['', '', ...daySubHeaders]));

  const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));
  sortedUsers.forEach((emp) => {
    const dayCodes: string[] = [];
    for (let d = 1; d <= days; d++) {
      const tid = rosterData[emp.id]?.[d] || 'working';
      const rt = findRosterPaintType(paintTypes, tid);
      dayCodes.push(rt?.code || 'W');
    }
    lines.push(csvRow([emp.name, emp.department || '—', ...dayCodes]));
  });

  const coverageCells: (string | number)[] = ['Coverage', ''];
  for (let d = 1; d <= days; d++) {
    const cov = coverageForDay(users, rosterData, d);
    coverageCells.push(`${cov.working}/${cov.total} (${cov.pct}%) · ${cov.off} off`);
  }
  lines.push(csvRow(coverageCells));

  const workingCells: (string | number)[] = ['Working', ''];
  for (let d = 1; d <= days; d++) {
    const cov = coverageForDay(users, rosterData, d);
    workingCells.push(cov.working);
  }
  lines.push(csvRow(workingCells));
  lines.push('');

  lines.push(csvRow(['Notes']));
  lines.push(
    csvRow([
      'Cell codes match the PDF legend. Weekends and public holidays (PH) are noted in the day row.',
    ])
  );
  return appendReportFooterCsvLines(lines, branding).join('\r\n');
}

export async function exportRosterCsv(
  roster: MonthlyFixedRoster,
  users: RosterUser[],
  rosterData?: RosterGrid,
  leaveTypes?: LeaveType[]
) {
  const branding = await loadDocumentBranding();
  const paintTypes = paintTypesForExport(leaveTypes);
  const grid = rosterData ?? rosterToGridData(roster, users, leaveTypes ?? []);
  const csv = buildRosterCsvContent(roster, grid, users, paintTypes, branding);
  const safeName = exportSafeFilenamePart(roster.name || 'roster', 40);
  downloadCsvContent(
    csv,
    exportFilename('Roster', [safeName, `${roster.year}-${String(roster.month + 1).padStart(2, '0')}`], 'csv')
  );
}

export async function exportRosterPdf(
  roster: MonthlyFixedRoster,
  rosterData: Record<string, Record<number, string>>,
  users: RosterUser[],
  leaveTypes?: LeaveType[]
): Promise<boolean> {
  const branding = await loadDocumentBranding(true);
  const paintTypes = paintTypesForExport(leaveTypes);
  const csv = buildRosterCsvContent(roster, rosterData, users, paintTypes, branding);
  const aoa = csvStringToAoa(csv);
  const period = `${monthName(roster.month)} ${roster.year}`;
  return downloadTabularPdfFromAoa({
    title: roster.name || 'Team Leave Roster',
    subtitle: period,
    rows: aoa,
    branding,
    orientation: 'landscape',
    filename: exportFilename('Roster', rosterFilenameParts(roster), 'pdf'),
    module: 'Roster',
    filenameParts: rosterFilenameParts(roster),
  });
}

function rosterFilenameParts(roster: MonthlyFixedRoster): string[] {
  const safeName = exportSafeFilenamePart(roster.name || 'roster', 40);
  return [safeName, `${roster.year}-${String(roster.month + 1).padStart(2, '0')}`];
}

export async function exportRosterExcel(
  roster: MonthlyFixedRoster,
  users: RosterUser[],
  rosterData?: RosterGrid,
  leaveTypes?: LeaveType[]
): Promise<void> {
  const branding = await loadDocumentBranding();
  const paintTypes = paintTypesForExport(leaveTypes);
  const grid = rosterData ?? rosterToGridData(roster, users, leaveTypes ?? []);
  const csv = buildRosterCsvContent(roster, grid, users, paintTypes, branding);
  const aoa = csvStringToAoa(csv);
  // Skip CSV metadata / legend preamble — shared Excel chrome owns the header block.
  const tableStart = aoa.findIndex(
    (row) => String(row[0] ?? '').trim().toLowerCase() === 'employee'
  );
  const tableAoa = tableStart >= 0 ? aoa.slice(tableStart) : aoa;
  const period = `${monthName(roster.month)} ${roster.year}`;
  await downloadBrandedWorkbookAsXlsx({
    filename: exportFilename('Roster', rosterFilenameParts(roster), 'xlsx'),
    reportTitle: 'Team Leave & Staffing Roster',
    branding,
    fields: [
      { label: 'Roster', value: roster.name || 'Team Leave Roster' },
      { label: 'Period', value: period },
      { label: 'Team size', value: String(users.length) },
      { label: 'Prepared by', value: '' },
    ],
    period: { from: period, to: period },
    purpose: 'Monthly leave and staffing roster by employee.',
    sheets: [
      {
        name: 'Roster',
        aoa: tableAoa,
        headerRows: [0],
      },
    ],
  });
}

export async function exportRoster(
  format: ExportFileExt,
  roster: MonthlyFixedRoster,
  rosterData: Record<string, Record<number, string>>,
  users: RosterUser[],
  leaveTypes?: LeaveType[]
): Promise<boolean> {
  const grid = rosterData ?? rosterToGridData(roster, users, leaveTypes ?? []);
  if (format === 'pdf') return exportRosterPdf(roster, grid, users, leaveTypes);
  if (format === 'csv') {
    await exportRosterCsv(roster, users, grid, leaveTypes);
    return true;
  }
  await exportRosterExcel(roster, users, grid, leaveTypes);
  return true;
}

export { rosterToGridData };
