import { isOffboardedStatus, normalizeSettlementStatus } from './offboardingWizardSteps';

const OPEN_SETTLEMENT_STATUSES = new Set([
  'DRAFT',
  'HR_REVIEW',
  'FINANCE_REVIEW',
  'MANAGEMENT_APPROVAL',
  'APPROVED',
  'PENDING_REMOVAL_APPROVAL',
]);

export type HubPrimaryBadge =
  | { kind: 'complete' }
  | { kind: 'awaiting_payroll' }
  | { kind: 'in_progress' }
  | { kind: 'exit_type'; isResignation: boolean };

/** Workflow finished: no-pay path (inactive) or pay path after payroll run (inactive). */
export function isOffboardingWorkflowComplete(
  settlementStatus: string,
  employeeStatus?: string
): boolean {
  const st = normalizeSettlementStatus(settlementStatus);
  if (st === 'PAID' || st === 'LOCKED') return true;
  if (st === 'PENDING_PAYROLL_OFFBOARD' || OPEN_SETTLEMENT_STATUSES.has(st)) return false;
  if (isOffboardedStatus(employeeStatus)) return true;
  return false;
}

export function isOffboardingAwaitingPayroll(settlementStatus: string): boolean {
  return normalizeSettlementStatus(settlementStatus) === 'PENDING_PAYROLL_OFFBOARD';
}

export function resolveHubPrimaryBadge(params: {
  settlementStatus: string;
  employeeStatus?: string;
  offboardType?: string | null;
  hubInProgress: boolean;
}): HubPrimaryBadge {
  const st = normalizeSettlementStatus(params.settlementStatus);
  if (st === 'PENDING_PAYROLL_OFFBOARD') return { kind: 'awaiting_payroll' };
  if (isOffboardingWorkflowComplete(st, params.employeeStatus)) return { kind: 'complete' };
  if (params.hubInProgress || OPEN_SETTLEMENT_STATUSES.has(st)) return { kind: 'in_progress' };
  if (isOffboardedStatus(params.employeeStatus)) {
    const status = String(params.employeeStatus ?? '').toLowerCase();
    const offboardType = String(params.offboardType ?? '').toLowerCase();
    const isResignation = status === 'resigned' || offboardType === 'resign';
    return { kind: 'exit_type', isResignation };
  }
  return { kind: 'in_progress' };
}

/** Human-readable outcome for the pay / no-pay workflow (hub card detail). */
export function hubWorkflowOutcomeLabel(
  t: (key: string) => string,
  settlementStatus: string
): string | null {
  const st = normalizeSettlementStatus(settlementStatus);
  if (st === 'LOCKED') return t('offboarding.hub.outcomeNoPayInactive');
  if (st === 'PAID') return t('offboarding.hub.outcomePaidInactive');
  if (st === 'PENDING_PAYROLL_OFFBOARD') return t('offboarding.hub.outcomeAwaitingPayroll');
  return null;
}

export type OffboardOriginKind = 'wizard' | 'probation' | 'employee' | 'abandonment';

const OFFBOARD_ORIGIN_KINDS = new Set<OffboardOriginKind>([
  'wizard',
  'probation',
  'employee',
  'abandonment',
]);

export function normalizeOffboardOrigin(raw: unknown): OffboardOriginKind | null {
  const val = String(raw ?? '')
    .trim()
    .toLowerCase();
  return OFFBOARD_ORIGIN_KINDS.has(val as OffboardOriginKind)
    ? (val as OffboardOriginKind)
    : null;
}

export function resolveOffboardOrigin(params: {
  offboardSource?: string | null;
  settlementClearance?: unknown;
  inProgress?: boolean;
}): OffboardOriginKind | null {
  const stored = normalizeOffboardOrigin(params.offboardSource);
  if (stored) return stored;

  if (params.settlementClearance) {
    try {
      const parsed =
        typeof params.settlementClearance === 'string'
          ? (JSON.parse(params.settlementClearance) as Record<string, unknown>)
          : (params.settlementClearance as Record<string, unknown>);
      const meta = parsed._offboardMeta as { source?: string } | undefined;
      const fromMeta = normalizeOffboardOrigin(meta?.source);
      if (fromMeta) return fromMeta;
    } catch {
      /* ignore malformed clearance */
    }
  }

  if (params.inProgress) return 'wizard';
  return null;
}

export function offboardOriginLabel(
  t: (key: string) => string,
  origin: OffboardOriginKind
): string {
  switch (origin) {
    case 'wizard':
      return t('offboarding.hub.originWizard');
    case 'probation':
      return t('offboarding.hub.originProbation');
    case 'employee':
      return t('offboarding.hub.originEmployee');
    case 'abandonment':
      return t('offboarding.hub.originAbandonment');
    default:
      return origin;
  }
}
