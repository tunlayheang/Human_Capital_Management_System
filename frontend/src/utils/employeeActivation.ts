import type { EmployeeDocumentRow } from '../types/employeeDocument';
import { normalizeEmployeeDocumentType } from '../constants/employeeDocumentTypes';
import {
  NATIONALITY_PRESET_VALUES,
  RELIGION_PRESET_VALUES,
} from '../constants/khmerPersonalChoices';
import type { EmployeeFormValues } from '../pages/EmployeeInput';
import {
  hasValidEmployeePhone,
  hasValidWorkEmail,
  isLikelyDraftPlaceholderPhone,
} from './employeeDraft';
import { validateOtherSpecification } from './selectWithOther';
import { BIRTH_DATE_FUTURE_MESSAGE, isFutureCompanyDate } from './companyCalendar';

/** Document types required before an employee can be activated. */
export const REQUIRED_EMPLOYEE_DOCUMENT_TYPES = [
  'National ID',
  'Passport',
  'Contract',
] as const;

export function uploadedDocumentTypes(documents: EmployeeDocumentRow[]): Set<string> {
  return new Set(documents.map((d) => normalizeEmployeeDocumentType(d.documentType)));
}

export function missingRequiredDocumentTypes(documents: EmployeeDocumentRow[]): string[] {
  const have = uploadedDocumentTypes(documents);
  return REQUIRED_EMPLOYEE_DOCUMENT_TYPES.filter((t) => !have.has(t));
}

export function areRequiredDocumentsUploaded(documents: EmployeeDocumentRow[]): boolean {
  return missingRequiredDocumentTypes(documents).length === 0;
}

export type ActivationCheckOptions = {
  portalAccountExists?: boolean;
  avatarUrl?: string | null;
  documents?: EmployeeDocumentRow[];
  /** Selected job position — used to enforce salary range on pay step. */
  selectedPosition?: {
    title?: string;
    salary?: number;
    salaryMin?: number;
    salaryMax?: number;
  };
};

const REQUIRED_MSG = 'This field is required';

export type ActivationFieldErrors = Partial<Record<keyof EmployeeFormValues, string>>;

export type ActivationIssueDetails = {
  /** Human-readable blockers (same order as historical activation checks). */
  blockers: string[];
  /** Per-field messages for red wizard alerts (keyed by form field). */
  fieldErrors: ActivationFieldErrors;
};

/**
 * Field-level activation issues. Keep in sync with activationBlockersExtended —
 * blockers are derived from this so order and requirements stay aligned.
 */
