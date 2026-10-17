import type { ProbationRatingLevel, ProbationReviewStatus, ProbationRow } from '../../types';

export type ProbationListTabId =
  | 'all'
  | 'in_review'
  | 'pending_manager'
  | 'pending_employee'
  | 'pending_hr'
  | 'pending_approval'
  | 'passed'
  | 'extended'
  | 'failed'
  | 'rejected';

type ProbationListTabDef = {
  id: ProbationListTabId;
  label: string;
  statuses: ProbationReviewStatus[] | null;
};

export const PROBATION_LIST_TAB_DEFS: ProbationListTabDef[] = [
  {
    id: 'in_review',
    label: 'In review',
    statuses: ['UPCOMING', 'REVIEW_DUE', 'IN_REVIEW', 'EXTENDED'],
  },
  { id: 'pending_manager', label: 'Pending manager', statuses: ['PENDING_MANAGER'] },
  { id: 'pending_employee', label: 'Pending employee', statuses: ['PENDING_EMPLOYEE'] },
  { id: 'pending_hr', label: 'Pending HR', statuses: ['PENDING_HR'] },
  { id: 'pending_approval', label: 'Pending approval', statuses: ['PENDING_FINAL_APPROVAL'] },
  { id: 'all', label: 'All', statuses: null },
  { id: 'passed', label: 'Passed', statuses: ['PASSED'] },
  { id: 'extended', label: 'Extended', statuses: ['EXTENDED'] },
  { id: 'failed', label: 'Failed', statuses: ['FAILED'] },
  { id: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
];

export function filterProbationRowsByTab(
  rows: ProbationRow[],
  tabId: ProbationListTabId
): ProbationRow[] {
  if (tabId === 'all') return rows;
  const def = PROBATION_LIST_TAB_DEFS.find((t) => t.id === tabId);
  if (!def?.statuses) return rows;
  return rows.filter((r) => def.statuses!.includes(r.status));
}

export const PROBATION_ACTIVE_TAB_IDS: ProbationListTabId[] = [
  'in_review',
  'pending_manager',
  'pending_employee',
  'pending_hr',
  'pending_approval',
  'all',
];

export const PROBATION_COMPLETED_TAB_IDS: ProbationListTabId[] = [
  'passed',
  'extended',
  'failed',
  'rejected',
  'all',
];

export function buildProbationListTabs(rows: ProbationRow[]) {
  return PROBATION_LIST_TAB_DEFS.map((def) => ({
    ...def,
    count:
      def.id === 'all'
        ? rows.length
        : rows.filter((r) => def.statuses?.includes(r.status)).length,
  }));
}

export const PROBATION_ALL_PHASE_TAB_IDS: ProbationListTabId[] = [
  'in_review',
  'pending_manager',
  'pending_employee',
  'pending_hr',
  'pending_approval',
  'passed',
  'extended',
  'failed',
  'rejected',
  'all',
];

export function buildProbationListTabsForPhase(
  rows: ProbationRow[],
  phase: 'all' | 'active' | 'completed'
) {
  const ids =
    phase === 'all'
      ? PROBATION_ALL_PHASE_TAB_IDS
      : phase === 'active'
        ? PROBATION_ACTIVE_TAB_IDS
        : PROBATION_COMPLETED_TAB_IDS;
  return ids.map((id) => {
    const def = PROBATION_LIST_TAB_DEFS.find((t) => t.id === id);
    if (!def) return { id, label: id, count: 0 };
    const label =
      id === 'all'
        ? phase === 'active'
          ? 'All active'
          : phase === 'completed'
            ? 'All completed'
            : 'All'
        : def.label;
    const count =
      id === 'all'
        ? rows.length
        : rows.filter((r) => def.statuses?.includes(r.status)).length;
    return { id: def.id, label, count };
  });
}

export function probationListEmptyMessage(
  tabId: ProbationListTabId,
  options?: { assignedOnly?: boolean }
): string {
  if (tabId === 'all') {
    return options?.assignedOnly
      ? 'No probation reviews assigned to you right now.'
      : 'No employees in probation review scope.';
  }
  const label = PROBATION_LIST_TAB_DEFS.find((t) => t.id === tabId)?.label ?? 'this status';
  return `No employees with status "${label.toLowerCase()}".`;
}

export const PROBATION_RATING_OPTIONS: { value: ProbationRatingLevel; label: string }[] = [
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD', label: 'Good' },
  { value: 'AVERAGE', label: 'Average' },
  { value: 'NEEDS_IMPROVEMENT', label: 'Needs Improvement' },
];

export const PROBATION_EXTENSION_OPTIONS = [15, 30, 60, 90] as const;

export function probationStatusLabel(status: ProbationReviewStatus): string {
  switch (status) {
    case 'UPCOMING':
      return 'Upcoming';
    case 'REVIEW_DUE':
      return 'Review Due';
    case 'IN_REVIEW':
      return 'In Review';
    case 'PENDING_MANAGER':
      return 'Pending Manager';
    case 'PENDING_EMPLOYEE':
      return 'Pending Employee';
    case 'PENDING_HR':
      return 'Pending HR';
    case 'PENDING_FINAL_APPROVAL':
      return 'Pending approval';
    case 'PASSED':
      return 'Passed';
    case 'EXTENDED':
      return 'Extended';
    case 'FAILED':
      return 'Failed';
    case 'REJECTED':
      return 'Rejected';
    default:
      return status;
  }
}

export function probationStatusVariant(
  status: ProbationReviewStatus
): 'success' | 'danger' | 'info' | 'warning' | 'neutral' {
  if (status === 'PASSED') return 'success';
  if (status === 'FAILED' || status === 'REJECTED') return 'danger';
  if (status === 'IN_REVIEW') return 'info';
  if (status === 'PENDING_MANAGER') return 'warning';
  if (status === 'PENDING_EMPLOYEE') return 'info';
  if (status === 'PENDING_HR') return 'warning';
  if (status === 'PENDING_FINAL_APPROVAL') return 'warning';
  if (status === 'EXTENDED') return 'warning';
  if (status === 'REVIEW_DUE') return 'warning';
  return 'neutral';
}

export function deriveClientRecommendation(
  ratings: Record<string, ProbationRatingLevel | ''>
): string {
  const scoreMap: Record<ProbationRatingLevel, number> = {
    EXCELLENT: 4,
    GOOD: 3,
    AVERAGE: 2,
    NEEDS_IMPROVEMENT: 1,
  };
  const values = Object.values(ratings).filter(Boolean) as ProbationRatingLevel[];
  if (values.length < 4) return 'Complete all ratings';
  const avg = values.reduce((sum, v) => sum + scoreMap[v], 0) / values.length;
  const weak = values.filter((v) => v === 'NEEDS_IMPROVEMENT').length;
  if (weak >= 2 || avg < 1.75) return 'Fail Probation — significant improvement needed';
  if (avg >= 3) return 'Pass Probation — meets expectations';
  return 'Extend Probation — more observation time recommended';
}

export function addDaysIso(base: string, days: number): string {
  const d = new Date(`${base.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
