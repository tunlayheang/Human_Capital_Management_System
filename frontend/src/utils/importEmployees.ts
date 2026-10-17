import * as XLSX from 'xlsx';
import {
  csvStringToAoa,
  downloadAoaAsXlsx,
  downloadCsvLines,
  exportFilename,
} from './export/exportDocumentStandard';
import { DEFAULT_ATTENDANCE_RULES } from '../types/attendance';

/**
 * Employee list export / staff import columns.
 * Display-only columns (Name, Age, Level, …) are accepted but ignored on create.
 * Create-critical columns after the list export fields are required for new hires.
 */
export const EMPLOYEE_LIST_TABULAR_COLUMNS = [
  'Employee ID',
  'Name',
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Department ID',
  'Department',
  'Office Location ID',
  'Office',
  'Position ID',
  'Position',
  'Level',
  'Birth Date',
  'Age',
  'Join Date',
  'Probation (Months)',
  'Role',
  'Status',
  'Portal Login Allowed',
  'Offboarding In Progress',
  'Offboarding Settlement Status',
  'Placement Pending',
  'Placement Effective Date',
  'Termination Reason',
  // Onboarding fields (same workbook format; filled for new imports / included on export)
  'Gender',
  'Nationality',
  'Religion',
  'Street Address',
  'City',
  'Country',
  'Employment Type',
  'Work Days',
  'Time In',
  'Time Out',
  'Work Hours',
  'Break Duration Minutes',
  'Grace Period Minutes',
  'Base Salary',
  'Currency',
  'Payment Method',
  'Bank Name',
  'Bank Account Number',
  'Emergency Contact Name',
  'Emergency Contact Relationship',
  'Emergency Contact Phone',
  'Marital Status',
  'Spouse Name',
  'Spouse Phone',
] as const;

export type EmployeeListTabularColumn = (typeof EMPLOYEE_LIST_TABULAR_COLUMNS)[number];

/** Keep in sync with backend `MAX_EMPLOYEE_IMPORT_ROWS`. */
export const MAX_EMPLOYEE_IMPORT_ROWS = 200;

export type ParsedEmployeeImportRow = {
  rowNumber: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  departmentId: string;
  positionId: string;
  birthDate: string;
  joinDate: string;
  probationMonths: string;
  role: string;
  portalLoginAllowed: string;
  gender: string;
  nationality: string;
  religion: string;
  streetAddress: string;
  city: string;
  country: string;
  employmentType: string;
  workDays: string;
  timeIn: string;
  timeOut: string;
  workHours: string;
  breakDurationMinutes: string;
  gracePeriodMinutes: string;
  baseSalary: string;
  currency: string;
  paymentMethod: string;
  bankName: string;
  bankAccountNumber: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  maritalStatus: string;
  spouseName: string;
  spousePhone: string;
};

export type EmployeeImportParseResult = {
  rows: ParsedEmployeeImportRow[];
  errors: Array<{ row: number; message: string }>;
  skippedBlank: number;
};

export type EmployeeImportCreatePayload = Record<string, unknown>;

