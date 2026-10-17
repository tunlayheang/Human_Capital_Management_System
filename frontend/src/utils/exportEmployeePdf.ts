import type { jsPDF } from 'jspdf';
import type { Language } from '../i18n/types';
import { formatEmployeeAge } from './employeeAge';
import type { ExportFileExt } from './export/exportDocumentStandard';
import { exportKeyValueDocument, type KeyValueSection } from './export/exportDocumentFormats';
import { ensurePdfUnicodeFont, pdfSetFont } from './export/pdfUnicodeFont';
import {
  BRANDED_PDF_BODY_BOTTOM,
  BRANDED_PDF_COLOR,
  BRANDED_PDF_MARGIN,
  drawBrandedKeyValueCell,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
  loadBrandedPdfContext,
} from './export/brandedPdfBase';
import { resolveEmployeeRecordDisplayName, type PersonNameFields } from './personDisplayName';
import {
  resolveBilingualText,
  resolveDepartmentRowName,
  resolvePositionRowTitle,
} from './localizedEntityLabel';
import {
  resolveEmergencyRelationLabel,
  resolveNationalityLabel,
  resolveReligionLabel,
} from '../constants/khmerPersonalChoices';
import { formatDateOnlyDisplay } from './formatDisplayDate';
import { resolveCityLabel } from '../constants/cambodiaLocations';
import { normalizeEmployeeDisplayId } from './index';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = BRANDED_PDF_MARGIN;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_BOTTOM = BRANDED_PDF_BODY_BOTTOM;

/** Shared teal document PDF palette. */
const COLOR = BRANDED_PDF_COLOR;

const ROW_H = 5;
const COL_GAP = 6;
const COL_W = (CONTENT_W - COL_GAP) / 2;
const LABEL_W = 30;

export type EmployeePdfPayload = {
  employee: Record<string, unknown>;
  roleLabel: string;
};

type PdfField = { label: string; value: string };

function formatDate(raw: unknown): string {
  if (raw == null || raw === '') return '—';
  return formatDateOnlyDisplay(String(raw));
}

function display(val: unknown): string {
  if (val == null || val === '') return '—';
  const s = String(val).trim();
  return s || '—';
}

function formatTime(raw: unknown): string {
  if (raw == null || raw === '') return '—';
  const s = String(raw).trim().slice(0, 5);
  return s || '—';
}

