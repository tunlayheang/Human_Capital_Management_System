
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useFieldArray, useWatch, SubmitHandler, type FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { 
  ArrowLeft, Zap, User, Phone, Briefcase, DollarSign, Users, Heart,
  FileText, FolderOpen, ChevronRight, ChevronLeft, CheckCircle2, Save, AlertCircle, Loader2, Sparkles, Clock, X
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceTabTitle } from '../hooks/useWorkspaceTabTitle';
import { useWorkspaceTabCache } from '../hooks/useWorkspaceTabCache';
import { Api } from '../services/api';
import {
  Role,
  type AllowanceTemplate,
  type AllowanceType,
  type LeaveApproverDepartment,
  type Position,
} from '../types';
import { validatePositionSalaryValue } from '../utils/positionSalary';
import { isActiveFlag } from '../utils/entityActive';
import {
  normalizeContractCurrency,
  khrToUsd,
  usdToKhr,
} from '../utils/contractMoney';
import { normalizeAccessRole } from '../utils/accessRole';
import { resolveMediaUrl } from '../utils/mediaUrl';
import {
  BIRTH_DATE_FUTURE_MESSAGE,
  isFutureCompanyDate,
  todayYmdInCompanyTz,
} from '../utils/companyCalendar';
import { joinPersonNameParts } from '../utils/personDisplayName';
import { normalizeEmployeeDisplayId } from '../utils';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { calculatePayrollForUser } from '../services/cambodiaTax';
import {
  applyAllowanceEngineToBreakdown,
  pickBestAllowanceTemplate,
} from '../utils/allowancePayPreview';
import type { WizardSeniorityPreview } from '../utils/seniorityPayPreview';
import {
  normalizeNationalityValue,
  normalizeReligionValue,
  NATIONALITY_PRESET_VALUES,
  RELIGION_PRESET_VALUES,
} from '../constants/khmerPersonalChoices';
import { validateOtherSpecification } from '../utils/selectWithOther';
import { SELECT_OTHER_VALUE } from '../constants/selectOther';
import { DEFAULT_ATTENDANCE_RULES } from '../types/attendance';
import { gracePeriodFromAttendanceSettings } from '../utils/attendanceSettingsDefault';
import { validatePortalPassword } from '../utils/passwordPolicy';
import { usePortalPasswordPolicy } from '../hooks/usePortalPasswordPolicy';
import { readProbationFieldsFromRecord } from '../utils/employeeProbation';
import {
  capPeriodMonthsForEmploymentType,
  defaultPeriodMonthsForEmploymentType,
  engagementEndDate,
  normalizeEmploymentType as normalizeEmploymentTypeFromPeriod,
  resolveWorkerTypeForEmployment,
} from '../utils/employmentPeriod';
import type { PayrollTaxBracket } from '../types';
import {
  CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS,
  type NssfWageBracket,
} from '../utils/nssfAssumedWage';
import {
  complianceRulesToEngineConfig,
  DEFAULT_PAYROLL_ENGINE_CONFIG,
  type PayrollEngineConfig,
} from '../utils/payrollEngineConfig';
import {
  CANONICAL_PAYROLL_TAX_BRACKETS_USD,
  computeTaxOnSalary,
  formatTaxRateForStorage,
  marginalTaxRateForIncome,
  taxBracketRangeForIncome,
} from '../utils/payrollTaxRate';
import {
  resolveExchangeRateKhrPerUsd,
  setPayrollExchangeRateCache,
} from '../utils/payrollExchangeRateCache';
import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../constants/payrollExchangeRate';
import {
  DEFAULT_PAYROLL_BASIS_DAYS,
  normalizePayrollBasisDays,
  type PayrollWorkDayMethod,
} from '../constants/payrollBasisDays';
import { WorkflowWizardShell, type WizardStep } from '../components/workflow/WorkflowWizardShell';
import { WizardFooterLayout } from '../components/workflow/WizardFooterLayout';
import { useAuth } from '../context/AuthContext';

// Import sub-components
import { StepBasics } from '../components/employee-wizard/StepBasics';
import { StepPersonal } from '../components/employee-wizard/StepPersonal';
import { StepJob } from '../components/employee-wizard/StepJob';
import { StepSchedule } from '../components/employee-wizard/StepSchedule';
import type { LeaveAssignmentOption } from '../types';
import {
  findMaternityLeaveTypeId,
  mergeLeaveAssignmentsWithTypes,
} from '../utils/leaveAssignmentDefaults';
import { StepContact } from '../components/employee-wizard/StepContact';
import { StepSalary } from '../components/employee-wizard/StepSalary';
import { StepFamily } from '../components/employee-wizard/StepFamily';
import { StepEmergency } from '../components/employee-wizard/StepEmergency';
import { StepDocuments } from '../components/employee-wizard/StepDocuments';
import { StepReview } from '../components/employee-wizard/StepReview';
import {
  computeTaxDependents,
  encodeSpouseHasWork,
  parseSpouseHasWork,
  type SpouseHasWork,
  isPopulatedChildRow,
} from '../utils/taxDependents';
import {
  inferPaymentMethodFromBank,
  normalizePaymentMethod,
  type PaymentMethod,
} from '../utils/paymentMethod';
import { EMPTY_CHILD_ROW, type EmployeeChildFormRow } from '../types/employeeChild';
import {
  canSaveDraft,
  collectActivationIssueDetails,
  effectiveEmployeeStatus,
  isOnboardingInProgressStatus,
  isOffboardedEmployeeStatus,
} from '../utils/employeeDraft';
import type { EmployeeDocumentRow } from '../types/employeeDocument';
import { checkEmployeeContactConflicts } from '../utils/checkEmployeeContact';
import { registerEmployeeOnboardingGuard } from '../utils/employeeOnboardingGuard';
import { STEP_FIELDS_MAP } from '../utils/employeeWizardStepValidation';

const workEmailSchema = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val).trim()),
  z.union([z.literal(''), z.string().email('Invalid work email')])
);

const optionalUrl = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val).trim()),
  z.union([
    z.literal(''),
    z.string().refine((s) => {
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid URL'),
  ])
);

const optionalText = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val)),
  z.string()
);

const optionalPhone = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val).trim()),
  z.union([
    z.literal(''),
    z
      .string()
      .refine(
        (v) => /^\d{8,11}$/.test(String(v).replace(/\D/g, '')),
        'Enter a valid phone number (digits only)'
      ),
  ])
);

const optionalDigits = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val).trim()),
  z.union([
    z.literal(''),
    z.string().refine((v) => /^\d+$/.test(v), 'Must contain numbers only'),
  ])
);

const optionalTime = z.preprocess(
  (val) => (val === undefined || val === null ? '' : String(val).trim()),
  z.union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format')])
);

// --- ZOD SCHEMA (format validation; mandatory steps enforced on Next) ---
const employeeBaseSchema = z.object({
  id: optionalText,
  firstName: optionalText,
  lastName: optionalText,
  firstNameKh: optionalText,
  lastNameKh: optionalText,
  accessRole: z.nativeEnum(Role).default(Role.EMPLOYEE),
  allowLogin: z.boolean().default(true),
  portalPassword: z.string().optional(),
  email: workEmailSchema,
  gender: optionalText,
  birthDate: optionalText,
  nationality: z.string().optional(),
  ethnicity: z.string().optional(),
  religion: z.string().optional(),
  nationalId: optionalDigits,
  passport: optionalDigits,
  birthCertificate: optionalText,
  departmentId: optionalText,
  position: optionalText,
  employmentType: z.enum(['Full-Time', 'Part-Time', 'Contract', 'Intern']).default('Full-Time'),
  joinDate: optionalText,
  /** Auto-derived from employment type + period (Art. 68); not shown in UI. */
  workerType: z.enum(['regular', 'specialized', 'non_specialized']).default('regular'),
  /** Probation / internship / contract period months (cap depends on employment type). */
  probationPeriodMonths: z.coerce.number().min(0).max(24).default(3),
  /** Computed preview (join + months); kept for display and legacy end-date entry. */
  probationEnd: z.string().optional(),
  workDays: z.coerce.number().min(0).max(7).default(5),
  timeIn: optionalTime,
  timeOut: optionalTime,
  workHours: z.coerce.number().min(0).max(24).default(8),
  breakDurationMinutes: z.coerce.number().min(0).max(180).default(60),
  gracePeriodMinutes: z.coerce.number().min(0).max(120).default(0),
  phone: optionalPhone,
  /** Telegram contact for ID card (optional; separate from login phone). */
  telegramNumber: optionalPhone,
  address: optionalText,
  addressKh: optionalText,
  country: optionalText,
  city: optionalText,
  cityKh: optionalText,
  website: optionalUrl,
  basicSalary: z.coerce.number().min(0).default(0),
  payrollBasisDays: z.coerce
    .number()
    .refine((n) => [22, 24, 26].includes(n), 'Payroll basis must be 22, 24, or 26 days')
    .default(26),
  currency: z.enum(['USD', 'KHR']).default('USD'),
  paymentMethod: z.enum(['bank', 'cash']).default('bank'),
  bankName: optionalText,
  bankAccount: optionalDigits,
  nssfEnrolled: z.boolean().default(true),
  allowanceTemplateId: z.string().optional().default(''),
  maritalStatus: z.enum(['single', 'married']).default('single'),
  spouseName: z.string().optional(),
  spouseNameKh: optionalText,
  spouseHasWork: z.enum(['yes', 'no']).optional(),
  spousePhone: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{8,11}$/.test(String(v).replace(/\D/g, '')), 'Enter a valid spouse phone'),
  children: z
    .array(
      z.object({
        name: optionalText,
        nameKh: optionalText,
        age: optionalText,
        gender: optionalText,
        occupation: optionalText,
        hasJob: z.enum(['yes', 'no']).default('no'),
      })
    )
    .default([]),
  emergencyName: optionalText,
  emergencyNameKh: optionalText,
  emergencyRelation: optionalText,
  emergencyRelationKh: optionalText,
  emergencyPhone: optionalPhone,
  leaveAssignments: z.record(z.string(), z.boolean()).default({}),
});

type PositionSalaryLookup = (
  positionId: string
) => Pick<Position, 'title' | 'salaryMin' | 'salaryMax' | 'salary'> | undefined;

function buildEmployeeSchema(
  _isEdit: boolean,
  excludeEmployeeDisplayId?: string,
  resolvePosition?: PositionSalaryLookup,
  exchangeRateKhrPerUsd = PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
) {
  return employeeBaseSchema
    .superRefine((data, ctx) => {
      const posId = String(data.position ?? '').trim();
      if (!posId || !resolvePosition) return;
      const pos = resolvePosition(posId);
      if (!pos) return;
      const salaryUsd = Number(data.basicSalary) || 0;
      const rangeResult = validatePositionSalaryValue(salaryUsd, pos);
      if (rangeResult !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: rangeResult,
          path: ['basicSalary'],
        });
      }
    })
    .superRefine((data, ctx) => {
      if (isFutureCompanyDate(data.birthDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: BIRTH_DATE_FUTURE_MESSAGE,
          path: ['birthDate'],
        });
      }
    })
    .superRefine((data, ctx) => {
      if (String(data.nationality ?? '').trim()) {
        const nationalityErr = validateOtherSpecification(
          data.nationality,
          NATIONALITY_PRESET_VALUES,
          'Please specify nationality (select Other, type, and press Enter)'
        );
        if (nationalityErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: nationalityErr,
            path: ['nationality'],
          });
        }
      }

      if (String(data.religion ?? '').trim()) {
        const religionErr = validateOtherSpecification(
          data.religion,
          RELIGION_PRESET_VALUES,
          'Please specify religion (select Other, type, and press Enter)'
        );
        if (religionErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: religionErr,
            path: ['religion'],
          });
        }
      }

      if (String(data.emergencyRelation ?? '').trim()) {
        const relationErr = validateOtherSpecification(
          data.emergencyRelation,
          ['Spouse', 'Parent', 'Sibling', 'Child', 'Friend', SELECT_OTHER_VALUE],
          'Please specify relationship'
        );
        if (relationErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: relationErr,
            path: ['emergencyRelation'],
          });
        }
      }

      if (!data.allowLogin) return;
      const pwd = String(data.portalPassword || '').trim();
      if (pwd) {
        const check = validatePortalPassword(pwd);
        if (!check.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.message,
            path: ['portalPassword'],
          });
        }
      }
    })
    .superRefine(async (data, ctx) => {
      const email = String(data.email ?? '').trim();
      const phone = String(data.phone ?? '').trim();
      if (!email && !phone) return;
      const excludeId = excludeEmployeeDisplayId?.trim() || String(data.id ?? '').trim();
      const conflicts = await checkEmployeeContactConflicts({
        email,
        phone,
        excludeEmployeeId: excludeId || undefined,
      });
      for (const c of conflicts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: c.message,
          path: [c.field],
        });
      }
    });
}