export function collectActivationIssueDetails(
  values: EmployeeFormValues,
  _options?: ActivationCheckOptions
): ActivationIssueDetails {
  const fieldErrors: ActivationFieldErrors = {};
  const blockers: string[] = [];

  if (!String(values.lastName ?? '').trim()) {
    fieldErrors.lastName = REQUIRED_MSG;
  }
  if (!String(values.firstName ?? '').trim()) {
    fieldErrors.firstName = REQUIRED_MSG;
  }
  if (fieldErrors.firstName || fieldErrors.lastName) {
    blockers.push('First and last name');
  }

  if (!String(values.id ?? '').trim()) {
    fieldErrors.id = REQUIRED_MSG;
    blockers.push('Employee ID');
  }
  if (!hasValidWorkEmail(values.email)) {
    fieldErrors.email = 'Enter a valid work email';
    blockers.push('Valid work email');
  }
  if (
    !hasValidEmployeePhone(values.phone) ||
    isLikelyDraftPlaceholderPhone(values.phone, values.id)
  ) {
    fieldErrors.phone = 'Enter a valid phone number';
    blockers.push('Valid phone number');
  }

  if (!String(values.departmentId ?? '').trim()) {
    fieldErrors.departmentId = REQUIRED_MSG;
    blockers.push('Department');
  }
  if (!String(values.position ?? '').trim()) {
    fieldErrors.position = REQUIRED_MSG;
    blockers.push('Job position');
  }
  if (!String(values.joinDate ?? '').trim()) {
    fieldErrors.joinDate = REQUIRED_MSG;
    blockers.push('Join date');
  }

  if (!String(values.gender ?? '').trim()) {
    fieldErrors.gender = REQUIRED_MSG;
    blockers.push('Gender');
  }
  if (!String(values.birthDate ?? '').trim()) {
    fieldErrors.birthDate = REQUIRED_MSG;
    blockers.push('Date of birth');
  } else if (isFutureCompanyDate(values.birthDate)) {
    fieldErrors.birthDate = BIRTH_DATE_FUTURE_MESSAGE;
    blockers.push(BIRTH_DATE_FUTURE_MESSAGE);
  }
  if (!String(values.nationality ?? '').trim()) {
    fieldErrors.nationality = REQUIRED_MSG;
    blockers.push('Nationality');
  } else {
    const natErr = validateOtherSpecification(
      values.nationality,
      NATIONALITY_PRESET_VALUES,
      'Nationality (specify Other)'
    );
    if (natErr) {
      fieldErrors.nationality = natErr;
      blockers.push(natErr);
    }
  }
  if (!String(values.religion ?? '').trim()) {
    fieldErrors.religion = REQUIRED_MSG;
    blockers.push('Religion');
  } else {
    const relErr = validateOtherSpecification(
      values.religion,
      RELIGION_PRESET_VALUES,
      'Religion (specify Other)'
    );
    if (relErr) {
      fieldErrors.religion = relErr;
      blockers.push(relErr);
    }
  }

  if (!String(values.address ?? '').trim()) {
    fieldErrors.address = REQUIRED_MSG;
    blockers.push('Address');
  }
  if (!String(values.city ?? '').trim()) {
    fieldErrors.city = REQUIRED_MSG;
    blockers.push('City');
  }

  if (!/^\d{2}:\d{2}$/.test(String(values.timeIn ?? ''))) {
    fieldErrors.timeIn = 'Use HH:MM format';
    blockers.push('Work schedule (time in)');
  }
  if (!/^\d{2}:\d{2}$/.test(String(values.timeOut ?? ''))) {
    fieldErrors.timeOut = 'Use HH:MM format';
    blockers.push('Work schedule (time out)');
  }
  if (values.workDays == null || Number(values.workDays) < 1) {
    fieldErrors.workDays = REQUIRED_MSG;
    blockers.push('Work days per week');
  }
  if (values.gracePeriodMinutes == null || Number.isNaN(Number(values.gracePeriodMinutes))) {
    fieldErrors.gracePeriodMinutes = REQUIRED_MSG;
    blockers.push('Grace period (minutes)');
  }
  if (
    values.breakDurationMinutes == null ||
    Number.isNaN(Number(values.breakDurationMinutes))
  ) {
    fieldErrors.breakDurationMinutes = REQUIRED_MSG;
    blockers.push('Break duration (minutes)');
  }

  if (
    values.basicSalary === undefined ||
    values.basicSalary === null ||
    Number(values.basicSalary) <= 0
  ) {
    fieldErrors.basicSalary = 'Enter a base salary greater than 0';
    blockers.push('Base salary');
  }
  if (values.paymentMethod !== 'cash') {
    if (!String(values.bankName ?? '').trim()) {
      fieldErrors.bankName = REQUIRED_MSG;
      blockers.push('Bank name');
    }
    if (!String(values.bankAccount ?? '').trim()) {
      fieldErrors.bankAccount = REQUIRED_MSG;
      blockers.push('Bank account number');
    }
  }

  if (values.maritalStatus === 'married') {
    if (!String(values.spouseName ?? '').trim()) {
      fieldErrors.spouseName = REQUIRED_MSG;
      blockers.push('Spouse name');
    }
    if (values.spouseHasWork !== 'yes' && values.spouseHasWork !== 'no') {
      fieldErrors.spouseHasWork = REQUIRED_MSG;
      blockers.push('Spouse employment status');
    }
    if (!String(values.spousePhone ?? '').trim()) {
      fieldErrors.spousePhone = REQUIRED_MSG;
      blockers.push('Spouse phone');
    }
  }

  if (!String(values.emergencyName ?? '').trim()) {
    fieldErrors.emergencyName = REQUIRED_MSG;
    blockers.push('Emergency contact name');
  }
  if (!String(values.emergencyRelation ?? '').trim()) {
    fieldErrors.emergencyRelation = REQUIRED_MSG;
    blockers.push('Emergency contact relationship');
  }
  if (
    !String(values.emergencyPhone ?? '').trim() ||
    !/^\d{8,11}$/.test(String(values.emergencyPhone).replace(/\D/g, ''))
  ) {
    fieldErrors.emergencyPhone = 'Enter a valid phone number (digits only)';
    blockers.push('Emergency contact phone');
  }

  return { blockers, fieldErrors };
}

export function activationBlockersExtended(
  values: EmployeeFormValues,
  options?: ActivationCheckOptions
): string[] {
  return collectActivationIssueDetails(values, options).blockers;
}

export function isEmployeeProfileReadyForActive(
  values: EmployeeFormValues,
  options?: ActivationCheckOptions
): boolean {
  return activationBlockersExtended(values, options).length === 0;
}
