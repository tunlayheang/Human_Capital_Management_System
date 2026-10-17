import type { SeniorityPreview, SeniorityRule } from '../types/seniority';
import type { SeniorityIndemnityPreview } from '../types/seniorityIndemnity';
import type { RulesConfigHelpContent } from '../content/rulesConfigHelpContent';
import { getRulesConfigHelp } from '../content/rulesConfigHelpContent';
import type { PayrollEngineConfig } from './payrollEngineConfig';
import { describeSeniorityRule } from '../pages/payroll/payrollRulesDisplay';

export type WizardSeniorityPreview = {
  loading: boolean;
  hasActivePolicies: boolean;
  activeRules: SeniorityRule[];
  preview: SeniorityPreview | null;
  indemnityLoading: boolean;
  indemnityPreview: SeniorityIndemnityPreview | null;
};

export function isSeniorityIndemnityMonth(monthPrefix: string): boolean {
  const monthNum = parseInt(monthPrefix.slice(5, 7), 10);
  return monthNum === 6 || monthNum === 12;
}

export function seniorityIndemnityMonthName(monthPrefix: string): string {
  const monthNum = parseInt(monthPrefix.slice(5, 7), 10);
  if (monthNum === 6) return 'June';
  if (monthNum === 12) return 'December';
  return '';
}

export function resolveAppliedSeniorityRule(
  activeRules: SeniorityRule[],
  preview: SeniorityPreview | null
): SeniorityRule | null {
  if (!activeRules.length) return null;
  const ruleName = preview?.snapshot?.ruleName?.trim();
  if (ruleName) {
    const match = activeRules.find((r) => r.name === ruleName);
    if (match) return match;
  }
  return activeRules[0] ?? null;
}

export const SERVICE_INELIGIBLE_LABELS: Record<string, string> = {
  no_rule: 'No matching policy for this month',
  probation: 'Still in probation — service seniority not paid yet',
  min_service: 'Minimum service period not met',
  min_working_days: 'Not enough working days this month',
  unpaid_leave: 'Too many unpaid leave days',
  employment_type: 'Employment type not eligible',
  suspended: 'Employee suspended',
};

export const INDEMNITY_INELIGIBLE_LABELS: Record<string, string> = {
  disabled: 'Seniority indemnity disabled in compliance settings',
  no_service: 'No eligible service period yet',
  contract_type_ineligible: 'Contract type not eligible (UDC required)',
  employment_type_excluded: 'Employment type excluded from indemnity',
  inclusion_waiting_period: 'Waiting period before indemnity applies',
  not_payout_month: 'Paid in June and December payroll only',
  zero_payout_days: 'No indemnity days due this period',
};

export function ineligibleLabel(reason: string, map: Record<string, string>): string {
  if (map[reason]) return map[reason];
  if (reason.startsWith('status_')) return 'Employee status not eligible';
  return reason.replace(/_/g, ' ');
}

export function monthlySeniorityExampleHelp(
  preview: SeniorityPreview | null
): RulesConfigHelpContent {
  const base = getRulesConfigHelp('payroll.seniorityExamplePreview');
  const notes = [...(base.notes ?? [])];
  if (preview) {
    if (!preview.snapshot.eligible && preview.snapshot.ineligibleReason) {
      notes.unshift(
        `This sample would not pay: ${ineligibleLabel(String(preview.snapshot.ineligibleReason), SERVICE_INELIGIBLE_LABELS)}`
      );
    } else if (preview.snapshot.ruleName) {
      notes.unshift(`Matched policy: ${preview.snapshot.ruleName}`);
    }
  }
  return { ...base, notes };
}

export function indemnityExampleHelp(
  preview: SeniorityIndemnityPreview | null
): RulesConfigHelpContent {
  const base = getRulesConfigHelp('payroll.seniorityIndemnityExamplePreview');
  const notes = [...(base.notes ?? [])];
  if (preview?.formula) {
    notes.unshift(`Formula: ${preview.formula}`);
  }
  if (preview && !preview.eligible && preview.ineligibleReason) {
    notes.unshift(
      `This sample would not pay: ${ineligibleLabel(String(preview.ineligibleReason), INDEMNITY_INELIGIBLE_LABELS)}`
    );
  }
  return { ...base, notes };
}