/** Lighter validation for incremental profile saves — skips salary range when pay is unset. */
function buildPartialSaveSchema(
  excludeEmployeeDisplayId?: string,
  resolvePosition?: PositionSalaryLookup,
  exchangeRateKhrPerUsd = PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
) {
  return employeeBaseSchema
    .superRefine((data, ctx) => {
      const posId = String(data.position ?? '').trim();
      const salaryUsd = Number(data.basicSalary) || 0;
      if (salaryUsd <= 0 || !posId || !resolvePosition) return;
      const pos = resolvePosition(posId);
      if (!pos) return;
      const rangeResult = validatePositionSalaryValue(salaryUsd, pos);
      if (rangeResult !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: rangeResult,
          path: ['basicSalary'],
        });
      }
    })
    .superRefine((data, ctx) => {
      if (isFutureCompanyDate(data.birthDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: BIRTH_DATE_FUTURE_MESSAGE,
          path: ['birthDate'],
        });
      }
    })
    .superRefine((data, ctx) => {
      if (String(data.nationality ?? '').trim()) {
        const nationalityErr = validateOtherSpecification(
          data.nationality,
          NATIONALITY_PRESET_VALUES,
          'Please specify nationality (select Other, type, and press Enter)'
        );
        if (nationalityErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: nationalityErr,
            path: ['nationality'],
          });
        }
      }

      if (String(data.religion ?? '').trim()) {
        const religionErr = validateOtherSpecification(
          data.religion,
          RELIGION_PRESET_VALUES,
          'Please specify religion (select Other, type, and press Enter)'
        );
        if (religionErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: religionErr,
            path: ['religion'],
          });
        }
      }

      if (String(data.emergencyRelation ?? '').trim()) {
        const relationErr = validateOtherSpecification(
          data.emergencyRelation,
          ['Spouse', 'Parent', 'Sibling', 'Child', 'Friend', SELECT_OTHER_VALUE],
          'Please specify relationship'
        );
        if (relationErr) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: relationErr,
            path: ['emergencyRelation'],
          });
        }
      }

      if (!data.allowLogin) return;
      const pwd = String(data.portalPassword || '').trim();
      if (pwd) {
        const check = validatePortalPassword(pwd);
        if (!check.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: check.message,
            path: ['portalPassword'],
          });
        }
      }
    })
    .superRefine(async (data, ctx) => {
      const email = String(data.email ?? '').trim();
      const phone = String(data.phone ?? '').trim();
      if (!email && !phone) return;
      const excludeId = excludeEmployeeDisplayId?.trim() || String(data.id ?? '').trim();
      const conflicts = await checkEmployeeContactConflicts({
        email,
        phone,
        excludeEmployeeId: excludeId || undefined,
      });
      for (const c of conflicts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: c.message,
          path: [c.field],
        });
      }
    });
}

function zodErrorToFieldErrors(error: z.ZodError): FieldErrors<EmployeeFormValues> {
  const out: FieldErrors<EmployeeFormValues> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== 'string') continue;
    (out as Record<string, { message: string; type: string }>)[key] = {
      message: issue.message,
      type: issue.code,
    };
  }
  return out;
}

async function validatePartialProfileSave(
  values: EmployeeFormValues,
  options: {
    excludeEmployeeDisplayId?: string;
    resolvePosition?: PositionSalaryLookup;
    exchangeRateKhrPerUsd?: number;
  }
): Promise<{ ok: true } | { ok: false; errors: FieldErrors<EmployeeFormValues> }> {
  const schema = buildPartialSaveSchema(
    options.excludeEmployeeDisplayId,
    options.resolvePosition,
    options.exchangeRateKhrPerUsd
  );
  const result = await schema.safeParseAsync(values);
  if (result.success) return { ok: true as const };
  return { ok: false as const, errors: zodErrorToFieldErrors(result.error) };
}

export type EmployeeFormValues = z.infer<typeof employeeBaseSchema>;

const FIELD_TO_STEP: Partial<Record<keyof EmployeeFormValues, number>> = {
  id: 0,
  firstName: 0,
  lastName: 0,
  firstNameKh: 0,
  lastNameKh: 0,
  email: 0,
  phone: 0,
  telegramNumber: 0,
  accessRole: 0,
  allowLogin: 0,
  portalPassword: 0,
  gender: 1,
  birthDate: 1,
  nationality: 1,
  ethnicity: 1,
  religion: 1,
  nationalId: 1,
  passport: 1,
  birthCertificate: 1,
  // avatar validated at activation via avatarPreview
  departmentId: 2,
  position: 2,
  employmentType: 2,
  joinDate: 2,
  workerType: 2,
  probationPeriodMonths: 2,
  probationEnd: 2,
  workDays: 3,
  timeIn: 3,
  timeOut: 3,
  workHours: 3,
  breakDurationMinutes: 3,
  gracePeriodMinutes: 3,
  address: 4,
  addressKh: 4,
  country: 4,
  city: 4,
  cityKh: 4,
  website: 4,
  maritalStatus: 5,
  spouseName: 5,
  spouseNameKh: 5,
  spouseHasWork: 5,
  spousePhone: 5,
  children: 5,
  basicSalary: 6,
  currency: 6,
  paymentMethod: 6,
  bankName: 6,
  bankAccount: 6,
  nssfEnrolled: 6,
  allowanceTemplateId: 6,
  emergencyName: 7,
  emergencyNameKh: 7,
  emergencyRelation: 7,
  emergencyRelationKh: 7,
  emergencyPhone: 7,
};

function flattenErrorMessages(errors: FieldErrors<EmployeeFormValues>): string[] {
  const out: string[] = [];
  const walk = (node: unknown, label?: string) => {
    if (!node || typeof node !== 'object') return;
    const maybe = node as { message?: unknown };
    if (typeof maybe.message === 'string') {
      out.push(label ? `${label}: ${maybe.message}` : maybe.message);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, label ?? key);
    }
  };
  walk(errors);
  return out;
}

function firstStepWithActivationIssues(
  fieldErrors: FieldErrors<EmployeeFormValues>
): number | null {
  const steps: number[] = [];
  for (const [field, step] of Object.entries(FIELD_TO_STEP)) {
    if (fieldErrors[field as keyof EmployeeFormValues] != null && step != null) {
      steps.push(step);
    }
  }
  if (steps.length === 0) return null;
  return Math.min(...steps);
}

function firstActivationFieldToFocus(
  fieldErrors: FieldErrors<EmployeeFormValues>
): keyof EmployeeFormValues | null {
  for (const field of Object.keys(FIELD_TO_STEP) as (keyof EmployeeFormValues)[]) {
    if (fieldErrors[field] != null) return field;
  }
  return null;
}

function formatIsoDate(val: unknown): string {
  if (val == null || val === '') return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return todayYmdInCompanyTz(parsed);
    return '';
  }
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    return todayYmdInCompanyTz(val);
  }
  const asString = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) return asString.slice(0, 10);
  return '';
}

const EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Contract', 'Intern'] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

function normalizeEmploymentType(raw: unknown): EmploymentType {
  return normalizeEmploymentTypeFromPeriod(raw) as EmploymentType;
}

function normalizeCurrency(raw: unknown): 'USD' | 'KHR' {
  const s = String(raw ?? 'USD').trim().toUpperCase();
  return s === 'KHR' ? 'KHR' : 'USD';
}

/** Persist empty optional text as null so updates clear fields instead of omitting them. */
function optionalTextField(val?: string | null): string | null {
  const s = String(val ?? '').trim();
  return s || null;
}

function optionalKhmerField(val?: string | null): string | null {
  return optionalTextField(val);
}

/** Strip secrets before caching wizard state across workspace tab switches. */
function sanitizeEmployeeFormCacheValues(values: EmployeeFormValues): EmployeeFormValues {
  return { ...values, portalPassword: '' };
}

type EmployeeInputFormCache = {
  values: EmployeeFormValues;
  baseline: EmployeeFormValues;
  currentStep: number;
  avatarPreview: string | null;
  recordStatus: string | null;
  portalAccountLinked: boolean;
  linkedPortalUserId: string | null;
  wasDirty: boolean;
  lastSavedIso: string | null;
};

function buildEmployeeApiPayload(
  data: EmployeeFormValues,
  avatarPreview: string | null,
  taxBrackets: PayrollTaxBracket[] = CANONICAL_PAYROLL_TAX_BRACKETS_USD,
  options?: {
    isDraft?: boolean;
    activate?: boolean;
    exchangeRateKhrPerUsd?: number;
    /** When Fixed Company Basis is active, force company basis days. */
    payrollBasisDaysOverride?: number;
  }
) {
  const exchangeRate = resolveExchangeRateKhrPerUsd(options?.exchangeRateKhrPerUsd, 'configured');
  const taxDependents = computeTaxDependents(
    data.maritalStatus || 'single',
    data.children ?? [],
    data.maritalStatus === 'married'
      ? (data.spouseHasWork as SpouseHasWork | undefined)
      : undefined
  );
  const marginalRate = marginalTaxRateForIncome(
    Number(data.basicSalary) || 0,
    taxBrackets,
    taxDependents,
    exchangeRate
  );
  const employmentType = normalizeEmploymentType(data.employmentType);
  const probationMonths = capPeriodMonthsForEmploymentType(
    Number(data.probationPeriodMonths ?? defaultPeriodMonthsForEmploymentType(employmentType)),
    employmentType
  );
  const workerType = resolveWorkerTypeForEmployment(employmentType, probationMonths);
  return {
    employee_id: data.id,
    first_name: data.firstName,
    last_name: data.lastName,
    first_name_kh: optionalKhmerField(data.firstNameKh),
    last_name_kh: optionalKhmerField(data.lastNameKh),
    email: data.email || '',
    phone: data.phone,
    telegram_number: optionalTextField(data.telegramNumber),
    street_address: optionalTextField(data.address),
    street_address_kh: optionalKhmerField(data.addressKh),
    country: data.country || 'Cambodia',
    city: optionalTextField(data.city),
    city_kh: optionalKhmerField(data.cityKh),
    gender: data.gender,
    birth_date: data.birthDate,
    nationality: data.nationality,
    ethnicity: optionalTextField(data.ethnicity),
    religion: optionalTextField(data.religion),
    national_id: optionalTextField(data.nationalId),
    passport_number: optionalTextField(data.passport),
    birth_certificate_number: optionalTextField(data.birthCertificate),
    employment_type: employmentType,
    department_id: optionalTextField(data.departmentId),
    position_id: optionalTextField(data.position),
    // Never send blank join_date — empty DatePicker state must not wipe DB on Save.
    join_date: String(data.joinDate ?? '').trim().slice(0, 10) || undefined,
    probation_period_months: probationMonths,
    worker_type: workerType,
    base_salary: data.basicSalary,
    payroll_basis_days:
      options?.payrollBasisDaysOverride ??
      data.payrollBasisDays ??
      DEFAULT_PAYROLL_BASIS_DAYS,
    currency: 'USD',
    payment_method: normalizePaymentMethod(data.paymentMethod),
    bank_name: data.paymentMethod === 'bank' ? optionalTextField(data.bankName) : null,
    bank_account_number:
      data.paymentMethod === 'bank' ? optionalTextField(data.bankAccount) : null,
    tax_id: formatTaxRateForStorage(marginalRate),
    nssf_enrolled: data.nssfEnrolled !== false,
    allowance_template_id: data.allowanceTemplateId?.trim() || null,
    tax_dependents: taxDependents,
    marital_status: data.maritalStatus,
    spouse_name:
      data.maritalStatus === 'married' ? optionalTextField(data.spouseName) : null,
    spouse_name_kh:
      data.maritalStatus === 'married' ? optionalKhmerField(data.spouseNameKh) : null,
    spouse_occupation:
      data.maritalStatus === 'married' && data.spouseHasWork
        ? encodeSpouseHasWork(data.spouseHasWork === 'yes')
        : null,
    spouse_phone:
      data.maritalStatus === 'married' ? optionalTextField(data.spousePhone) : null,
    children: (data.children ?? []).filter(isPopulatedChildRow).map((child, index) => ({
      name: child.name?.trim() || '',
      name_kh: optionalKhmerField(child.nameKh),
      age: child.age != null && String(child.age).trim() !== '' ? Number(child.age) : null,
      gender: child.gender?.trim() || '',
      occupation: child.occupation?.trim() || '',
      hasJob: child.hasJob === 'yes' ? 'yes' : 'no',
      sortOrder: index,
    })),
    emergency_contact_name: optionalTextField(data.emergencyName),
    emergency_contact_name_kh: optionalKhmerField(data.emergencyNameKh),
    emergency_contact_relationship: optionalTextField(data.emergencyRelation),
    emergency_contact_relationship_kh: optionalKhmerField(data.emergencyRelationKh),
    emergency_contact_phone: optionalTextField(data.emergencyPhone),
    avatar_url: optionalTextField(avatarPreview),
    role: data.accessRole,
    accessRole: data.accessRole,
    ...(options?.isDraft
      ? { is_draft: true, status: 'draft' as const, allow_login: false }
      : {
          allow_login: data.allowLogin,
          ...(options?.activate
            ? { status: 'active' as const, activate_profile: true }
            : {}),
          ...(data.allowLogin && data.portalPassword
            ? { portal_password: data.portalPassword }
            : {}),
        }),
    work_days: data.workDays,
    time_in: data.timeIn,
    time_out: data.timeOut,
    work_hours: data.workHours,
    break_duration_minutes: data.breakDurationMinutes,
    grace_period_minutes:
      data.gracePeriodMinutes != null && !Number.isNaN(data.gracePeriodMinutes)
        ? data.gracePeriodMinutes
        : DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes,
    leave_assignments: data.leaveAssignments ?? {},
  };
}

