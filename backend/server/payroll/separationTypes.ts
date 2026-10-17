/** Employee separation categories — drives workflow, payroll, and deduction rules. */

export type SeparationType =
  | 'normal_resignation'
  | 'resignation_without_notice'
  | 'absconded'
  | 'termination'
  | 'retirement';

export type SeparationRules = {
  separationType: SeparationType;
  targetStatus: string;
  label: string;
  requiresResignationLetter: boolean;
  allowsIncompleteClearance: boolean;
  defaultNoNoticePenaltyUsd?: number;
  stopAttendanceOnConfirm: boolean;
  stopOtOnFlag: boolean;
  stopLeaveRequestsOnConfirm: boolean;
};

export const SEPARATION_RULES: Record<SeparationType, SeparationRules> = {
  normal_resignation: {
    separationType: 'normal_resignation',
    targetStatus: 'resigned',
    label: 'Normal resignation',
    requiresResignationLetter: true,
    allowsIncompleteClearance: false,
    stopAttendanceOnConfirm: false,
    stopOtOnFlag: false,
    stopLeaveRequestsOnConfirm: false,
  },
  resignation_without_notice: {
    separationType: 'resignation_without_notice',
    targetStatus: 'resigned',
    label: 'Resignation without notice',
    requiresResignationLetter: false,
    allowsIncompleteClearance: true,
    defaultNoNoticePenaltyUsd: 0,
    stopAttendanceOnConfirm: true,
    stopOtOnFlag: true,
    stopLeaveRequestsOnConfirm: true,
  },
  absconded: {
    separationType: 'absconded',
    targetStatus: 'absconded',
    label: 'Absconded / job abandonment',
    requiresResignationLetter: false,
    allowsIncompleteClearance: true,
    stopAttendanceOnConfirm: true,
    stopOtOnFlag: true,
    stopLeaveRequestsOnConfirm: true,
  },
  termination: {
    separationType: 'termination',
    targetStatus: 'terminated',
    label: 'Termination',
    requiresResignationLetter: false,
    allowsIncompleteClearance: false,
    stopAttendanceOnConfirm: true,
    stopOtOnFlag: true,
    stopLeaveRequestsOnConfirm: true,
  },
  retirement: {
    separationType: 'retirement',
    targetStatus: 'retired',
    label: 'Retirement',
    requiresResignationLetter: false,
    allowsIncompleteClearance: false,
    stopAttendanceOnConfirm: true,
    stopOtOnFlag: false,
    stopLeaveRequestsOnConfirm: true,
  },
};

export function normalizeSeparationType(raw: unknown): SeparationType | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (s in SEPARATION_RULES) return s as SeparationType;
  if (s === 'resign') return 'normal_resignation';
  if (s === 'terminate') return 'termination';
  return null;
}

export function rulesForSeparation(type: SeparationType): SeparationRules {
  return SEPARATION_RULES[type];
}
