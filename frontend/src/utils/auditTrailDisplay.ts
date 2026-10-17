import { formatDateOnlyDisplay } from './formatDisplayDate';

export type AuditTrailDetailInput = {
  entityType: string;
  entityId?: string | null;
  action: string;
  reason?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
  source?: string;
  performedBy?: string | null;
  changedBy?: {
    id?: string;
    name?: string;
    email?: string;
    employeeCode?: string | null;
  } | null;
};

export type AuditDetailLine = {
  label: string;
  before: string;
  after: string;
};

export type AuditTrailDetail = {
  /** Required human summary of what changed. */
  detail: string;
  /** Page → tab (and optional section) where the action happened. */
  pageAndTab: string;
  /** Human action name performed by the actor. */
  actorAction: string;
  /** Actor display name when available. */
  actorName: string | null;
  /** Subject employee display id when present on the audit payload. */
  employeeId: string | null;
  /** Reason / notes for the action when present. */
  reason: string | null;
  summary: string | null;
  sourceLabel: string | null;
  actionLabel: string;
  lines: AuditDetailLine[];
  hasContent: boolean;
};

/** Lowercase underscore token for matching aliases. */
export function normalizeAuditEntityToken(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Raw / legacy entityType values → one HCMS component key.
 * Keeps the Audit Trail filter to a single option per area.
 */
const AUDIT_ENTITY_COMPONENT_ALIASES: Record<string, string> = {
  // Employees
  employee: 'employees',
  employees: 'employees',
  employee_sensitive_change: 'employees',
  employee_movement: 'employees',
  movement: 'employees',
  abandonment_case: 'employees',
  final_settlement: 'employees',

  // Positions
  position: 'positions',
  positions: 'positions',
  settings_position_levels: 'positions',

  // Departments
  department: 'departments',
  departments: 'departments',

  // Leaves
  leave: 'leaves',
  leaves: 'leaves',
  leave_request: 'leaves',
  leave_type: 'leaves',

  // Overtime
  overtime: 'overtime',
  overtime_request: 'overtime',
  overtime_type: 'overtime',

  // Attendance
  attendance: 'attendance',
  attendance_record: 'attendance',
  attendance_period: 'attendance',
  attendance_amendment: 'attendance',

  // Payroll (runs, slips, rules, allowances)
  payroll: 'payroll',
  payroll_run: 'payroll',
  payslip: 'payroll',
  payslips: 'payroll',
  payroll_adjustment: 'payroll',
  payroll_policy_version: 'payroll',
  payroll_rule: 'payroll',
  payroll_compliance_rule: 'payroll',
  compliance_rule: 'payroll',
  exchange_rate: 'payroll',
  tax_brackets: 'payroll',
  tax_rules: 'payroll',
  nssf_wage_table: 'payroll',
  nssf_rules: 'payroll',
  allowance: 'payroll',
  allowance_type: 'payroll',
  allowance_rule: 'payroll',
  allowance_template: 'payroll',
  employee_allowance_package: 'payroll',
  employee_allowance_assignment: 'payroll',

  // Performance / KPI / probation
  employee_appraisal: 'performance',
  appraisal_period: 'performance',
  appraisal_final: 'performance',
  appraisal_eval: 'performance',
  kpi_appraisal: 'performance',
  kpi_components: 'performance',
  kpi_attendance_rules: 'performance',
  kpi_policy: 'performance',
  kpi_recommendation_rules: 'performance',
  probation_final: 'performance',
  probation_eval: 'performance',

  // Projects
  project: 'projects',
  projects: 'projects',
  task: 'projects',
  tasks: 'projects',

  // Notifications
  notification: 'notifications',
  notifications: 'notifications',
  announcement: 'notifications',

  // Access
  permission: 'permissions',
  permissions: 'permissions',
  permission_override: 'permissions',
  permission_request: 'permissions',
  user: 'users',
  users: 'users',

  // Settings
  setting: 'settings',
  settings: 'settings',
  system_setting: 'settings',
  company_profile: 'settings',
  database_backup: 'settings',
  organization_setting: 'settings',
  work_day_policy: 'settings',
  payroll_work_day_policy: 'settings',
  preview: 'settings',

  // Auth
  auth_login: 'authentication',
};

const AUDIT_ENTITY_COMPONENT_LABELS: Record<string, string> = {
  employees: 'Employees',
  positions: 'Positions',
  departments: 'Departments',
  leaves: 'Leaves',
  overtime: 'Overtime',
  attendance: 'Attendance',
  payroll: 'Payroll',
  performance: 'Performance',
  projects: 'Projects',
  notifications: 'Notifications',
  permissions: 'Permissions',
  users: 'User management',
  settings: 'Settings',
  authentication: 'Login',
};

function humanizeEntityToken(token: string): string {
  return token
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Collapse raw audit entityType values to one stable component key. */
export function canonicalizeAuditEntityType(raw: string): string {
  const token = normalizeAuditEntityToken(raw);
  if (!token) return '';
  if (token.startsWith('compliance_rule')) return 'payroll';

  const direct = AUDIT_ENTITY_COMPONENT_ALIASES[token];
  if (direct) return direct;

  // Singular ↔ plural without listing every alias.
  if (token.endsWith('ies')) {
    const singular = `${token.slice(0, -3)}y`;
    if (AUDIT_ENTITY_COMPONENT_ALIASES[singular]) return AUDIT_ENTITY_COMPONENT_ALIASES[singular];
  }
  if (token.endsWith('s') && token.length > 3) {
    const singular = token.slice(0, -1);
    if (AUDIT_ENTITY_COMPONENT_ALIASES[singular]) return AUDIT_ENTITY_COMPONENT_ALIASES[singular];
  }
  const asPlural = `${token}s`;
  if (AUDIT_ENTITY_COMPONENT_ALIASES[asPlural]) return AUDIT_ENTITY_COMPONENT_ALIASES[asPlural];

  return token;
}

/** Display label for a raw or canonical entity type (one name per component). */
export function formatAuditEntityLabel(raw: string): string {
  const key = canonicalizeAuditEntityType(raw);
  if (!key) return '—';
  return AUDIT_ENTITY_COMPONENT_LABELS[key] ?? humanizeEntityToken(key);
}

/** Unique component options for the Audit Trail entity filter. */
export function buildAuditEntityFilterOptions(
  entityTypes: string[]
): Array<{ value: string; label: string }> {
  const keys = Array.from(
    new Set(entityTypes.map((t) => canonicalizeAuditEntityType(t)).filter(Boolean))
  );
  return keys
    .map((value) => ({ value, label: formatAuditEntityLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}


const FIELD_LABELS: Record<string, string> = {
  exchangeRateKhrPerUsd: 'Exchange rate (KHR per USD)',
  exchange_rate_khr_per_usd: 'Exchange rate (KHR per USD)',
  rate: 'Exchange rate (KHR per USD)',
  effectiveFrom: 'Effective from',
  effective_from: 'Effective from',
  effectiveTo: 'Effective until',
  effective_to: 'Effective until',
  notes: 'Notes',
  status: 'Status',
  month: 'Payroll month',
  netUsd: 'Net pay (USD)',
  grossUsd: 'Gross pay (USD)',
  totalEmployees: 'Employees in run',
  totalNetPay: 'Total net pay (USD)',
  brackets: 'Tax brackets',
  message: 'Result',
  policyType: 'Policy type',
  policyKey: 'Policy key',
  clearanceJson: 'Offboarding details',
  lastWorkingDate: 'Last working day',
  employeeId: 'Employee ID',
  terminationReason: 'Termination reason',
  workflowStatus: 'Workflow status',
  bank_account_number: 'Bank account',
  bank_name: 'Bank name',
  payment_method: 'Payment method',
  base_salary: 'Base salary',
  phone: 'Phone',
  department_id: 'Department',
  position_id: 'Position',
  job_position: 'Job position',
  work_location: 'Work location',
  contract_type: 'Contract type',
  employment_status: 'Employment status',
  tax_id: 'Tax ID',
  nssf_id: 'NSSF ID',
  tax_dependents: 'Tax dependents',
  nssf_enrolled: 'NSSF enrolled',
  changeSource: 'Change source',
  fieldName: 'Field',
  weightedScore: 'Weighted score',
  rawScore: 'Raw score',
  finalGrade: 'Final grade',
  rankingPosition: 'Ranking',
  assignedManagerUserId: 'Assigned manager',
  managerSubmittedAt: 'Manager submitted',
  finalApprovedAt: 'Final approved',
  hrApprovedAt: 'HR approved',
  recommendation: 'Recommendation',
  managerRecommendations: 'Manager recommendations',
  strengths: 'Strengths',
  weaknesses: 'Weaknesses',
  locked: 'Locked',
  periodType: 'Period type',
  startDate: 'Start date',
  endDate: 'End date',
  alertNotificationDate: 'Alert date',
  name: 'Name',
  manualCommentThreshold: 'Manual comment threshold',
  weightPercent: 'Weight (%)',
  scoringMethod: 'Scoring method',
  ruleType: 'Rule type',
  minCount: 'Minimum count',
  maxCount: 'Maximum count',
  deductionPoints: 'Deduction points',
  deductionMode: 'Deduction mode',
  gradeCodes: 'Grade codes',
  recommendationType: 'Recommendation type',
};

const SKIP_KEYS = new Set([
  'versionId',
  'id',
  'entityId',
  'entityType',
  'source',
  'route',
  'method',
  'originalUrl',
  'query',
  'params',
  'ipAddress',
  'userAgent',
  'statusCode',
  'durationMs',
  'payrollAuditId',
  'legacyEntityType',
  'legacyEntityId',
  'statusChange',
  'response',
  'request',
  'metadata',
  'payload',
  // Expanded into Field / Before / After rows instead of a single blob.
  'fields',
  'employeeId',
  'employee_id',
]);

const SOURCE_LABELS: Record<string, string> = {
  audit_log: 'System record',
  domain_audit: 'Domain change',
  payroll_audit: 'Payroll workflow',
  sensitive_module: 'Policy change',
  allowance_audit: 'Allowance rules',
  setting_audit: 'System settings',
  appraisal_audit: 'KPI appraisal',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  DOWNLOAD: 'Downloaded',
  RESTORE: 'Restored',
  STATUS_CHANGE: 'Status changed',
  PAYROLL_CALCULATED: 'Payroll calculated',
  PAYROLL_RECALCULATED: 'Payroll recalculated',
  PAYROLL_APPROVED: 'Payroll approved',
  PAYROLL_REJECTED: 'Payroll rejected',
  REOPEN_CYCLE_ARCHIVED: 'Prior cycle archived (reopen)',
  WORKFLOW_STATUS: 'Workflow status changed',
  SCORE_UPDATED: 'Score updated',
  LOCK_CHANGED: 'Lock changed',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  APPLIED: 'Applied',
};

const SENSITIVE_CHANGE_SOURCE_LABELS: Record<string, string> = {
  profile_update: 'Profile update',
  field_correction: 'Field correction',
  movement: 'Movement',
};

type AuditFieldEntry = {
  field?: string;
  label?: string;
  value?: unknown;
  display?: unknown;
  before?: unknown;
  after?: unknown;
  beforeDisplay?: unknown;
  afterDisplay?: unknown;
};

function isAuditFieldEntry(value: unknown): value is AuditFieldEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as AuditFieldEntry;
  return (
    'field' in row ||
    'label' in row ||
    'value' in row ||
    'display' in row ||
    'before' in row ||
    'after' in row
  );
}

function extractAuditFieldEntries(record: Record<string, unknown>): AuditFieldEntry[] | null {
  const fields = record.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  if (!fields.every(isAuditFieldEntry)) return null;
  return fields;
}

function fieldEntryKey(entry: AuditFieldEntry, index: number): string {
  const field = String(entry.field ?? '').trim();
  if (field) return field;
  const label = String(entry.label ?? '').trim();
  if (label) return `label:${label.toLowerCase()}`;
  return `idx:${index}`;
}

function fieldEntryLabel(entry: AuditFieldEntry): string {
  const label = String(entry.label ?? '').trim();
  if (label) return label;
  const field = String(entry.field ?? '').trim();
  if (field) return fieldLabel(field);
  return 'Field';
}

function fieldEntryDisplay(entry: AuditFieldEntry, side: 'before' | 'after'): string {
  if (side === 'before') {
    if (entry.beforeDisplay != null && entry.beforeDisplay !== '') {
      return formatAuditValue(String(entry.field ?? 'value'), entry.beforeDisplay);
    }
    if (entry.before !== undefined) {
      return formatAuditValue(String(entry.field ?? 'value'), entry.before);
    }
    if (entry.display != null && entry.display !== '') {
      return formatAuditValue(String(entry.field ?? 'value'), entry.display);
    }
    return formatAuditValue(String(entry.field ?? 'value'), entry.value);
  }
  if (entry.afterDisplay != null && entry.afterDisplay !== '') {
    return formatAuditValue(String(entry.field ?? 'value'), entry.afterDisplay);
  }
  if (entry.after !== undefined) {
    return formatAuditValue(String(entry.field ?? 'value'), entry.after);
  }
  if (entry.display != null && entry.display !== '') {
    return formatAuditValue(String(entry.field ?? 'value'), entry.display);
  }
  return formatAuditValue(String(entry.field ?? 'value'), entry.value);
}

/** Unpack nested `fields: [{ field, label, value, display }]` payloads into Field/Before/After rows. */
function collectFieldArrayLines(
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDetailLine[] | null {
  const oldFields = extractAuditFieldEntries(oldRecord);
  const newFields = extractAuditFieldEntries(newRecord);
  if (!oldFields && !newFields) return null;

  const keys = new Set<string>();
  const oldByKey = new Map<string, AuditFieldEntry>();
  const newByKey = new Map<string, AuditFieldEntry>();

  (oldFields ?? []).forEach((entry, index) => {
    const key = fieldEntryKey(entry, index);
    keys.add(key);
    oldByKey.set(key, entry);
  });
  (newFields ?? []).forEach((entry, index) => {
    const key = fieldEntryKey(entry, index);
    keys.add(key);
    newByKey.set(key, entry);
  });

  const lines: AuditDetailLine[] = [];
  for (const key of keys) {
    const beforeEntry = oldByKey.get(key);
    const afterEntry = newByKey.get(key);
    const label = fieldEntryLabel(afterEntry ?? beforeEntry ?? {});
    const before = beforeEntry ? fieldEntryDisplay(beforeEntry, 'before') : '—';
    const after = afterEntry ? fieldEntryDisplay(afterEntry, 'after') : '—';
    if (before === after) continue;
    lines.push({ label, before, after });
  }

  return lines.sort((a, b) => a.label.localeCompare(b.label));
}

function resolveSubjectEmployeeId(
  input: AuditTrailDetailInput,
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>,
  meta: Record<string, unknown>
): string | null {
  const candidates = [
    newRecord.employeeId,
    oldRecord.employeeId,
    newRecord.employee_id,
    oldRecord.employee_id,
    meta.employeeId,
    meta.employee_id,
    meta.employeeCode,
  ];
  for (const value of candidates) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  if (
    input.entityType === 'employee_sensitive_change' ||
    input.entityType === 'employee' ||
    input.entityType === 'employees'
  ) {
    const entityId = String(input.entityId ?? '').trim();
    if (entityId && !entityId.startsWith('esc-') && !entityId.startsWith('efc-') && !entityId.startsWith('audit-')) {
      return entityId;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { value };
    }
  }
  return { value };
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateValue(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const formatted = formatDateOnlyDisplay(raw, '');
    return formatted || null;
  }
  return null;
}

function formatAuditValue(key: string, value: unknown): string {
  if (isEmpty(value)) return '—';

  const lowerKey = key.toLowerCase();
  if (
    lowerKey.includes('exchangerate') ||
    lowerKey === 'rate' ||
    lowerKey.includes('khr_per_usd')
  ) {
    const n = Number(value);
    if (Number.isFinite(n)) return `${Math.round(n).toLocaleString()} KHR per USD`;
  }

  const asDate = formatDateValue(value);
  if (asDate && (lowerKey.includes('date') || lowerKey.includes('from') || lowerKey.includes('to'))) {
    return asDate;
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : String(value);

  if (Array.isArray(value)) {
    if (key === 'brackets') return `${value.length} bracket${value.length === 1 ? '' : 's'}`;
    if (value.length <= 3) {
      return value.map((item) => formatAuditValue(key, item)).join('; ');
    }
    return `${value.length} items`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('exchangeRateKhrPerUsd' in obj) {
      return formatAuditValue('exchangeRateKhrPerUsd', obj.exchangeRateKhrPerUsd);
    }
    const keys = Object.keys(obj);
    if (keys.length <= 4) {
      return keys
        .map((k) => `${fieldLabel(k)}: ${formatAuditValue(k, obj[k])}`)
        .join(' · ');
    }
    return `${keys.length} fields updated`;
  }

  return String(value);
}

function flattenComparable(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  const payload = asRecord(record.payload);
  for (const [key, value] of Object.entries(payload)) {
    if (!(key in out)) out[key] = value;
  }
  const request = asRecord(record.request);
  for (const [key, value] of Object.entries(request)) {
    if (!(key in out)) out[key] = value;
  }
  const response = asRecord(record.response);
  for (const key of ['message', 'exchangeRateKhrPerUsd', 'effectiveFrom', 'month', 'status']) {
    if (key in response && !(key in out)) out[key] = response[key];
  }
  const statusChange = asRecord(record.statusChange);
  if ('before' in statusChange || 'after' in statusChange) {
    if (!('status' in out)) {
      out.status = statusChange.after ?? statusChange.before;
    }
  }
  return out;
}

function collectChangeLines(
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDetailLine[] {
  const oldFlat = flattenComparable(oldRecord);
  const newFlat = flattenComparable(newRecord);
  const keys = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
  const lines: AuditDetailLine[] = [];

  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue;
    const before = oldFlat[key];
    const after = newFlat[key];
    if (isEmpty(before) && isEmpty(after)) continue;
    const beforeText = formatAuditValue(key, before);
    const afterText = formatAuditValue(key, after);
    if (beforeText === afterText) continue;
    lines.push({
      label: fieldLabel(key),
      before: beforeText,
      after: afterText,
    });
  }

  return lines.sort((a, b) => a.label.localeCompare(b.label));
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Display label for a raw audit action code. */
export function formatAuditActionLabel(action: string): string {
  return actionLabel(action);
}

function sourceLabel(source?: string): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

function pickSummary(
  input: AuditTrailDetailInput,
  meta: Record<string, unknown>
): string | null {
  const fromMeta = String(meta.summary ?? '').trim();
  if (fromMeta) return fromMeta;
  const reason = String(input.reason ?? '').trim();
  if (reason && !/^payroll\s+\w+\s+update$/i.test(reason)) return reason;
  const message = String(asRecord(asRecord(input.newValue).response).message ?? '').trim();
  if (message) return message;
  return null;
}

const ENTITY_PAGE_TAB: Record<string, { page: string; tab: string; section?: string }> = {
  exchange_rate: { page: 'Payroll', tab: 'Rules', section: 'Exchange rate' },
  tax_brackets: { page: 'Payroll', tab: 'Rules', section: 'Tax on Salary' },
  tax_rules: { page: 'Payroll', tab: 'Rules', section: 'Tax on Salary' },
  nssf_wage_table: { page: 'Payroll', tab: 'Rules', section: 'NSSF assumed wage' },
  nssf_rules: { page: 'Payroll', tab: 'Rules', section: 'NSSF' },
  compliance_rule: { page: 'Payroll', tab: 'Rules', section: 'Compliance' },
  payroll_compliance_rule: { page: 'Payroll', tab: 'Rules', section: 'Compliance' },
  work_day_policy: { page: 'Settings', tab: 'Work-day policy' },
  payroll_work_day_policy: { page: 'Settings', tab: 'Work-day policy' },
  payroll_policy_version: { page: 'Payroll', tab: 'Rules' },
  payroll_run: { page: 'Payroll', tab: 'Approvals' },
  payroll_adjustment: { page: 'Payroll', tab: 'Approvals', section: 'Adjustment' },
  allowance: { page: 'Payroll', tab: 'Rules', section: 'Allowances' },
  allowance_type: { page: 'Payroll', tab: 'Rules', section: 'Allowance types' },
  allowance_rule: { page: 'Payroll', tab: 'Rules', section: 'Allowance rules' },
  allowance_template: { page: 'Payroll', tab: 'Rules', section: 'Allowance packages' },
  movement: { page: 'Employees', tab: 'Movements' },
  employee_movement: { page: 'Employees', tab: 'Movements' },
  employee_sensitive_change: { page: 'Employees', tab: 'List', section: 'Sensitive changes' },
  employee_appraisal: { page: 'Performance', tab: 'KPI appraisals' },
  appraisal_period: { page: 'Performance', tab: 'KPI appraisals', section: 'Periods' },
  kpi_components: { page: 'Performance', tab: 'KPI appraisals', section: 'Components' },
  kpi_attendance_rules: { page: 'Performance', tab: 'KPI appraisals', section: 'Attendance rules' },
  kpi_policy: { page: 'Performance', tab: 'KPI appraisals', section: 'Policy' },
  kpi_recommendation_rules: {
    page: 'Performance',
    tab: 'KPI appraisals',
    section: 'Recommendation rules',
  },
  setting: { page: 'Settings', tab: 'System' },
  system_setting: { page: 'Settings', tab: 'System' },
  company_profile: { page: 'Settings', tab: 'Company profile' },
  database_backup: { page: 'Settings', tab: 'Backup' },
  organization_setting: { page: 'Settings', tab: 'Security' },
  settings_position_levels: { page: 'Settings', tab: 'Company profile', section: 'Structure' },
  auth_login: { page: 'Authentication', tab: 'Login' },
  employees: { page: 'Employees', tab: 'List' },
  departments: { page: 'Organization', tab: 'Departments' },
  projects: { page: 'Projects', tab: 'Overview' },
  leaves: { page: 'Leaves', tab: 'Requests' },
  overtime: { page: 'Overtime', tab: 'Requests' },
  attendance: { page: 'Attendance', tab: 'List' },
  users: { page: 'User management', tab: 'Users' },
  permissions: { page: 'Permissions', tab: 'Matrix' },
};

const ROUTE_PAGE_TAB: Array<{ match: RegExp; page: string; tab: string; section?: string }> = [
  { match: /\/payroll\/exchange-rate/i, page: 'Payroll', tab: 'Rules', section: 'Exchange rate' },
  { match: /\/payroll\/tax-brackets/i, page: 'Payroll', tab: 'Rules', section: 'Tax on Salary' },
  {
    match: /\/payroll\/nssf-assumed-wage/i,
    page: 'Payroll',
    tab: 'Rules',
    section: 'NSSF assumed wage',
  },
  { match: /\/payroll\/compliance-rules/i, page: 'Payroll', tab: 'Rules', section: 'Compliance' },
  { match: /\/allowances\/templates/i, page: 'Payroll', tab: 'Rules', section: 'Allowance packages' },
  { match: /\/allowances\/rules/i, page: 'Payroll', tab: 'Rules', section: 'Allowance rules' },
  { match: /\/allowances\/types/i, page: 'Payroll', tab: 'Rules', section: 'Allowance types' },
  { match: /\/payroll\/runs/i, page: 'Payroll', tab: 'Approvals' },
  { match: /\/payroll\/schedule/i, page: 'Payroll', tab: 'Calendar' },
  { match: /\/employees\/.*\/movements|\/employee-movements/i, page: 'Employees', tab: 'Movements' },
  { match: /\/employees\/.*\/offboard|\/final-settlement/i, page: 'Employees', tab: 'Offboarding' },
  { match: /\/employees/i, page: 'Employees', tab: 'List' },
  { match: /\/company-profile|\/settings\/company/i, page: 'Settings', tab: 'Company profile' },
  { match: /\/settings\/backup/i, page: 'Settings', tab: 'Backup' },
  { match: /\/organization-settings|\/settings\/security/i, page: 'Settings', tab: 'Security' },
  { match: /\/system-settings|\/settings/i, page: 'Settings', tab: 'System' },
  { match: /\/appraisal|\/kpi/i, page: 'Performance', tab: 'KPI appraisals' },
  { match: /\/probation/i, page: 'Performance', tab: 'Probation' },
  { match: /\/auth\/login/i, page: 'Authentication', tab: 'Login' },
];

function formatPageTab(parts: { page: string; tab: string; section?: string }): string {
  return parts.section
    ? `${parts.page} → ${parts.tab} → ${parts.section}`
    : `${parts.page} → ${parts.tab}`;
}

function resolveEntityKey(input: AuditTrailDetailInput, meta: Record<string, unknown>): string {
  const policyType = String(meta.policyType ?? '').trim();
  if (policyType) return policyType;
  const entityType = String(input.entityType ?? '').trim();
  if (entityType.startsWith('compliance_rule')) return 'compliance_rule';
  if (entityType === 'payroll_policy_version') {
    const legacy = String(meta.legacyEntityId ?? input.entityId ?? '').trim();
    if (legacy.startsWith('compliance_rule')) return 'compliance_rule';
    if (ENTITY_PAGE_TAB[legacy]) return legacy;
  }
  return entityType;
}

/** Map audit entity/route metadata to HCMS page → tab → section. */
export function resolveAuditPageAndTab(input: AuditTrailDetailInput): string {
  const meta = input.metadata ?? {};
  const entityKey = resolveEntityKey(input, meta);
  const fromEntity = ENTITY_PAGE_TAB[entityKey];
  if (fromEntity) return formatPageTab(fromEntity);

  const route = String(meta.route ?? meta.originalUrl ?? '').trim();
  if (route) {
    for (const entry of ROUTE_PAGE_TAB) {
      if (entry.match.test(route)) {
        return formatPageTab(entry);
      }
    }
    const first = route.replace(/^\/+/, '').split('/')[0];
    if (first && ENTITY_PAGE_TAB[first]) return formatPageTab(ENTITY_PAGE_TAB[first]);
  }

  const pretty = entityKey
    ? entityKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'System';
  return `System → ${pretty}`;
}

function resolveActorName(input: AuditTrailDetailInput): string | null {
  const actor = input.changedBy;
  const name = String(actor?.name ?? '').trim();
  if (name) return name;
  const email = String(actor?.email ?? '').trim();
  if (email) return email;
  const code = String(actor?.employeeCode ?? '').trim();
  if (code) return code;
  const performedBy = String(input.performedBy ?? '').trim();
  if (performedBy && performedBy !== 'system') return performedBy;
  if (performedBy === 'system') return 'System';
  return null;
}

function resolveEntityNoun(input: AuditTrailDetailInput, meta: Record<string, unknown>): string {
  const key = resolveEntityKey(input, meta);
  const mapped = ENTITY_PAGE_TAB[key];
  if (mapped?.section) return mapped.section;
  if (mapped) return mapped.tab;
  return key.replace(/_/g, ' ') || 'record';
}

/** e.g. "Updated exchange rate" — action name done by the actor. */
export function resolveActorActionName(
  input: AuditTrailDetailInput,
  meta: Record<string, unknown> = input.metadata ?? {}
): string {
  const verb = actionLabel(input.action);
  const changeSource = String(meta.changeSource ?? '').trim();
  if (changeSource && SENSITIVE_CHANGE_SOURCE_LABELS[changeSource]) {
    return `${verb} ${SENSITIVE_CHANGE_SOURCE_LABELS[changeSource].toLowerCase()}`;
  }
  if (input.entityType === 'employee_sensitive_change') {
    const fieldName = String(meta.fieldName ?? '').trim();
    if (fieldName) return `${verb} ${fieldLabel(fieldName).toLowerCase()}`;
    return `${verb} employee change`;
  }
  const noun = resolveEntityNoun(input, meta);
  if (!noun || noun.toLowerCase() === 'record') return verb;
  return `${verb} ${noun.toLowerCase()}`;
}

function buildDetailText(
  summary: string | null,
  lines: AuditDetailLine[],
  actorAction: string
): string {
  if (summary) return summary;
  if (lines.length === 1) {
    const line = lines[0]!;
    if (line.before === '—' || line.before === line.after) {
      return `${line.label}: ${line.after}`;
    }
    return `${line.label}: ${line.before} → ${line.after}`;
  }
  if (lines.length > 1) {
    return `${actorAction} (${lines.length} fields changed)`;
  }
  return actorAction;
}

function isScalarAuditValue(value: unknown): boolean {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function unwrapStoredAuditValue(value: unknown): unknown {
  if (value == null || value === '' || value === 'null') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('{')
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
  }
  return value;
}

export function buildAuditTrailDetail(input: AuditTrailDetailInput): AuditTrailDetail {
  const oldRecord = asRecord(input.oldValue);
  const newRecord = asRecord(input.newValue);
  const meta = input.metadata ?? {};

  let lines = collectFieldArrayLines(oldRecord, newRecord) ?? collectChangeLines(oldRecord, newRecord);

  if (
    !lines.length &&
    (isScalarAuditValue(input.oldValue) || isScalarAuditValue(input.newValue))
  ) {
    const settingKey = String(meta.settingKey ?? input.entityId ?? '').trim();
    const label = settingKey
      ? settingKey
          .split('.')
          .pop()!
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : 'Value';
    lines = [
      {
        label,
        before: formatAuditValue('value', unwrapStoredAuditValue(input.oldValue)),
        after: formatAuditValue('value', unwrapStoredAuditValue(input.newValue)),
      },
    ];
  }

  if (!lines.length && input.entityType === 'exchange_rate') {
    const oldPayload = asRecord(oldRecord.payload);
    const newPayload = asRecord(newRecord.payload);
    lines = collectChangeLines(
      { effectiveFrom: oldRecord.effectiveFrom, ...oldPayload },
      { effectiveFrom: newRecord.effectiveFrom, notes: newRecord.notes, ...newPayload }
    );
  }

  if (!lines.length && input.action === 'REOPEN_CYCLE_ARCHIVED') {
    const snapshot =
      typeof input.oldValue === 'object' && input.oldValue
        ? (input.oldValue as Record<string, unknown>)
        : asRecord(input.oldValue);
    lines = Object.entries(snapshot)
      .filter(([key, value]) => !isEmpty(value) && !SKIP_KEYS.has(key))
      .map(([key, value]) => ({
        label: fieldLabel(key),
        before: formatAuditValue(key, value),
        after: '—',
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  if (!lines.length && input.action === 'WORKFLOW_STATUS') {
    const before = formatAuditValue('workflowStatus', input.oldValue);
    const after = formatAuditValue('workflowStatus', input.newValue);
    if (before !== after) {
      lines = [{ label: 'Workflow status', before, after }];
    }
  }

  // Single-field metadata corrections sometimes only store fieldName in metadata.
  if (!lines.length && meta.fieldName != null) {
    const fieldName = String(meta.fieldName);
    const before = formatAuditValue(fieldName, unwrapStoredAuditValue(input.oldValue));
    const after = formatAuditValue(fieldName, unwrapStoredAuditValue(input.newValue));
    if (before !== after || !isEmpty(input.oldValue) || !isEmpty(input.newValue)) {
      lines = [{ label: fieldLabel(fieldName), before, after }];
    }
  }

  const summary = pickSummary(input, meta);
  const src = sourceLabel(input.source);
  const pageAndTab = resolveAuditPageAndTab(input);
  const actorAction = resolveActorActionName(input, meta);
  const actorName = resolveActorName(input);
  const employeeId = resolveSubjectEmployeeId(input, oldRecord, newRecord, meta);
  const reason = String(input.reason ?? '').trim() || null;
  const detail = buildDetailText(summary, lines, actorAction);

  return {
    detail,
    pageAndTab,
    actorAction,
    actorName,
    employeeId,
    reason,
    summary,
    sourceLabel: src,
    actionLabel: actionLabel(input.action),
    lines,
    hasContent: Boolean(detail || pageAndTab || actorAction || reason || employeeId || lines.length),
  };
}
