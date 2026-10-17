import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Percent,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Api } from '../../services/api';
import { formatRelativeTime } from '../../utils';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';
import { Button } from '../../components/ui/Button';
import { ListSearchFilterBar } from '../../components/ui/page';
import {
  FilterMenuDateRange,
  FilterMenuRadioGroup,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { ContentSkeleton } from '../../components/common/ContentSkeleton';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  countDateRangeFilters,
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  type DateRangeValue,
} from '../../utils/dateRangeFilter';

export type TaskActivityEntry = {
  id: string;
  taskId: string;
  projectId: string | null;
  action: string;
  summary: string;
  taskTitle: string;
  performedBy: string | null;
  performedByName: string | null;
  at: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  oldAssigneeId?: string | null;
  newAssigneeId?: string | null;
  oldAssigneeName?: string | null;
  newAssigneeName?: string | null;
};

type FilterMode = 'all' | 'handover' | 'progress' | 'status' | 'created' | 'deleted';

type Props = {
  projectId: string;
  /** When true, only activity for the viewer's assigned tasks is returned by scope=self. */
  tasksOnly?: boolean;
  /** Bump to force a refresh after task create/update/delete. */
  refreshKey?: number;
};

const STATUS_LABELS: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  REVIEW: 'In review',
  DONE: 'Done',
  BLOCKED: 'Blocked',
};

function normalizeAction(action: string): string {
  return String(action).toUpperCase().replace(/\s+/g, '_');
}

