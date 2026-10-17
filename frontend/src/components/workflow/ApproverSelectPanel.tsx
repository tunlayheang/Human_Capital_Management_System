import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { Api } from '../../services/api';
import { ListSearchBarShell, ListSearchInput } from '../ui/page';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import { formatAccessRoleLabel } from '../../utils/accessRole';

export type WorkflowApproverCandidate = {
  userId: string | null;
  employeePk: string;
  firstName?: string;
  lastName?: string;
  firstNameKh?: string;
  lastNameKh?: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  levelCode?: string | null;
  levelLabel?: string | null;
  employeeCode: string | null;
  positionTitle: string | null;
  departmentId: string;
  departmentName: string;
  isDepartmentHead?: boolean;
  hasPortalAccess: boolean;
};

export type WorkflowApproverDepartmentGroup = {
  departmentId: string;
  departmentName: string;
  candidates: WorkflowApproverCandidate[];
};

type Props = {
  value: string[];
  onChange: (userIds: string[], candidates: WorkflowApproverCandidate[]) => void;
  required?: boolean;
  disabled?: boolean;
  hideHeader?: boolean;
  /** When false, skips loading (e.g. modal closed). */
  active?: boolean;
  title?: string;
  description?: string;
  /** When set, limits how many approvers can be assigned (e.g. 1 for final appraisal). */
  maxApprovers?: number;
  /** Only this department accordion is expanded on load; others stay collapsed. */
  defaultExpandedDepartmentId?: string | null;
};

function candidateRowKey(candidate: WorkflowApproverCandidate): string {
  return candidate.userId ?? candidate.employeePk;
}

function isSelectableCandidate(candidate: WorkflowApproverCandidate): boolean {
  return candidate.hasPortalAccess && Boolean(candidate.userId);
}

function MetaChip({
  mark,
  label,
  value,
  compact = false,
}: {
  mark: string;
  label: string;
  value: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 max-w-full min-w-0 rounded-md bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 text-[10px] leading-tight"
        title={`${label}: ${value}`}
      >
        <span className="font-bold uppercase text-primary-600 dark:text-primary-400 shrink-0">{mark}</span>
        <span className="text-slate-700 dark:text-slate-200 truncate min-w-0">{value}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 min-w-0 max-w-full"
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] font-bold uppercase text-primary-600 dark:text-primary-400 shrink-0">
        {mark}
      </span>
      <span className="text-slate-600 dark:text-slate-300 break-words">{value}</span>
    </span>
  );
}

export function ApproverCandidateMeta({
  candidate,
  className = '',
  variant = 'inline',
}: {
  candidate: WorkflowApproverCandidate;
  className?: string;
  variant?: 'inline' | 'pills';
}) {
  const role = formatAccessRoleLabel(candidate.roleLabel || candidate.role || '').trim();
  const level = (candidate.levelLabel || '').trim();
  const position = (candidate.positionTitle || '').trim();
  const code = (candidate.employeeCode || '').trim();

  if (!code && !role && !level && !position) return null;

  if (variant === 'pills') {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 w-full min-w-0 ${className}`.trim()}>
        {role ? <MetaChip compact mark="R" label="Role" value={role} /> : null}
        {level ? <MetaChip compact mark="L" label="Level" value={level} /> : null}
        {position ? <MetaChip compact mark="P" label="Position" value={position} /> : null}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 w-full min-w-0 text-[11px] leading-snug text-slate-500 dark:text-slate-400 ${className}`.trim()}
    >
      {code ? (
        <span className="font-semibold text-slate-600 dark:text-slate-300 shrink-0">{code}</span>
      ) : null}
      {role ? <MetaChip mark="R" label="Role" value={role} /> : null}
      {level ? <MetaChip mark="L" label="Level" value={level} /> : null}
      {position ? <MetaChip mark="P" label="Position" value={position} /> : null}
    </div>
  );
}

