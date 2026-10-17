import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowRightLeft,
  Award,
  Calendar,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  DollarSign,
  PenLine,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { StatusLabel } from '../ui/StatusLabel';
import { formatCurrency } from '../../utils';
import { formatSalaryChangePercent } from '../../utils/contractMoney';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from '../../utils/formatDisplayDate';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromMovementRow,
} from './EmployeeListIdentity';

export function formatMovementDate(iso: string): string {
  return formatDateOnlyDisplay(iso, iso);
}

export function formatMovementDateTime(iso: string): string {
  return formatDateTimeDisplay(iso, iso);
}

export function movementRecordedByLabel(name: string | null | undefined): string {
  const n = String(name ?? '').trim();
  return n || 'Unknown';
}

export function MovementRecordedMeta({
  row,
  align = 'left',
}: {
  row: EmployeeMovementRow;
  align?: 'left' | 'right';
}) {
  const by = movementRecordedByLabel(row.createdByName);
  const at = row.createdAt ? formatMovementDateTime(row.createdAt) : '—';
  const alignClass = align === 'right' ? 'text-right' : '';

  return (
    <div className={`min-w-0 ${alignClass}`}>
      <p className="text-slate-700 dark:text-slate-200 truncate">{by}</p>
      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
        <Clock className="w-3 h-3 shrink-0" aria-hidden />
        <time dateTime={row.createdAt || undefined}>{at}</time>
      </p>
    </div>
  );
}