function leaveTypesToAssignmentOptions(
  types: { id: string; name: string; nameKh?: string | null; isPaid?: boolean; daysAllowed?: number }[]
): LeaveAssignmentOption[] {
  return types.map((t) => ({
    leaveTypeId: t.id,
    name: t.name,
    nameKh: t.nameKh ?? null,
    code: t.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    isPaid: t.isPaid !== false,
    daysAllowed: Number(t.daysAllowed ?? 0),
    assigned: false,
  }));
}

export const EmployeeInput: React.FC = () => {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { user: currentUser, refreshUser } = useAuth();
  usePortalPasswordPolicy();
  const { prompt: promptChangeReason, ConfirmDialogHost: SystemConfirmDialogHost } = useConfirmDialog();
  
  const [currentStep, setCurrentStep] = useState(0);
  const [departments, setDepartments] = useState<any[]>([]);
  const [positions, setPositions] = useState<
    Array<Pick<Position, 'id' | 'title' | 'level' | 'accessRole' | 'salaryMin' | 'salaryMax' | 'salary'>>
  >([]); 
  const [managers, setManagers] = useState<any[]>([]);
  const [approverDepartments, setApproverDepartments] = useState<LeaveApproverDepartment[]>([]);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [recordStatus, setRecordStatus] = useState<string | null>(null);
  const [portalAccountLinked, setPortalAccountLinked] = useState(false);
  const [taxBrackets, setTaxBrackets] = useState<PayrollTaxBracket[]>(
    CANONICAL_PAYROLL_TAX_BRACKETS_USD
  );
  const [nssfWageBrackets, setNssfWageBrackets] = useState<NssfWageBracket[]>(
    CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
  );
  const [payrollEngine, setPayrollEngine] = useState<PayrollEngineConfig>(
    DEFAULT_PAYROLL_ENGINE_CONFIG
  );
  const [workDayMethod, setWorkDayMethod] =
    useState<PayrollWorkDayMethod>('fixed_employee_basis');
  const [companyBasisDays, setCompanyBasisDays] = useState<number>(DEFAULT_PAYROLL_BASIS_DAYS);
  const workDayPolicyRef = useRef({
    method: 'fixed_employee_basis' as PayrollWorkDayMethod,
    companyBasisDays: DEFAULT_PAYROLL_BASIS_DAYS,
  });
  workDayPolicyRef.current = { method: workDayMethod, companyBasisDays };
  const [previewApprovedOt, setPreviewApprovedOt] = useState({ hours150: 0, hours200: 0 });
  const [linkedPortalUserId, setLinkedPortalUserId] = useState<string | null>(null);
  const [leaveTypeOptions, setLeaveTypeOptions] = useState<LeaveAssignmentOption[]>([]);
  const [leaveTypesLoading, setLeaveTypesLoading] = useState(true);
  const [allowanceTemplates, setAllowanceTemplates] = useState<AllowanceTemplate[]>([]);
  const [allowanceTypes, setAllowanceTypes] = useState<AllowanceType[]>([]);
  const [allowanceTemplatesLoading, setAllowanceTemplatesLoading] = useState(true);
  const [allowancePreviewLoading, setAllowancePreviewLoading] = useState(false);
  /** User manually changed the package dropdown — do not auto-reselect. */
  const allowancePackageTouchedRef = useRef(false);
  /** Last package id we auto-selected (so dept/role changes can update it). */
  const allowancePackageAutoSelectedRef = useRef<string | null>(null);
  const [saveConfirm, setSaveConfirm] = useState<
    'draft' | 'profile' | 'changes' | 'finish' | 'leave' | null
  >(null);
  const [saveConfirmLoading, setSaveConfirmLoading] = useState(false);
  /** After a failed Finish attempt, keep showing activation required-field alerts. */
  const [highlightCompletionErrors, setHighlightCompletionErrors] = useState(false);
  const pendingExitRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // --- STEP DEFINITION ---
  const WIZARD_STEPS: WizardStep[] = useMemo(() => [
      { id: 'basics', label: t('onboarding.steps.identity'), icon: Zap },
      { id: 'personal', label: t('onboarding.steps.personal'), icon: User },
      { id: 'job', label: t('onboarding.steps.placement'), icon: Briefcase },
      { id: 'schedule', label: 'Work Schedule', icon: Clock },
      { id: 'contact', label: t('onboarding.steps.contact'), icon: Phone },
      { id: 'family', label: t('onboarding.steps.family'), icon: Users },
      { id: 'salary', label: t('onboarding.steps.pay'), icon: DollarSign },
      { id: 'emergency', label: 'Emergency', icon: Heart },
      { id: 'documents', label: t('onboarding.steps.documents'), icon: FolderOpen },
      { id: 'review', label: t('onboarding.steps.review'), icon: FileText }
  ], [t]);

  const resolvePositionById = useCallback<PositionSalaryLookup>(
    (positionId) => positions.find((p) => p.id === positionId),
    [positions]
  );

  const employeeSchema = useMemo(
    () => buildEmployeeSchema(isEditMode, id, resolvePositionById, payrollEngine.exchangeRate),
    [isEditMode, id, resolvePositionById, payrollEngine.exchangeRate]
  );

  const formHydratedRef = useRef(false);
  const hasUnsavedEditsRef = useRef(false);
  const baselineValuesRef = useRef<EmployeeFormValues | null>(null);
  const formCacheRestoredRef = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    trigger,
    watch,
    getValues,
    getFieldState,
    setFocus,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema) as any,
    mode: 'onChange',
    defaultValues: {
      currency: 'USD',
      nationality: 'Cambodia',
      country: 'Cambodia',
      gender: 'Male',
      allowLogin: true,
      accessRole: Role.EMPLOYEE,
      joinDate: new Date().toISOString().split('T')[0],
      workerType: 'regular',
      probationPeriodMonths: 3,
      probationEnd: '',
      employmentType: 'Full-Time',
      email: '',
      website: '',
      basicSalary: 0,
      payrollBasisDays: DEFAULT_PAYROLL_BASIS_DAYS,
      paymentMethod: 'bank' as PaymentMethod,
      nssfEnrolled: true,
      maritalStatus: 'single',
      spouseHasWork: 'yes',
      workDays: 5,
      timeIn: '08:00',
      timeOut: '17:00',
      workHours: 8,
      breakDurationMinutes: 60,
      gracePeriodMinutes: DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes,
      children: [] as EmployeeChildFormRow[],
      emergencyRelation: 'Spouse',
      leaveAssignments: {},
      allowanceTemplateId: '',
      portalPassword: '',
      departmentId: '',
    }
  });

  const watchAll = watch();
  /** Base salary is always USD-authoritative (KHR is display-only on the salary step). */
  const contractSalaryUsd = useMemo(
    () => Math.round((Number(watchAll.basicSalary) || 0) * 100) / 100,
    [watchAll.basicSalary]
  );
  const { fields: childFields, append: appendChild, remove: removeChild } = useFieldArray({
    control,
    name: 'children',
    shouldUnregister: false,
  });
  const watchGender = watch('gender');
  const watchDepartmentId = watch('departmentId');
  const watchJoinDateForProbation = watch('joinDate');
  const watchEmploymentTypeForPeriod = watch('employmentType');
  const watchProbationMonthsForProbation = watch('probationPeriodMonths');

  useEffect(() => {
    const employmentType = normalizeEmploymentType(watchEmploymentTypeForPeriod);
    const months = capPeriodMonthsForEmploymentType(
      Number(
        watchProbationMonthsForProbation ??
          defaultPeriodMonthsForEmploymentType(employmentType)
      ),
      employmentType
    );
    const end = engagementEndDate(watchJoinDateForProbation, months) ?? '';
    const workerType = resolveWorkerTypeForEmployment(employmentType, months);
    const current = getValues('probationEnd');
    if (current !== end) {
      setValue('probationEnd', end, { shouldDirty: false });
    }
    if (getValues('workerType') !== workerType) {
      setValue('workerType', workerType, { shouldDirty: false });
    }
    if (getValues('probationPeriodMonths') !== months) {
      setValue('probationPeriodMonths', months, { shouldDirty: false });
    }
  }, [
    watchJoinDateForProbation,
    watchEmploymentTypeForPeriod,
    watchProbationMonthsForProbation,
    getValues,
    setValue,
  ]);

  /** New employees: Maternity follows gender (Female only). Edit keeps saved HR choices. */
  useEffect(() => {
    if (isEditMode) return;
    const maternityId = findMaternityLeaveTypeId(leaveTypeOptions);
    if (!maternityId) return;
    const current = getValues('leaveAssignments') ?? {};
    const nextMaternity = watchGender === 'Female';
    if (current[maternityId] === nextMaternity) return;
    setValue(
      'leaveAssignments',
      { ...current, [maternityId]: nextMaternity },
      { shouldDirty: false }
    );
  }, [isEditMode, watchGender, leaveTypeOptions, setValue, getValues]);

  const markFormClean = useCallback(() => {
    const values = sanitizeEmployeeFormCacheValues(getValues());
    reset(values, { keepValues: true, keepDirty: false, keepErrors: true });
    baselineValuesRef.current = values;
  }, [reset, getValues]);

  const tabCache = useWorkspaceTabCache<EmployeeInputFormCache>({
    slot: `employee-input-form-v2:${id ?? 'new'}`,
    getSnapshot: () => {
      const values = sanitizeEmployeeFormCacheValues(getValues());
      return {
        values,
        baseline: baselineValuesRef.current ?? values,
        currentStep,
        avatarPreview,
        recordStatus,
        portalAccountLinked,
        linkedPortalUserId,
        wasDirty: Boolean(hasUnsavedEditsRef.current || isDirty),
        lastSavedIso: lastSaved ? lastSaved.toISOString() : null,
      };
    },
    applySnapshot: (cached) => {
      formCacheRestoredRef.current = true;
      const baseline = sanitizeEmployeeFormCacheValues(cached.baseline);
      const values = sanitizeEmployeeFormCacheValues(cached.values);
      baselineValuesRef.current = baseline;
      reset(baseline);
      if (cached.wasDirty) {
        reset(values, { keepDefaultValues: true });
      } else {
        reset(values);
        baselineValuesRef.current = values;
      }
      setCurrentStep(
        Number.isFinite(cached.currentStep) ? Math.max(0, Math.floor(cached.currentStep)) : 0
      );
      setAvatarPreview(cached.avatarPreview ?? null);
      setRecordStatus(cached.recordStatus ?? null);
      setPortalAccountLinked(Boolean(cached.portalAccountLinked));
      setLinkedPortalUserId(cached.linkedPortalUserId ?? null);
      if (cached.lastSavedIso) {
        const parsed = new Date(cached.lastSavedIso);
        if (!Number.isNaN(parsed.getTime())) setLastSaved(parsed);
      }
      formHydratedRef.current = true;
      setIsLoadingData(false);
      setLeaveTypesLoading(false);
    },
    shouldPersist: () => formHydratedRef.current || formCacheRestoredRef.current,
    persistDeps: [
      watchAll,
      currentStep,
      avatarPreview,
      recordStatus,
      portalAccountLinked,
      linkedPortalUserId,
      isDirty,
      lastSaved,
      id,
    ],
  });
  const tabCacheRef = useRef(tabCache);
  tabCacheRef.current = tabCache;

  const returnToEmployeeHub = useCallback(() => {
    markFormClean();
    navigate('/employees/onboarding');
  }, [markFormClean, navigate]);

  const updateEmployeeWithOptionalChangeReason = useCallback(
    async (employeeId: string, payload: Record<string, unknown>): Promise<unknown> => {
      const payrollChangePrompt = async () => {
        const result = await promptChangeReason({
          title: t('onboarding.confirm.payrollChangeTitle'),
          description: t('onboarding.confirm.payrollChangeDescription'),
          variant: 'success',
          confirmLabel: t('onboarding.confirm.confirmSave'),
          reasonPlaceholder: t('onboarding.confirm.changeReasonPlaceholder'),
          reasonRequired: true,
          showEffectiveDateInput: true,
          effectiveDateLabel: t('onboarding.confirm.effectiveDateLabel'),
          defaultEffectiveDate: todayYmdInCompanyTz(),
        });
        if (result === null) throw new Error('Save cancelled');
        if (typeof result === 'string') {
          return { change_reason: result.trim(), effective_from: todayYmdInCompanyTz() };
        }
        return {
          change_reason: result.reason.trim(),
          effective_from: result.effectiveFrom.trim().slice(0, 10),
        };
      };

      const needsPayrollMeta = (e: unknown) => {
        const msg = e instanceof Error ? e.message : '';
        const code =
          e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        return (
          code === 'CHANGE_REASON_REQUIRED' ||
          code === 'MASTER_DATA_EFFECTIVE_DATE_REQUIRED' ||
          /change reason is required/i.test(msg) ||
          /effective date is required/i.test(msg)
        );
      };

      try {
        return await Api.employees.update(employeeId, payload);
      } catch (e) {
        if (!needsPayrollMeta(e)) throw e;
        const extras = await payrollChangePrompt();
        return Api.employees.update(employeeId, { ...payload, ...extras });
      }
    },
    [promptChangeReason, t]
  );

  const isManager = currentUser?.role === Role.MANAGER;
  const displayStatus = effectiveEmployeeStatus(recordStatus, watchAll.email);
  const showDraftBadge = Boolean(id) && displayStatus === 'draft';
  const showInactiveBadge = Boolean(id) && isOffboardedEmployeeStatus(displayStatus);
  const hasUnsavedEdits = isDirty && !isLoadingData && formHydratedRef.current;
  hasUnsavedEditsRef.current = hasUnsavedEdits;

  const liveActivationIssues = useMemo(() => {
    if (!highlightCompletionErrors) {
      return {
        fieldErrors: {} as FieldErrors<EmployeeFormValues>,
        blockers: [] as string[],
      };
    }
    const details = collectActivationIssueDetails(watchAll as EmployeeFormValues, {
      avatarUrl: avatarPreview,
    });
    const fieldErrors: FieldErrors<EmployeeFormValues> = {};
    for (const [key, message] of Object.entries(details.fieldErrors)) {
      if (!message) continue;
      (fieldErrors as Record<string, { type: string; message: string }>)[key] = {
        type: 'required',
        message,
      };
    }
    return {
      fieldErrors,
      blockers: details.blockers,
    };
  }, [highlightCompletionErrors, watchAll, avatarPreview]);

  const displayErrors = useMemo(() => {
    if (!highlightCompletionErrors) return errors;
    return { ...errors, ...liveActivationIssues.fieldErrors };
  }, [errors, highlightCompletionErrors, liveActivationIssues.fieldErrors]);

  const workspaceTabTitle = useMemo(() => {
    if (!isEditMode) {
      const label = t('employees.newEmployee');
      return label && label !== 'employees.newEmployee' ? label : 'New employee';
    }
    const name = joinPersonNameParts(watchAll.firstName, watchAll.lastName);
    return name || null;
  }, [isEditMode, watchAll.firstName, watchAll.lastName, t]);
  useWorkspaceTabTitle(workspaceTabTitle);

  useEffect(() => {
    registerEmployeeOnboardingGuard({
      hasUnsavedEdits: () => hasUnsavedEditsRef.current,
      requestLeave: (exit) => {
        pendingExitRef.current = exit;
        setSaveConfirm('leave');
      },
    });
    return () => registerEmployeeOnboardingGuard(null);
  }, []);

  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedEdits]);

  useEffect(() => {
    let cancelled = false;
    const loadPositionsForDept = async () => {
      if (!watchDepartmentId) {
        setPositions([]);
        return;
      }
      try {
        const plist = await Api.positions.getByDepartment(watchDepartmentId, {
          activeOnly: true,
        });
        if (cancelled) return;
        const currentPos = String(getValues('position') || '').trim();
        let posRaw = Array.isArray(plist)
          ? plist
              .filter((p: { isActive?: boolean }) => isActiveFlag(p.isActive))
              .map(
              (p: {
                id: string;
                title: string;
                titleKh?: string;
                level?: string | null;
                accessRole?: string | null;
                salaryMin?: number;
                salaryMax?: number;
                salary?: number;
                isActive?: boolean;
              }) => ({
                id: p.id,
                title: p.title,
                titleKh: p.titleKh,
                level: p.level ?? null,
                accessRole: p.accessRole ?? null,
                salaryMin: p.salaryMin,
                salaryMax: p.salaryMax,
                salary: p.salary,
                isActive: isActiveFlag(p.isActive),
              })
            )
          : [];
        // Edit only: keep the already-assigned inactive position so the select can display it.
        if (
          isEditMode &&
          currentPos &&
          !posRaw.some((p) => String(p.id || '') === currentPos)
        ) {
          const allForDept = await Api.positions.getByDepartment(watchDepartmentId);
          if (cancelled) return;
          const current = Array.isArray(allForDept)
            ? allForDept.find((p: { id?: string }) => String(p.id || '') === currentPos)
            : null;
          if (current && !isActiveFlag(current.isActive)) {
            posRaw = [
              ...posRaw,
              {
                id: current.id,
                title: `${current.title || 'Position'} (Inactive)`,
                titleKh: current.titleKh,
                level: current.level ?? null,
                accessRole: current.accessRole ?? null,
                salaryMin: current.salaryMin,
                salaryMax: current.salaryMax,
                salary: current.salary,
                isActive: false,
              },
            ];
          }
        }
        setPositions(posRaw);
        // Only clear after a real department position list loads — never wipe
        // a saved position while the list is still empty / failed.
        if (
          currentPos &&
          posRaw.length > 0 &&
          !posRaw.some((p) => p.id === currentPos)
        ) {
          setValue('position', '');
        }
      } catch {
        if (!cancelled) setPositions([]);
      }
    };
    void loadPositionsForDept();
    return () => {
      cancelled = true;
    };
  }, [watchDepartmentId, getValues, setValue, isEditMode]);

  const watchPositionId = watch('position');
  const watchBasicSalary = watch('basicSalary');

  const selectedPosition = useMemo(
    () => (watchPositionId ? positions.find((p) => p.id === watchPositionId) : undefined),
    [watchPositionId, positions]
  );

  useEffect(() => {
    void trigger('basicSalary');
  }, [watchBasicSalary, watchPositionId, selectedPosition, trigger]);

  useEffect(() => {
    if (!watchPositionId || isEditMode) return;
    const selected = positions.find((p) => p.id === watchPositionId);
    const role = selected?.accessRole;
    if (!role) return;
    setValue('accessRole', normalizeAccessRole(role), { shouldDirty: true });
  }, [watchPositionId, positions, isEditMode, setValue]);

  const generateId = useCallback(
    async (force?: boolean) => {
      if (!force) {
        const current = getValues('id');
        if (current && String(current).trim() !== '') return;
      }
      try {
        const res = await Api.employees.generateNextId();
        setValue('id', normalizeEmployeeDisplayId(res.next_id), { shouldDirty: false });
      } catch {
        try {
          let max = 0;
          let page = 1;
          let totalPages = 1;
          const limit = 500;
          do {
            const data = await Api.employees.getAll({
              page,
              limit,
              sort_by: 'created_at',
              sort_order: 'DESC',
            });
            const rows = Array.isArray(data?.employees) ? data.employees : [];
            totalPages =
              typeof data?.total_pages === 'number' && data.total_pages >= 1
                ? data.total_pages
                : 1;
            for (const e of rows) {
              const m = String((e as { employee_id?: string }).employee_id || '').match(
                /^(?:IROC|ROC|EMP)(\d+)$/i
              );
              if (m) max = Math.max(max, parseInt(m[1], 10));
            }
            page++;
          } while (page <= totalPages && page <= 40);
          setValue('id', `ROC${String(max + 1).padStart(5, '0')}`, { shouldDirty: false });
          showToast(
            'Next employee ID was derived from existing records (preview API unavailable).',
            'warning'
          );
        } catch {
          showToast(t('messages.loadError') || 'Could not generate employee ID.', 'error');
        }
      }
    },
    [getValues, setValue, showToast, t]
  );

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      const restored =
        tabCacheRef.current.consumeRestored() || formCacheRestoredRef.current;
      formCacheRestoredRef.current = false;

      if (!restored) {
        formHydratedRef.current = false;
        setIsLoadingData(true);
      }
      try {
        const [depts, users, leaveTypesRaw, attendanceSettings, approverRes] = await Promise.all([
          // Server-side filter — inactive units must not appear for new placement.
          Api.departments.getAll({ activeOnly: true, noCache: true }),
          Api.users.getAll(),
          Api.leaves.getTypes(),
          Api.attendance.getSettings().catch(() => null),
          Api.leaves.getApproverManagers().catch(() => ({ departments: [] })),
        ]);
        if (cancelled) return;
        const graceDefault = gracePeriodFromAttendanceSettings(attendanceSettings);
        let assignableDepts = (Array.isArray(depts) ? depts : []).filter((d: { isActive?: boolean }) =>
          isActiveFlag(d.isActive)
        );
        setDepartments(assignableDepts);
        setApproverDepartments(
          Array.isArray(approverRes?.departments) ? approverRes.departments : []
        );
        setManagers(
          users.filter(
            (u) =>
              u.role === Role.MANAGER &&
              u.accountType !== 'system' &&
              u.employeeId
          )
        );

        const normalizedTypes = Array.isArray(leaveTypesRaw)
          ? leaveTypesRaw
              .map((row: Record<string, unknown>) => {
                const name = String(row.name ?? '').trim();
                const id = String(row.id ?? '').trim();
                if (!id || !name) return null;
                return {
                  id,
                  name,
                  isPaid: Boolean(row.isPaid ?? row.is_paid ?? true),
                  daysAllowed: Number(row.daysAllowed ?? row.days_allowed ?? 0),
                };
              })
              .filter((x): x is { id: string; name: string; isPaid: boolean; daysAllowed: number } => x != null)
          : [];
        const typeOptions = leaveTypesToAssignmentOptions(normalizedTypes);
        setLeaveTypeOptions(typeOptions);

        setPositions([]);

        const clearInactivePlacementSelection = () => {
          const selectedDept = String(getValues('departmentId') || '').trim();
          if (
            selectedDept &&
            !assignableDepts.some((d: { id?: string }) => String(d.id || '') === selectedDept)
          ) {
            setValue('departmentId', '');
            setValue('position', '');
          }
        };

        // Returning to this workspace tab: keep typed form values — do not overwrite from API.
        // Still drop a cached placement that points at an inactive department (new hire only).
        if (restored) {
          if (!id) clearInactivePlacementSelection();
          return;
        }

        if (id) {
          const emp = await Api.employees.getById(id);
          if (cancelled) return;
          if (!emp || typeof emp !== 'object') {
            showToast(t('messages.loadError'), 'error');
            navigate('/employees');
            return;
          }
          const e = emp as Record<string, unknown>;
          setRecordStatus(effectiveEmployeeStatus(String(e.status ?? 'active'), e.email));
          setValue('id', normalizeEmployeeDisplayId(String(e.employee_id ?? '')));
          setValue('firstName', String(e.first_name ?? ''));
          setValue('lastName', String(e.last_name ?? ''));
          setValue('firstNameKh', String(e.first_name_kh ?? ''));
          setValue('lastNameKh', String(e.last_name_kh ?? ''));
          setValue('email', String(e.email ?? ''));
          setValue('phone', String(e.phone ?? ''));
          setValue(
            'telegramNumber',
            String(e.telegram_number ?? e.telegramNumber ?? '')
          );
          setValue('address', String(e.street_address ?? ''));
          setValue('addressKh', String(e.street_address_kh ?? ''));
          setValue('country', String(e.country ?? 'Cambodia') || 'Cambodia');
          setValue('city', String(e.city ?? ''));
          setValue('cityKh', String(e.city_kh ?? ''));
          setValue('departmentId', String(e.department_id ?? ''));
          setValue('position', String(e.position_id ?? ''));
          {
            const currentDeptId = String(e.department_id ?? '').trim();
            if (
              currentDeptId &&
              !assignableDepts.some((d: { id?: string }) => String(d.id || '') === currentDeptId)
            ) {
              try {
                const currentDept = await Api.departments.getById(currentDeptId);
                if (currentDept && !isActiveFlag(currentDept.isActive)) {
                  assignableDepts = [
                    ...assignableDepts,
                    {
                      ...currentDept,
                      name: `${currentDept.name || 'Department'} (Inactive)`,
                      isActive: false,
                    },
                  ];
                  setDepartments(assignableDepts);
                }
              } catch {
                /* keep active-only list */
              }
            }
          }
          setValue('employmentType', normalizeEmploymentType(e.employment_type));
          setValue('joinDate', formatIsoDate(e.join_date));
          const probation = readProbationFieldsFromRecord(e);
          setValue('workerType', probation.workerType, { shouldDirty: false });
          setValue('probationPeriodMonths', probation.probationPeriodMonths, { shouldDirty: false });
          setValue('probationEnd', probation.probationEnd, { shouldDirty: false });
          setValue('workDays', Number(e.work_days) || 5);
          setValue('timeIn', String(e.time_in ?? '08:00').slice(0, 5));
          setValue('timeOut', String(e.time_out ?? '17:00').slice(0, 5));
          setValue('workHours', Number(e.work_hours) || 8);
          setValue('breakDurationMinutes', Number(e.break_duration_minutes ?? 60));
          if (e.grace_period_minutes != null && e.grace_period_minutes !== '') {
            setValue('gracePeriodMinutes', Number(e.grace_period_minutes));
          } else {
            setValue('gracePeriodMinutes', graceDefault);
          }
          {
            const storedCurrency = normalizeCurrency(e.currency);
            const rawSalary = Number(e.base_salary) || 0;
            // Legacy rows may store KHR amounts when currency=KHR — normalize to USD for the form.
            const salaryUsd =
              storedCurrency === 'KHR' && rawSalary > 0
                ? khrToUsd(rawSalary, payrollEngine.exchangeRate)
                : Math.round(rawSalary * 100) / 100;
            setValue('basicSalary', salaryUsd);
            // Contract salary is always entered/stored as USD; KHR is display-only via FX.
            setValue('currency', 'USD');
          }
          {
            const policy = workDayPolicyRef.current;
            setValue(
              'payrollBasisDays',
              policy.method === 'fixed_company_basis'
                ? normalizePayrollBasisDays(policy.companyBasisDays)
                : Number(e.payroll_basis_days) > 0
                  ? normalizePayrollBasisDays(e.payroll_basis_days)
                  : DEFAULT_PAYROLL_BASIS_DAYS
            );
          }
          setValue('gender', String(e.gender ?? 'Male'));
          setValue('birthDate', formatIsoDate(e.birth_date));
          setValue(
            'nationality',
            normalizeNationalityValue(String(e.nationality ?? e.ethnicity ?? 'Cambodia'))
          );
          setValue('religion', normalizeReligionValue(String(e.religion ?? '')));
          setValue('nationalId', String(e.national_id ?? ''));
          setValue('passport', String(e.passport_number ?? ''));
          setValue('birthCertificate', String(e.birth_certificate_number ?? ''));
          setValue(
            'paymentMethod',
            normalizePaymentMethod(
              (e as { payment_method?: unknown }).payment_method ??
                inferPaymentMethodFromBank(e.bank_name, e.bank_account_number)
            )
          );
          setValue('bankName', String(e.bank_name ?? ''));
          setValue('bankAccount', String(e.bank_account_number ?? ''));
          setValue('nssfEnrolled', e.nssf_enrolled !== false);
          setValue(
            'allowanceTemplateId',
            String(e.allowance_template_id ?? e.allowanceTemplateId ?? '')
          );
          const marital = String(e.marital_status ?? 'single').toLowerCase();
          setValue('maritalStatus', marital === 'married' ? 'married' : 'single');
          setValue('spouseName', String(e.spouse_name ?? ''));
          setValue('spouseNameKh', String(e.spouse_name_kh ?? ''));
          const spouseHasWork = parseSpouseHasWork(e.spouse_occupation) ?? 'yes';
          setValue('spouseHasWork', spouseHasWork);
          setValue('spousePhone', String(e.spouse_phone ?? ''));
          const apiChildren = Array.isArray((e as { children?: unknown }).children)
            ? ((e as { children: EmployeeChildFormRow[] }).children ?? [])
            : [];
          const dependentChildren = Array.isArray((e as { dependents?: unknown }).dependents)
            ? ((e as { dependents: Record<string, unknown>[] }).dependents ?? []).filter((d) =>
                String(d.relationship ?? '')
                  .trim()
                  .toLowerCase()
                  .includes('child')
              )
            : [];
          const childRows = apiChildren.length
            ? apiChildren
            : dependentChildren.map((d) => ({
                name: String(d.name ?? d.full_name ?? ''),
                nameKh: String(d.name_kh ?? d.nameKh ?? ''),
                age: d.age != null ? String(d.age) : '',
                gender: String(d.gender ?? ''),
                occupation: String(d.occupation ?? ''),
                hasJob: (d.has_job === true || d.has_job === 'yes' || d.hasJob === 'yes'
                  ? 'yes'
                  : 'no') as 'yes' | 'no',
              }));
          if (childRows.length) {
            setValue(
              'children',
              childRows.map((c) => ({
                name: String(c.name ?? ''),
                nameKh: String(
                  (c as { nameKh?: string; name_kh?: string }).nameKh ??
                    (c as { name_kh?: string }).name_kh ??
                    ''
                ),
                age: c.age != null && String(c.age).trim() !== '' ? String(c.age) : '',
                gender: String(c.gender ?? ''),
                occupation: String(c.occupation ?? ''),
                hasJob: ((c.hasJob ?? (c as { has_job?: string }).has_job) === 'yes'
                  ? 'yes'
                  : 'no') as 'yes' | 'no',
              }))
            );
          } else {
            setValue('children', []);
          }
          setValue('emergencyName', String(e.emergency_contact_name ?? ''));
          setValue('emergencyNameKh', String(e.emergency_contact_name_kh ?? ''));
          setValue('emergencyRelation', String(e.emergency_contact_relationship ?? ''));
          setValue('emergencyRelationKh', String(e.emergency_contact_relationship_kh ?? ''));
          setValue('emergencyPhone', String(e.emergency_contact_phone ?? ''));
          if (e.avatar_url) setAvatarPreview(resolveMediaUrl(String(e.avatar_url)));

          // Prefer the server-provided role/allow_login (canonical). Fall back to matching the legacy users list for older API builds.
          const serverRole = normalizeAccessRole(
            (e as Record<string, unknown>).accessRole ?? e.role
          );
          const userMatch = users.find(
            (u: { email?: string; employeeId?: string }) =>
              u.employeeId === String(e.id ?? '') ||
              (!!String(e.email || '').trim() &&
                u.email?.toLowerCase() === String(e.email || '').toLowerCase())
          );
          const hasPortalAccount =
            typeof e.allow_login === 'boolean'
              ? (e.allow_login as boolean)
              : !!userMatch;

          setPortalAccountLinked(hasPortalAccount);
          setLinkedPortalUserId(userMatch?.id ? String(userMatch.id) : null);
          setValue('allowLogin', hasPortalAccount);

          setValue('accessRole', serverRole);
          if (userMatch?.role) {
            const fallbackRole = normalizeAccessRole(userMatch.role);
            if (fallbackRole) setValue('accessRole', fallbackRole);
          }

          const savedAssignments =
            e.leave_assignments && typeof e.leave_assignments === 'object' && !Array.isArray(e.leave_assignments)
              ? (e.leave_assignments as Record<string, boolean>)
              : null;
          setValue(
            'leaveAssignments',
            mergeLeaveAssignmentsWithTypes(typeOptions, savedAssignments, String(e.gender ?? 'Male'))
          );
        } else {
          setPortalAccountLinked(false);
          setLinkedPortalUserId(null);
          // Not a draft until the user clicks Save Draft.
          setRecordStatus(null);
          await generateId(false);
          if (cancelled) return;
          if (isManager && currentUser) {
            setValue('accessRole', Role.EMPLOYEE);
            // Do not prefill department — draft should only keep fields the user chose.
          }
          clearInactivePlacementSelection();
          setValue(
            'leaveAssignments',
            mergeLeaveAssignmentsWithTypes(typeOptions, {}, getValues('gender') || 'Male')
          );
          setValue('gracePeriodMinutes', graceDefault);
        }
      } catch {
        if (!cancelled) showToast(t('messages.loadError'), 'error');
      } finally {
        if (!cancelled) {
          setLeaveTypesLoading(false);
          if (!restored) {
            markFormClean();
          }
          formHydratedRef.current = true;
          setIsLoadingData(false);
          tabCacheRef.current.persistNow();
        }
      }
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [id, setValue, showToast, isManager, currentUser, t, navigate, generateId, markFormClean, getValues]);

  useEffect(() => {
    let cancelled = false;
    void Api.payroll
      .getTaxBrackets()
      .then((rows) => {
        if (!cancelled && rows?.length) setTaxBrackets(rows);
      })
      .catch(() => {
        /* keep canonical defaults */
      });
    void Api.payroll
      .getNssfAssumedWageBrackets()
      .then((rows) => {
        if (!cancelled && rows?.length) {
          setNssfWageBrackets(
            rows.map(({ level, wageMinKhr, wageMaxKhr, assumedWageKhr }) => ({
              level,
              wageMinKhr,
              wageMaxKhr,
              assumedWageKhr,
            }))
          );
        }
      })
      .catch(() => {
        /* keep canonical defaults */
      });
    void Api.payroll
      .getComplianceRules()
      .then((rules) => {
        if (cancelled) return;
        if (rules?.length) setPayrollEngine(complianceRulesToEngineConfig(rules));
      })
      .catch(() => {
        /* keep defaults */
      });
    void Api.payroll
      .getExchangeRateDetails()
      .then((fx) => {
        if (cancelled) return;
        const configured = fx.latestExchangeRateKhrPerUsd ?? fx.exchangeRateKhrPerUsd;
        if (Number.isFinite(configured) && configured > 0) {
          setPayrollExchangeRateCache({
            configured,
            active: fx.exchangeRateKhrPerUsd,
          });
          setPayrollEngine((prev) => ({ ...prev, exchangeRate: configured }));
        }
      })
      .catch(() => {
        /* keep cached / default rate */
      });
    void Api.payroll
      .getWorkDayPolicy()
      .then((policy) => {
        if (cancelled) return;
        const method = (policy.method as PayrollWorkDayMethod) ?? 'fixed_employee_basis';
        const days = normalizePayrollBasisDays(policy.companyBasisDays);
        setWorkDayMethod(method);
        setCompanyBasisDays(days);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (workDayMethod !== 'fixed_company_basis') return;
    setValue('payrollBasisDays', normalizePayrollBasisDays(companyBasisDays), {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [workDayMethod, companyBasisDays, setValue]);
  useEffect(() => {
    let cancelled = false;
    const month = new Date().toISOString().slice(0, 7);
    if (!linkedPortalUserId) {
      setPreviewApprovedOt({ hours150: 0, hours200: 0 });
      return;
    }
    void Api.overtime
      .getApprovedHours(linkedPortalUserId, month)
      .then((res) => {
        if (!cancelled) {
          setPreviewApprovedOt({
            hours150: res.hours150 ?? 0,
            hours200: res.hours200 ?? 0,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewApprovedOt({ hours150: 0, hours200: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [linkedPortalUserId]);

  const buildActivationOptions = useCallback(
    async (values: EmployeeFormValues) => {
      let documents: EmployeeDocumentRow[] = [];
      const displayId = String(values.id ?? '').trim();
      if (displayId) {
        try {
          const rows = await Api.employees.listDocuments(displayId);
          documents = Array.isArray(rows) ? rows : [];
        } catch {
          documents = [];
        }
      }
      const posId = String(values.position ?? '').trim();
      const pos = posId ? positions.find((p) => p.id === posId) : undefined;
      return {
        portalAccountExists: portalAccountLinked,
        avatarUrl: avatarPreview,
        documents,
        selectedPosition: pos,
      };
    },
    [portalAccountLinked, avatarPreview, positions]
  );

  const runStepValidation = useCallback(
    async (stepIndex: number): Promise<boolean> => {
      if (stepIndex === 0 && !String(getValues('id') ?? '').trim()) {
        await generateId(true);
      }

      const fields = STEP_FIELDS_MAP[stepIndex] ?? [];
      if (fields.length > 0) {
        const ok = await trigger(fields as (keyof EmployeeFormValues)[], { shouldFocus: true });
        if (!ok) return false;
      }
      if (stepIndex === 6) {
        const salary = Number(getValues('basicSalary') ?? 0);
        if (salary > 0) {
          const ok = await trigger('basicSalary', { shouldFocus: true });
          if (!ok) return false;
        }
      }
      return true;
    },
    [trigger, getValues, generateId]
  );

  const handleNext = async () => {
    const ok = await runStepValidation(currentStep);
    if (ok) {
      setCurrentStep((prev) => Math.min(prev + 1, WIZARD_STEPS.length - 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrev = () => {
      setCurrentStep(prev => Math.max(prev - 1, 0));
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const jumpToStep = async (index: number) => {
    if (index < currentStep) {
      setCurrentStep(index);
      return;
    }
    for (let s = currentStep; s < index; s++) {
      const ok = await runStepValidation(s);
      if (!ok) return;
    }
    setCurrentStep(index);
  };

  const persistDraft = useCallback(async (): Promise<string | null> => {
    const values = getValues();
    try {
      if (!String(values.id || '').trim()) {
        await generateId(true);
      }
      const data = getValues();
      const payload = buildEmployeeApiPayload(data, avatarPreview, taxBrackets, {
        isDraft: true,
        exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
        ...(workDayMethod === 'fixed_company_basis'
          ? { payrollBasisDaysOverride: normalizePayrollBasisDays(companyBasisDays) }
          : {}),
      });
      const routeId = id?.trim();
      const formId = String(data.id || '').trim();
      const updateId = routeId || formId;
      // New onboarding (no URL id, never saved) — create directly. Avoids PUT 404 noise
      // for a preview EmpID that is not in the database yet.
      // Edit URL / previously saved draft — try update first; on 404 create (e.g. DB restore
      // wiped the row while the tab still points at /employees/ROC#####/edit).
      const shouldTryUpdate = Boolean(updateId) && (Boolean(routeId) || recordStatus != null);

      if (shouldTryUpdate) {
        try {
          const updateRes = (await Api.employees.update(updateId, {
            ...payload,
            updated_by: currentUser?.name,
          })) as { employee?: Record<string, unknown> };
          const savedEmp = updateRes?.employee;
          if (savedEmp && typeof savedEmp === 'object') {
            const probation = readProbationFieldsFromRecord(savedEmp);
            setValue('workerType', probation.workerType, { shouldDirty: false });
            setValue('probationPeriodMonths', probation.probationPeriodMonths, {
              shouldDirty: false,
            });
            setValue('probationEnd', probation.probationEnd, { shouldDirty: false });
          }
          setRecordStatus('draft');
          setLastSaved(new Date());
          const savedDisplayId = String(
            (savedEmp as { employee_id?: string } | undefined)?.employee_id ||
              updateId
          ).trim();
          if (!routeId && savedDisplayId) {
            navigate(`/employees/${savedDisplayId}/edit`, { replace: true });
          }
          return savedDisplayId || updateId;
        } catch (updateErr) {
          const status = (updateErr as Error & { status?: number })?.status;
          if (status !== 404) throw updateErr;
          // Missing row — create below.
        }
      }

      let created: {
        employee?: Record<string, unknown> & { employee_id?: string };
      };
      try {
        created = (await Api.employees.create({
          ...payload,
          created_by: currentUser?.name,
        })) as { employee?: Record<string, unknown> & { employee_id?: string } };
      } catch (createErr) {
        const err = createErr as Error & {
          status?: number;
          data?: { existingEmployeeId?: string; code?: string };
        };
        if (err.status === 409) {
          const existingId = String(
            err.data?.existingEmployeeId || formId || updateId || payload.employee_id || ''
          ).trim();
          if (existingId) {
            try {
              const updateRes = (await Api.employees.update(existingId, {
                ...payload,
                updated_by: currentUser?.name,
              })) as { employee?: Record<string, unknown> };
              const savedEmp = updateRes?.employee;
              if (savedEmp && typeof savedEmp === 'object') {
                const probation = readProbationFieldsFromRecord(savedEmp);
                setValue('workerType', probation.workerType, { shouldDirty: false });
                setValue('probationPeriodMonths', probation.probationPeriodMonths, {
                  shouldDirty: false,
                });
                setValue('probationEnd', probation.probationEnd, { shouldDirty: false });
              }
              const savedDisplayId = String(
                (savedEmp as { employee_id?: string } | undefined)?.employee_id ||
                  existingId
              ).trim();
              setValue('id', normalizeEmployeeDisplayId(savedDisplayId), {
                shouldDirty: false,
              });
              setRecordStatus('draft');
              setLastSaved(new Date());
              navigate(`/employees/${savedDisplayId}/edit`, { replace: true });
              return savedDisplayId;
            } catch (conflictUpdateErr) {
              throw conflictUpdateErr;
            }
          }
        }
        throw createErr;
      }
      const savedEmp = created?.employee;
      if (savedEmp && typeof savedEmp === 'object') {
        const probation = readProbationFieldsFromRecord(savedEmp);
        setValue('workerType', probation.workerType, { shouldDirty: false });
        setValue('probationPeriodMonths', probation.probationPeriodMonths, {
          shouldDirty: false,
        });
        setValue('probationEnd', probation.probationEnd, { shouldDirty: false });
      }
      const newDisplayId =
        created?.employee?.employee_id || data.id || getValues('id') || null;
      if (newDisplayId) {
        setValue('id', normalizeEmployeeDisplayId(String(newDisplayId)), {
          shouldDirty: false,
        });
      }
      setRecordStatus('draft');
      setLastSaved(new Date());
      if (newDisplayId && !routeId) {
        navigate(`/employees/${newDisplayId}/edit`, { replace: true });
      } else if (newDisplayId && routeId && routeId !== String(newDisplayId)) {
        navigate(`/employees/${newDisplayId}/edit`, { replace: true });
      }
      return newDisplayId;
    } catch (e: unknown) {
      console.error(e);
      showToast(e instanceof Error ? e.message : t('messages.opFailed'), 'error');
      return null;
    }
  }, [
    avatarPreview,
    currentUser?.name,
    generateId,
    getValues,
    id,
    navigate,
    recordStatus,
    showToast,
    t,
    taxBrackets,
    payrollEngine.exchangeRate,
    workDayMethod,
    companyBasisDays,
    setValue,
  ]);

  const executeSaveDraft = async (options?: { navigateToList?: boolean }) => {
    const saved = await persistDraft();
    if (saved) {
      markFormClean();
      showToast(t('onboarding.messages.draftSaved'), 'success');
      if (options?.navigateToList) {
        navigate('/employees/onboarding');
      }
    }
  };

  const saveConfirmMeta = useMemo(() => {
    switch (saveConfirm) {
      case 'draft':
        return {
          title: t('onboarding.confirm.saveDraftTitle'),
          description: t('onboarding.confirm.saveDraftDescription'),
          confirmLabel: t('onboarding.confirm.confirmSave'),
        };
      case 'profile':
        return {
          title: t('onboarding.confirm.saveProfileTitle'),
          description: t('onboarding.confirm.saveProfileDescription'),
          confirmLabel: t('onboarding.confirm.confirmSave'),
        };
      case 'changes':
        return {
          title: t('onboarding.confirm.saveChangesTitle'),
          description: t('onboarding.confirm.saveChangesDescription'),
          confirmLabel: t('onboarding.confirm.confirmSave'),
        };
      case 'finish':
        return {
          title: t('onboarding.confirm.finishTitle'),
          description: t('onboarding.confirm.finishDescription'),
          confirmLabel: t('onboarding.confirm.confirmSave'),
        };
      case 'leave':
        return {
          title: t('onboarding.confirm.leaveTitle'),
          description: t('onboarding.confirm.leaveDescription'),
          confirmLabel: t('onboarding.confirm.confirmSaveDraft'),
        };
      default:
        return null;
    }
  }, [saveConfirm, t]);

  const handleSaveDialogClose = () => {
    if (saveConfirmLoading) return;
    if (saveConfirm === 'leave') {
      pendingExitRef.current = null;
    }
    setSaveConfirm(null);
  };

  const completePendingExit = () => {
    const exit = pendingExitRef.current;
    pendingExitRef.current = null;
    exit?.();
  };

  const handleLeaveDiscard = () => {
    const exit = pendingExitRef.current;
    pendingExitRef.current = null;
    setSaveConfirm(null);
    // Allow the pending navigation (tab switch / sidebar) to proceed without re-prompting.
    hasUnsavedEditsRef.current = false;
    exit?.();
  };

  const requestLeave = (exitFn: () => void) => {
    if (!hasUnsavedEdits) {
      exitFn();
      return;
    }
    pendingExitRef.current = exitFn;
    setSaveConfirm('leave');
  };

  const focusFirstInvalidStep = useCallback(
    (formErrors: FieldErrors<EmployeeFormValues>) => {
      const step = firstStepWithActivationIssues(formErrors);
      if (step != null) {
        setCurrentStep(step);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const focusField = firstActivationFieldToFocus(formErrors);
        if (focusField) {
          window.setTimeout(() => {
            try {
              setFocus(focusField);
            } catch {
              /* field may not be mounted yet during step transition */
            }
          }, 80);
        }
      }
    },
    [setFocus]
  );

  const onValidationFailed = useCallback(
    (formErrors: FieldErrors<EmployeeFormValues>) => {
      focusFirstInvalidStep(formErrors);
      showToast(t('onboarding.messages.fixErrors'), 'error');
    },
    [focusFirstInvalidStep, showToast, t]
  );

  const syncAfterEmployeeSave = useCallback(
    async (employeeDisplayId: string, saved?: { email?: string | null }) => {
      const savedEmail = String(saved?.email ?? '').trim();
      if (savedEmail) {
        setValue('email', savedEmail, { shouldDirty: false });
      }
      const selfCode =
        String(currentUser?.displayEmployeeId ?? currentUser?.employeeId ?? '').trim();
      if (selfCode && selfCode === String(employeeDisplayId)) {
        await refreshUser();
      }
    },
    [currentUser, refreshUser, setValue]
  );

  /** Finish / Save Profile that activates — incomplete profiles must use Save Draft instead. */
  const assertReadyToCompleteOrToast = useCallback((): boolean => {
    const activatingNew = !id;
    const activatingDraft = Boolean(id) && isOnboardingInProgressStatus(recordStatus);
    if (!activatingNew && !activatingDraft) return true;

    const data = getValues();
    const issues = collectActivationIssueDetails(data, { avatarUrl: avatarPreview });
    if (issues.blockers.length === 0) {
      setHighlightCompletionErrors(false);
      return true;
    }

    const fieldErrors: FieldErrors<EmployeeFormValues> = {};
    for (const [key, message] of Object.entries(issues.fieldErrors)) {
      if (!message) continue;
      (fieldErrors as Record<string, { type: string; message: string }>)[key] = {
        type: 'required',
        message,
      };
    }

    setHighlightCompletionErrors(true);
    focusFirstInvalidStep(fieldErrors);

    const detail = issues.blockers[0] ? ` Missing: ${issues.blockers[0]}.` : '';
    showToast(`${t('onboarding.messages.incompleteUseDraft')}${detail}`, 'warning');
    return false;
  }, [id, recordStatus, getValues, avatarPreview, showToast, t, focusFirstInvalidStep]);

  const handleSaveChanges = async () => {
    if (!id) return;
    try {
      if (!assertReadyToCompleteOrToast()) return;

      const data = getValues();
      const partialCheck = await validatePartialProfileSave(data, {
        excludeEmployeeDisplayId: id,
        resolvePosition: resolvePositionById,
        exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
      });
      if (partialCheck.ok === false) {
        focusFirstInvalidStep(partialCheck.errors);
        const msgs = flattenErrorMessages(partialCheck.errors);
        showToast(msgs[0] ?? t('onboarding.messages.fixErrors'), 'error');
        return;
      }

      const canActivate =
        !isOffboardedEmployeeStatus(recordStatus) &&
        (!id || isOnboardingInProgressStatus(recordStatus));
      const payload = buildEmployeeApiPayload(data, avatarPreview, taxBrackets, {
        isDraft: false,
        activate: canActivate,
        exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
        ...(workDayMethod === 'fixed_company_basis'
          ? { payrollBasisDaysOverride: normalizePayrollBasisDays(companyBasisDays) }
          : {}),
      });
      const updated = (await updateEmployeeWithOptionalChangeReason(id, {
        ...payload,
        updated_by: currentUser?.name,
      })) as {
        pendingApproval?: boolean;
        employee?: { allow_login?: boolean; status?: string; email?: string };
        profileComplete?: boolean;
        missingFields?: string[];
      };
      const linked = updated?.employee?.allow_login === true;
      setPortalAccountLinked(linked);
      if (linked) setValue('allowLogin', true);
      const savedStatus = String(
        updated?.employee?.status ?? (canActivate ? 'active' : recordStatus ?? 'active')
      );
      setRecordStatus(
        effectiveEmployeeStatus(savedStatus, updated?.employee?.email ?? data.email)
      );
      await syncAfterEmployeeSave(id, updated?.employee);
      if (updated?.pendingApproval) {
        showToast(
          'Sensitive placement or pay changes submitted for HR Manager approval. Other updates were saved.',
          'warning'
        );
      } else {
        showToast(
          canActivate ? 'Saved successfully.' : 'Profile saved.',
          'success'
        );
      }
      setLastSaved(new Date());
      returnToEmployeeHub();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('messages.opFailed');
      if (msg !== 'Save cancelled') {
        showToast(msg, 'error');
      }
    }
  };

  const onSubmit: SubmitHandler<EmployeeFormValues> = async (data) => {
    try {
      if (!assertReadyToCompleteOrToast()) return;

      const partialCheck = await validatePartialProfileSave(data, {
        excludeEmployeeDisplayId: id,
        resolvePosition: resolvePositionById,
        exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
      });
      if (partialCheck.ok === false) {
        focusFirstInvalidStep(partialCheck.errors);
        const msgs = flattenErrorMessages(partialCheck.errors);
        showToast(msgs[0] ?? t('onboarding.messages.fixErrors'), 'error');
        return;
      }

      const canActivate =
        !isOffboardedEmployeeStatus(recordStatus) &&
        (!id || isOnboardingInProgressStatus(recordStatus));
      const payload = buildEmployeeApiPayload(data, avatarPreview, taxBrackets, {
        isDraft: false,
        activate: canActivate,
        exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
        ...(workDayMethod === 'fixed_company_basis'
          ? { payrollBasisDaysOverride: normalizePayrollBasisDays(companyBasisDays) }
          : {}),
      });
      if (id) {
        const updated = (await updateEmployeeWithOptionalChangeReason(id, {
          ...payload,
          updated_by: currentUser?.name,
        })) as { employee?: { status?: string; email?: string }; pendingApproval?: boolean };
        if (updated?.pendingApproval) {
          showToast(
            'Sensitive placement or pay changes submitted for HR Manager approval.',
            'warning'
          );
        }
        const savedStatus = String(
          updated?.employee?.status ?? (canActivate ? 'active' : recordStatus ?? 'active')
        );
        setRecordStatus(
          effectiveEmployeeStatus(savedStatus, updated?.employee?.email ?? data.email)
        );
        await syncAfterEmployeeSave(id, updated?.employee);
        setLastSaved(new Date());
        showToast('Saved successfully.', 'success');
        returnToEmployeeHub();
      } else {
        try {
          const created = (await Api.employees.create({
            ...payload,
            created_by: currentUser?.name,
          })) as { employee?: { employee_id?: string; status?: string; email?: string } };
          const newId = String(created?.employee?.employee_id || data.id || '').trim();
          if (newId) {
            await syncAfterEmployeeSave(newId, created?.employee);
          }
          showToast(t('onboarding.messages.success'), 'success');
          returnToEmployeeHub();
        } catch (createErr) {
          const err = createErr as Error & {
            status?: number;
            data?: { existingEmployeeId?: string };
          };
          if (err.status === 409) {
            const existingId = String(
              err.data?.existingEmployeeId || data.id || ''
            ).trim();
            if (existingId) {
              const updated = (await updateEmployeeWithOptionalChangeReason(existingId, {
                ...payload,
                updated_by: currentUser?.name,
              })) as {
                employee?: { status?: string; email?: string };
                pendingApproval?: boolean;
              };
              if (updated?.pendingApproval) {
                showToast(
                  'Sensitive placement or pay changes submitted for HR Manager approval.',
                  'warning'
                );
              }
              const savedStatus = String(
                updated?.employee?.status ??
                  (canActivate ? 'active' : recordStatus ?? 'active')
              );
              setRecordStatus(
                effectiveEmployeeStatus(
                  savedStatus,
                  updated?.employee?.email ?? data.email
                )
              );
              await syncAfterEmployeeSave(existingId, updated?.employee);
              setLastSaved(new Date());
              showToast('Saved successfully.', 'success');
              navigate(`/employees/${existingId}/edit`, { replace: true });
              returnToEmployeeHub();
              return;
            }
          }
          throw createErr;
        }
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : t('messages.opFailed');
      if (msg !== 'Save cancelled') {
        showToast(msg, 'error');
      }
    }
  };

  const handleSaveConfirm = async () => {
    const action = saveConfirm;
    if (!action) return;
    if (action === 'draft' || action === 'leave') {
      setSaveConfirmLoading(true);
      try {
        await executeSaveDraft({ navigateToList: action === 'draft' });
        setSaveConfirm(null);
        if (action === 'leave') {
          completePendingExit();
        }
      } finally {
        setSaveConfirmLoading(false);
      }
      return;
    }
    setSaveConfirm(null);
    if (action === 'profile' || action === 'changes') {
      setSaveConfirmLoading(true);
      try {
        await handleSaveChanges();
      } finally {
        setSaveConfirmLoading(false);
      }
    } else if (action === 'finish') {
      setSaveConfirmLoading(true);
      try {
        const data = getValues();
        const partialCheck = await validatePartialProfileSave(data, {
          excludeEmployeeDisplayId: id,
          resolvePosition: resolvePositionById,
          exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
        });
        if (partialCheck.ok === false) {
          focusFirstInvalidStep(partialCheck.errors);
          const msgs = flattenErrorMessages(partialCheck.errors);
          showToast(msgs[0] ?? t('onboarding.messages.fixErrors'), 'error');
          return;
        }
        await onSubmit(data);
      } finally {
        setSaveConfirmLoading(false);
      }
    }
  };

  const openFooterSaveConfirm = () => {
    if (!assertReadyToCompleteOrToast()) return;
    if (id) {
      setSaveConfirm('profile');
    } else {
      setSaveConfirm('finish');
    }
  };

  // Limits intentionally mirror what the backend enforces so the UI fails fast
  // before any bytes hit the wire.
  const AVATAR_MAX_BYTES = 5 * 1024 * 1024;     // 5 MB
  const AVATAR_MIN_BYTES = 2 * 1024;             // 2 KB - rejects empty/broken files
  const AVATAR_MIN_DIM = 100;                    // 100 x 100 px
  const AVATAR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

  /** Returns null if the image looks valid; otherwise an error message string. */
  const validateImageFile = (file: File): Promise<string | null> =>
    new Promise((resolve) => {
      if (!AVATAR_ALLOWED_MIME.includes(file.type)) {
        return resolve('Only JPG, PNG, or WebP images are allowed.');
      }
      if (file.size > AVATAR_MAX_BYTES) {
        return resolve(`Image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum allowed is 5 MB.`);
      }
      if (file.size < AVATAR_MIN_BYTES) {
        return resolve('Image looks too small to be a valid photo. Please pick a clearer picture.');
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth < AVATAR_MIN_DIM || img.naturalHeight < AVATAR_MIN_DIM) {
          resolve(
            `Image is only ${img.naturalWidth}×${img.naturalHeight}px. Please use at least ${AVATAR_MIN_DIM}×${AVATAR_MIN_DIM}px.`
          );
        } else {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('That file does not look like a readable image.');
      };
      img.src = url;
    });

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validationError = await validateImageFile(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    try {
      const { url } = await Api.uploads.avatar(file);
      setAvatarPreview(resolveMediaUrl(url));
      showToast('Picture uploaded.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload picture.';
      showToast(msg, 'error');
    }
  };

  const watchMaritalStatus = useWatch({ control, name: 'maritalStatus', defaultValue: 'single' });
  const watchSpouseHasWork = useWatch({ control, name: 'spouseHasWork' });
  const watchChildren = useWatch({ control, name: 'children', defaultValue: [] as EmployeeChildFormRow[] });

  const taxDependents = useMemo(
    () =>
      computeTaxDependents(
        watchMaritalStatus || 'single',
        watchChildren ?? [],
        watchMaritalStatus === 'married'
          ? (watchSpouseHasWork as SpouseHasWork | undefined)
          : undefined
      ),
    [watchMaritalStatus, watchChildren, watchSpouseHasWork]
  );

  const [seniorityPayContext, setSeniorityPayContext] = useState<WizardSeniorityPreview>({
    loading: false,
    hasActivePolicies: false,
    activeRules: [],
    preview: null,
    indemnityLoading: true,
    indemnityPreview: null,
  });

  useEffect(() => {
    let cancelled = false;
    const monthPrefix = new Date().toISOString().slice(0, 7);
    setSeniorityPayContext((prev) => ({ ...prev, indemnityLoading: true }));
    Api.payroll
      .previewSeniorityIndemnity({
        baseSalary: contractSalaryUsd,
        joinDate: watchAll.joinDate || undefined,
        employmentType: watchAll.employmentType || 'Full-Time',
        month: monthPrefix,
      })
      .then((indemnityPreview) => {
        if (!cancelled) {
          setSeniorityPayContext((prev) => ({
            ...prev,
            indemnityLoading: false,
            indemnityPreview,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeniorityPayContext((prev) => ({
            ...prev,
            indemnityLoading: false,
            indemnityPreview: null,
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contractSalaryUsd, watchAll.joinDate, watchAll.employmentType]);

  const seniorityEntitlementUsd = 0;
  const seniorityIndemnityUsd = seniorityPayContext.indemnityPreview?.payoutUsd ?? 0;

  const baseEstimatedPay = useMemo(() => {
      const mockUser = {
          salary: contractSalaryUsd,
          joinDate: watchAll.joinDate,
          dependents: taxDependents,
      } as any;
      return calculatePayrollForUser(mockUser, {
        nssfEnrolled: watchAll.nssfEnrolled !== false,
        nssfBrackets: nssfWageBrackets,
        compliance: payrollEngine,
        approvedOvertime: previewApprovedOt,
        taxBrackets,
        standardDailyHours: Number(watchAll.workHours) || 8,
        monthPrefix: new Date().toISOString().slice(0, 7),
        seniorityEntitlement: seniorityEntitlementUsd,
        seniorityIndemnityUsd,
      });
  }, [
    contractSalaryUsd,
    watchAll.joinDate,
    watchAll.nssfEnrolled,
    watchAll.workHours,
    watchAll.timeOut,
    taxDependents,
    nssfWageBrackets,
    payrollEngine,
    previewApprovedOt,
    taxBrackets,
    seniorityEntitlementUsd,
    seniorityIndemnityUsd,
  ]);

  const [estimatedPay, setEstimatedPay] = useState(baseEstimatedPay);

  useEffect(() => {
    setEstimatedPay(baseEstimatedPay);
  }, [baseEstimatedPay]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([Api.payroll.getAllowanceTemplates(), Api.payroll.getAllowanceTypes()])
      .then(([templates, types]) => {
        if (cancelled) return;
        setAllowanceTemplates(Array.isArray(templates) ? templates : []);
        setAllowanceTypes(Array.isArray(types) ? types : []);
      })
      .catch(() => {
        if (!cancelled) {
          setAllowanceTemplates([]);
          setAllowanceTypes([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAllowanceTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Leave package empty until HR assigns one (never auto-match by dept/role).
  useEffect(() => {
    if (allowanceTemplatesLoading || allowancePackageTouchedRef.current) return;
    const best = pickBestAllowanceTemplate(
      allowanceTemplates,
      watchAll.departmentId
    );
    const nextId = best?.id ?? '';
    const current = String(watchAll.allowanceTemplateId ?? '').trim();
    // Keep an explicitly stored/manual package; only fill empty or replace our prior auto-pick.
    if (
      current &&
      current !== allowancePackageAutoSelectedRef.current
    ) {
      return;
    }
    if (current === nextId) return;
    allowancePackageAutoSelectedRef.current = nextId || null;
    setValue('allowanceTemplateId', nextId, {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [
    allowanceTemplates,
    allowanceTemplatesLoading,
    watchAll.allowanceTemplateId,
    watchAll.departmentId,
    setValue,
  ]);

  useEffect(() => {
    const templateId = String(watchAll.allowanceTemplateId ?? '').trim();

    // Explicit “No allowance” after user interaction — do not auto-apply rules.
    if (!templateId && allowancePackageTouchedRef.current) {
      if (allowanceTypes.length > 0) {
        setEstimatedPay(
          applyAllowanceEngineToBreakdown(
            baseEstimatedPay,
            {
              legacy: {
                transport: 0,
                attendance: 0,
                meal: 0,
                seniority: 0,
                position: 0,
                commission: 0,
                otMeal: 0,
              },
              lines: [],
            },
            {
              taxDependents,
              taxBrackets,
              compliance: payrollEngine,
              nssfEnrolled: watchAll.nssfEnrolled !== false,
              nssfBrackets: nssfWageBrackets,
              allAllowanceTypes: allowanceTypes,
              packageTypeIds: new Set(),
            }
          )
        );
      } else {
        setEstimatedPay(baseEstimatedPay);
      }
      setAllowancePreviewLoading(false);
      return;
    }

    const pkg = templateId
      ? allowanceTemplates.find((t) => t.id === templateId)
      : null;

    let cancelled = false;
    setAllowancePreviewLoading(true);

    Api.payroll
      .previewAllowancePackage({
        // Empty = no package (allowances are assigned explicitly, never auto-matched).
        allowanceTemplateId: templateId || null,
        baseSalary: contractSalaryUsd,
        joinDate: watchAll.joinDate || null,
        departmentId: watchAll.departmentId || null,
        positionId: watchAll.position || null,
        accessRole: watchAll.accessRole || Role.EMPLOYEE,
        employeeId:
          id && id !== 'new' && !String(id).includes('onboarding')
            ? id
            : undefined,
        workHours: Number(watchAll.workHours) || 8,
        gracePeriodMinutes: watchAll.gracePeriodMinutes,
        month: new Date().toISOString().slice(0, 7),
      })
      .then(({ result }) => {
        if (cancelled) return;
        setEstimatedPay(
          applyAllowanceEngineToBreakdown(
            baseEstimatedPay,
            {
              legacy: result.legacy as import('../utils/allowancePayPreview').AllowanceEngineLegacy,
              lines: result.lines.map((l) => ({
                code: l.code,
                name: l.name,
                amount: l.amount,
              })),
            },
            {
              taxDependents,
              taxBrackets,
              compliance: payrollEngine,
              nssfEnrolled: watchAll.nssfEnrolled !== false,
              nssfBrackets: nssfWageBrackets,
              allowancePackageName: pkg?.template_name,
              allAllowanceTypes: allowanceTypes,
              // null = show engine amounts like Payroll preview.
              packageTypeIds: null,
            }
          )
        );
      })
      .catch(() => {
        if (!cancelled) setEstimatedPay(baseEstimatedPay);
      })
      .finally(() => {
        if (!cancelled) setAllowancePreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    watchAll.allowanceTemplateId,
    contractSalaryUsd,
    watchAll.joinDate,
    watchAll.departmentId,
    watchAll.position,
    watchAll.accessRole,
    watchAll.nssfEnrolled,
    watchAll.workHours,
    watchAll.gracePeriodMinutes,
    baseEstimatedPay,
    taxDependents,
    taxBrackets,
    payrollEngine,
    nssfWageBrackets,
    allowanceTemplates,
    allowanceTypes,
    id,
  ]);

  useEffect(() => {
    setEstimatedPay((prev) => {
      const taxOnSalary = Math.round(
        computeTaxOnSalary(prev.grossSalary, taxDependents, {
          exchangeRateKhrPerUsd: payrollEngine.exchangeRate,
          brackets: taxBrackets,
        }) * 100
      ) / 100;
      if (
        taxOnSalary === prev.deductions.taxOnSalary &&
        prev.attendanceSummary?.dependents === taxDependents
      ) {
        return prev;
      }
      const deductions = {
        ...prev.deductions,
        taxOnSalary,
      };
      deductions.total =
        deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;
      const netSalary = Math.max(
        0,
        Math.round((prev.grossSalary - deductions.total) * 100) / 100
      );
      return {
        ...prev,
        deductions,
        netSalary,
        netSalaryKHR: usdToKhr(netSalary, prev.exchangeRate),
        attendanceSummary: prev.attendanceSummary
          ? { ...prev.attendanceSummary, dependents: taxDependents }
          : prev.attendanceSummary,
      };
    });
  }, [taxDependents, taxBrackets, payrollEngine.exchangeRate]);

  useEffect(() => {
    if (watchMaritalStatus === 'single') {
      setValue('spouseName', '');
      setValue('spouseHasWork', 'yes');
      setValue('spousePhone', '');
      setValue('children', []);
    }
  }, [watchMaritalStatus, setValue]);

  const marginalTaxRate = useMemo(
    () =>
      marginalTaxRateForIncome(
        estimatedPay.grossSalary || 0,
        taxBrackets,
        taxDependents,
        payrollEngine.exchangeRate
      ),
    [estimatedPay.grossSalary, taxBrackets, taxDependents, payrollEngine.exchangeRate]
  );

  const taxBracketRange = useMemo(
    () =>
      taxBracketRangeForIncome(
        estimatedPay.grossSalary || 0,
        taxBrackets,
        taxDependents,
        payrollEngine.exchangeRate
      ),
    [estimatedPay.grossSalary, taxBrackets, taxDependents, payrollEngine.exchangeRate]
  );

  const renderStepContent = () => {
      switch (currentStep) {
          case 0: return (
            <StepBasics
              register={register}
              errors={displayErrors}
              setValue={setValue}
              watchAccessRole={watchAll.accessRole}
              watchAllowLogin={!!watchAll.allowLogin}
              employeeDisplayId={id || watchAll.id}
              portalAccountLinked={portalAccountLinked}
              onValidateContact={() => void trigger(['email', 'phone'])}
              onPortalAccessChange={(enabled) => {
                if (!enabled) setPortalAccountLinked(false);
              }}
              isManager={isManager}
              isEdit={isEditMode}
            />
          );
          case 1: return (
            <StepPersonal
              register={register}
              errors={displayErrors}
              setValue={(name, value, opts) => setValue(name as Parameters<typeof setValue>[0], value, opts)}
              watchNationality={watchAll.nationality}
              watchReligion={watchAll.religion}
              watchBirthDate={watchAll.birthDate}
              avatarPreview={avatarPreview}
              fileInputRef={fileInputRef}
              handleImageChange={handleImageChange}
            />
          );
          case 2: return (
            <StepJob
              register={register}
              errors={displayErrors}
              departments={departments}
              positions={positions}
              isManager={isManager}
              watchAccessRole={watchAll.accessRole}
              watchDepartmentId={watchAll.departmentId}
              watchJoinDate={watchAll.joinDate}
              watchEmploymentType={watchAll.employmentType}
              watchProbationPeriodMonths={watchAll.probationPeriodMonths}
              setValue={setValue}
              onDepartmentCreated={(dept) => {
                setDepartments((prev) => {
                  if (prev.some((d) => d.id === dept.id)) {
                    return prev.map((d) => (d.id === dept.id ? { ...d, ...dept } : d));
                  }
                  return [...prev, dept].sort((a, b) =>
                    String(a.name || '').localeCompare(String(b.name || ''))
                  );
                });
                setValue('departmentId', dept.id, { shouldDirty: true });
                setValue('position', '', { shouldDirty: true });
                setPositions([]);
              }}
              onPositionCreated={(pos) => {
                setPositions((prev) => {
                  if (prev.some((p) => p.id === pos.id)) {
                    return prev.map((p) => (p.id === pos.id ? { ...p, ...pos } : p));
                  }
                  return [...prev, pos];
                });
                setValue('position', pos.id, { shouldDirty: true });
              }}
            />
          );
          case 3: return (
            <StepSchedule
              register={register}
              errors={displayErrors}
              setValue={setValue}
              watchTimeIn={watchAll.timeIn}
              watchTimeOut={watchAll.timeOut}
              watchBreakMinutes={watchAll.breakDurationMinutes}
              watchWorkHours={watchAll.workHours}
              leaveTypeOptions={leaveTypeOptions}
              leaveAssignments={watchAll.leaveAssignments ?? {}}
              leaveTypesLoading={leaveTypesLoading}
              onLeaveAssignmentToggle={(leaveTypeId, enabled) => {
                const current = getValues('leaveAssignments') ?? {};
                setValue(
                  'leaveAssignments',
                  { ...current, [leaveTypeId]: enabled },
                  { shouldDirty: true }
                );
              }}
            />
          );
          case 4: return (
            <StepContact
              register={register}
              errors={displayErrors}
              setValue={setValue}
              watchCountry={watchAll.country}
              watchCity={watchAll.city}
              watchCityKh={watchAll.cityKh}
            />
          );
          case 5:
            return (
              <StepFamily
                register={register}
                errors={displayErrors}
                watchMaritalStatus={watchMaritalStatus || 'single'}
                watchSpouseHasWork={watchSpouseHasWork as SpouseHasWork | undefined}
                watchChildren={(watchChildren ?? []) as EmployeeChildFormRow[]}
                childFields={childFields as import('react-hook-form').FieldArrayWithId<{ children: EmployeeChildFormRow[] }, 'children', 'id'>[]}
                appendChild={() => appendChild({ ...EMPTY_CHILD_ROW })}
                removeChild={removeChild}
              />
            );
          case 6:
            return (
              <StepSalary
                control={control as unknown as import('react-hook-form').Control<import('react-hook-form').FieldValues>}
                register={register}
                errors={displayErrors}
                estimatedPay={estimatedPay}
                taxRate={marginalTaxRate}
                taxBracketRange={taxBracketRange}
                taxDependents={taxDependents}
                setValue={setValue}
                watchPaymentMethod={normalizePaymentMethod(watchAll.paymentMethod)}
                watchNssfEnrolled={watchAll.nssfEnrolled !== false}
                engineConfig={payrollEngine}
                allowanceTemplates={allowanceTemplates}
                allowanceTypes={allowanceTypes}
                allowanceTemplateId={watchAll.allowanceTemplateId ?? ''}
                onAllowanceTemplateChange={(templateId) => {
                  allowancePackageTouchedRef.current = true;
                  setValue('allowanceTemplateId', templateId, {
                    shouldDirty: true,
                    shouldValidate: false,
                  });
                }}
                templatesLoading={allowanceTemplatesLoading}
                allowancePreviewLoading={allowancePreviewLoading}
                selectedPosition={selectedPosition}
                wizardSeniority={seniorityPayContext}
                joinDate={watchAll.joinDate}
                previewMonth={new Date().toISOString().slice(0, 7)}
                watchCurrency={normalizeContractCurrency(watchAll.currency)}
                workDayMethod={workDayMethod}
                companyBasisDays={companyBasisDays}
              />
            );
          case 7:
            return (
              <StepEmergency
                register={register}
                errors={displayErrors}
                setValue={(name, value, opts) => setValue(name as Parameters<typeof setValue>[0], value, opts)}
                watchEmergencyRelation={watchAll.emergencyRelation}
                watchEmergencyRelationKh={watchAll.emergencyRelationKh}
              />
            );
          case 8:
            return (
              <StepDocuments
                employeeDisplayId={id || watchAll.id}
                canSaveDraft={canSaveDraft(watchAll)}
                onSaveDraftForUploads={persistDraft}
              />
            );
          case 9: return (
            <StepReview
              watchAll={watchAll}
              avatarPreview={avatarPreview}
              departments={departments}
              managers={managers}
              positions={positions}
              jumpToStep={jumpToStep}
              employeeDisplayId={id || watchAll.id}
            />
          );
          default: return null;
      }
  };

  return (
    <>
      <SystemConfirmDialogHost />
      <ConfirmDialog
        open={saveConfirm != null}
        onClose={handleSaveDialogClose}
        title={saveConfirmMeta?.title ?? ''}
        description={saveConfirmMeta?.description ?? ''}
        variant="success"
        confirmLabel={saveConfirmMeta?.confirmLabel ?? t('onboarding.confirm.confirmSave')}
        cancelLabel={
          saveConfirm === 'leave' ? t('onboarding.confirm.stayOnPage') : t('onboarding.confirm.cancel')
        }
        showCancelAction={saveConfirm !== 'leave'}
        secondaryLabel={
          saveConfirm === 'leave' ? t('onboarding.confirm.leaveWithoutSaving') : undefined
        }
        onSecondary={saveConfirm === 'leave' ? handleLeaveDiscard : undefined}
        loading={saveConfirmLoading}
        onConfirm={() => void handleSaveConfirm()}
      />
      <div className="flex flex-col flex-1 min-h-0 w-full">
      <WorkflowWizardShell
        header={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => requestLeave(() => navigate('/employees/onboarding'))}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
                aria-label="Back to employee list"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                    {id ? t('onboarding.editTitle') : t('onboarding.title')}
                  </h2>
                  {showDraftBadge ? (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-[10px] font-bold uppercase rounded-full">
                      Draft
                    </span>
                  ) : showInactiveBadge ? (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold uppercase rounded-full">
                      Inactive
                    </span>
                  ) : id ? (
                    <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase rounded-full">
                      {t('common.active')}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase rounded-full">
                      New
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {id ? `${t('onboarding.editSubtitle')} ${watchAll.firstName}` : t('onboarding.subtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {lastSaved && (
                <span className="hidden sm:flex text-[10px] uppercase font-bold tracking-wider text-slate-400 items-center">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                  {t('onboarding.messages.saved')}{' '}
                  {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        }
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        maxReachableStep={currentStep}
        onStepChange={jumpToStep}
        stepHeader={{
          title: WIZARD_STEPS[currentStep]?.label ?? '',
        }}
        footer={
          <WizardFooterLayout
            left={
              currentStep > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  className="h-9 px-2 sm:px-2.5 text-slate-600 dark:text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4 sm:mr-1.5 shrink-0" aria-hidden />
                  <span className="hidden xs:inline">{t('onboarding.buttons.back')}</span>
                  <span className="sr-only xs:hidden">{t('onboarding.buttons.back')}</span>
                </Button>
              ) : null
            }
            right={
              <>
                {currentStep < WIZARD_STEPS.length - 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleNext}
                    className="h-9 w-auto px-2.5 sm:px-4 text-sm"
                  >
                    <span>{t('onboarding.buttons.nextShort')}</span>
                    <ChevronRight className="w-4 h-4 ml-1 shrink-0" aria-hidden />
                  </Button>
                )}
                {(showDraftBadge || isOnboardingInProgressStatus(recordStatus) || !id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSaveConfirm('draft')}
                    disabled={!canSaveDraft(watchAll)}
                    title={
                      canSaveDraft(watchAll)
                        ? t('onboarding.buttons.saveDraft')
                        : t('onboarding.messages.draftNeedsIdentity')
                    }
                    aria-label={t('onboarding.buttons.saveDraft')}
                    className="h-9 px-2 sm:px-2.5 text-slate-600 dark:text-slate-300"
                  >
                    <Save className="w-4 h-4 sm:mr-1.5 shrink-0" aria-hidden />
                    <span className="hidden sm:inline">{t('onboarding.buttons.saveDraft')}</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={openFooterSaveConfirm}
                  isLoading={isSubmitting}
                  className="h-9 w-auto bg-primary-600 hover:bg-primary-700 text-white shadow-md shadow-primary-500/30 px-3 sm:px-5 text-sm gap-1.5"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
                  ) : (
                    <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
                  )}
                  <span>
                    {id ? t('onboarding.buttons.saveProfile') : t('onboarding.buttons.finishShort')}
                  </span>
                </Button>
              </>
            }
          />
        }
      >
        <div className="max-w-5xl mx-auto">
          {isLoadingData ? (
            <ContentSkeleton layout="form" />
          ) : (
            <form className="w-full" onSubmit={(e) => e.preventDefault()}>
              {Object.keys(errors).length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-red-800 dark:text-red-300">{t('onboarding.messages.attention')}</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{t('onboarding.messages.fixErrors')}</p>
                    <ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-300 list-disc list-inside">
                      {flattenErrorMessages(errors).map((msg) => (
                        <li key={msg}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {renderStepContent()}
            </form>
          )}
        </div>
      </WorkflowWizardShell>
      </div>
    </>
  );
};
