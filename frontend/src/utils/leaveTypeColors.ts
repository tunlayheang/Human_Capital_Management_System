/**
 * Shared leave / roster chip colors (Planning calendar + roster builder + badges).
 * Uses the same semantic palette as StatusLabel (statusPalette.ts).
 */

import {
  statusTagClassNames,
  type StatusSemantic,
} from '../constants/statusPalette';

export type LeaveColorStyle = {
  /** Tailwind + hcms-status-tag classes for chips and roster cells. */
  chip: string;
  swatch: string;
  exportStyle: { bg: string; color: string; border: string };
};

const SEMANTIC_SWATCH: Record<StatusSemantic, string> = {
  pending: 'bg-[#E88B0C]',
  inProgress: 'bg-[#178FCC]',
  submitted: 'bg-[#7C5FD4]',
  inReview: 'bg-[#B8940A]',
  success: 'bg-[#28A058]',
  failed: 'bg-[#DC2626]',
  expired: 'bg-[#6B7280]',
};

const SEMANTIC_EXPORT: Record<StatusSemantic, { bg: string; color: string; border: string }> = {
  pending: { bg: '#FFF4E5', color: '#C76A00', border: '#FFDDB3' },
  inProgress: { bg: '#E8F4FC', color: '#0078C1', border: '#B8DCF5' },
  submitted: { bg: '#F3EEFF', color: '#6B4FBB', border: '#DDD0F5' },
  inReview: { bg: '#FFFBE8', color: '#9A7B00', border: '#F5EAA8' },
  success: { bg: '#E8F8EF', color: '#1F7A45', border: '#B8E6CB' },
  failed: { bg: '#FDECEC', color: '#B42318', border: '#FAC5C5' },
  expired: { bg: '#F1F3F5', color: '#5C6670', border: '#DDE1E6' },
};

const LEAVE_KIND_SEMANTIC: Record<string, StatusSemantic> = {
  annual: 'inProgress',
  sick: 'success',
  personal: 'submitted',
  maternity: 'pending',
  paternity: 'inReview',
  unpaid: 'expired',
  emergency: 'failed',
  holiday: 'failed',
  working: 'success',
  dayoff: 'expired',
  /** Roster Mission / business trip — same palette as ROSTER_MISSION_COLOR. */
  mission: 'inProgress',
};

const FALLBACK_SEMANTICS: StatusSemantic[] = [
  'inProgress',
  'success',
  'submitted',
  'pending',
  'inReview',
  'expired',
  'failed',
];

function styleForSemantic(semantic: StatusSemantic): LeaveColorStyle {
  return {
    chip: statusTagClassNames(semantic),
    swatch: SEMANTIC_SWATCH[semantic],
    exportStyle: SEMANTIC_EXPORT[semantic],
  };
}

function semanticForKind(kind: string | null, fallbackIndex = 0): StatusSemantic {
  if (kind && LEAVE_KIND_SEMANTIC[kind]) return LEAVE_KIND_SEMANTIC[kind]!;
  return FALLBACK_SEMANTICS[fallbackIndex % FALLBACK_SEMANTICS.length]!;
}

export const ROSTER_WORKING_COLOR: LeaveColorStyle = styleForSemantic('success');

export const ROSTER_DAY_OFF_COLOR: LeaveColorStyle = styleForSemantic('expired');

export const ROSTER_HOLIDAY_COLOR: LeaveColorStyle = styleForSemantic('failed');

/** Mission / business trip days — still clocked, distinct from Working. */
export const ROSTER_MISSION_COLOR: LeaveColorStyle = styleForSemantic('inProgress');

/** Fixed-roster day-off chips on Team Leave Calendar. */
export const PLANNING_DAY_OFF_CHIP = statusTagClassNames('expired');

/** Fixed-roster Mission chips on Team Leave Calendar. */
export const PLANNING_MISSION_CHIP = statusTagClassNames('inProgress');

/** Public holiday marker on Team Leave Calendar. */
export const PLANNING_HOLIDAY_CHIP = statusTagClassNames('failed');

/** Resolve a configured leave type to a stable color kind (not index-based). */
export function resolveLeaveColorKind(input: {
  name?: string | null;
  code?: string | null;
}): string | null {
  const code = String(input.code ?? '')
    .trim()
    .toUpperCase();
  const name = String(input.name ?? '')
    .trim()
    .toLowerCase();

  if (code === 'AL' || code === 'ANNUAL' || name.includes('annual') || name.includes('vacation')) {
    return 'annual';
  }
  if (code === 'ML' || name.includes('maternity')) return 'maternity';
  if (code === 'PL' || name.includes('paternity')) return 'paternity';
  if (code === 'SICK' || code.startsWith('SIC') || name.includes('sick')) return 'sick';
  if (code === 'UL' || code === 'UNPAID' || name.includes('unpaid')) return 'unpaid';
  if (code === 'PLV' || name.includes('personal')) return 'personal';
  if (name.includes('emergency')) return 'emergency';
  if (name.includes('holiday') || code === 'H' || code === 'PH' || code === 'PUBLIC_HOLIDAY') {
    return 'holiday';
  }
  if (
    code === 'M' ||
    code === 'MISSION' ||
    name === 'mission' ||
    name.includes('business trip')
  ) {
    return 'mission';
  }
  return null;
}

export function leaveColorForKind(kind: string | null, fallbackIndex = 0): LeaveColorStyle {
  return styleForSemantic(semanticForKind(kind, fallbackIndex));
}

export function leaveColorForLabel(label: string, fallbackIndex = 0): LeaveColorStyle {
  return leaveColorForKind(resolveLeaveColorKind({ name: label, code: label }), fallbackIndex);
}

/** Badge / calendar chip classes for a leave type label. */
export function chipClassesForLeaveTypeLabel(
  type: string,
  fallbackIndex = 0,
  size: 'sm' | 'md' = 'md'
): string {
  const kind = resolveLeaveColorKind({ name: type, code: type });
  const semantic = semanticForKind(kind, fallbackIndex);
  return `${statusTagClassNames(semantic)} hcms-status-tag--${size}`;
}
