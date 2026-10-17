import React, { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '../ui/Button';
import { ApproverSelectModal } from './ApproverSelectModal';
import {
  ApproverCandidateMeta,
  type WorkflowApproverCandidate,
} from './ApproverSelectPanel';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';

type Props = {
  value: string[];
  selected?: WorkflowApproverCandidate[];
  onChange: (userIds: string[], candidates: WorkflowApproverCandidate[]) => void;
  required?: boolean;
  label?: string;
  hint?: string;
  buttonLabel?: string;
  modalTitle?: string;
  modalDescription?: string;
  maxApprovers?: number;
  defaultExpandedDepartmentId?: string | null;
};

export function ApproverSummaryCard({
  person,
  step,
  trailing,
}: {
  person: WorkflowApproverCandidate;
  step?: number;
  /** Optional status / phase chip (e.g. Evaluating now). */
  trailing?: React.ReactNode;
}) {
  const { language } = useLanguage();
  const displayName = resolveEmployeeRecordDisplayName(person, language);
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';
  const code = (person.employeeCode || '').trim();

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-2.5 py-2 min-w-0">
      {step != null ? (
        <span
          className="inline-flex items-center justify-center w-6 h-6 mt-0.5 rounded-full bg-primary-600 text-white text-[10px] font-bold tabular-nums shrink-0"
          title={`Approval step ${step}`}
        >
          {step}
        </span>
      ) : null}
      <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-primary-700 dark:text-primary-300">{initial}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-slate-900 dark:text-white leading-tight break-words font-khmer">
              {displayName}
            </span>
            {code ? (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                {code}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 shrink-0">
            {person.departmentName ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 break-words text-right">
                {person.departmentName}
              </span>
            ) : null}
            {trailing}
          </div>
        </div>
        <ApproverCandidateMeta candidate={person} variant="pills" />
      </div>
    </div>
  );
}

export const ApproverApprovalField: React.FC<Props> = ({
  value,
  selected,
  onChange,
  required = false,
  label = 'Approvers',
  hint = 'Assign one or more employees with portal access to review before this is finalized.',
  buttonLabel = 'Approval',
  modalTitle = 'Select approvers',
  modalDescription,
  maxApprovers,
  defaultExpandedDepartmentId,
}) => {
  const [open, setOpen] = useState(false);
  const [cached, setCached] = useState<WorkflowApproverCandidate[]>(selected ?? []);

  useEffect(() => {
    if (selected?.length) setCached(selected);
  }, [selected]);

  const displayList = useMemo(() => {
    if (selected?.length) return selected;
    if (cached.length && value.length) {
      const cachedIds = new Set(cached.map((row) => row.userId));
      if (value.every((id) => cachedIds.has(id))) {
        return value
          .map((id) => cached.find((row) => row.userId === id))
          .filter((row): row is WorkflowApproverCandidate => Boolean(row));
      }
    }
    return [];
  }, [selected, cached, value]);

  const hasSelection = value.length > 0 && displayList.length > 0;

  return (
    <>
      <div className="space-y-2 min-w-0 max-w-full">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {label}
            {required ? <span className="text-red-500 ml-0.5">*</span> : null}
          </p>
          {hint ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug break-words">
              {hint}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 overflow-hidden min-w-0 max-w-full">
          <div className="flex flex-col xs:flex-row xs:flex-wrap xs:items-center xs:justify-between gap-2 px-2.5 py-2 sm:px-4 sm:py-2.5 border-b border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/40 min-w-0">
            {hasSelection ? (
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 min-w-0">
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 mr-1.5 rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 font-semibold tabular-nums">
                  {displayList.length}
                </span>
                approver{displayList.length === 1 ? '' : 's'} selected
              </p>
            ) : value.length ? (
              <p className="text-xs text-slate-500 min-w-0">{value.length} approver(s) selected.</p>
            ) : (
              <p className="text-xs text-slate-500 min-w-0">No approvers selected yet.</p>
            )}
            <Button
              type="button"
              variant={hasSelection ? 'outline' : 'primary'}
              size="sm"
              className="w-full xs:w-auto shrink-0 max-w-full"
              onClick={() => setOpen(true)}
            >
              {hasSelection ? 'Change approvers' : buttonLabel}
            </Button>
          </div>

          {hasSelection ? (
            <div className="p-2 sm:p-3 max-h-[min(18rem,42vh)] overflow-y-auto overscroll-contain space-y-2 min-w-0">
              {displayList.length > 1 ? (
                <p className="text-[10px] text-slate-500 dark:text-slate-400 px-0.5 pb-1">
                  Top approves first, then each person below in order.
                </p>
              ) : null}
              {displayList.map((person, index) => (
                <ApproverSummaryCard
                  key={person.userId ?? person.employeePk}
                  person={person}
                  step={displayList.length > 1 ? index + 1 : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 px-3 py-5 sm:px-4 sm:py-8 text-center min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Users className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xs break-words">
                {value.length
                  ? 'Approver details are loading. Use the button above to review or change selections.'
                  : 'Choose employees with portal access to review this before it is finalized.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <ApproverSelectModal
        isOpen={open}
        onClose={() => setOpen(false)}
        value={value}
        title={modalTitle}
        description={modalDescription ?? hint}
        onConfirm={(userIds, candidates) => {
          setCached(candidates);
          onChange(userIds, candidates);
        }}
        maxApprovers={maxApprovers}
        defaultExpandedDepartmentId={defaultExpandedDepartmentId}
      />
    </>
  );
};

export default ApproverApprovalField;
