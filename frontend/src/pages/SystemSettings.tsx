import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useUrlSyncedTab } from '../hooks/useUrlSyncedTab';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Check,
  Shield,
  Save,
  Upload,
  X,
  CalendarDays,
  Type,
  Bold,
  Italic,
  Underline,
  Link as LinkIcon,
  Loader2,
  Pencil,
  UserPlus,
  MapPinned,
  QrCode,
} from 'lucide-react';
import { Api, API_BASE_URL } from '../services/api';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { LoadingState } from '../components/common/LoadingState';
import { setCompanyTimezone } from '../utils/companyCalendar';
import { invalidatePortalBrandingCache } from '../services/portalBranding';
import { invalidateDocumentBrandingCache } from '../utils/documentBranding';
import { resolveMediaUrl } from '../utils/mediaUrl';
import { CreateAdminTab } from '../components/settings/CreateAdminTab';
import {
  DefaultPasswordSetupPanel,
  type DefaultPasswordSetupHandle,
} from '../components/settings/DefaultPasswordSetupPanel';
import { CompanyProfilePanel } from '../components/settings/CompanyProfilePanel';
import {
  COMPANY_TABS,
  type CompanyInnerTabKey,
} from '../components/settings/companyProfileConfig';
import { DOCUMENT_TEMPLATE_COVERAGE } from '../utils/documentBranding';
import { displaySettingText, unwrapStoredSettingValue } from '../utils/settingValue';
import { filterInputChange, numericInputAttrs } from '../utils/formInputFilters';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../constants/permissionKeys';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { RulesConfigHelp } from '../components/ui/RulesConfigHelp';
import type { RulesConfigHelpId } from '../content/rulesConfigHelpContent';
import { PageShell } from '../components/ui/page';
import { InfoDetailsButton } from '../components/ui/InfoDetailsButton';
import { setCompanyLocaleFromSettings } from '../utils/companyLocaleSettings';
import {
  portalPasswordPolicyFromSecuritySettings,
  setPortalPasswordPolicy,
} from '../utils/passwordPolicy';
import { refreshPortalPasswordPolicy } from '../hooks/usePortalPasswordPolicy';

const AttendanceGeofenceSettings = lazy(
  () => import('../components/attendance/AttendanceGeofenceSettings')
);

interface SystemSettingsData {
  [key: string]: any;
}

interface SettingCategory {
  key: string;
  name: string;
  icon: React.ElementType;
  description: string;
}

type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'date'
  | 'time'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'richtext'
  | 'upload'
  | 'cover-upload'
  | 'timezone'
  | 'country';

type FieldDef = {
  key: string;
  label: string;
  type: FieldKind;
  required?: boolean;
  tab?: CompanyInnerTabKey;
  options?: string[];
  fullWidth?: boolean;
  placeholder?: string;
  maxLength?: number;
  maskInSummary?: boolean;
  helperText?: string;
  min?: number;
  max?: number;
  step?: number;
  section?: 'session' | 'password' | 'authentication';
};

const CATEGORY_KEYS = [
  'company',
  'security',
  'office',
  'qr',
  'create_admin',
] as const;

const ATTENDANCE_LOCATION_TABS = new Set<string>(['office', 'qr']);