function ApproverCandidateRow({
  candidate,
  checked,
  assigned,
  disabled,
  onToggle,
}: {
  candidate: WorkflowApproverCandidate;
  checked: boolean;
  assigned: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { language } = useLanguage();
  const displayName = resolveEmployeeRecordDisplayName(candidate, language);
  const selectable = isSelectableCandidate(candidate);
  const rowDisabled = disabled || !selectable;

  return (
    <label
      className={`flex items-start gap-2 w-full px-2.5 sm:px-3 py-2 transition-colors ${
        rowDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked || assigned
          ? 'bg-primary-50 dark:bg-primary-950/30'
          : selectable
            ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
            : ''
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
        checked={checked}
        disabled={rowDisabled}
        onChange={onToggle}
      />
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center shrink-0">
        <span className="text-[10px] sm:text-xs font-bold text-primary-700 dark:text-primary-300">
          {displayName.charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-visible">
        <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug break-words font-khmer">
          {displayName}
          {candidate.isDepartmentHead ? (
            <span className="ml-1 text-[10px] font-normal text-primary-600 whitespace-nowrap">
              · Head
            </span>
          ) : null}
          {assigned ? (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              Assigned
            </span>
          ) : null}
          {!selectable ? (
            <span className="ml-1.5 text-[10px] font-normal text-slate-400 whitespace-nowrap">
              · No portal access
            </span>
          ) : null}
        </p>
        <ApproverCandidateMeta candidate={candidate} className="mt-0.5" />
      </div>
    </label>
  );
}

function ApproverPendingRow({
  candidate,
  step,
  totalSteps,
  checked,
  disabled,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  candidate: WorkflowApproverCandidate;
  step: number;
  totalSteps: number;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { language } = useLanguage();
  const displayName = resolveEmployeeRecordDisplayName(candidate, language);
  const code = (candidate.employeeCode || '').trim();
  const initial = displayName.charAt(0).toUpperCase() || '?';
  const rowDisabled = disabled || !candidate.userId;

  return (
    <label
      className={`flex items-start gap-2 w-full px-2.5 sm:px-3 py-2 transition-colors ${
        rowDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked
          ? 'bg-primary-50 dark:bg-primary-950/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
        checked={checked}
        disabled={rowDisabled}
        onChange={onToggle}
      />
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-[10px] font-bold tabular-nums"
          title={`Approval step ${step}`}
        >
          {step}
        </span>
        {totalSteps > 1 ? (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              disabled={rowDisabled || step === 1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMoveUp();
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
              title="Move up (approve earlier)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={rowDisabled || step === totalSteps}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMoveDown();
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
              title="Move down (approve later)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center shrink-0">
        <span className="text-[10px] sm:text-xs font-bold text-primary-700 dark:text-primary-300">
          {initial}
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-visible">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug break-words font-khmer">
              {displayName}
            </p>
            {code ? (
              <span className="text-[10px] font-medium text-slate-500 tabular-nums">{code}</span>
            ) : null}
          </div>
          {candidate.departmentName ? (
            <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400 shrink-0 break-words text-right">
              {candidate.departmentName}
            </span>
          ) : null}
        </div>
        <ApproverCandidateMeta candidate={candidate} variant="pills" className="mt-1" />
      </div>
    </label>
  );
}

function candidatesFromIds(
  ids: string[],
  candidateMap: Map<string, WorkflowApproverCandidate>
): WorkflowApproverCandidate[] {
  return ids
    .map((id) => candidateMap.get(id))
    .filter((candidate): candidate is WorkflowApproverCandidate => Boolean(candidate));
}

function buildDefaultExpanded(
  rows: WorkflowApproverDepartmentGroup[],
  defaultDepartmentId?: string | null
): Record<string, boolean> {
  const focusId = String(defaultDepartmentId ?? '').trim();
  const out: Record<string, boolean> = {};
  for (const g of rows) {
    out[g.departmentId] = focusId ? g.departmentId === focusId : false;
  }
  return out;
}

export const ApproverSelectPanel: React.FC<Props> = ({
  value,
  onChange,
  required = false,
  disabled = false,
  hideHeader = false,
  active = true,
  title = 'Select approvers',
  description =
    'Choose approvers in the order they should review. The first person in the approval list must approve before the next can act.',
  maxApprovers,
  defaultExpandedDepartmentId,
}) => {
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<WorkflowApproverDepartmentGroup[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Checkbox selection order (first checked is first when assigned). */
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>(value);

  useEffect(() => {
    setPendingIds(value);
  }, [value]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await Api.workflow.getApprovers()) as {
        departments?: WorkflowApproverDepartmentGroup[];
      };
      const rows = Array.isArray(res?.departments) ? res.departments : [];
      setGroups(rows);
      setExpanded(buildDefaultExpanded(rows, defaultExpandedDepartmentId));
    } catch {
      setGroups([]);
      setExpanded({});
    } finally {
      setLoading(false);
    }
  }, [defaultExpandedDepartmentId]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const candidateMap = useMemo(() => {
    const map = new Map<string, WorkflowApproverCandidate>();
    for (const g of groups) {
      for (const c of g.candidates) {
        if (c.userId) map.set(c.userId, c);
      }
    }
    return map;
  }, [groups]);

  const pendingSet = useMemo(() => new Set(pendingIds), [pendingIds]);
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const pendingCandidates = useMemo(
    () => candidatesFromIds(pendingIds, candidateMap),
    [pendingIds, candidateMap]
  );

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        candidates: g.candidates.filter((c) => {
          const hay =
            `${c.name} ${c.email} ${c.employeeCode ?? ''} ${c.roleLabel ?? ''} ${c.role} ${c.levelLabel ?? ''} ${c.positionTitle ?? ''} ${c.departmentName}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((g) => g.candidates.length > 0);
  }, [groups, query]);

  const searching = Boolean(query.trim());

  const isDepartmentOpen = (departmentId: string) => {
    if (searching) return true;
    return expanded[departmentId] === true;
  };

  const applyPendingOrder = (next: string[]) => {
    // Selection / list order only — never reorder by role or position tier.
    const ordered = maxApprovers === 1 ? next.slice(0, 1) : [...next];
    setPendingIds(ordered);
    onChange(ordered, candidatesFromIds(ordered, candidateMap));
  };

  const toggleChecked = (
    candidate: WorkflowApproverCandidate,
    options?: { allowAssigned?: boolean }
  ) => {
    if (disabled || !candidate.userId) return;
    const assigned = pendingSet.has(candidate.userId);
    if (!options?.allowAssigned && !assigned && !isSelectableCandidate(candidate)) return;
    const userId = candidate.userId;
    setCheckedIds((prev) => {
      if (prev.includes(userId)) return prev.filter((id) => id !== userId);
      return [...prev, userId];
    });
  };

  const assignChecked = () => {
    if (disabled) return;
    // Append in checkbox selection order (first checked → first in chain among new adds).
    const toAdd = checkedIds.filter(
      (id) => candidateMap.has(id) && !pendingSet.has(id)
    );
    if (!toAdd.length) return;
    let next = maxApprovers === 1 ? [toAdd[0]] : [...pendingIds, ...toAdd];
    if (maxApprovers != null && maxApprovers > 0) {
      next = next.slice(0, maxApprovers);
    }
    applyPendingOrder(next);
    setCheckedIds((prev) => prev.filter((id) => !toAdd.includes(id)));
  };

  const removeCheckedFromPending = () => {
    if (disabled) return;
    const next = pendingIds.filter((id) => !checkedSet.has(id));
    applyPendingOrder(next);
    setCheckedIds((prev) => prev.filter((id) => next.includes(id)));
  };

  const movePending = (userId: string, direction: -1 | 1) => {
    if (disabled) return;
    const index = pendingIds.indexOf(userId);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= pendingIds.length) return;
    const next = [...pendingIds];
    [next[index], next[target]] = [next[target], next[index]];
    applyPendingOrder(next);
  };

  const checkedToAddCount = checkedIds.filter(
    (id) => candidateMap.has(id) && !pendingSet.has(id)
  ).length;

  const canAssign =
    checkedToAddCount > 0 &&
    !disabled &&
    (maxApprovers == null || pendingIds.length + checkedToAddCount <= maxApprovers);
  const canRemove =
    pendingIds.some((id) => checkedSet.has(id)) && !disabled;

  const emptyMessage = query.trim()
    ? 'No employees match your search.'
    : 'No employees available.';

  return (
    <div className="space-y-3 min-w-0">
      {!hideHeader ? (
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {title}
            {required ? <span className="text-red-500 ml-0.5">*</span> : null}
          </p>
          {description ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 xl:items-stretch min-w-0">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden flex flex-col min-h-0 min-w-0 xl:min-h-[16rem]">
          <div className="p-2.5 sm:p-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <ListSearchBarShell>
              <ListSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search name, ID, position…"
                className="flex-1 min-w-0"
                inputClassName={disabled || loading ? 'opacity-60 pointer-events-none' : undefined}
              />
            </ListSearchBarShell>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-[10rem] max-h-[38vh] sm:max-h-[42vh] xl:max-h-[min(20rem,48vh)] divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 px-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading approvers…
              </div>
            ) : filteredGroups.length ? (
              filteredGroups.map((group) => {
                const open = isDepartmentOpen(group.departmentId);
                return (
                  <div key={group.departmentId}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [group.departmentId]: !open,
                        }))
                      }
                      className="w-full flex items-center gap-2 px-2.5 sm:px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {open ? (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="min-w-0 flex-1 break-words leading-snug">{group.departmentName}</span>
                      <span className="text-[11px] font-normal normal-case text-slate-400 shrink-0 tabular-nums">
                        {group.candidates.length}
                      </span>
                    </button>
                    {open ? (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
                        {group.candidates.map((c) => (
                          <li key={candidateRowKey(c)}>
                            <ApproverCandidateRow
                              candidate={c}
                              checked={Boolean(c.userId && checkedSet.has(c.userId))}
                              assigned={Boolean(c.userId && pendingSet.has(c.userId))}
                              disabled={disabled}
                              onToggle={() => toggleChecked(c)}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-center text-slate-500 py-8 px-3">{emptyMessage}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row xl:flex-col items-stretch sm:items-center justify-center gap-2 shrink-0 px-0.5">
          <button
            type="button"
            disabled={!canAssign}
            onClick={assignChecked}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-primary-50 dark:hover:bg-primary-950/30 disabled:opacity-40 xl:px-3 xl:py-2 xl:rounded-lg xl:text-xs flex-1 xl:flex-none"
            title="Assign selected approvers"
          >
            <ChevronsRight className="w-4 h-4 shrink-0" />
            <span className="xl:sr-only">Assign selected</span>
          </button>
          <button
            type="button"
            disabled={!canRemove}
            onClick={removeCheckedFromPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 xl:px-3 xl:py-2 xl:rounded-lg xl:text-xs flex-1 xl:flex-none"
            title="Remove selected approvers"
          >
            <ChevronsLeft className="w-4 h-4 shrink-0" />
            <span className="xl:sr-only">Remove selected</span>
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden flex flex-col min-w-0 min-h-[8rem] xl:min-h-[16rem]">
          <div className="p-2.5 sm:p-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Approval {pendingCandidates.length ? `(${pendingCandidates.length})` : ''}
            </p>
            {pendingCandidates.length > 1 ? (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Selection order — top approves first. Use the arrows to reorder before submitting.
              </p>
            ) : null}
          </div>
          {pendingCandidates.length ? (
            <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800 max-h-[38vh] sm:max-h-[42vh] xl:max-h-[min(20rem,48vh)]">
              {pendingCandidates.map((pending, index) => {
                const userId = pending.userId;
                return (
                  <li key={pending.userId ?? pending.employeePk}>
                    <ApproverPendingRow
                      candidate={pending}
                      step={index + 1}
                      totalSteps={pendingCandidates.length}
                      checked={Boolean(userId && checkedSet.has(userId))}
                      disabled={disabled}
                      onToggle={() => toggleChecked(pending, { allowAssigned: true })}
                      onMoveUp={() => userId && movePending(userId, -1)}
                      onMoveDown={() => userId && movePending(userId, 1)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 flex-1 flex items-center justify-center text-center px-4 py-8 leading-relaxed">
              Select people on the left, then tap the arrow to assign them. To remove, select here and
              tap the left arrow.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ApproverSelectPanel;
