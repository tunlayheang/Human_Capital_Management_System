import type { EmployeeAppraisal } from '../../types/appraisal';
import { formatAppraisalScore } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import type { KpiGradeDefinition } from '../settings/KpiGradeSettingsPanel';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';

export type AppraisalMovementPrefill = {
  appraisalId: string;
  employeeId: string;
  employeeName: string;
  periodName: string;
  periodEndDate: string;
  finalGrade: string | null;
  weightedScore: number | null;
  recommendation: string | null;
  suggestedMovementType?: 'promotion' | 'salary_update' | 'transfer';
  suggestedSalaryIncreasePercent?: number;
};

/** Fallback rates when grade scale has not been loaded (matches backend defaults). */
const DEFAULT_PAY_RAISE_BY_GRADE: Record<string, number> = {
  'A+': 10,
  A: 8,
  'B+': 6,
  B: 5,
  'C+': 3,
  C: 2,
  D: 0,
  F: 0,
};

export function payRaiseRateForGrade(
  grade: string | null | undefined,
  grades?: KpiGradeDefinition[] | null
): number {
  const code = String(grade ?? '').trim().toUpperCase();
  if (!code) return 0;
  if (Array.isArray(grades) && grades.length) {
    const hit = grades.find((g) => String(g.code).trim().toUpperCase() === code);
    if (hit && Number.isFinite(Number(hit.payRaiseRate))) {
      return Math.max(0, Number(hit.payRaiseRate));
    }
  }
  return DEFAULT_PAY_RAISE_BY_GRADE[code] ?? 0;
}

export function suggestMovementTypeFromGrade(
  grade: string | null | undefined
): 'promotion' | 'salary_update' | null {
  const g = String(grade || '').trim().toUpperCase();
  if (g === 'A+' || g === 'A') return 'promotion';
  if (g === 'B+' || g === 'B') return 'salary_update';
  return null;
}

export function suggestedMovementTypeLabel(
  type: 'promotion' | 'salary_update' | 'transfer' | null | undefined
): string | null {
  if (type === 'promotion') return 'Promotion';
  if (type === 'salary_update') return 'Pay change';
  if (type === 'transfer') return 'Transfer';
  return null;
}

export function isAppraisalMovementReviewVisible(status: string | undefined): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === 'PENDING_FINAL_APPROVAL' || s === 'APPROVED' || s === 'CLOSED';
}

export type PlannedMovementFollowUp = {
  summary: string;
  detailLines: string[];
  suggestedType: 'promotion' | 'salary_update' | null;
  suggestedTypeLabel: string | null;
  recommendation: string | null;
};

/** Outcome summary approvers should review before signing off on final approval. */
export function plannedMovementFollowUp(appraisal: EmployeeAppraisal): PlannedMovementFollowUp {
  const suggestedType = suggestMovementTypeFromGrade(appraisal.final_grade);
  const suggestedTypeLabel = suggestedMovementTypeLabel(suggestedType);
  const recommendation = appraisal.recommendation?.trim() || null;
  const grade = appraisal.final_grade?.trim() || null;
  const score =
    appraisal.weighted_score != null && Number.isFinite(Number(appraisal.weighted_score))
      ? `${formatAppraisalScore(appraisal.weighted_score)}%`
      : null;

  const detailLines: string[] = [];
  if (grade) detailLines.push(`Final grade: ${grade}`);
  if (score) detailLines.push(`Weighted score: ${score}`);
  if (recommendation) detailLines.push(`HR recommendation: ${recommendation}`);
  if (appraisal.manager_recommendations?.trim()) {
    detailLines.push(`Manager recommendation: ${appraisal.manager_recommendations.trim()}`);
  }
  if (suggestedTypeLabel) {
    detailLines.push(`Typical follow-up for this grade: ${suggestedTypeLabel}`);
  } else {
    detailLines.push('Confirm whether promotion, transfer, or pay change applies after approval.');
  }
  const raiseRate = payRaiseRateForGrade(grade);
  if (raiseRate > 0 && (suggestedType === 'promotion' || suggestedType === 'salary_update')) {
    detailLines.push(`Pay raise rate rule for grade ${grade}: ${raiseRate}%`);
  }
  detailLines.push('Employee movement is recorded after final approval in Employee movements.');

  const summary = recommendation
    ? recommendation
    : suggestedTypeLabel
      ? `${suggestedTypeLabel} may apply based on grade ${grade ?? 'outcome'}.`
      : 'Review whether employee movement follow-up is required.';

  return {
    summary,
    detailLines,
    suggestedType,
    suggestedTypeLabel,
    recommendation,
  };
}