const COUNTRIES = [
  { code: 'KH', name: 'Cambodia', flag: '🇰🇭' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
];

const TIMEZONES = [
  'Asia/Phnom_Penh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'UTC',
  'America/New_York',
  'Europe/London',
];

const COMPANY_FIELDS: FieldDef[] = [
  { key: 'company.name', label: 'Company Name', type: 'text', required: true, tab: 'general' },
  { key: 'company.legal_name', label: 'Company Legal Name', type: 'text', tab: 'general' },
  {
    key: 'company.short_name',
    label: 'Company Short Name / Abbreviation',
    type: 'text',
    tab: 'general',
  },
  {
    key: 'company.industry_type',
    label: 'Industry Type',
    type: 'select',
    tab: 'general',
    options: ['Technology', 'Finance', 'Healthcare', 'Education', 'Retail', 'Other'],
    placeholder: 'Type your industry…',
  },
  {
    key: 'company.business_type',
    label: 'Business Type',
    type: 'select',
    tab: 'general',
    options: ['Private', 'NGO', 'Government', 'Bank', 'Manufacturing', 'Other'],
    placeholder: 'Type your business type…',
  },
  { key: 'company.founded_date', label: 'Founded Date', type: 'date', tab: 'general' },
  { key: 'company.website', label: 'Website URL', type: 'url', tab: 'general', fullWidth: true },

  {
    key: 'branding.logo',
    label: 'Portal logo',
    type: 'upload',
    tab: 'branding',
    fullWidth: true,
    helperText: 'Shown in the header on the login page and inside the app. PNG, JPG, or SVG. Max 2 MB.',
  },

  { key: 'contact.main_phone', label: 'Main Phone Number', type: 'tel', tab: 'general' },
  { key: 'contact.secondary_phone', label: 'Secondary Phone', type: 'tel', tab: 'general' },
  { key: 'contact.company_email', label: 'Company Email', type: 'email', tab: 'general' },
  { key: 'contact.hr_email', label: 'HR Email', type: 'email', tab: 'general' },
  { key: 'contact.support_email', label: 'Support Email', type: 'email', tab: 'general' },
  { key: 'contact.fax_number', label: 'Fax Number', type: 'text', tab: 'general' },

  { key: 'regional.country', label: 'Default Country', type: 'country', tab: 'regional' },
  { key: 'company.timezone', label: 'Timezone', type: 'timezone', required: true, tab: 'regional' },
  {
    key: 'regional.date_format',
    label: 'Date Format',
    type: 'select',
    tab: 'regional',
    options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
  },
  {
    key: 'regional.time_format',
    label: 'Time Format',
    type: 'select',
    tab: 'regional',
    options: ['12 Hour', '24 Hour'],
  },
  { key: 'company.currency', label: 'Currency', type: 'select', tab: 'regional', options: ['USD', 'KHR', 'EUR'] },
  { key: 'regional.language', label: 'Language', type: 'select', tab: 'regional', options: ['English', 'Khmer'] },
  {
    key: 'regional.week_start',
    label: 'Week Start Day',
    type: 'select',
    tab: 'regional',
    options: ['Monday', 'Sunday'],
  },

  {
    key: 'compliance.registration_number',
    label: 'Company Registration Number',
    type: 'text',
    tab: 'compliance',
    maskInSummary: true,
  },
  { key: 'company.tax_id', label: 'Tax ID / VAT TIN', type: 'text', tab: 'compliance', maskInSummary: true },
  { key: 'compliance.tax_registration_date', label: 'Tax Registration Date', type: 'date', tab: 'compliance' },
  { key: 'compliance.nssf_number', label: 'NSSF Number', type: 'text', tab: 'compliance', maskInSummary: true },
  { key: 'compliance.patent_number', label: 'Patent Number', type: 'text', tab: 'compliance' },
  {
    key: 'compliance.ministry_registration_number',
    label: 'Ministry Registration Number',
    type: 'text',
    tab: 'compliance',
  },
  {
    key: 'compliance.labor_registration_number',
    label: 'Labor Registration Number',
    type: 'text',
    tab: 'compliance',
  },
  {
    key: 'compliance.default_tax_rule',
    label: 'Default Tax Rule',
    type: 'select',
    tab: 'compliance',
    options: ['Progressive', 'Flat', 'Custom'],
  },
  {
    key: 'compliance.exchange_rate_source',
    label: 'Default Currency Exchange Rate Source',
    type: 'select',
    tab: 'compliance',
    options: ['National Bank', 'Manual', 'Provider API'],
  },

  {
    key: 'documents.payslip_footer',
    label: 'Payslip Footer',
    type: 'richtext',
    tab: 'documents',
    maxLength: 1200,
    fullWidth: true,
    helperText: `Used on: ${DOCUMENT_TEMPLATE_COVERAGE.payslipFooter.join('; ')}.`,
  },
  {
    key: 'documents.report_header',
    label: 'Report Header',
    type: 'richtext',
    tab: 'documents',
    maxLength: 1200,
    fullWidth: true,
    helperText: `Used on: ${DOCUMENT_TEMPLATE_COVERAGE.reportHeader.join('; ')}.`,
  },
  {
    key: 'documents.report_footer',
    label: 'Report Footer',
    type: 'richtext',
    tab: 'documents',
    maxLength: 1200,
    fullWidth: true,
    helperText: `Used on: ${DOCUMENT_TEMPLATE_COVERAGE.reportFooter.join('; ')}.`,
  },
  {
    key: 'documents.email_signature',
    label: 'Email Signature Template',
    type: 'richtext',
    tab: 'documents',
    maxLength: 1200,
    fullWidth: true,
    helperText: `Used on: ${DOCUMENT_TEMPLATE_COVERAGE.emailSignature.join('; ')}.`,
  },
];

const SECURITY_FIELDS: FieldDef[] = [
  {
    key: 'security.session_timeout',
    label: 'Session timeout',
    type: 'select',
    required: true,
    options: ['5', '10', '15', '30', '45', '60', '90', '120', '180', '240', 'Other'],
    helperText: 'Minutes of inactivity before the portal signs the user out.',
    section: 'session',
  },
  {
    key: 'security.password_min_length',
    label: 'Minimum Password Length',
    type: 'select',
    required: true,
    options: ['8', '10', '12', '14', '16', '20', 'Other'],
    helperText: 'Recommended minimum: 8 characters.',
    section: 'password',
  },
  {
    key: 'security.password_complexity',
    label: 'Password Complexity',
    type: 'multiselect',
    required: true,
    options: ['Uppercase', 'Lowercase', 'Numbers', 'Special Characters'],
    section: 'password',
  },
  {
    key: 'security.mfa_required',
    label: 'MFA Required',
    type: 'checkbox',
    helperText: 'Require multi-factor authentication during sign in.',
    section: 'authentication',
  },
  {
    key: 'security.login_attempts',
    label: 'Max login attempts',
    type: 'select',
    required: true,
    options: ['1', '2', '3', '4', '5', '6', '8', '10', 'Other'],
    helperText: 'Failed password tries before a temporary lockout.',
    section: 'session',
  },
  {
    key: 'security.locked_period',
    label: 'Lockout period',
    type: 'select',
    required: true,
    options: ['5', '10', '15', '30', '45', '60', '90', '120', '180', '240', 'Other'],
    helperText: 'How long the account stays locked after too many failed attempts.',
    section: 'session',
  },
];

const SECURITY_SECTION_HELP: Record<
  'session' | 'password' | 'authentication',
  RulesConfigHelpId
> = {
  session: 'settings.securitySession',
  password: 'settings.securityPassword',
  authentication: 'settings.securityAuthentication',
};

const SECURITY_SECTIONS: Array<{
  key: 'session' | 'password' | 'authentication';
  title: string;
  description: string;
}> = [
  {
    key: 'session',
    title: 'Session Policy',
    description: 'Idle logout and failed-login lockout for all portal users.',
  },
  {
    key: 'password',
    title: 'Password Policy',
    description: 'Define password length and complexity requirements.',
  },
  {
    key: 'authentication',
    title: 'Authentication',
    description: 'Configure additional sign-in protection.',
  },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w./?%&=-]*)?$/i;