const HEADER_ALIASES: Record<string, EmployeeListTabularColumn> = {
  'employee id': 'Employee ID',
  employeeid: 'Employee ID',
  employee_id: 'Employee ID',
  'employee code': 'Employee ID',
  name: 'Name',
  'first name': 'First Name',
  firstname: 'First Name',
  first_name: 'First Name',
  'last name': 'Last Name',
  lastname: 'Last Name',
  last_name: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  'department id': 'Department ID',
  departmentid: 'Department ID',
  department_id: 'Department ID',
  department: 'Department',
  'office location id': 'Office Location ID',
  office: 'Office',
  'position id': 'Position ID',
  positionid: 'Position ID',
  position_id: 'Position ID',
  position: 'Position',
  level: 'Level',
  'birth date': 'Birth Date',
  birthdate: 'Birth Date',
  birth_date: 'Birth Date',
  age: 'Age',
  'join date': 'Join Date',
  joindate: 'Join Date',
  join_date: 'Join Date',
  'probation (months)': 'Probation (Months)',
  'probation months': 'Probation (Months)',
  probation_period_months: 'Probation (Months)',
  role: 'Role',
  status: 'Status',
  'portal login allowed': 'Portal Login Allowed',
  allow_login: 'Portal Login Allowed',
  'offboarding in progress': 'Offboarding In Progress',
  'offboarding settlement status': 'Offboarding Settlement Status',
  'placement pending': 'Placement Pending',
  'placement effective date': 'Placement Effective Date',
  'termination reason': 'Termination Reason',
  gender: 'Gender',
  nationality: 'Nationality',
  religion: 'Religion',
  'street address': 'Street Address',
  address: 'Street Address',
  street_address: 'Street Address',
  city: 'City',
  country: 'Country',
  'employment type': 'Employment Type',
  employment_type: 'Employment Type',
  'work days': 'Work Days',
  work_days: 'Work Days',
  'time in': 'Time In',
  time_in: 'Time In',
  'time out': 'Time Out',
  time_out: 'Time Out',
  'work hours': 'Work Hours',
  work_hours: 'Work Hours',
  'break duration minutes': 'Break Duration Minutes',
  break_duration_minutes: 'Break Duration Minutes',
  'grace period minutes': 'Grace Period Minutes',
  grace_period_minutes: 'Grace Period Minutes',
  'base salary': 'Base Salary',
  base_salary: 'Base Salary',
  salary: 'Base Salary',
  currency: 'Currency',
  'payment method': 'Payment Method',
  payment_method: 'Payment Method',
  'bank name': 'Bank Name',
  bank_name: 'Bank Name',
  'bank account number': 'Bank Account Number',
  bank_account_number: 'Bank Account Number',
  'emergency contact name': 'Emergency Contact Name',
  emergency_contact_name: 'Emergency Contact Name',
  'emergency contact relationship': 'Emergency Contact Relationship',
  emergency_contact_relationship: 'Emergency Contact Relationship',
  'emergency contact phone': 'Emergency Contact Phone',
  emergency_contact_phone: 'Emergency Contact Phone',
  'marital status': 'Marital Status',
  marital_status: 'Marital Status',
  'spouse name': 'Spouse Name',
  spouse_name: 'Spouse Name',
  'spouse phone': 'Spouse Phone',
  spouse_phone: 'Spouse Phone',
};

function normalizeHeaderCell(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapHeaderCell(cell: unknown): EmployeeListTabularColumn | null {
  const normalized = normalizeHeaderCell(cell);
  const compact = normalized.replace(/\s/g, '');
  return HEADER_ALIASES[normalized] ?? HEADER_ALIASES[compact] ?? null;
}

function findHeaderRowIndex(aoa: (string | number)[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 40); i += 1) {
    const row = aoa[i] ?? [];
    const mapped = new Set(row.map((cell) => mapHeaderCell(cell)).filter(Boolean));
    if (mapped.has('First Name') && mapped.has('Email') && mapped.has('Department ID')) {
      return i;
    }
  }
  return -1;
}

function buildColumnIndex(
  headerRow: (string | number)[]
): Partial<Record<EmployeeListTabularColumn, number>> {
  const index: Partial<Record<EmployeeListTabularColumn, number>> = {};
  headerRow.forEach((cell, colIdx) => {
    const alias = mapHeaderCell(cell);
    if (alias && index[alias] == null) index[alias] = colIdx;
  });
  return index;
}

function cellAt(
  line: (string | number)[],
  index: Partial<Record<EmployeeListTabularColumn, number>>,
  key: EmployeeListTabularColumn
): string {
  const col = index[key];
  if (col == null) return '';
  return String(line[col] ?? '').trim();
}

export function formatEmployeeImportDate(value: unknown): string {
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
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function rowIsBlank(cells: (string | number)[]): boolean {
  return cells.every((cell) => String(cell ?? '').trim() === '');
}

function parseYesNo(value: string, defaultYes = true): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return defaultYes;
  if (['no', 'n', 'false', '0', 'off'].includes(v)) return false;
  if (['yes', 'y', 'true', '1', 'on'].includes(v)) return true;
  return defaultYes;
}