/** First calendar day of the month after period end — avoids frozen payroll month defaults. */
export function defaultMovementEffectiveDate(periodEndDate: string | null | undefined): string {
  const periodEnd = String(periodEndDate ?? '').slice(0, 10);
  if (periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    const [y, m] = periodEnd.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  }
  return todayYmdInCompanyTz();
}

export function buildAppraisalMovementPrefill(
  appraisal: EmployeeAppraisal & {
    employeeCode?: string | null;
    periodEndDate?: string | null;
  },
  movementType: 'promotion' | 'salary_update' | 'transfer',
  grades?: KpiGradeDefinition[] | null
): AppraisalMovementPrefill | null {
  const employeeId = String(appraisal.employeeCode ?? '').trim();
  if (!employeeId) return null;

  const suggested = suggestMovementTypeFromGrade(appraisal.final_grade);
  const effectiveDefault = defaultMovementEffectiveDate(appraisal.periodEndDate);
  const raiseRate = payRaiseRateForGrade(appraisal.final_grade, grades);

  return {
    appraisalId: appraisal.id,
    employeeId,
    employeeName: appraisal.employeeName ?? employeeId,
    periodName: appraisal.periodName ?? 'Appraisal period',
    periodEndDate: effectiveDefault,
    finalGrade: appraisal.final_grade,
    weightedScore:
      appraisal.weighted_score != null && Number.isFinite(Number(appraisal.weighted_score))
        ? Number(appraisal.weighted_score)
        : null,
    recommendation: appraisal.recommendation,
    suggestedMovementType: movementType,
    suggestedSalaryIncreasePercent:
      suggested === 'salary_update' ||
      movementType === 'salary_update' ||
      movementType === 'promotion'
        ? raiseRate
        : undefined,
  };
}

export function appraisalMovementNote(prefill: AppraisalMovementPrefill): string {
  const scoreLine =
    prefill.weightedScore != null
      ? `${formatAppraisalScore(prefill.weightedScore)}% (${prefill.finalGrade ?? '—'})`
      : prefill.finalGrade ?? '—';
  return `Following KPI appraisal "${prefill.periodName}" — score ${scoreLine}.`;
}

export function isAppraisalReadyForMovement(status: string): boolean {
  return status === 'APPROVED' || status === 'CLOSED';
}

export const APPRAISAL_MOVEMENT_PREFILL_STORAGE_KEY = 'hcms:movement-appraisal-prefill';

export function persistAppraisalMovementPrefill(prefill: AppraisalMovementPrefill): void {
  try {
    sessionStorage.setItem(APPRAISAL_MOVEMENT_PREFILL_STORAGE_KEY, JSON.stringify(prefill));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readAppraisalMovementPrefill(): AppraisalMovementPrefill | null {
  try {
    const raw = sessionStorage.getItem(APPRAISAL_MOVEMENT_PREFILL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppraisalMovementPrefill;
  } catch {
    return null;
  }
}

export function clearAppraisalMovementPrefill(): void {
  try {
    sessionStorage.removeItem(APPRAISAL_MOVEMENT_PREFILL_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function movementTypeForAppraisalFollowUp(
  type: EmployeeMovementRow['movementType']
): string {
  if (type === 'salary_update') return 'Pay change';
  if (type === 'promotion') return 'Promotion';
  return 'Transfer';
}