export function movementTypeLabel(type: EmployeeMovementRow['movementType']): string {
  const map: Record<string, string> = {
    transfer: 'Transfer',
    promotion: 'Promotion',
    demotion: 'Demotion',
    salary_increase: 'Salary increase',
    salary_adjustment: 'Salary adjustment',
    salary_update: 'Pay change',
    employment_status_change: 'Employment status',
    contract_type_change: 'Contract type',
    department_change: 'Department change',
    position_change: 'Position change',
    branch_change: 'Branch change',
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

export function movementStatusBadge(
  status: string,
  canonicalStatus?: string,
  approvalProgress?: { approved: number; total: number } | null
) {
  const canon = String(canonicalStatus ?? '').toLowerCase();
  const s = String(status ?? '').toLowerCase();
  const code = canon || s || status;

  if (canon === 'draft' || s === 'draft') {
    return <StatusLabel status="DRAFT" context="movement" label="Draft" size="sm" />;
  }
  if (canon === 'pending' || s === 'pending_approval' || s === 'pending') {
    if (approvalProgress && approvalProgress.total > 1) {
      const label =
        approvalProgress.approved > 0
          ? `Pending · ${approvalProgress.approved}/${approvalProgress.total} approved`
          : `Pending · ${approvalProgress.total} approvers`;
      return <StatusLabel status="PENDING" context="movement" label={label} size="sm" />;
    }
    return <StatusLabel status="PENDING" context="movement" label="Pending approval" size="sm" />;
  }
  if (canon === 'returned' || s === 'returned') {
    return <StatusLabel status="RETURNED" context="movement" label="Returned" size="sm" />;
  }
  if (canon === 'rejected' || s === 'rejected') {
    return <StatusLabel status="REJECTED" context="movement" label="Rejected" size="sm" />;
  }
  if (canon === 'approved' || s === 'scheduled' || s === 'approved') {
    return (
      <StatusLabel
        status="SCHEDULED"
        context="movement"
        label="Approved — awaiting effective date"
        size="sm"
      />
    );
  }
  if (canon === 'applied' || s === 'applied' || (s === 'completed' && canon !== 'approved')) {
    return <StatusLabel status="APPLIED" context="movement" label="Applied" size="sm" />;
  }
  if (canon === 'cancelled' || s === 'cancelled') {
    return <StatusLabel status="CANCELLED" context="movement" label="Cancelled" size="sm" />;
  }
  return <StatusLabel status={code} context="movement" label="Applied" size="sm" />;
}

export type MovementApproverEntry = NonNullable<EmployeeMovementRow['assignedApprovers']>[number];

export function isMovementPendingApproval(row: EmployeeMovementRow): boolean {
  const canon = String(row.canonicalStatus ?? '').toLowerCase();
  const s = String(row.status ?? '').toLowerCase();
  return canon === 'pending' || s === 'pending_approval' || s === 'pending';
}

export function resolveMovementApprovers(row: EmployeeMovementRow): Array<
  NonNullable<EmployeeMovementRow['assignedApprovers']>[number] & {
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }
> {
  if (row.assignedApprovers?.length) {
    return row.assignedApprovers.map((entry, index) => {
      const phase =
        entry.phase ??
        (entry.status === 'approved'
          ? 'approved'
          : row.currentApproverUserId === entry.userId
            ? 'current'
            : 'queued');
      return {
        ...entry,
        sortOrder: entry.sortOrder ?? index,
        phase,
      };
    });
  }
  const legacyId = String(row.assignedApproverUserId ?? '').trim();
  if (!legacyId) return [];
  const legacyApproved = !isMovementPendingApproval(row);
  return [
    {
      userId: legacyId,
      name: row.assignedApproverName ?? null,
      status: legacyApproved ? 'approved' : 'pending',
      approvedAt: legacyApproved ? row.approvedAt ?? null : null,
      sortOrder: 0,
      phase: legacyApproved ? 'approved' : 'current',
    },
  ];
}

export function MovementApprovalTracker({
  row,
  compact = false,
}: {
  row: EmployeeMovementRow;
  compact?: boolean;
}) {
  const approvers = resolveMovementApprovers(row);
  if (!approvers.length) return null;

  const pending = isMovementPendingApproval(row);
  const approvedCount = approvers.filter((entry) => entry.status === 'approved').length;
  const total = approvers.length;
  const progressPct = total > 0 ? Math.round((approvedCount / total) * 100) : 0;
  const showTracker = pending || total > 1;
  if (!showTracker) return null;

  const heading = pending
    ? row.currentApproverName
      ? `Awaiting review by ${row.currentApproverName} (step ${approvedCount + 1} of ${total})`
      : approvedCount > 0
        ? `Approval routing (${approvedCount} of ${total} complete)`
        : `Waiting for approval (${total} approver${total === 1 ? '' : 's'})`
    : `Approved by ${total} approver${total === 1 ? '' : 's'}`;

  return (
    <div
      className={`rounded-lg border ${
        pending
          ? 'border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
          : 'border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/15'
      } ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p
          className={`font-semibold text-slate-800 dark:text-slate-100 ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {heading}
        </p>
        {total > 1 ? (
          <span
            className={`tabular-nums font-medium ${
              pending ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
            } ${compact ? 'text-[10px]' : 'text-xs'}`}
          >
            {approvedCount}/{total}
          </span>
        ) : null}
      </div>

      {total > 1 ? (
        <div
          className="h-1.5 rounded-full bg-white/80 dark:bg-slate-900/40 overflow-hidden mb-2.5"
          aria-hidden
        >
          <div
            className={`h-full rounded-full transition-all ${
              pending ? 'bg-amber-500 dark:bg-amber-400' : 'bg-emerald-500 dark:bg-emerald-400'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      ) : null}

      <ul className={`space-y-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {approvers.map((entry) => {
          const approved = entry.status === 'approved' || entry.phase === 'approved';
          const isCurrent = entry.phase === 'current';
          const isQueued = entry.phase === 'queued';
          const displayName = String(entry.name ?? '').trim() || 'Approver';
          const statusLabel = approved
            ? 'Approved'
            : isCurrent
              ? 'Reviewing'
              : isQueued
                ? 'Up next'
                : pending
                  ? 'Waiting'
                  : '—';
          return (
            <li key={entry.userId} className="flex items-start gap-2 min-w-0">
              {approved ? (
                <CheckCircle2
                  className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
                  aria-hidden
                />
              ) : isCurrent ? (
                <Clock
                  className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400 mt-0.5"
                  aria-hidden
                />
              ) : (
                <Circle className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600 mt-0.5" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span
                    className={`font-medium break-words ${
                      isCurrent
                        ? 'text-slate-900 dark:text-white'
                        : approved
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {displayName}
                  </span>
                  <span
                    className={`shrink-0 font-medium ${
                      approved
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : isCurrent
                          ? 'text-primary-700 dark:text-primary-300'
                          : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                {approved && entry.approvedAt ? (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {formatMovementDateTime(entry.approvedAt)}
                  </p>
                ) : isCurrent && pending ? (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Can review and approve this change
                  </p>
                ) : isQueued && pending ? (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Waiting for earlier approvers in the chain
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MovementTypeIcon({ type }: { type: EmployeeMovementRow['movementType'] }) {
  if (type === 'promotion') {
    return <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  }
  if (type === 'salary_update') {
    return <DollarSign className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />;
  }
  return <ArrowRightLeft className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />;
}

export type MovementChangeParts = {
  hasPlacementChange: boolean;
  placementFrom: string | null;
  placementTo: string | null;
  hasSalaryChange: boolean;
  salaryFrom: number | null;
  salaryTo: number | null;
  salaryCurrency: string;
};

function hasRecordedSalaryChange(row: EmployeeMovementRow): boolean {
  return (
    row.fromBaseSalary != null &&
    row.toBaseSalary != null &&
    Math.abs(row.toBaseSalary - row.fromBaseSalary) >= 0.005
  );
}

function formatPlacementLabel(department: string, position: string): string {
  const dept = String(department ?? '').trim();
  const pos = String(position ?? '').trim();
  if (!dept && !pos) return '—';
  if (!dept) return pos;
  if (!pos) return dept;
  return `${dept} · ${pos}`;
}

export function parseMovementChangeParts(row: EmployeeMovementRow): MovementChangeParts {
  const currency = row.toCurrency || row.fromCurrency || 'USD';

  if (row.movementType === 'contract_type_change' || row.movementType === 'employment_status_change') {
    return {
      hasPlacementChange: true,
      placementFrom: row.currentValue ?? '—',
      placementTo: row.newValue ?? '—',
      hasSalaryChange: false,
      salaryFrom: null,
      salaryTo: null,
      salaryCurrency: currency,
    };
  }

  if (
    row.movementType === 'salary_update' ||
    row.movementType === 'salary_adjustment' ||
    row.movementType === 'salary_increase'
  ) {
    return {
      hasPlacementChange: false,
      placementFrom: null,
      placementTo: null,
      hasSalaryChange: true,
      salaryFrom: row.fromBaseSalary,
      salaryTo: row.toBaseSalary,
      salaryCurrency: currency,
    };
  }

  const placementFrom = formatPlacementLabel(row.fromDepartmentName, row.fromPositionTitle);
  const placementTo = formatPlacementLabel(row.toDepartmentName, row.toPositionTitle);
  const placementChanged =
    row.fromDepartmentName !== row.toDepartmentName ||
    row.fromPositionTitle !== row.toPositionTitle;

  return {
    hasPlacementChange: placementChanged,
    placementFrom,
    placementTo,
    hasSalaryChange: hasRecordedSalaryChange(row),
    salaryFrom: row.fromBaseSalary,
    salaryTo: row.toBaseSalary,
    salaryCurrency: currency,
  };
}

function salaryDeltaLabel(parts: MovementChangeParts): string | null {
  if (!parts.hasSalaryChange || parts.salaryFrom == null || parts.salaryTo == null) return null;
  const delta = parts.salaryTo - parts.salaryFrom;
  if (Math.abs(delta) < 0.005) return null;
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${formatCurrency(Math.abs(delta), parts.salaryCurrency)}`;
}

function salaryDeltaPercentLabel(
  row: EmployeeMovementRow,
  parts: MovementChangeParts
): string | null {
  if (!parts.hasSalaryChange || parts.salaryFrom == null || parts.salaryTo == null) return null;
  return formatSalaryChangePercent({
    fromAmount: parts.salaryFrom,
    fromCurrency: row.fromCurrency ?? parts.salaryCurrency,
    toAmount: parts.salaryTo,
    toCurrency: row.toCurrency ?? row.fromCurrency ?? parts.salaryCurrency,
  });
}

function movementFromToParts(row: EmployeeMovementRow): { from: string; to: string } {
  const parts = parseMovementChangeParts(row);
  if (!parts.hasPlacementChange && parts.hasSalaryChange) {
    return {
      from: formatCurrency(parts.salaryFrom ?? 0, parts.salaryCurrency),
      to: formatCurrency(parts.salaryTo ?? 0, parts.salaryCurrency),
    };
  }

  let from = parts.placementFrom ?? '';
  let to = parts.placementTo ?? '';
  if (parts.hasSalaryChange) {
    from += ` · ${formatCurrency(parts.salaryFrom ?? 0, parts.salaryCurrency)}`;
    to += ` · ${formatCurrency(parts.salaryTo ?? 0, parts.salaryCurrency)}`;
  }
  return { from, to };
}

type MovementChangeFieldProps = {
  label: string;
  from?: string;
  to?: string;
  delta?: string | null;
  compact?: boolean;
  /** Approval queues show pay change as percent only — no currency from/to. */
  percentOnly?: boolean;
  percentValue?: string | null;
};

function percentValueTone(value: string | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (!value || value === 'New' || value === '0%' || value === '—') return 'neutral';
  if (value.startsWith('+')) return 'positive';
  if (value.startsWith('-')) return 'negative';
  return 'neutral';
}

function MovementChangeField({
  label,
  from = '',
  to = '',
  delta,
  compact = false,
  percentOnly = false,
  percentValue,
}: MovementChangeFieldProps) {
  const deltaPositive = delta?.startsWith('+');
  const deltaNeutral = delta === 'New' || delta === '0%';
  const percentTone = percentOnly ? percentValueTone(percentValue) : null;

  if (percentOnly) {
    const toneClass =
      percentTone === 'positive'
        ? 'text-emerald-600 dark:text-emerald-400'
        : percentTone === 'negative'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-slate-700 dark:text-slate-200';

    return (
      <div
        className={`rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/30 ${
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
          {label}
        </p>
        <p
          className={`font-semibold tabular-nums ${compact ? 'text-sm' : 'text-sm sm:text-base'} ${toneClass}`}
        >
          {percentValue ?? '—'}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/30 ${
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
        {label}
      </p>
      <div className="flex flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2">
        <span
          className={`text-slate-500 dark:text-slate-400 min-w-0 break-words ${
            compact ? 'text-xs' : 'text-xs sm:text-sm'
          }`}
        >
          {from}
        </span>
        <ArrowRight
          className="w-3.5 h-3.5 shrink-0 text-slate-300 dark:text-slate-600 hidden sm:block"
          aria-hidden
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-wide text-slate-300 dark:text-slate-600 sm:hidden"
          aria-hidden
        >
          to
        </span>
        <span
          className={`font-semibold text-slate-800 dark:text-slate-100 min-w-0 break-words ${
            compact ? 'text-xs' : 'text-sm'
          }`}
        >
          {to}
        </span>
        {delta ? (
          <span
            className={`text-xs font-semibold tabular-nums shrink-0 sm:ml-auto ${
              deltaNeutral
                ? 'text-slate-600 dark:text-slate-300'
                : deltaPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function MovementChangeLines({
  row,
  compact = false,
  salaryDeltaFormat = 'amount',
}: {
  row: EmployeeMovementRow;
  compact?: boolean;
  /** Manager approval lists show pay change as a percentage. */
  salaryDeltaFormat?: 'amount' | 'percent';
}) {
  const parts = parseMovementChangeParts(row);
  const delta =
    salaryDeltaFormat === 'percent'
      ? salaryDeltaPercentLabel(row, parts)
      : salaryDeltaLabel(parts);
  const fields: MovementChangeFieldProps[] = [];

  if (parts.hasPlacementChange && parts.placementFrom && parts.placementTo) {
    fields.push({ label: 'Role', from: parts.placementFrom, to: parts.placementTo });
  }
  if (parts.hasSalaryChange) {
    if (salaryDeltaFormat === 'percent') {
      fields.push({
        label: 'Pay',
        percentOnly: true,
        percentValue: salaryDeltaPercentLabel(row, parts) ?? '—',
      });
    } else {
      fields.push({
        label: 'Pay',
        from: formatCurrency(parts.salaryFrom ?? 0, parts.salaryCurrency),
        to: formatCurrency(parts.salaryTo ?? 0, parts.salaryCurrency),
        delta,
      });
    }
  }

  if (!fields.length) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">No recorded changes.</p>;
  }

  return (
    <div className={`grid gap-2 min-w-0 ${fields.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
      {fields.map((field) => (
        <MovementChangeField key={field.label} {...field} compact={compact} />
      ))}
    </div>
  );
}

export function MovementFromToCell({
  row,
  layout = 'stack',
}: {
  row: EmployeeMovementRow;
  layout?: 'stack' | 'inline';
}) {
  const { from, to } = movementFromToParts(row);

  if (layout === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-sm">
        <span className="text-slate-500 dark:text-slate-400 truncate max-w-full">{from}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-primary-500 dark:text-primary-400" aria-hidden />
        <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-full">{to}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-slate-600 dark:text-slate-300 break-words">{from}</span>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400">
        <ArrowRight className="w-3 h-3 shrink-0" aria-hidden />
        <span className="break-words">{to}</span>
      </span>
    </div>
  );
}

export function movementTypeIconWrapClass(type: EmployeeMovementRow['movementType']): string {
  if (type === 'promotion') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
  if (type === 'salary_update') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
  return 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300';
}

export type MovementOriginKind = 'probation' | 'appraisal' | 'manual';

export function resolveMovementOrigin(row: EmployeeMovementRow): MovementOriginKind {
  if (row.sourceProbationReviewId) return 'probation';
  if (row.sourceAppraisalId) return 'appraisal';
  return 'manual';
}

function movementOriginMeta(row: EmployeeMovementRow): {
  kind: MovementOriginKind;
  label: string;
  title: string;
  variant: 'info' | 'success' | 'neutral';
  icon: typeof ClipboardCheck;
  href: string | null;
} {
  const kind = resolveMovementOrigin(row);
  if (kind === 'probation') {
    return {
      kind,
      label: 'Probation',
      title: 'Created from a probation review outcome',
      variant: 'info',
      icon: ClipboardCheck,
      href: '/performance?tab=probation',
    };
  }
  if (kind === 'appraisal') {
    const period = row.sourceAppraisalPeriodName?.trim();
    return {
      kind,
      label: period ? `KPI · ${period}` : 'KPI appraisal',
      title: period ? `Linked to KPI appraisal: ${period}` : 'Created from a KPI appraisal',
      variant: 'success',
      icon: Award,
      href: '/performance?tab=kpi-appraisals',
    };
  }
  return {
    kind,
    label: 'Manual',
    title: 'Recorded manually in Employee movements',
    variant: 'neutral',
    icon: PenLine,
    href: null,
  };
}

export function MovementOriginBadge({
  row,
  className = '',
}: {
  row: EmployeeMovementRow;
  className?: string;
}) {
  const meta = movementOriginMeta(row);
  const Icon = meta.icon;
  const badge = (
    <Badge
      variant={meta.variant}
      className={`text-[10px] gap-1 font-semibold uppercase tracking-wide ${className}`}
      title={meta.title}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {meta.label}
    </Badge>
  );

  if (meta.href) {
    return (
      <Link to={meta.href} className="inline-flex shrink-0 hover:opacity-90" title={meta.title}>
        {badge}
      </Link>
    );
  }
  return badge;
}

export function MovementSourceLink({ row }: { row: EmployeeMovementRow }): React.ReactNode {
  if (row.sourceProbationReviewId) {
    return (
      <Link
        to="/performance?tab=probation"
        className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline dark:text-primary-400"
        title="Created from probation review"
      >
        <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
        Probation review
      </Link>
    );
  }
  if (row.sourceAppraisalId) {
    return (
      <Link
        to="/performance?tab=kpi-appraisals"
        className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline dark:text-primary-400"
        title={
          row.sourceAppraisalPeriodName
            ? `KPI appraisal: ${row.sourceAppraisalPeriodName}`
            : 'Linked KPI appraisal'
        }
      >
        <Award className="w-3.5 h-3.5 shrink-0" />
        {row.sourceAppraisalPeriodName ?? 'Appraisal'}
      </Link>
    );
  }
  return <span>Manual entry</span>;
}

type MovementListCardProps = {
  row: EmployeeMovementRow;
  showEmployee?: boolean;
  /** When false, hide email/phone under the name (approval queues). */
  showContact?: boolean;
  sourceLink?: React.ReactNode;
  actions?: React.ReactNode;
  /** Tighter layout for embedded lists (employee row expansion, profile). */
  density?: 'default' | 'compact';
  /** Flush item inside a parent panel (employee list row expansion). */
  embedded?: boolean;
  /** Pay delta display in manager approval queues. */
  salaryDeltaFormat?: 'amount' | 'percent';
  /** Opens full movement detail (review modal or wizard). Prefer explicit actions instead. */
  onOpenDetail?: () => void;
};

export function MovementListCard({
  row,
  showEmployee = true,
  showContact = true,
  sourceLink,
  actions,
  density = 'default',
  embedded = false,
  salaryDeltaFormat = 'amount',
  onOpenDetail,
}: MovementListCardProps) {
  const compact = density === 'compact' || embedded;
  const recordedAt = row.createdAt ? formatMovementDateTime(row.createdAt) : null;
  const recordedBy = movementRecordedByLabel(row.createdByName);
  const padding = compact ? 'p-3 sm:p-3.5' : 'p-3.5 sm:p-4';
  const canOpenDetail = Boolean(onOpenDetail);
  const shellClass = embedded
    ? `relative bg-transparent${canOpenDetail ? ' cursor-pointer' : ''}`
    : `relative rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900/60 transition-colors${
        canOpenDetail
          ? ' hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md cursor-pointer'
          : ''
      }`;

  const handleCardActivate = () => {
    onOpenDetail?.();
  };

  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [data-no-card-nav]')) {
      return;
    }
    handleCardActivate();
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!canOpenDetail) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardActivate();
    }
  };

  return (
    <article
      role={canOpenDetail ? 'button' : undefined}
      tabIndex={canOpenDetail ? 0 : undefined}
      onClick={canOpenDetail ? handleCardClick : undefined}
      onKeyDown={canOpenDetail ? handleCardKeyDown : undefined}
      aria-label={
        canOpenDetail
          ? `${movementTypeLabel(row.movementType)} — ${row.employeeName ?? row.employeeId}`
          : undefined
      }
      className={`${shellClass} ${padding}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          className={`inline-flex shrink-0 items-center justify-center rounded-lg ${movementTypeIconWrapClass(row.movementType)} ${
            compact ? 'h-8 w-8' : 'h-9 w-9'
          }`}
        >
          <MovementTypeIcon type={row.movementType} />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p
              className={`font-semibold text-slate-900 dark:text-white leading-tight break-words ${
                compact ? 'text-sm' : 'text-sm sm:text-base'
              }`}
            >
              {movementTypeLabel(row.movementType)}
            </p>
            <MovementOriginBadge row={row} />
            <span className="ml-auto shrink-0">
              {movementStatusBadge(row.status, row.canonicalStatus, row.approvalProgress)}
            </span>
          </div>
          {showEmployee ? (
            <EmployeeListIdentityBlock
              data={employeeListIdentityFromMovementRow(row)}
              avatarClassName={compact ? 'h-8 w-8 sm:h-9 sm:w-9 shrink-0' : 'h-9 w-9 sm:h-10 sm:w-10 shrink-0'}
              className="max-w-full"
              showEmail={showContact}
              showPhone={showContact}
            />
          ) : null}
          <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span>Effective {formatMovementDate(row.effectiveDate)}</span>
          </p>
        </div>
      </div>

      <div className={compact ? 'mt-2.5' : 'mt-3'}>
        <MovementChangeLines row={row} compact={compact} salaryDeltaFormat={salaryDeltaFormat} />
      </div>

      <div className={compact ? 'mt-2.5' : 'mt-3'}>
        <MovementApprovalTracker row={row} compact={compact} />
      </div>

      <footer
        className={`${
          compact ? 'mt-2.5 pt-2' : 'mt-3 pt-2.5'
        } border-t ${
          embedded
            ? 'border-slate-100/80 dark:border-slate-800/80'
            : 'border-slate-100 dark:border-slate-800'
        } flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}
      >
        <span
          className="min-w-0 break-words text-[11px] sm:text-xs text-slate-500 dark:text-slate-400"
          title={recordedBy}
        >
          Recorded {recordedAt ?? '—'}
          {recordedBy !== 'Unknown' ? ` · ${recordedBy}` : ''}
          {row.approvedAt
            ? ` · Approved ${formatMovementDateTime(row.approvedAt)}${row.approvedByName ? ` · ${row.approvedByName}` : ''}`
            : ''}
          {row.appliedAt ? ` · Applied ${formatMovementDateTime(row.appliedAt)}` : ''}
          {sourceLink ? (
            <>
              {' · '}
              <span className="inline">{sourceLink}</span>
            </>
          ) : null}
        </span>
        {actions ? <div className="w-full sm:w-auto sm:shrink-0">{actions}</div> : null}
      </footer>
    </article>
  );
}

/** Minimal row for appraisal follow-up and other inline summaries. */
export function MovementSummaryRow({ row }: { row: EmployeeMovementRow }) {
  const parts = parseMovementChangeParts(row);

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-2.5 min-w-0">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${movementTypeIconWrapClass(row.movementType)}`}
          >
            <MovementTypeIcon type={row.movementType} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {movementTypeLabel(row.movementType)}
              </p>
              <MovementOriginBadge row={row} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              Effective {formatMovementDate(row.effectiveDate)}
            </p>
            {(parts.hasPlacementChange || parts.hasSalaryChange) && (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                {parts.hasPlacementChange && parts.placementTo ? parts.placementTo : null}
                {parts.hasPlacementChange && parts.hasSalaryChange ? ' · ' : null}
                {parts.hasSalaryChange
                  ? formatCurrency(parts.salaryTo ?? 0, parts.salaryCurrency)
                  : null}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 self-start sm:self-center">
          {movementStatusBadge(row.status, row.canonicalStatus, row.approvalProgress)}
        </div>
      </div>
      <div className="px-3 pb-2.5">
        <MovementApprovalTracker row={row} compact />
      </div>
    </div>
  );
}