const PHONE_REGEX = /^[+()\-.\d\s]{6,20}$/;

function normalizeSettingValue(type: FieldKind, value: unknown): unknown {
  value = unwrapStoredSettingValue(value);
  if (type === 'multiselect') {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  if (type === 'checkbox') return Boolean(value);
  return value ?? '';
}

function toApiValue(type: FieldKind, value: unknown): unknown {
  if (type === 'multiselect') return Array.isArray(value) ? value : [];
  return value;
}

function hasDiff(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function settingsInputClass(error?: string) {
  return error
    ? 'hcms-field-input border-red-400 focus:border-red-400 focus:ring-red-200/50 dark:focus:ring-red-900/40'
    : 'hcms-field-input';
}

function formatFieldDisplayValue(field: FieldDef, value: unknown): string {
  if (field.type === 'checkbox') {
    return displaySettingText(Boolean(unwrapStoredSettingValue(value)));
  }
  if (field.type === 'multiselect') {
    const raw = unwrapStoredSettingValue(value);
    return Array.isArray(raw) && raw.length > 0 ? raw.map(String).join(', ') : '—';
  }
  if (field.type === 'upload' || field.type === 'cover-upload') {
    return unwrapStoredSettingValue(value) ? 'File uploaded' : '—';
  }
  const text = displaySettingText(value, { masked: field.maskInSummary });
  if (text === '—' || text === '') return text;
  if (field.key === 'security.session_timeout' || field.key === 'security.locked_period') {
    return `${text} minutes`;
  }
  if (field.key === 'security.login_attempts') {
    return `${text} attempts`;
  }
  return text;
}

const RichTextField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}> = ({ value, onChange, maxLength }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
  }, [value]);

  const run = (cmd: string) => {
    document.execCommand(cmd);
    onChange(ref.current?.innerHTML || '');
    ref.current?.focus();
  };

  const toolbarBtnClass =
    'p-1.5 rounded text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-600 dark:bg-slate-900/80">
          <button type="button" aria-label="Bold" onClick={() => run('bold')} className={toolbarBtnClass}>
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Italic" onClick={() => run('italic')} className={toolbarBtnClass}>
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Underline" onClick={() => run('underline')} className={toolbarBtnClass}>
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Create link" onClick={() => run('createLink')} className={toolbarBtnClass}>
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {!preview ? (
        <div
          ref={ref}
          role="textbox"
          aria-multiline
          contentEditable
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          className="min-h-[120px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
        />
      ) : (
        <div className="min-h-[120px] w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-200">
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: value || '<em>No template content</em>' }}
          />
        </div>
      )}
      {maxLength ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {(value || '').length}/{maxLength}
        </p>
      ) : null}
    </div>
  );
};