export function parseEmployeeImportAoa(aoa: (string | number)[][]): EmployeeImportParseResult {
  const headerIndex = findHeaderRowIndex(aoa);
  if (headerIndex < 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message:
            'Missing header row. Use the Employee List export columns (First Name, Email, Department ID, …).',
        },
      ],
      skippedBlank: 0,
    };
  }

  const columnIndex = buildColumnIndex(aoa[headerIndex] ?? []);
  const required: EmployeeListTabularColumn[] = [
    'First Name',
    'Last Name',
    'Email',
    'Phone',
    'Department ID',
    'Position ID',
    'Join Date',
    'Gender',
    'Birth Date',
    'Religion',
    'Street Address',
    'City',
    'Base Salary',
    'Emergency Contact Name',
    'Emergency Contact Relationship',
    'Emergency Contact Phone',
  ];
  const missingHeaders = required.filter((key) => columnIndex[key] == null);
  if (missingHeaders.length) {
    return {
      rows: [],
      errors: [
        {
          row: headerIndex + 1,
          message: `Missing required columns: ${missingHeaders.join(', ')}`,
        },
      ],
      skippedBlank: 0,
    };
  }

  const rows: ParsedEmployeeImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skippedBlank = 0;

  for (let i = headerIndex + 1; i < aoa.length; i += 1) {
    const line = aoa[i] ?? [];
    if (rowIsBlank(line)) {
      skippedBlank += 1;
      continue;
    }

    const sheetRow = i + 1;
    const get = (key: EmployeeListTabularColumn) => cellAt(line, columnIndex, key);
    const birthRaw =
      columnIndex['Birth Date'] != null ? formatEmployeeImportDate(line[columnIndex['Birth Date']!]) : '';
    const joinRaw =
      columnIndex['Join Date'] != null ? formatEmployeeImportDate(line[columnIndex['Join Date']!]) : '';
    const timeInRaw =
      columnIndex['Time In'] != null ? formatExcelTime(line[columnIndex['Time In']!]) : '';
    const timeOutRaw =
      columnIndex['Time Out'] != null ? formatExcelTime(line[columnIndex['Time Out']!]) : '';

    const row: ParsedEmployeeImportRow = {
      rowNumber: sheetRow,
      employeeId: get('Employee ID'),
      firstName: get('First Name'),
      lastName: get('Last Name'),
      email: get('Email'),
      phone: get('Phone'),
      departmentId: get('Department ID'),
      positionId: get('Position ID'),
      birthDate: birthRaw,
      joinDate: joinRaw,
      probationMonths: get('Probation (Months)'),
      role: get('Role'),
      portalLoginAllowed: get('Portal Login Allowed'),
      gender: get('Gender'),
      nationality: get('Nationality'),
      religion: get('Religion'),
      streetAddress: get('Street Address'),
      city: get('City'),
      country: get('Country'),
      employmentType: get('Employment Type'),
      workDays: get('Work Days'),
      timeIn: timeInRaw,
      timeOut: timeOutRaw,
      workHours: get('Work Hours'),
      breakDurationMinutes: get('Break Duration Minutes'),
      gracePeriodMinutes: get('Grace Period Minutes'),
      baseSalary: get('Base Salary'),
      currency: get('Currency'),
      paymentMethod: get('Payment Method'),
      bankName: get('Bank Name'),
      bankAccountNumber: get('Bank Account Number'),
      emergencyContactName: get('Emergency Contact Name'),
      emergencyContactRelationship: get('Emergency Contact Relationship'),
      emergencyContactPhone: get('Emergency Contact Phone'),
      maritalStatus: get('Marital Status'),
      spouseName: get('Spouse Name'),
      spousePhone: get('Spouse Phone'),
    };

    const rowMissing: string[] = [];
    if (!row.firstName) rowMissing.push('First Name');
    if (!row.lastName) rowMissing.push('Last Name');
    if (!row.email) rowMissing.push('Email');
    if (!row.phone) rowMissing.push('Phone');
    if (!row.departmentId) rowMissing.push('Department ID');
    if (!row.positionId) rowMissing.push('Position ID');
    if (!row.joinDate) rowMissing.push('Join Date');
    if (!row.gender) rowMissing.push('Gender');
    if (!row.birthDate) rowMissing.push('Birth Date');
    if (!row.baseSalary) rowMissing.push('Base Salary');
    if (!row.emergencyContactName) rowMissing.push('Emergency Contact Name');
    if (!row.emergencyContactRelationship) rowMissing.push('Emergency Contact Relationship');
    if (!row.emergencyContactPhone) rowMissing.push('Emergency Contact Phone');
    if (!row.religion) rowMissing.push('Religion');
    if (!row.streetAddress) rowMissing.push('Street Address');
    if (!row.city) rowMissing.push('City');

    if (rowMissing.length) {
      errors.push({ row: sheetRow, message: `Missing: ${rowMissing.join(', ')}` });
      continue;
    }

    rows.push(row);
  }

  if (rows.length > MAX_EMPLOYEE_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message: `Import is limited to ${MAX_EMPLOYEE_IMPORT_ROWS} rows per file (found ${rows.length}). Split the file and try again.`,
        },
      ],
      skippedBlank,
    };
  }

  return { rows, errors, skippedBlank };
}