function formatServiceYearsLabel(
  preview: SeniorityPreview | null,
  indemnityPreview: SeniorityIndemnityPreview | null,
  joinDate?: string
): string | null {
  if (indemnityPreview?.serviceLength?.label) {
    return joinDate
      ? `${indemnityPreview.serviceLength.label} · joined ${joinDate.slice(0, 10)}`
      : indemnityPreview.serviceLength.label;
  }
  const years = preview?.snapshot?.serviceYears;
  if (years == null) return null;
  const rounded = Math.round(years * 100) / 100;
  return joinDate
    ? `${rounded} yr${rounded === 1 ? '' : 's'} · joined ${joinDate.slice(0, 10)}`
    : `${rounded} yr${rounded === 1 ? '' : 's'}`;
}

export function seniorityPreviewSummaryLines(params: {
  baseSalary: number;
  joinDate?: string;
  monthPrefix: string;
  engineConfig: PayrollEngineConfig;
  wizardSeniority: WizardSeniorityPreview;
  serviceEntitlementUsd: number;
  indemnityUsd: number;
}): Array<{ label: string; detail?: string; amount?: number; muted?: boolean }> {
  const { wizardSeniority } = params;
  const preview = wizardSeniority.preview;
  const indemnityPreview = wizardSeniority.indemnityPreview;
  const lines: Array<{ label: string; detail?: string; amount?: number; muted?: boolean }> = [];

  const serviceYearsLabel = formatServiceYearsLabel(preview, indemnityPreview, params.joinDate);
  if (serviceYearsLabel) {
    lines.push({ label: 'Years of service', detail: serviceYearsLabel });
  }

  if (wizardSeniority.hasActivePolicies) {
    const appliedRule = resolveAppliedSeniorityRule(wizardSeniority.activeRules, preview);
    if (appliedRule) {
      lines.push({
        label: 'Service policy',
        detail: `${appliedRule.name} — ${describeSeniorityRule(appliedRule)}`,
      });
    }

    if (preview?.snapshot) {
      const snap = preview.snapshot;
      if (!snap.eligible && snap.ineligibleReason) {
        lines.push({
          label: 'Service payout this month',
          detail: ineligibleLabel(String(snap.ineligibleReason), SERVICE_INELIGIBLE_LABELS),
          amount: 0,
          muted: true,
        });
      } else if (snap.fullMonthAccrualUsd > 0) {
        const prorationPct = Math.round((snap.prorationFactor ?? 0) * 100);
        if (prorationPct > 0 && prorationPct < 100) {
          lines.push({
            label: 'Service seniority (prorated)',
            detail: `${prorationPct}% of full month (preview assumes 22 eligible days)`,
            amount: params.serviceEntitlementUsd,
          });
        } else if (params.serviceEntitlementUsd > 0) {
          lines.push({
            label: 'Service seniority this month',
            amount: params.serviceEntitlementUsd,
          });
        }
      } else if (params.serviceEntitlementUsd > 0) {
        lines.push({
          label: 'Service seniority this month',
          amount: params.serviceEntitlementUsd,
        });
      }
    }
  } else {
    lines.push({
      label: 'Service seniority',
      detail: 'No active policies on Payroll → Rules → Seniority.',
      amount: 0,
      muted: true,
    });
  }

  if (indemnityPreview?.eligible && params.indemnityUsd > 0) {
    lines.push({
      label: `Jun/Dec indemnity (${seniorityIndemnityMonthName(params.monthPrefix)})`,
      detail: indemnityPreview.formula || undefined,
      amount: params.indemnityUsd,
    });
  } else if (isSeniorityIndemnityMonth(params.monthPrefix)) {
    const reason = indemnityPreview?.ineligibleReason;
    lines.push({
      label: `Jun/Dec indemnity (${seniorityIndemnityMonthName(params.monthPrefix)})`,
      detail: reason
        ? ineligibleLabel(reason, INDEMNITY_INELIGIBLE_LABELS)
        : `${params.engineConfig.seniorityDaysPerYear ?? 15} days/yr — UDC employees, paid June & December`,
      amount: 0,
      muted: true,
    });
  }

  return lines;
}

export function seniorityTotalAddedToGross(
  serviceEntitlementUsd: number,
  indemnityUsd: number
): number {
  return Math.round((serviceEntitlementUsd + indemnityUsd) * 100) / 100;
}
