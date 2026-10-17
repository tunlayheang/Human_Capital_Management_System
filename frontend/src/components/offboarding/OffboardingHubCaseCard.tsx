import React from 'react';
import { ArrowRight, ClipboardList, GraduationCap, ShieldAlert, UserRound } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { StatusLabel } from '../ui/StatusLabel';
import { Button } from '../ui/Button';
import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromEmployeeRow,
} from '../employee/EmployeeListIdentity';
import {
  OffboardingWorkflowProgress,
  buildOffboardingSteps,
} from '../employee/OffboardingWorkflowProgress';
import {
  hubWorkflowOutcomeLabel,
  isOffboardingAwaitingPayroll,
  isOffboardingWorkflowComplete,
  resolveHubPrimaryBadge,
  resolveOffboardOrigin,
  offboardOriginLabel,
  type OffboardOriginKind,
} from '../../offboarding/offboardingHubStatus';
import {
  formatSettlementUsd,
} from '../../offboarding/settlementDisplay';
import { OffboardingSettlementActions } from './OffboardingSettlementActions';
import { EmployeeArchiveRetentionCard } from '../employee/EmployeeArchiveRetentionCard';
import type { EmployeeArchiveDetail } from '../../types';
export type OffboardCaseDetails = {
  typeLabel: string;
  statusBadge: 'info' | 'warning' | 'neutral' | 'success';
  reason: string | null;
  offboardedAt: string | null;
  lastWorkingDate: string | null;
  department: string | null;
  position: string | null;
};

type Props = {
  employee: {
    employee_id: string;
    first_name: string;
    last_name: string;
    avatar_url?: string | null;
    email?: string;
    phone?: string;
    status?: string;
    offboard_type?: string | null;
    offboard_source?: string | null;
  };
  settlementStatus: string;
  settlementStatusLabel: string;
  settlement?: {
    id: string;
    netUsd?: number;
    clearanceJson?: unknown;
    breakdown?: unknown;
    breakdownSnapshotJson?: unknown;
  } | null;
  showSettlementActions?: boolean;
  onSettlementUpdated?: () => void;
  details: OffboardCaseDetails;
  inProgress?: boolean;
  highlighted?: boolean;
  archiveDetail?: EmployeeArchiveDetail | null;
  archiveLoading?: boolean;
  onContinue: () => void;
  onViewArchive?: () => void;
  onCloseArchive?: () => void;
  t: (key: string) => string;
  formatDate: (iso?: string | null) => string;
  formatDateTime: (iso?: string | null) => string;
};