export async function readEmployeeImportFile(file: File): Promise<(string | number)[][]> {
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

const TEMPLATE_EXAMPLE_ROWS: (string | number)[][] = [
  [...EMPLOYEE_LIST_TABULAR_COLUMNS],
  [
    '',
    '',
    'Sokha',
    'Chan',
    'sokha.chan@example.com',
    '012345678',
    'dept-1',
    'Operations',
    '',
    '',
    'pos-1',
    'Staff',
    '',
    '15/01/1995',
    '',
    '01/04/2026',
    '3',
    'EMPLOYEE',
    '',
    'Yes',
    '',
    '',
    '',
    '',
    '',
    'Female',
    'Cambodia',
    'Buddhism',
    'Street 123',
    'Phnom Penh',
    'Cambodia',
    'Full-Time',
    '5',
    '08:00',
    '17:00',
    '8',
    '60',
    String(DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes ?? 0),
    '500',
    'USD',
    'cash',
    '',
    '',
    'Dara Chan',
    'Sibling',
    '098765432',
    'single',
    '',
    '',
  ],
];

export function downloadEmployeeImportTemplate(format: 'csv' | 'xlsx'): void {
  const filename = exportFilename('Employee_Import_Template', [], format);
  if (format === 'xlsx') {
    downloadAoaAsXlsx(TEMPLATE_EXAMPLE_ROWS, filename, 'Employee Import');
    return;
  }
  const lines = TEMPLATE_EXAMPLE_ROWS.map((row) => row.map((cell) => String(cell)).join(','));
  downloadCsvLines(lines, filename);
}

function normalizeRole(raw: string): string {
  const role = raw.trim().toUpperCase() || 'EMPLOYEE';
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return 'EMPLOYEE';
  if (['EMPLOYEE', 'MANAGER', 'HR'].includes(role)) return role;
  return 'EMPLOYEE';
}

function normalizePaymentMethod(raw: string): 'bank' | 'cash' {
  const v = raw.trim().toLowerCase();
  if (v === 'bank' || v === 'transfer') return 'bank';
  return 'cash';
}

/** Build POST /employees body — portal login defaults on with system default password. */
export function buildEmployeeImportCreatePayload(
  row: ParsedEmployeeImportRow,
  employeeId: string
): EmployeeImportCreatePayload {
  const paymentMethod = normalizePaymentMethod(row.paymentMethod);
  const marital = (row.maritalStatus || 'single').trim().toLowerCase() || 'single';
  const allowLogin = parseYesNo(row.portalLoginAllowed, true);
  const workDays = Number(row.workDays || 5);
  const workHours = Number(row.workHours || 8);
  const breakMinutes = Number(row.breakDurationMinutes || 60);
  const graceMinutes =
    row.gracePeriodMinutes !== ''
      ? Number(row.gracePeriodMinutes)
      : DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes;
  const probation = Number(row.probationMonths || 3);
  const salary = Number(row.baseSalary);

  return {
    employee_id: employeeId,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    phone: row.phone,
    department_id: row.departmentId,
    position_id: row.positionId,
    join_date: row.joinDate,
    birth_date: row.birthDate,
    gender: row.gender,
    nationality: row.nationality || 'Cambodia',
    religion: row.religion,
    street_address: row.streetAddress,
    city: row.city,
    country: row.country || 'Cambodia',
    employment_type: row.employmentType || 'Full-Time',
    probation_period_months: Number.isFinite(probation) ? probation : 3,
    work_days: Number.isFinite(workDays) && workDays >= 1 ? workDays : 5,
    time_in: row.timeIn || '08:00',
    time_out: row.timeOut || '17:00',
    work_hours: Number.isFinite(workHours) && workHours > 0 ? workHours : 8,
    break_duration_minutes: Number.isFinite(breakMinutes) ? breakMinutes : 60,
    grace_period_minutes: Number.isFinite(graceMinutes) ? graceMinutes : 0,
    base_salary: salary,
    currency: row.currency || 'USD',
    payment_method: paymentMethod,
    bank_name: paymentMethod === 'bank' ? row.bankName || null : null,
    bank_account_number: paymentMethod === 'bank' ? row.bankAccountNumber || null : null,
    emergency_contact_name: row.emergencyContactName,
    emergency_contact_relationship: row.emergencyContactRelationship,
    emergency_contact_phone: row.emergencyContactPhone,
    marital_status: marital,
    spouse_name: marital === 'married' ? row.spouseName || null : null,
    spouse_phone: marital === 'married' ? row.spousePhone || null : null,
    role: normalizeRole(row.role),
    accessRole: normalizeRole(row.role),
    allow_login: allowLogin,
  };
}