function formatSalary(amount: unknown, currency: unknown): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return '—';
  const cur = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${cur}`;
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    pending_approval: 'Pending',
    terminated: 'Inactive',
  };
  return map[status] || status || '—';
}

function buildAllFields(
  payload: EmployeePdfPayload,
  language: Language = 'en'
): {
  personal: PdfField[];
  employment: PdfField[];
  contact: PdfField[];
  compensation: PdfField[];
  emergency: PdfField[];
  extra: PdfField[];
} {
  const e = payload.employee;
  const dept = e.department as
    | { name?: string; name_kh?: string; nameKh?: string; officeLocationName?: string }
    | undefined;
  const pos = e.position as { title?: string; title_kh?: string; titleKh?: string } | undefined;
  const dependents = Array.isArray(e.dependents) ? (e.dependents as Record<string, unknown>[]) : [];
  const fullName = resolveEmployeeRecordDisplayName(e as PersonNameFields, language);
  const departmentLabel = dept
    ? resolveDepartmentRowName(
        { name: dept.name, nameKh: dept.nameKh ?? dept.name_kh },
        language
      )
    : display(e.department_id);
  const positionLabel = pos
    ? resolvePositionRowTitle(
        { title: pos.title, titleKh: pos.titleKh ?? pos.title_kh },
        language
      )
    : display(e.position_id);

  const personal: PdfField[] = [
    { label: 'Name', value: fullName },
    { label: 'Employee ID', value: display(normalizeEmployeeDisplayId(e.employee_id)) },
    { label: 'Gender', value: display(e.gender) },
    { label: 'Date of birth', value: formatDate(e.birth_date) },
    { label: 'Age', value: formatEmployeeAge(e.birth_date as string | null | undefined) },
    {
      label: 'Nationality',
      value: resolveNationalityLabel(String(e.nationality ?? ''), language),
    },
    { label: 'National ID', value: display(e.national_id) },
    { label: 'Passport', value: display(e.passport_number) },
    { label: 'Birth certificate', value: display(e.birth_certificate_number) },
    { label: 'Marital status', value: display(e.marital_status) },
  ];

  const employment: PdfField[] = [
    { label: 'Status', value: statusLabel(String(e.status ?? '')) },
    { label: 'Department', value: departmentLabel },
    { label: 'Position', value: positionLabel },
    { label: 'Role', value: payload.roleLabel },
    { label: 'Type', value: display(e.employment_type) },
    { label: 'Join date', value: formatDate(e.join_date) },
    {
      label: 'Probation',
      value: e.probation_period_months != null ? `${display(e.probation_period_months)} mo` : '—',
    },
    { label: 'Location', value: display(e.officeLocationName ?? dept?.officeLocationName ?? e.work_location) },
    { label: 'Portal', value: e.allow_login === true ? 'Yes' : 'No' },
    {
      label: 'Schedule',
      value:
        e.time_in || e.time_out
          ? `${formatTime(e.time_in)} – ${formatTime(e.time_out)}`
          : '—',
    },
    {
      label: 'Hours / day',
      value: e.work_hours != null && e.work_hours !== '' ? `${display(e.work_hours)}h` : '—',
    },
    { label: 'Days / week', value: display(e.work_days) },
    {
      label: 'Break',
      value:
        e.break_duration_minutes != null ? `${display(e.break_duration_minutes)} min` : '—',
    },
    {
      label: 'Grace',
      value:
        e.grace_period_minutes != null && e.grace_period_minutes !== ''
          ? `${display(e.grace_period_minutes)} min`
          : 'Org default',
    },
  ];

  const contact: PdfField[] = [
    { label: 'Email', value: display(e.email) },
    { label: 'Mobile', value: display(e.phone) },
    { label: 'Telegram number', value: display(e.telegram_number ?? e.telegramNumber) },
    { label: 'Work phone', value: display(e.work_phone) },
    {
      label: 'Address',
      value: resolveBilingualText(
        e.street_address as string | null | undefined,
        e.street_address_kh as string | null | undefined,
        language
      ),
    },
    {
      label: 'City',
      value: resolveCityLabel(
        e.city as string | null | undefined,
        language,
        e.city_kh as string | null | undefined
      ),
    },
    { label: 'Province', value: display(e.state_province) },
    { label: 'Postal', value: display(e.postal_code) },
    { label: 'Country', value: display(e.country) },
  ];

  const compensation: PdfField[] = [
    { label: 'Base salary', value: formatSalary(e.base_salary, e.currency) },
    { label: 'Salary type', value: display(e.salary_type) },
    { label: 'Currency', value: display(e.currency) },
    { label: 'Pay day', value: display(e.payment_day) },
    {
      label: 'Payment method',
      value:
        String((e as { payment_method?: string }).payment_method ?? '').toLowerCase() === 'cash'
          ? 'Cash'
          : 'Bank transfer',
    },
    ...(String((e as { payment_method?: string }).payment_method ?? 'bank').toLowerCase() !==
    'cash'
      ? [
          { label: 'Bank', value: display(e.bank_name) },
          { label: 'Account', value: display(e.bank_account_number) },
        ]
      : []),
    { label: 'Tax ID', value: display(e.tax_id) },
  ];

  const emergency: PdfField[] = [
    {
      label: 'Name',
      value: resolveBilingualText(
        e.emergency_contact_name as string | null | undefined,
        e.emergency_contact_name_kh as string | null | undefined,
        language
      ),
    },
    {
      label: 'Relation',
      value: resolveEmergencyRelationLabel(
        String(e.emergency_contact_relationship ?? ''),
        language,
        e.emergency_contact_relationship_kh as string | null | undefined
      ),
    },
    { label: 'Phone', value: display(e.emergency_contact_phone) },
  ];

  const extra: PdfField[] = [];
  if (e.religion) {
    extra.push({
      label: 'Religion',
      value: resolveReligionLabel(String(e.religion), language),
    });
  }
  if (e.spouse_name || e.spouse_name_kh) {
    extra.push({
      label: 'Spouse',
      value: resolveBilingualText(
        e.spouse_name as string | null | undefined,
        e.spouse_name_kh as string | null | undefined,
        language
      ),
    });
  }
  if (e.spouse_phone) extra.push({ label: 'Spouse phone', value: display(e.spouse_phone) });
  if (e.termination_reason) extra.push({ label: 'Termination', value: display(e.termination_reason) });
  if (e.terminated_at) extra.push({ label: 'Terminated', value: formatDate(e.terminated_at) });
  dependents.forEach((dep, i) => {
    const name = resolveBilingualText(
      (dep.full_name ?? dep.name) as string | null | undefined,
      (dep.name_kh ?? dep.nameKh) as string | null | undefined,
      language
    );
    const rel = dep.relationship ? ` · ${display(dep.relationship)}` : '';
    extra.push({ label: `Dependent ${i + 1}`, value: `${name}${rel}` });
  });

  return { personal, employment, contact, compensation, emergency, extra };
}

function safeFilename(employeeId: string, lastName: string): string {
  const id = employeeId.replace(/[^\w-]+/g, '_') || 'employee';
  const last = lastName.replace(/[^\w-]+/g, '_') || 'profile';
  return `Employee_${id}_${last}.pdf`;
}

/** `Name:                    Pov Kosal` within a column. */
function drawKeyValueCell(doc: jsPDF, x: number, y: number, colW: number, field: PdfField) {
  drawBrandedKeyValueCell(doc, x, y + 3.2, colW, field.label, field.value, LABEL_W);
}

function drawSectionHeading(doc: jsPDF, y: number, title: string): number {
  if (y + 7 > BODY_BOTTOM) return y;
  pdfSetFont(doc, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.primary);
  doc.text(title.toUpperCase(), MARGIN, y + 2.5);
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(0.15);
  doc.line(MARGIN, y + 4, PAGE_W - MARGIN, y + 4);
  return y + 6.5;
}

/** Two-column key/value section — stays on one page (stops if out of room). */
function drawKeyValueSection(doc: jsPDF, y: number, title: string, fields: PdfField[]): number {
  if (!fields.length) return y;
  y = drawSectionHeading(doc, y, title);

  for (let i = 0; i < fields.length; i += 2) {
    if (y + ROW_H > BODY_BOTTOM) break;
    const left = fields[i];
    const right = fields[i + 1];
    drawKeyValueCell(doc, MARGIN, y, COL_W, left);
    if (right) {
      drawKeyValueCell(doc, MARGIN + COL_W + COL_GAP, y, COL_W, right);
    }
    y += ROW_H;
  }
  return y + 2;
}

/**
 * Generate a single-page A4 employee profile PDF.
 * Uses Company Profile document templates (Report Header / Report Footer).
 */
export async function exportEmployeeProfilePdf(
  payload: EmployeePdfPayload,
  language: Language = 'en'
): Promise<void> {
  const { branding, logo, generatedAt } = await loadBrandedPdfContext(true);
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  await ensurePdfUnicodeFont(doc);

  const e = payload.employee;
  const fields = buildAllFields(payload, language);

  let y = drawBrandedPdfHeader(doc, {
    title: 'Employee Profile',
    branding,
    logo,
    margin: MARGIN,
    fields: [
      { label: 'Document', value: 'Employee Profile' },
      {
        label: 'Employee',
        value: `${String(e.last_name ?? '').trim()} ${String(e.first_name ?? '').trim()}`.trim() || '—',
      },
      { label: 'Generated', value: generatedAt },
    ],
    documentLabel: 'Employee Profile',
  });
  y = drawKeyValueSection(doc, y, 'Personal', fields.personal);
  y = drawKeyValueSection(doc, y, 'Employment', fields.employment);
  y = drawKeyValueSection(doc, y, 'Contact', fields.contact);
  y = drawKeyValueSection(doc, y, 'Compensation', fields.compensation);
  y = drawKeyValueSection(doc, y, 'Emergency Contact', fields.emergency);
  if (fields.extra.length) {
    drawKeyValueSection(doc, y, 'Additional', fields.extra);
  }

  drawBrandedPdfFooter(doc, {
    generatedAt,
    branding,
    margin: MARGIN,
    documentLabel: 'Employee Profile',
    page: 1,
    totalPages: 1,
  });

  doc.save(
    safeFilename(normalizeEmployeeDisplayId(e.employee_id) || 'unknown', String(e.last_name ?? 'profile'))
  );
}

function buildEmployeeProfileSections(
  payload: EmployeePdfPayload,
  language: Language = 'en'
): KeyValueSection[] {
  const fields = buildAllFields(payload, language);
  const toRows = (items: PdfField[]) => items.map((field) => ({ label: field.label, value: field.value }));
  return [
    { title: 'Personal', rows: toRows(fields.personal) },
    { title: 'Employment', rows: toRows(fields.employment) },
    { title: 'Contact', rows: toRows(fields.contact) },
    { title: 'Compensation', rows: toRows(fields.compensation) },
    { title: 'Emergency contact', rows: toRows(fields.emergency) },
    ...(fields.extra.length ? [{ title: 'Additional', rows: toRows(fields.extra) }] : []),
  ];
}

export async function exportEmployeeProfileDocument(
  format: ExportFileExt,
  payload: EmployeePdfPayload,
  language: Language = 'en'
): Promise<void> {
  const e = payload.employee;
  await exportKeyValueDocument(format, {
    module: 'Employee_Profile',
    filenameParts: [normalizeEmployeeDisplayId(e.employee_id) || 'unknown', String(e.last_name ?? 'profile')],
    reportTitle: 'Employee Profile',
    sections: buildEmployeeProfileSections(payload, language),
    metadata: [{ label: 'Role', value: payload.roleLabel }],
    exportPdf: () => exportEmployeeProfilePdf(payload, language),
    sheetName: 'Employee',
  });
}