export const OffboardingHubCaseCard: React.FC<Props> = ({
  employee,
  settlementStatus,
  settlementStatusLabel,
  settlement,
  showSettlementActions,
  onSettlementUpdated,
  details,
  inProgress,
  highlighted,
  archiveDetail,
  archiveLoading,
  onContinue,
  onViewArchive,
  onCloseArchive,
  t,
  formatDate,
  formatDateTime,
}) => {
  const identity = employeeListIdentityFromEmployeeRow(employee);
  const workflowComplete = isOffboardingWorkflowComplete(settlementStatus, employee.status);
  const awaitingPayroll = isOffboardingAwaitingPayroll(settlementStatus);
  const primaryBadge = resolveHubPrimaryBadge({
    settlementStatus,
    employeeStatus: employee.status,
    offboardType: employee.offboard_type,
    hubInProgress: Boolean(inProgress),
  });
  const outcomeLabel = hubWorkflowOutcomeLabel(t, settlementStatus) ?? settlementStatusLabel;
  const origin = resolveOffboardOrigin({
    offboardSource: employee.offboard_source,
    settlementClearance: settlement?.clearanceJson,
    inProgress,
  });
  const originIcon = (kind: OffboardOriginKind) => {
    switch (kind) {
      case 'probation':
        return GraduationCap;
      case 'employee':
        return UserRound;
      case 'abandonment':
        return ShieldAlert;
      default:
        return ClipboardList;
    }
  };
  const placement =
    details.department || details.position
      ? [details.department, details.position].filter(Boolean).join(' · ')
      : null;
  const canOpenWizard = !workflowComplete;

  const handleCardActivate = () => {
    if (canOpenWizard) onContinue();
  };

  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [data-no-card-nav]')) {
      return;
    }
    handleCardActivate();
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!canOpenWizard) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardActivate();
    }
  };

  return (
    <article
      data-offboarding-case-id={employee.employee_id}
      role={canOpenWizard ? 'button' : undefined}
      tabIndex={canOpenWizard ? 0 : undefined}
      onClick={canOpenWizard ? handleCardClick : undefined}
      onKeyDown={canOpenWizard ? handleCardKeyDown : undefined}
      aria-label={
        canOpenWizard
          ? `${identity.displayName || employee.employee_id} — ${t('offboarding.hub.continueWizard')}`
          : undefined
      }
      className={`group rounded-xl border transition-shadow hover:shadow-md ${
        canOpenWizard ? 'cursor-pointer' : ''
      } ${
        highlighted
          ? 'border-primary-300 dark:border-primary-700 bg-primary-50/40 dark:bg-primary-950/20 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1 space-y-2">
              <EmployeeListIdentityBlock
                data={{
                  ...identity,
                  subtitle: placement ?? identity.subtitle,
                }}
                avatarClassName="w-11 h-11 shrink-0 ring-2 ring-white dark:ring-slate-800 shadow-sm"
                showSubtitle={Boolean(placement || identity.subtitle)}
                nameExtra={
                  origin ? (
                    <Badge variant="neutral" className="text-[10px] gap-1">
                      {React.createElement(originIcon(origin), {
                        className: 'w-3 h-3 shrink-0',
                        'aria-hidden': true,
                      })}
                      {offboardOriginLabel(t, origin)}
                    </Badge>
                  ) : null
                }
              />

              <div className="min-w-0">
                {primaryBadge.kind === 'complete' ? (
                  <StatusLabel
                    status="PAID"
                    context="settlement"
                    label={t('offboarding.hub.completeBadge')}
                    size="sm"
                  />
                ) : primaryBadge.kind === 'awaiting_payroll' ? (
                  <StatusLabel
                    status="PENDING_PAYROLL"
                    context="settlement"
                    label={t('offboarding.hub.awaitingPayrollBadge')}
                    size="sm"
                  />
                ) : primaryBadge.kind === 'in_progress' ? (
                  <StatusLabel
                    status="IN_PROGRESS"
                    context="settlement"
                    label={t('offboarding.hub.inProgressBadge')}
                    size="sm"
                  />
                ) : (
                  <Badge
                    variant={primaryBadge.isResignation ? 'info' : 'warning'}
                    className="text-[10px]"
                  >
                    {primaryBadge.isResignation
                      ? t('offboarding.hub.resignation')
                      : t('offboarding.hub.termination')}
                  </Badge>
                )}
              </div>

              <OffboardingWorkflowProgress
                variant="pipeline"
                steps={buildOffboardingSteps({ settlementStatus, t })}
              />

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                {details.lastWorkingDate ? (
                  <span>
                    <span className="text-slate-400">{t('offboarding.hub.lastWorkingDay')}:</span>{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {formatDate(details.lastWorkingDate)}
                    </span>
                  </span>
                ) : null}
                {settlement?.netUsd != null ? (
                  <>
                    <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                    <span>
                      <span className="text-slate-400">{t('offboarding.hub.netPay')}:</span>{' '}
                      <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {formatSettlementUsd(settlement.netUsd)}
                      </span>
                    </span>
                  </>
                ) : null}
                {placement ? (
                  <>
                    <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                    <span className="break-words min-w-0">{placement}</span>
                  </>
                ) : null}
                {workflowComplete && details.offboardedAt ? (
                  <>
                    <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                    <span>
                      {t('offboarding.hub.offboardedOn')}{' '}
                      {formatDateTime(details.offboardedAt)}
                    </span>
                  </>
                ) : null}
              </div>

              {details.reason ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                  {details.reason}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2 w-full lg:w-auto lg:shrink-0 lg:min-w-[10rem]">
            {settlementStatus ? (
              <StatusLabel
                status={settlementStatus}
                context="settlement"
                label={outcomeLabel}
                size="sm"
                className="justify-center lg:justify-end"
              />
            ) : null}
            {!workflowComplete ? (
              <Button
                size="sm"
                onClick={onContinue}
                className="shadow-sm group-hover:shadow-md transition-shadow"
              >
                {awaitingPayroll
                  ? t('offboarding.hub.viewWizard')
                  : t('offboarding.hub.continueWizard')}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        {showSettlementActions && settlement?.id && settlementStatus ? (
          <div
            className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800"
            data-no-card-nav
          >
            <OffboardingSettlementActions
              settlementId={settlement.id}
              status={settlementStatus}
              clearanceJson={settlement.clearanceJson}
              breakdown={settlement.breakdown}
              breakdownSnapshotJson={settlement.breakdownSnapshotJson}
              onUpdated={() => onSettlementUpdated?.()}
            />
          </div>
        ) : null}

        {highlighted ? (
          <div
            className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800"
            data-no-card-nav
          >
            <EmployeeArchiveRetentionCard
              detail={archiveDetail ?? null}
              loading={Boolean(archiveLoading && !archiveDetail)}
              onClose={onCloseArchive}
              closeLabel={t('offboarding.hub.closeArchive')}
            />
          </div>
        ) : workflowComplete && onViewArchive ? (
          <button
            type="button"
            className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline"
            data-no-card-nav
            onClick={onViewArchive}
          >
            {t('offboarding.hub.viewArchive')}
          </button>
        ) : null}
      </div>
    </article>
  );
};

export default OffboardingHubCaseCard;