const SystemSettings: React.FC = () => {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canViewSecurity = hasPermission(PERM.SETTINGS_SECURITY_VIEW);
  const canEditSecurity = hasPermission(PERM.SETTINGS_SECURITY_EDIT);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SystemSettingsData>({});
  const [originalSettings, setOriginalSettings] = useState<SystemSettingsData>({});
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyTab, setCompanyTab] = useUrlSyncedTab<CompanyInnerTabKey>({
    values: ['general', 'branding', 'structure'] as const,
    defaultValue: 'general',
    param: 'companyTab',
  });
  const [uploadingFieldKey, setUploadingFieldKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [otherSelectOpen, setOtherSelectOpen] = useState<Record<string, boolean>>({});
  const [companyProfileEditing, setCompanyProfileEditing] = useState(false);
  const [securityEditing, setSecurityEditing] = useState(false);
  const [defaultPasswordDirty, setDefaultPasswordDirty] = useState(false);
  const defaultPasswordRef = useRef<DefaultPasswordSetupHandle>(null);

  const activeTab = useMemo(() => {
    const tab = searchParams.get('tab');
    if (tab && (CATEGORY_KEYS as readonly string[]).includes(tab)) return tab;
    return 'company';
  }, [searchParams]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (!tab || !(CATEGORY_KEYS as readonly string[]).includes(tab)) {
      navigate(`/settings?tab=${activeTab}`, { replace: true });
      return;
    }
    if (tab === 'security' && !canViewSecurity) {
      navigate('/settings?tab=company', { replace: true });
    }
  }, [searchParams, activeTab, navigate, canViewSecurity]);

  useEffect(() => {
    if (!canEditSecurity && securityEditing) {
      setSecurityEditing(false);
    }
  }, [canEditSecurity, securityEditing]);

  const categories: SettingCategory[] = useMemo(() => {
    const all: SettingCategory[] = [
      { key: 'company', name: 'Company Profile', icon: Building2, description: 'Organization information and login page appearance' },
      { key: 'security', name: 'Security', icon: Shield, description: 'Password policies and session settings' },
      {
        key: 'office',
        name: 'Office location',
        icon: MapPinned,
        description: 'Office geofence point, radius, and zone preview',
      },
      {
        key: 'qr',
        name: 'Generate QR',
        icon: QrCode,
        description: 'Entrance QR display for on-site check-in',
      },
      {
        key: 'create_admin',
        name: 'Create Admin',
        icon: UserPlus,
        description: 'Grant system administrator portal access to an employee',
      },
    ];
    return all.filter((cat) => cat.key !== 'security' || canViewSecurity);
  }, [canViewSecurity]);

  const settingFields = useMemo(
    () => ({
      company: COMPANY_FIELDS,
      security: SECURITY_FIELDS,
    }),
    []
  );

  const getAuthHeaders = () => {
    const storedUser = localStorage.getItem('hcms_user');
    if (!storedUser) return {};

    try {
      const parsedUser = JSON.parse(storedUser);
      return parsedUser?.token ? { Authorization: `Bearer ${parsedUser.token}` } : {};
    } catch {
      return {};
    }
  };

  const exitCompanyEditMode = useCallback(() => {
    setCompanyProfileEditing(false);
    setSettings({ ...originalSettings });
    setFieldErrors({});
    setOtherSelectOpen({});
  }, [originalSettings]);

  const exitSecurityEditMode = useCallback(() => {
    setSecurityEditing(false);
    setSettings({ ...originalSettings });
    setFieldErrors({});
    defaultPasswordRef.current?.reset();
    setDefaultPasswordDirty(false);
  }, [originalSettings]);

  const companyTabPrevRef = useRef(companyTab);

  useEffect(() => {
    if (activeTab !== 'company') {
      setCompanyProfileEditing(false);
    }
    if (activeTab !== 'security') {
      setSecurityEditing(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'company') return;
    if (companyTabPrevRef.current === companyTab) return;
    companyTabPrevRef.current = companyTab;
    exitCompanyEditMode();
  }, [companyTab, activeTab, exitCompanyEditMode]);

  const tabCache = useWorkspaceTabCache<{
    settings: SystemSettingsData;
    originalSettings: SystemSettingsData;
    companyTab: CompanyInnerTabKey;
  }>({
    slot: 'system-settings-v1',
    cacheKey: activeTab,
    getSnapshot: () => ({ settings, originalSettings, companyTab }),
    applySnapshot: (cached) => {
      setSettings(cached.settings);
      setOriginalSettings(cached.originalSettings);
      setCompanyTab(cached.companyTab);
      setLoading(false);
    },
    shouldPersist: (cached) => Object.keys(cached.settings).length > 0,
    persistDeps: [settings, originalSettings, companyTab, activeTab],
  });

  const loadSettings = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (activeTab === 'create_admin' || ATTENDANCE_LOCATION_TABS.has(activeTab)) {
      setLoading(false);
      return;
    }
    if (activeTab === 'security' && !canViewSecurity) {
      setLoading(false);
      return;
    }
    try {
      if (!opts?.background) setLoading(true);
      const currentFields = settingFields[activeTab as keyof typeof settingFields] || [];
      const fieldTypeByKey = new Map(currentFields.map((field) => [field.key, field.type]));
      const formattedSettings: SystemSettingsData = {};
      const organizationSettingsUrl =
        activeTab === 'company'
          ? `${API_BASE_URL}/settings/company`
          : activeTab === 'security'
            ? `${API_BASE_URL}/settings/security-policy`
            : null;

      if (organizationSettingsUrl) {
        const response = await fetch(organizationSettingsUrl, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Unable to load settings');
        const data = await response.json();
        const flat = (data.settings ?? {}) as Record<string, unknown>;
        for (const field of currentFields) {
          formattedSettings[field.key] = normalizeSettingValue(field.type, flat[field.key]);
        }
        if (activeTab === 'company' && flat['company.timezone'] != null) {
          setCompanyTimezone(flat['company.timezone']);
        }
      } else {
        const response = await fetch(`${API_BASE_URL}/settings/global`, {
          headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Unable to load settings');

        const data = await response.json();
        const settingsList = Array.isArray(data) ? data : data.data || [];
        const visibleSettings = settingsList.filter(
          (setting: any) =>
            setting.category === activeTab || String(setting.key || '').startsWith(`${activeTab}.`)
        );
        visibleSettings.forEach((setting: any) => {
          const type = fieldTypeByKey.get(setting.key) || 'text';
          formattedSettings[setting.key] = normalizeSettingValue(type, setting.value);
        });
        for (const field of currentFields) {
          if (!(field.key in formattedSettings)) {
            formattedSettings[field.key] = normalizeSettingValue(field.type, undefined);
          }
        }
      }

      setSettings(formattedSettings);
      setOriginalSettings({ ...formattedSettings });
      setFieldErrors({});
      if (activeTab === 'security') {
        setPortalPasswordPolicy(portalPasswordPolicyFromSecuritySettings(formattedSettings));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      if (!opts?.background) showToast('Failed to load settings', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [activeTab, showToast, canViewSecurity]);

  useWorkspaceTabMountLoad(
    loadSettings,
    [loadSettings, activeTab],
    tabCache,
    activeTab !== 'create_admin' &&
      !ATTENDANCE_LOCATION_TABS.has(activeTab) &&
      !(activeTab === 'security' && !canViewSecurity)
  );

  const organizationSettingsUrl =
    activeTab === 'company'
      ? `${API_BASE_URL}/settings/company`
      : activeTab === 'security'
        ? `${API_BASE_URL}/settings/security-policy`
        : null;

  const saveSetting = async (key: string, value: any) => {
    const saveUrl = organizationSettingsUrl ?? `${API_BASE_URL}/settings/global`;
    try {
      setSaving(true);
      const response = await fetch(saveUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ key, value }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Save failed');
      }
      if (data.success) {
        const next = { ...settings, [key]: value } as Record<string, unknown>;
        setSettings((prev) => ({ ...prev, [key]: value }));
        if (key === 'company.timezone') setCompanyTimezone(value);
        if (
          key === 'regional.language' ||
          key === 'regional.date_format' ||
          key === 'regional.time_format' ||
          key === 'regional.week_start' ||
          key === 'regional.country'
        ) {
          setCompanyLocaleFromSettings(next);
        }
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (error) {
      console.error('Error saving setting:', error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const updateDraftValue = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateFields = (fields: FieldDef[]): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const value = settings[field.key];
      const asText = String(value ?? '').trim();
      const isEmpty =
        value == null ||
        asText === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (field.type === 'checkbox' && value === false && field.required);
      if (field.required && isEmpty) {
        errors[field.key] = `${field.label} is required`;
        continue;
      }
      if (!isEmpty && field.type === 'email' && !EMAIL_REGEX.test(asText)) {
        errors[field.key] = 'Invalid email format';
      }
      if (!isEmpty && field.type === 'url' && !URL_REGEX.test(asText)) {
        errors[field.key] = 'Invalid URL format';
      }
      if (!isEmpty && field.type === 'tel' && !PHONE_REGEX.test(asText)) {
        errors[field.key] = 'Invalid phone number';
      }
      if (!isEmpty && field.type === 'date' && Number.isNaN(new Date(asText).getTime())) {
        errors[field.key] = 'Invalid date';
      }
      if (
        field.key === 'security.session_timeout' ||
        field.key === 'security.password_min_length' ||
        field.key === 'security.login_attempts' ||
        field.key === 'security.locked_period'
      ) {
        const num = Number(asText);
        if (!Number.isFinite(num) || num <= 0) {
          errors[field.key] = 'Please enter a valid positive number';
          continue;
        }
        if (field.key === 'security.password_min_length') {
          if (num < 8) {
            errors[field.key] = 'Minimum password length cannot be below 8';
            continue;
          }
          if (num > 128) {
            errors[field.key] = 'Maximum password length is 128';
            continue;
          }
        }
      }
      if (!isEmpty && field.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          errors[field.key] = 'Invalid number';
          continue;
        }
        if (field.min != null && num < field.min) {
          errors[field.key] = `Minimum allowed value is ${field.min}`;
          continue;
        }
        if (field.max != null && num > field.max) {
          errors[field.key] = `Maximum allowed value is ${field.max}`;
          continue;
        }
      }
      if (field.key === 'security.password_complexity' && (!Array.isArray(value) || value.length === 0)) {
        errors[field.key] = 'Select at least one complexity requirement';
      }
      if (field.maxLength && field.type !== 'upload' && field.type !== 'cover-upload' && asText.length > field.maxLength) {
        errors[field.key] = `Maximum ${field.maxLength} characters`;
      }
    }
    return errors;
  };

  const handleSaveAll = async () => {
    const allCategoryFields = settingFields[activeTab as keyof typeof settingFields] || [];
    const tabFields =
      activeTab === 'company'
        ? allCategoryFields.filter((field) => field.tab === companyTab)
        : allCategoryFields;
    const validationErrors = validateFields(tabFields);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      showToast('Please fix validation errors before saving', 'error');
      return;
    }

    const changed = tabFields.filter((field) =>
      hasDiff(
        toApiValue(field.type, settings[field.key]),
        toApiValue(field.type, originalSettings[field.key])
      )
    );
    const passwordDirty =
      activeTab === 'security' &&
      (defaultPasswordDirty || Boolean(defaultPasswordRef.current?.isDirty()));

    if (changed.length === 0 && !passwordDirty) {
      showToast('No changes to save', 'warning');
      return;
    }

    try {
      setSavingAll(true);

      if (passwordDirty) {
        const passwordOk = await defaultPasswordRef.current!.save();
        if (!passwordOk) return;
        setDefaultPasswordDirty(false);
      }

      if (changed.length > 0) {
        if (organizationSettingsUrl) {
          const bulk: Record<string, unknown> = {};
          for (const field of changed) {
            bulk[field.key] = toApiValue(field.type, settings[field.key]);
          }
          const response = await fetch(organizationSettingsUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ settings: bulk }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.message || data.error || 'Save failed');
          }
          if (Object.prototype.hasOwnProperty.call(bulk, 'company.timezone')) {
            setCompanyTimezone(bulk['company.timezone']);
          }
        } else {
          await Promise.all(
            changed.map((field) => saveSetting(field.key, toApiValue(field.type, settings[field.key])))
          );
        }
        setOriginalSettings(settings);
        if (activeTab === 'security') {
          setPortalPasswordPolicy(portalPasswordPolicyFromSecuritySettings(settings));
          void refreshPortalPasswordPolicy();
        }
        if (activeTab === 'company') {
          setCompanyProfileEditing(false);
          const brandingKeys = new Set(['branding.logo']);
          const documentTemplateKeys = new Set([
            'documents.payslip_footer',
            'documents.report_header',
            'documents.report_footer',
            'documents.email_signature',
            'company.name',
            'company.legal_name',
            'company.short_name',
          ]);
          if (changed.some((field) => brandingKeys.has(field.key))) {
            invalidatePortalBrandingCache();
          }
          if (changed.some((field) => documentTemplateKeys.has(field.key))) {
            invalidateDocumentBrandingCache();
          }
        }
      }

      if (activeTab === 'security') {
        setSecurityEditing(false);
      }
      if (changed.length > 0) {
        showToast('Settings updated successfully', 'success');
      }
      // Default-password-only saves already toast from DefaultPasswordSetupPanel.
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSavingAll(false);
    }
  };

  const handleReset = () => {
    setSettings(originalSettings);
    setFieldErrors({});
    if (activeTab === 'security') {
      defaultPasswordRef.current?.reset();
      setDefaultPasswordDirty(false);
    }
    showToast('Changes reset', 'warning');
  };

  const renderReadOnlyField = (field: FieldDef) => {
    const value = settings[field.key];
    if (field.type === 'upload' || field.type === 'cover-upload') {
      const src = String(value || '');
      if (!src) {
        return (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            No file uploaded
          </div>
        );
      }
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <img
            src={resolveMediaUrl(src) || src}
            alt={field.label}
            className={
              field.type === 'cover-upload'
                ? 'h-40 w-full rounded-lg object-cover'
                : 'h-20 w-auto object-contain rounded'
            }
          />
        </div>
      );
    }
    if (field.type === 'richtext') {
      const html = String(value || '').trim();
      return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 min-h-[2.5rem] dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
          {html ? (
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="text-slate-500 dark:text-slate-400">—</span>
          )}
        </div>
      );
    }
    return <>{formatFieldDisplayValue(field, value)}</>;
  };

  const renderUploadField = (field: FieldDef) => {
    const value = String(settings[field.key] || '');
    const previewSrc = resolveMediaUrl(value) || value;
    const isCover = field.type === 'cover-upload';
    const isUploading = uploadingFieldKey === field.key;
    const brandingKind = field.key === 'branding.front_cover' ? 'front_cover' : 'logo';

    const onFile = async (file: File | null) => {
      if (!file) return;
      const allowed = isCover
        ? ['image/png', 'image/jpeg', 'image/webp']
        : ['image/png', 'image/jpeg', 'image/svg+xml'];
      const maxBytes = isCover ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
      if (!allowed.includes(file.type)) {
        setFieldErrors((prev) => ({
          ...prev,
          [field.key]: isCover
            ? 'Only PNG, JPG, or WEBP files are allowed'
            : 'Only PNG, JPG, SVG files are allowed',
        }));
        showToast('Invalid file format', 'error');
        return;
      }
      if (file.size > maxBytes) {
        setFieldErrors((prev) => ({
          ...prev,
          [field.key]: isCover ? 'File must be under 5MB' : 'File must be under 2MB',
        }));
        showToast('File too large', 'error');
        return;
      }

      setUploadingFieldKey(field.key);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field.key];
        return next;
      });

      try {
        const result = await Api.system.uploadBrandingAsset(file, brandingKind);
        updateDraftValue(field.key, result.url);
        showToast(isCover ? 'Front cover uploaded' : 'Logo uploaded', 'success');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Upload failed';
        setFieldErrors((prev) => ({ ...prev, [field.key]: msg }));
        showToast(msg, 'error');
      } finally {
        setUploadingFieldKey(null);
      }
    };

    const accept = isCover
      ? '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
      : '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml';
    const hint = isCover ? 'PNG/JPG/WEBP, max 5MB' : 'PNG/JPG/SVG, max 2MB';

    return (
      <div className="space-y-2">
        <label
          htmlFor={`upload-${field.key}`}
          className={`block rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center hover:border-primary-400 hover:bg-primary-50/30 transition-colors dark:border-slate-600 dark:bg-slate-900/40 ${
            isUploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (isUploading) return;
            const file = e.dataTransfer.files?.[0] || null;
            void onFile(file);
          }}
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 mx-auto text-primary-600 mb-2 animate-spin" />
          ) : (
            <Upload className="w-5 h-5 mx-auto text-slate-500 mb-2" />
          )}
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {isUploading ? 'Uploading…' : 'Drag & drop or click to upload'}
          </p>
          <p className="text-xs text-slate-500 mt-1">{hint}</p>
        </label>
        <input
          id={`upload-${field.key}`}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={isUploading}
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
        {value ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <img
              src={previewSrc}
              alt={field.label}
              className={
                isCover
                  ? 'h-40 w-full rounded-lg object-cover'
                  : 'h-20 w-auto object-contain rounded'
              }
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => updateDraftValue(field.key, '')}
                disabled={isUploading}
                className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
            No file uploaded
          </div>
        )}
      </div>
    );
  };

  const renderField = (field: FieldDef) => {
    const value = settings[field.key] || '';
    const setValue = (newValue: any) => updateDraftValue(field.key, newValue);
    const error = mergedFieldErrors[field.key];

    switch (field.type) {
      case 'text':
      case 'tel':
      case 'email':
      case 'url':
        return (
          <>
            <input
              id={`field-${field.key}`}
              type={field.type}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={settingsInputClass(error)}
              required={field.required}
              placeholder={field.placeholder}
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        );

      case 'number': {
        const numKind = field.step ? ('decimal' as const) : ('integer' as const);
        return (
          <>
            <input
              id={`field-${field.key}`}
              {...numericInputAttrs(numKind)}
              value={value}
              onChange={(e) => {
                const cleaned = filterInputChange(
                  numKind,
                  e.target.value,
                  field.step ? { maxDecimals: 2 } : undefined
                );
                setValue(field.step ? parseFloat(cleaned) : parseInt(cleaned, 10) || 0);
              }}
              min={field.min}
              max={field.max}
              className={settingsInputClass(error)}
              required={field.required}
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        );
      }

      case 'time':
      case 'date':
        return (
          <>
            <input
              id={`field-${field.key}`}
              type={field.type}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={settingsInputClass(error)}
              required={field.required}
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        );

      case 'timezone':
        return (
          <>
            <input
              id={`field-${field.key}`}
              list="timezone-list"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={settingsInputClass(error)}
              required={field.required}
              aria-label={field.label}
            />
            <datalist id="timezone-list">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </>
        );

      case 'country':
        return (
          <select
            id={`field-${field.key}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="hcms-field-input"
          >
            <option value="" disabled hidden>Select country...</option>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={`${country.flag} ${country.name}`}>
                {country.flag} {country.name}
              </option>
            ))}
          </select>
        );

      case 'select':
        {
          const supportsOther = Boolean(field.options?.includes('Other'));
          const rawValue = String(value ?? '');
          const presetOptions = (field.options || []).filter((o) => o !== 'Other');
          const isPreset = presetOptions.includes(rawValue);
          const selectValue =
            supportsOther && (otherSelectOpen[field.key] || (rawValue !== '' && !isPreset))
              ? '__other__'
              : rawValue;

          return (
            <div className="space-y-2">
              {supportsOther && selectValue === '__other__' ? (
                <input
                  id={`field-${field.key}`}
                  type="text"
                  value={rawValue}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={() => {
                    if (!String(rawValue || '').trim()) {
                      setOtherSelectOpen((prev) => ({ ...prev, [field.key]: false }));
                    }
                  }}
                  maxLength={field.maxLength ?? 120}
                  className="hcms-field-input"
                  placeholder={field.placeholder ?? 'Type custom text…'}
                />
              ) : (
                <select
                  id={`field-${field.key}`}
                  value={selectValue}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '__other__') {
                      setOtherSelectOpen((prev) => ({ ...prev, [field.key]: true }));
                      if (isPreset) setValue('');
                      return;
                    }
                    setOtherSelectOpen((prev) => ({ ...prev, [field.key]: false }));
                    setValue(next);
                  }}
                  className="hcms-field-input"
                  required={field.required}
                >
                  <option value="" disabled hidden>Select...</option>
                  {presetOptions.map((option: string) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                  <option value="__other__">Other</option>
                </select>
              )}
            </div>
          );
        }

      case 'multiselect':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {field.options?.map((option: string) => (
              <label
                key={option}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200"
              >
                <span>{option}</span>
                <input
                  type="checkbox"
                  checked={Array.isArray(value) ? value.includes(option) : false}
                  onChange={(e) => {
                    const currentValues = Array.isArray(value) ? value : [];
                    const newValues = e.target.checked
                      ? [...currentValues, option]
                      : currentValues.filter((v: string) => v !== option);
                    setValue(newValues);
                  }}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
              </label>
            ))}
          </div>
        );

      case 'checkbox':
        return (
          <button
            id={`field-${field.key}`}
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => setValue(!Boolean(value))}
            className={`inline-flex w-14 h-8 items-center rounded-full border-2 transition-colors ${
              Boolean(value)
                ? 'bg-primary-600 border-primary-600'
                : 'bg-slate-300 border-slate-300 dark:bg-slate-600 dark:border-slate-600'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
                Boolean(value) ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        );

      case 'upload':
      case 'cover-upload':
        return renderUploadField(field);

      case 'richtext':
        return (
          <RichTextField
            value={String(value || '')}
            onChange={(v) => setValue(field.maxLength ? v.slice(0, field.maxLength) : v)}
            maxLength={field.maxLength}
          />
        );

      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="hcms-field-input"
            required={field.required}
          />
        );
    }
  };

  const currentCategory = categories.find((cat) => cat.key === activeTab);
  const showSettingsFooter = activeTab === 'security';
  const currentFields = (settingFields[activeTab as keyof typeof settingFields] || []).filter((field) =>
    activeTab === 'company' ? field.tab === companyTab : true
  );
  const allCurrentCategoryFields = settingFields[activeTab as keyof typeof settingFields] || [];
  const isCreateAdminTab = activeTab === 'create_admin';
  const isAttendanceLocationTab = ATTENDANCE_LOCATION_TABS.has(activeTab);
  const hasUnsavedChanges = useMemo(() => {
    const fieldsDirty = allCurrentCategoryFields.some((field) =>
      hasDiff(
        toApiValue(field.type, settings[field.key]),
        toApiValue(field.type, originalSettings[field.key])
      )
    );
    return fieldsDirty || (activeTab === 'security' && securityEditing && defaultPasswordDirty);
  }, [
    allCurrentCategoryFields,
    settings,
    originalSettings,
    activeTab,
    securityEditing,
    defaultPasswordDirty,
  ]);
  const { ConfirmDialogHost: UnsavedChangesDialogHost, confirmDiscardIfDirty } =
    useUnsavedChangesGuard({
      isDirty: hasUnsavedChanges,
    });
  const liveValidationErrors = useMemo(() => {
    if (activeTab === 'security' && !securityEditing) return {};
    return validateFields(currentFields);
  }, [activeTab, securityEditing, currentFields, settings]);
  const mergedFieldErrors = useMemo(
    () => ({ ...liveValidationErrors, ...fieldErrors }),
    [liveValidationErrors, fieldErrors]
  );
  const hasValidationErrors = Object.keys(liveValidationErrors).length > 0;

  const renderSecuritySections = () => (
    <div className="space-y-4">
      <DefaultPasswordSetupPanel
        ref={defaultPasswordRef}
        editing={securityEditing}
        onDirtyChange={setDefaultPasswordDirty}
      />
      {SECURITY_SECTIONS.map((section) => {
        const fields = SECURITY_FIELDS.filter((field) => field.section === section.key);
        return (
          <section
            key={section.key}
            className="hcms-settings-section"
            aria-label={section.title}
          >
            <RulesConfigHelp help={SECURITY_SECTION_HELP[section.key]} className="absolute top-3 right-3 z-10" />
            <div className="mb-3 pr-8">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{section.title}</h3>
              {section.description ? (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
              ) : null}
            </div>
            <div
              className={`grid grid-cols-1 gap-4 ${
                section.key === 'session' ? 'sm:grid-cols-3' : 'md:grid-cols-2'
              }`}
            >
              {fields.map((field) => (
                <div
                  key={field.key}
                  className={`space-y-2 ${field.type === 'multiselect' || field.type === 'checkbox' ? 'md:col-span-2' : ''}`}
                >
                  <label className="hcms-field-label" htmlFor={`field-${field.key}`}>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {securityEditing ? (
                    renderField(field)
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 min-h-[2.75rem]">
                      {formatFieldDisplayValue(field, settings[field.key])}
                    </div>
                  )}
                  {securityEditing && mergedFieldErrors[field.key] ? (
                    <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                      {mergedFieldErrors[field.key]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );

  if (isAttendanceLocationTab) {
    return (
      <PageShell className="w-full min-w-0">
        <Suspense fallback={<LoadingState variant="panel" layout="form" label="Loading settings…" />}>
          <AttendanceGeofenceSettings forcedTab={activeTab as 'office' | 'qr'} />
        </Suspense>
      </PageShell>
    );
  }

  return (
    <>
    <UnsavedChangesDialogHost />
    <PageShell className="w-full min-w-0">
      {/* Section switch lives in the Settings sidebar */}
      <div className="min-w-0">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            {/* Category Header */}
            <div
              className={`p-4 sm:p-6 ${activeTab === 'company' ? 'pb-4 border-b-0' : 'border-b border-slate-200 dark:border-slate-700'}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center space-x-2 min-w-0">
                    {currentCategory && <currentCategory.icon className="w-5 h-5 shrink-0" />}
                    <span className="truncate">{currentCategory?.name}</span>
                  </h2>
                  {isCreateAdminTab ? (
                    <InfoDetailsButton
                      title="System administrator (not an employee)"
                      summary="This creates a portal login only — no HR employee record, no attendance/leave/payroll. Sign in with the AdminID (e.g. ADM00001) and password. Staff and managers continue to use their EmpID (e.g. ROC#####)."
                      tips={[
                        'Only grant Admin to trusted staff who manage the system.',
                        'Use a strong unique password; share credentials securely.',
                        'Admin accounts are not part of the employee roster.',
                      ]}
                      ariaLabel="Admin creation guidelines"
                    />
                  ) : (
                    <InfoDetailsButton
                      title="Quick Stats"
                      rows={[
                        {
                          label: 'Total Settings',
                          value: allCurrentCategoryFields.length,
                        },
                        { label: 'Last Updated', value: '2 mins ago' },
                        {
                          label: 'Status',
                          value: (
                            <span className="text-green-600 dark:text-green-400">Active</span>
                          ),
                        },
                      ]}
                      ariaLabel="Quick stats"
                    />
                  )}
                </div>
              </div>
            </div>

            {isCreateAdminTab ? (
              <div className="p-6">
                <CreateAdminTab
                  onCancel={() => {
                    navigate('/settings?tab=company', { replace: true });
                  }}
                />
              </div>
            ) : activeTab === 'company' ? (
              <CompanyProfilePanel
                companyTab={companyTab}
                onTabChange={setCompanyTab}
                editing={companyProfileEditing}
                onStartEdit={() => setCompanyProfileEditing(true)}
                onCancelEdit={() => {
                  void (async () => {
                    if (!(await confirmDiscardIfDirty())) return;
                    exitCompanyEditMode();
                  })();
                }}
                loading={loading}
                saving={savingAll || Boolean(uploadingFieldKey)}
                hasUnsavedChanges={hasUnsavedChanges}
                hasValidationErrors={hasValidationErrors}
                onSave={() => void handleSaveAll()}
                onReset={handleReset}
                fields={currentFields}
                fieldErrors={mergedFieldErrors}
                settings={settings}
                renderEditableField={(field) => renderField(field as FieldDef)}
                renderReadOnlyValue={(field) => renderReadOnlyField(field as FieldDef)}
              />
            ) : activeTab === 'security' && canViewSecurity ? (
              <>
                <div className="p-6 space-y-6">
                  {loading ? (
                    <ContentSkeleton layout="form" rows={2} />
                  ) : (
                    renderSecuritySections()
                  )}
                </div>

                {showSettingsFooter ? (
                  <div className="sticky bottom-0 z-10 border-t border-slate-200/90 dark:border-slate-700/80 hcms-sticky-footer p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {!securityEditing ? (
                          <span className="inline-flex items-center gap-1">
                            {canEditSecurity ? (
                              <>
                                Select{' '}
                                <span className="font-medium text-slate-700 dark:text-slate-300">Edit</span> to
                                update security settings.
                              </>
                            ) : (
                              <>You can view Security settings. Editing requires the Edit Security Settings permission.</>
                            )}
                          </span>
                        ) : hasUnsavedChanges ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <Loader2 className="w-3.5 h-3.5" />
                            Unsaved changes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <Check className="w-3.5 h-3.5" />
                            All changes saved
                          </span>
                        )}
                      </div>
                      <div className="flex justify-end space-x-3">
                        {!securityEditing ? (
                          canEditSecurity ? (
                            <button
                              type="button"
                              onClick={() => setSecurityEditing(true)}
                              className="px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 flex items-center space-x-2"
                            >
                              <Pencil className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              View only — you do not have permission to edit Security settings.
                            </span>
                          )
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void (async () => {
                                  if (!(await confirmDiscardIfDirty())) return;
                                  exitSecurityEditMode();
                                })();
                              }}
                              className="px-4 py-2 text-slate-700 bg-slate-100 dark:bg-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center space-x-2"
                            >
                              <X className="w-4 h-4" />
                              <span>Cancel</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleReset}
                              disabled={!hasUnsavedChanges || savingAll}
                              className="px-4 py-2 text-slate-700 bg-slate-100 dark:bg-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveAll()}
                              disabled={!hasUnsavedChanges || savingAll || hasValidationErrors}
                              className="px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 flex items-center space-x-2 disabled:opacity-50"
                            >
                              {savingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              <span>Save Changes</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
      </div>
    </PageShell>
    </>
  );
};

export default SystemSettings;
