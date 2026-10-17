/**
 * Maps dotted keys (UI / API) to `company_profile` and `settings_security` columns.
 */

export const ORG_SETTINGS_SINGLETON_ID = 'default';

export type OrgSettingsTable = 'company_profile' | 'security';

export type FieldMapping = {
  key: string;
  table: OrgSettingsTable;
  column: string;
  /** text | date | boolean | json */
  kind: 'text' | 'date' | 'boolean' | 'json';
};

export const ORGANIZATION_FIELD_MAP: FieldMapping[] = [
  { key: 'company.name', table: 'company_profile', column: 'name', kind: 'text' },
  { key: 'company.legal_name', table: 'company_profile', column: 'legal_name', kind: 'text' },
  { key: 'company.short_name', table: 'company_profile', column: 'short_name', kind: 'text' },
  { key: 'company.industry_type', table: 'company_profile', column: 'industry_type', kind: 'text' },
  { key: 'company.business_type', table: 'company_profile', column: 'business_type', kind: 'text' },
  { key: 'company.founded_date', table: 'company_profile', column: 'founded_date', kind: 'date' },
  { key: 'company.website', table: 'company_profile', column: 'website', kind: 'text' },

  { key: 'branding.logo', table: 'company_profile', column: 'logo_url', kind: 'text' },
  { key: 'branding.front_cover', table: 'company_profile', column: 'banner_logo_url', kind: 'text' },

  { key: 'contact.main_phone', table: 'company_profile', column: 'main_phone', kind: 'text' },
  { key: 'contact.secondary_phone', table: 'company_profile', column: 'secondary_phone', kind: 'text' },
  { key: 'contact.company_email', table: 'company_profile', column: 'company_email', kind: 'text' },
  { key: 'contact.hr_email', table: 'company_profile', column: 'hr_email', kind: 'text' },
  { key: 'contact.support_email', table: 'company_profile', column: 'support_email', kind: 'text' },
  { key: 'contact.fax_number', table: 'company_profile', column: 'fax_number', kind: 'text' },

  { key: 'regional.country', table: 'company_profile', column: 'default_country', kind: 'text' },
  { key: 'company.timezone', table: 'company_profile', column: 'timezone', kind: 'text' },
  { key: 'regional.date_format', table: 'company_profile', column: 'date_format', kind: 'text' },
  { key: 'regional.time_format', table: 'company_profile', column: 'time_format', kind: 'text' },
  { key: 'company.currency', table: 'company_profile', column: 'currency', kind: 'text' },
  { key: 'regional.language', table: 'company_profile', column: 'language', kind: 'text' },
  { key: 'regional.week_start', table: 'company_profile', column: 'week_start', kind: 'text' },

  { key: 'compliance.registration_number', table: 'company_profile', column: 'registration_number', kind: 'text' },
  { key: 'company.tax_id', table: 'company_profile', column: 'tax_id', kind: 'text' },
  { key: 'compliance.tax_registration_date', table: 'company_profile', column: 'tax_registration_date', kind: 'date' },
  { key: 'compliance.nssf_number', table: 'company_profile', column: 'nssf_number', kind: 'text' },
  { key: 'compliance.patent_number', table: 'company_profile', column: 'patent_number', kind: 'text' },
  {
    key: 'compliance.ministry_registration_number',
    table: 'company_profile',
    column: 'ministry_registration_number',
    kind: 'text',
  },
  {
    key: 'compliance.labor_registration_number',
    table: 'company_profile',
    column: 'labor_registration_number',
    kind: 'text',
  },
  { key: 'compliance.default_tax_rule', table: 'company_profile', column: 'default_tax_rule', kind: 'text' },
  {
    key: 'compliance.exchange_rate_source',
    table: 'company_profile',
    column: 'exchange_rate_source',
    kind: 'text',
  },

  { key: 'documents.payslip_footer', table: 'company_profile', column: 'payslip_footer', kind: 'text' },
  { key: 'documents.report_header', table: 'company_profile', column: 'report_header', kind: 'text' },
  { key: 'documents.report_footer', table: 'company_profile', column: 'report_footer', kind: 'text' },
  { key: 'documents.email_signature', table: 'company_profile', column: 'email_signature', kind: 'text' },

  { key: 'security.session_timeout', table: 'security', column: 'session_timeout_minutes', kind: 'text' },
  { key: 'security.password_min_length', table: 'security', column: 'password_min_length', kind: 'text' },
  { key: 'security.password_complexity', table: 'security', column: 'password_complexity', kind: 'json' },
  { key: 'security.mfa_required', table: 'security', column: 'mfa_required', kind: 'boolean' },
  { key: 'security.login_attempts', table: 'security', column: 'max_login_attempts', kind: 'text' },
  { key: 'security.locked_period', table: 'security', column: 'locked_period_minutes', kind: 'text' },
];

export const ORGANIZATION_SETTING_KEYS = new Set(ORGANIZATION_FIELD_MAP.map((m) => m.key));

export const KEY_BY_TABLE: Record<OrgSettingsTable, FieldMapping[]> = ORGANIZATION_FIELD_MAP.reduce(
  (acc, m) => {
    (acc[m.table] ??= []).push(m);
    return acc;
  },
  {} as Record<OrgSettingsTable, FieldMapping[]>
);

export const MAPPING_BY_KEY = new Map(ORGANIZATION_FIELD_MAP.map((m) => [m.key, m]));

export const COMPANY_SETTING_KEY_PREFIXES = [
  'company.',
  'branding.',
  'contact.',
  'regional.',
  'compliance.',
  'documents.',
] as const;

export function isCompanySettingsKey(key: string): boolean {
  return (
    ORGANIZATION_SETTING_KEYS.has(key) ||
    COMPANY_SETTING_KEY_PREFIXES.some((p) => key.startsWith(p))
  );
}

export function isSecuritySettingsKey(key: string): boolean {
  return key.startsWith('security.');
}

/** Columns stored on the unified company_profile row (excludes security). */
export const COMPANY_PROFILE_COLUMNS = [
  ...new Set(
    ORGANIZATION_FIELD_MAP.filter((m) => m.table === 'company_profile').map((m) => m.column)
  ),
];