function actionIcon(action: string) {
  const a = normalizeAction(action);
  if (a === 'HANDED_OVER') return ArrowRightLeft;
  if (a === 'PROGRESS_UPDATED') return Percent;
  if (a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE') return CheckCircle2;
  if (a === 'CREATED' || a === 'CREATE') return Plus;
  if (a === 'DELETED' || a === 'DELETE') return X;
  return ClipboardList;
}

function actionTone(action: string): string {
  const a = normalizeAction(action);
  if (a === 'HANDED_OVER') return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300';
  if (a === 'PROGRESS_UPDATED') return 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300';
  if (a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (a === 'CREATED' || a === 'CREATE') {
    return 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300';
  }
  if (a === 'DELETED' || a === 'DELETE') {
    return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function actionLabel(action: string): string {
  const a = normalizeAction(action);
  if (a === 'HANDED_OVER') return 'Handover';
  if (a === 'PROGRESS_UPDATED') return 'Progress';
  if (a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE') return 'Status';
  if (a === 'CREATED' || a === 'CREATE') return 'Created';
  if (a === 'DELETED' || a === 'DELETE') return 'Cancelled';
  return 'Updated';
}

function matchesFilter(entry: TaskActivityEntry, mode: FilterMode): boolean {
  if (mode === 'all') return true;
  const a = normalizeAction(entry.action);
  if (mode === 'handover') return a === 'HANDED_OVER';
  if (mode === 'progress') return a === 'PROGRESS_UPDATED';
  if (mode === 'status') return a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE';
  if (mode === 'created') return a === 'CREATED' || a === 'CREATE';
  if (mode === 'deleted') return a === 'DELETED' || a === 'DELETE';
  return true;
}

function displayValue(field: string, value: unknown, fallbackName?: string | null): string {
  if (fallbackName) return fallbackName;
  if (value == null || value === '') return '—';
  if (field === 'progress') return `${value}%`;
  if (field === 'status') {
    const key = String(value).toUpperCase();
    return STATUS_LABELS[key] ?? String(value).replace(/_/g, ' ');
  }
  if (field === 'priority') return String(value).toUpperCase();
  if (field === 'assigneeId') return String(value);
  return String(value);
}

function findChange(entry: TaskActivityEntry, field: string) {
  return entry.changes.find((c) => c.field === field);
}

/** Compact one-line detail that still carries the action’s required facts. */
function activityDetail(entry: TaskActivityEntry): string {
  const a = normalizeAction(entry.action);
  const statusChange = findChange(entry, 'status');
  const progressChange = findChange(entry, 'progress');
  const assigneeChange = findChange(entry, 'assigneeId');
  const priorityChange = findChange(entry, 'priority');
  const dueChange = findChange(entry, 'dueDate');

  if (a === 'HANDED_OVER') {
    const from =
      entry.oldAssigneeName ||
      displayValue('assigneeId', assigneeChange?.from) ||
      'Unassigned';
    const to =
      entry.newAssigneeName ||
      displayValue('assigneeId', assigneeChange?.to) ||
      'Unassigned';
    return `${from} → ${to}`;
  }

  if (a === 'PROGRESS_UPDATED') {
    const from = displayValue('progress', progressChange?.from ?? 0);
    const to = displayValue('progress', progressChange?.to ?? 0);
    return `${from} → ${to}`;
  }

  if (a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE') {
    const parts: string[] = [];
    if (statusChange) {
      const from = displayValue('status', statusChange.from);
      const to = displayValue('status', statusChange.to);
      if (from !== '—' && to !== '—') {
        parts.push(`${from} → ${to}`);
      } else if (to !== '—') {
        parts.push(`Set to ${to}`);
      } else if (from !== '—') {
        parts.push(`Cleared from ${from}`);
      }
    }
    if (progressChange) {
      parts.push(
        `Progress ${displayValue('progress', progressChange.from)} → ${displayValue('progress', progressChange.to)}`
      );
    }
    if (parts.length) return parts.join(' · ');
  }

  if (a === 'CREATED' || a === 'CREATE') {
    const bits: string[] = [];
    const status = findChange(entry, 'status');
    const priority = findChange(entry, 'priority');
    const due = findChange(entry, 'dueDate');
    const assignee = findChange(entry, 'assigneeId');
    if (status?.to != null && status.to !== '') bits.push(displayValue('status', status.to));
    if (priority?.to != null && priority.to !== '') bits.push(displayValue('priority', priority.to));
    if (due?.to) bits.push(`Due ${displayValue('dueDate', due.to)}`);
    if (assignee?.to) {
      bits.push(entry.newAssigneeName || displayValue('assigneeId', assignee.to));
    }
    return bits.length ? bits.join(' · ') : 'New task created';
  }

  if (a === 'DELETED' || a === 'DELETE') {
    const bits: string[] = ['Cancelled'];
    const priority = findChange(entry, 'priority');
    const assignee = findChange(entry, 'assigneeId');
    if (priority?.from != null && priority.from !== '') {
      bits.push(displayValue('priority', priority.from));
    }
    if (assignee?.from != null && assignee.from !== '') {
      bits.push(entry.oldAssigneeName || displayValue('assigneeId', assignee.from));
    }
    return bits.join(' · ');
  }

  const bits: string[] = [];
  if (statusChange) {
    bits.push(
      `Status ${displayValue('status', statusChange.from)} → ${displayValue('status', statusChange.to)}`
    );
  }
  if (progressChange) {
    bits.push(
      `Progress ${displayValue('progress', progressChange.from)} → ${displayValue('progress', progressChange.to)}`
    );
  }
  if (assigneeChange) {
    bits.push(
      `${entry.oldAssigneeName || displayValue('assigneeId', assigneeChange.from)} → ${
        entry.newAssigneeName || displayValue('assigneeId', assigneeChange.to)
      }`
    );
  }
  if (priorityChange) {
    bits.push(
      `Priority ${displayValue('priority', priorityChange.from)} → ${displayValue('priority', priorityChange.to)}`
    );
  }
  if (dueChange) {
    bits.push(`Due ${displayValue('dueDate', dueChange.from)} → ${displayValue('dueDate', dueChange.to)}`);
  }
  if (bits.length) return bits.join(' · ');

  // Fall back to summary body without repeating the task title when possible.
  const title = entry.taskTitle?.trim();
  if (title && entry.summary.includes(title)) {
    return entry.summary.replace(new RegExp(`[“"]?${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[”"]?`), 'task').trim();
  }
  return entry.summary;
}

export const TaskActivityTab: React.FC<Props> = ({ projectId, tasksOnly, refreshKey = 0 }) => {
  const [entries, setEntries] = useState<TaskActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await Api.projects.getTaskActivity(projectId, {
        limit: 150,
        scope: tasksOnly ? 'self' : undefined,
      });
      setEntries(Array.isArray(rows) ? (rows as TaskActivityEntry[]) : []);
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : 'Failed to load task activity');
    } finally {
      setLoading(false);
    }
  }, [projectId, tasksOnly]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: filterMode, defaultValue: 'all' }]) +
      countDateRangeFilters(dateRange),
    [filterMode, dateRange]
  );

  const clearFilters = () => {
    setFilterMode('all');
    setDateRange(EMPTY_DATE_RANGE);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!matchesFilter(entry, filterMode)) return false;
      if (!recordMatchesDateRange(entry.at, dateRange)) return false;
      if (!q) return true;
      const hay = [
        entry.summary,
        entry.taskTitle,
        entry.taskId,
        entry.performedByName,
        entry.oldAssigneeName,
        entry.newAssigneeName,
        entry.action,
        activityDetail(entry),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filterMode, search, dateRange]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold dark:text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-600" />
            Task Activity
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Creates, progress, status changes, handovers, and cancellations for this project.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        >
          Refresh
        </Button>
      </div>

      <ListSearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search task, ticket, actor…"
        filter={
          <PageFilterMenu activeCount={filterActiveCount} onClear={clearFilters}>
            <FilterMenuDateRange
              from={dateRange.from}
              to={dateRange.to}
              onChange={setDateRange}
              fromLabel="Activity from"
              toLabel="Activity to"
            />
            <FilterMenuRadioGroup
              label="Show"
              value={filterMode}
              defaultValue="all"
              onChange={setFilterMode}
              options={[
                { value: 'all', label: 'All activity' },
                { value: 'handover', label: 'Handovers' },
                { value: 'progress', label: 'Progress' },
                { value: 'status', label: 'Status' },
                { value: 'created', label: 'Created' },
                { value: 'deleted', label: 'Cancelled' },
              ]}
            />
          </PageFilterMenu>
        }
      />

      {loading ? (
        <ContentSkeleton layout="list" rows={4} label="Loading activity…" />
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-rose-600">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Activity className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">
            {entries.length === 0
              ? 'No task activity yet. Updates and handovers will appear here.'
              : 'No activity matches this filter.'}
          </p>
        </div>
      ) : (
        <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-2.5">
          {filtered.map((entry) => {
            const Icon = actionIcon(entry.action);
            const detail = activityDetail(entry);
            return (
              <li key={entry.id} className="relative pl-5 py-2.5 first:pt-0">
                <span
                  className={`absolute -left-2.5 top-3 flex h-5 w-5 items-center justify-center rounded-full border border-white dark:border-slate-900 ${actionTone(entry.action)}`}
                >
                  <Icon className="w-3 h-3" />
                </span>

                {/* Line 1: action + ticket + title + who/when */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${actionTone(entry.action)}`}
                  >
                    {actionLabel(entry.action)}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0">{entry.taskId}</span>
                  <span
                    className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[min(100%,28rem)]"
                    title={entry.taskTitle}
                  >
                    {entry.taskTitle || 'Untitled task'}
                  </span>
                  <span
                    className="text-[11px] text-slate-400 shrink-0"
                    title={formatDateTimeDisplay(entry.at)}
                  >
                    {formatRelativeTime(entry.at)}
                  </span>
                  {entry.performedByName ? (
                    <span className="text-[11px] text-slate-400 truncate">
                      by {entry.performedByName}
                    </span>
                  ) : null}
                </div>

                {/* Line 2: action detail (from → to / key facts) */}
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 truncate" title={detail}>
                  {detail}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
