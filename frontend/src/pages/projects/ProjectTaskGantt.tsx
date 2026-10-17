import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Focus,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Project, ProjectMilestone, Task, TaskStatus, User } from '../../types';
import {
  buildTaskGanttDayHeaders,
  buildTaskGanttRange,
  earlierCalendarDate,
  isTaskMilestoneLike,
  laterCalendarDate,
  parseDate,
  taskGanttBarPixels,
  taskGanttTodayLeft,
} from './projectUtils';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';

const ROW_H = 40;
const HEADER_H = 52;
const LABEL_W = 220;
const DATE_W = 92;
const FROZEN_W = LABEL_W + DATE_W * 2;

type ZoomLevel = 'day' | 'week' | 'month';

const ZOOM_PX: Record<ZoomLevel, number> = {
  day: 36,
  week: 16,
  month: 8,
};

type Props = {
  project: Project;
  tasks: Task[];
  milestones: ProjectMilestone[];
  employees: User[];
  canEdit: boolean;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
};

type GanttRow =
  | {
      kind: 'group';
      key: string;
      status: TaskStatus;
      label: string;
      startDate?: string;
      endDate?: string;
      progress: number;
      count: number;
    }
  | {
      kind: 'task';
      key: string;
      task: Task;
      depth: number;
      milestone: boolean;
    }
  | {
      kind: 'milestone';
      key: string;
      title: string;
      dueDate?: string;
    };

const STATUS_ORDER: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVIEW,
  TaskStatus.BLOCKED,
  TaskStatus.DONE,
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'To do',
  [TaskStatus.IN_PROGRESS]: 'In progress',
  [TaskStatus.REVIEW]: 'Review',
  [TaskStatus.BLOCKED]: 'Blocked',
  [TaskStatus.DONE]: 'Done',
};

function toYmd(value?: string): string {
  const d = parseDate(value);
  if (!d) return formatDateOnlyDisplay(value, '—');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sortByStart(a: Task, b: Task): number {
  const as = parseDate(a.startDate || a.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bs = parseDate(b.startDate || b.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (as !== bs) return as - bs;
  return a.title.localeCompare(b.title);
}

function pickDefaultZoom(dayCount: number): ZoomLevel {
  if (dayCount > 120) return 'month';
  if (dayCount > 45) return 'week';
  return 'day';
}

function rowDates(row: GanttRow): { start: string; end: string } {
  if (row.kind === 'group') return { start: toYmd(row.startDate), end: toYmd(row.endDate) };
  if (row.kind === 'task') {
    return {
      start: toYmd(row.task.startDate || row.task.dueDate),
      end: toYmd(row.task.dueDate || row.task.startDate),
    };
  }
  return { start: toYmd(row.dueDate), end: toYmd(row.dueDate) };
}

export const ProjectTaskGantt: React.FC<Props> = ({
  project,
  tasks,
  milestones,
  employees,
  canEdit,
  onEditTask,
  onDeleteTask,
}) => {
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  const range = useMemo(
    () => buildTaskGanttRange(project, tasks, milestones),
    [project, tasks, milestones]
  );

  useEffect(() => {
    setZoom(pickDefaultZoom(range.dayCount));
    didInitialScroll.current = false;
  }, [range.dayCount, project.id]);

  const dayPx = ZOOM_PX[zoom];
  const { days, months } = useMemo(() => buildTaskGanttDayHeaders(range), [range]);
  const todayLeft = useMemo(() => taskGanttTodayLeft(range, dayPx), [range, dayPx]);
  const timelineWidth = days.length * dayPx;
  const gridWidth = FROZEN_W + timelineWidth;

  const rows = useMemo(() => {
    const out: GanttRow[] = [];
    const byStatus = new Map<TaskStatus, Task[]>();
    for (const status of STATUS_ORDER) byStatus.set(status, []);
    for (const task of [...tasks].sort(sortByStart)) {
      const list = byStatus.get(task.status) ?? [];
      list.push(task);
      byStatus.set(task.status, list);
    }

    for (const status of STATUS_ORDER) {
      const list = byStatus.get(status) ?? [];
      if (list.length === 0) continue;
      let startDate: string | undefined;
      let endDate: string | undefined;
      for (const t of list) {
        startDate = earlierCalendarDate(startDate, t.startDate || t.dueDate);
        endDate = laterCalendarDate(endDate, t.dueDate || t.startDate);
      }
      const progress = Math.round(
        list.reduce((s, t) => s + (t.progress ?? 0), 0) / Math.max(1, list.length)
      );
      out.push({
        kind: 'group',
        key: `group-${status}`,
        status,
        label: STATUS_LABEL[status],
        startDate,
        endDate,
        progress,
        count: list.length,
      });
      if (!collapsed[`group-${status}`]) {
        for (const task of list) {
          out.push({
            kind: 'task',
            key: task.id,
            task,
            depth: 1,
            milestone: isTaskMilestoneLike(task),
          });
        }
      }
    }

    const ms = [...milestones].filter((m) => m.dueDate || m.title);
    ms.sort((a, b) => {
      const ta = parseDate(a.dueDate)?.getTime() ?? 0;
      const tb = parseDate(b.dueDate)?.getTime() ?? 0;
      return ta - tb;
    });
    for (const m of ms) {
      out.push({
        kind: 'milestone',
        key: `ms-${m.id}`,
        title: m.title || 'Milestone',
        dueDate: m.dueDate,
      });
    }
    return out;
  }, [tasks, milestones, collapsed]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId]
  );

  const taskIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => {
      if (row.kind === 'task') map.set(row.task.id, i);
    });
    return map;
  }, [rows]);

  const dependencyLinks = useMemo(() => {
    const links: {
      from: number;
      to: number;
      fromBar: { left: number; width: number };
      toBar: { left: number; width: number };
    }[] = [];
    for (const row of rows) {
      if (row.kind !== 'task') continue;
      const deps = row.task.dependencies ?? [];
      if (!deps.length) continue;
      const toIdx = taskIndexById.get(row.task.id);
      const toBar = taskGanttBarPixels(
        range,
        dayPx,
        row.task.startDate || row.task.dueDate,
        row.task.dueDate || row.task.startDate
      );
      if (toIdx == null || !toBar) continue;
      for (const depId of deps) {
        const fromIdx = taskIndexById.get(depId);
        const fromTask = tasks.find((t) => t.id === depId);
        if (fromIdx == null || !fromTask) continue;
        const fromBar = taskGanttBarPixels(
          range,
          dayPx,
          fromTask.startDate || fromTask.dueDate,
          fromTask.dueDate || fromTask.startDate
        );
        if (!fromBar) continue;
        links.push({ from: fromIdx, to: toIdx, fromBar, toBar });
      }
    }
    return links;
  }, [rows, taskIndexById, tasks, range, dayPx]);

  const scrollTimelineTo = useCallback(
    (barLeftPx: number, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el) return;
      const absoluteLeft = FROZEN_W + barLeftPx;
      const target = Math.max(0, absoluteLeft - el.clientWidth * 0.28);
      el.scrollTo({ left: target, behavior });
    },
    []
  );

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (todayLeft == null) {
        for (const row of rows) {
          if (row.kind !== 'task') continue;
          const bar = taskGanttBarPixels(
            range,
            dayPx,
            row.task.startDate || row.task.dueDate,
            row.task.dueDate || row.task.startDate
          );
          if (bar) {
            scrollTimelineTo(bar.left, behavior);
            return;
          }
        }
        return;
      }
      scrollTimelineTo(todayLeft, behavior);
    },
    [todayLeft, rows, range, dayPx, scrollTimelineTo]
  );

  const scrollToSelection = useCallback(() => {
    if (!selectedId) {
      scrollToToday();
      return;
    }
    const row = rows.find(
      (r) =>
        (r.kind === 'task' && r.task.id === selectedId) ||
        (r.kind === 'milestone' && r.key === selectedId)
    );
    if (!row) {
      scrollToToday();
      return;
    }
    let bar: { left: number; width: number } | null = null;
    if (row.kind === 'task') {
      bar = taskGanttBarPixels(
        range,
        dayPx,
        row.task.startDate || row.task.dueDate,
        row.task.dueDate || row.task.startDate
      );
    } else if (row.kind === 'milestone') {
      bar = taskGanttBarPixels(range, dayPx, row.dueDate, row.dueDate);
    }
    if (bar) scrollTimelineTo(bar.left + bar.width / 2);
    else scrollToToday();
  }, [selectedId, rows, range, dayPx, scrollTimelineTo, scrollToToday]);

  useEffect(() => {
    if (didInitialScroll.current) return;
    if (!scrollRef.current || days.length === 0) return;
    didInitialScroll.current = true;
    requestAnimationFrame(() => scrollToToday('auto'));
  }, [days.length, dayPx, scrollToToday]);

  useEffect(() => {
    if (!selectedId) return;
    if (!tasks.some((t) => t.id === selectedId) && !selectedId.startsWith('ms-')) {
      setSelectedId(null);
    }
  }, [tasks, selectedId]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const bumpZoom = (dir: -1 | 1) => {
    const order: ZoomLevel[] = ['month', 'week', 'day'];
    const idx = order.indexOf(zoom);
    const next = order[Math.max(0, Math.min(order.length - 1, idx + dir))];
    setZoom(next);
    didInitialScroll.current = false;
  };

  const isActiveRow = (row: GanttRow) => {
    const id = row.kind === 'task' ? row.task.id : row.key;
    return id === selectedId || id === hoveredId;
  };

  const selectRow = (row: GanttRow) => {
    if (row.kind === 'task') setSelectedId(row.task.id);
    else if (row.kind === 'milestone') setSelectedId(row.key);
    else setSelectedId(null);
  };

  const frozenGlass =
    'bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-r border-slate-200 dark:border-slate-700';

  return (
    <div className="flex flex-col min-h-0">
      <ConfirmDialogHost />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60">
        <div className="flex items-center gap-0.5 text-slate-500">
          <ToolbarIcon
            title="Edit selected task"
            disabled={!canEdit || !selectedTask}
            onClick={() => selectedTask && onEditTask(selectedTask)}
          >
            <Pencil className="w-4 h-4" />
          </ToolbarIcon>
          <ToolbarIcon
            title="Delete selected task"
            disabled={!canEdit || !selectedTask}
            onClick={() => {
              if (!selectedTask) return;
              void (async () => {
                const ok = await confirm({
                  title: 'Delete task?',
                  description: `Delete "${selectedTask.title}" from the active list? It stays in history and can be shown with the Cancelled filter.`,
                  variant: 'danger',
                  confirmLabel: 'Delete',
                });
                if (ok) onDeleteTask(selectedTask.id);
              })();
            }}
          >
            <Trash2 className="w-4 h-4" />
          </ToolbarIcon>
        </div>

        <span className="hidden sm:inline mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        <div className="flex items-center gap-1">
          <ToolbarIcon title="Zoom out" disabled={zoom === 'month'} onClick={() => bumpZoom(-1)}>
            <Minus className="w-4 h-4" />
          </ToolbarIcon>
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-[11px] font-semibold">
            {(['month', 'week', 'day'] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => {
                  setZoom(level);
                  didInitialScroll.current = false;
                }}
                className={`px-2.5 py-1 capitalize ${
                  zoom === level
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <ToolbarIcon title="Zoom in" disabled={zoom === 'day'} onClick={() => bumpZoom(1)}>
            <Plus className="w-4 h-4" />
          </ToolbarIcon>
          <ToolbarIcon title="Jump to today" onClick={() => scrollToToday()}>
            <Focus className="w-4 h-4" />
          </ToolbarIcon>
          {selectedId ? (
            <button
              type="button"
              onClick={scrollToSelection}
              className="ml-1 px-2 py-1 rounded-md text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40"
            >
              Find selected
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <LegendDot className="bg-teal-500" label="Group" />
          <LegendDot className="bg-blue-500" label="Task" />
          <LegendDot className="bg-violet-500 rotate-45 !rounded-sm !w-2.5 !h-2.5" label="Milestone" />
        </div>
      </div>

      {tasks.length === 0 && milestones.length === 0 ? (
        <div className="py-16 text-center text-slate-500">
          <p className="font-medium">No tasks on the Gantt chart yet</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="hcms-table-scroll custom-scrollbar relative min-h-[320px] max-h-[min(70vh,720px)] overflow-y-auto border-t border-slate-100 dark:border-slate-800"
        >
          <div className="relative" style={{ minWidth: gridWidth, width: gridWidth }}>
            {/* Sticky header: frozen labels + scrolling date row (same scroll as bars) */}
            <div
              className="sticky top-0 z-30 flex border-b border-slate-200 dark:border-slate-700"
              style={{ height: HEADER_H }}
            >
              <div
                className={`sticky left-0 z-40 shrink-0 grid ${frozenGlass}`}
                style={{
                  width: FROZEN_W,
                  gridTemplateColumns: `${LABEL_W}px ${DATE_W}px ${DATE_W}px`,
                  height: HEADER_H,
                }}
              >
                <div className="px-3 flex items-end pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Task name
                </div>
                <div className="px-2 flex items-end pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-l border-slate-200 dark:border-slate-700">
                  Start
                </div>
                <div className="px-2 flex items-end pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-l border-slate-200 dark:border-slate-700">
                  End
                </div>
              </div>

              <div className="relative shrink-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-sm" style={{ width: timelineWidth }}>
                <div className="flex h-6 border-b border-slate-200 dark:border-slate-700">
                  {months.map((m) => (
                    <div
                      key={m.key}
                      className="shrink-0 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center border-r border-slate-200 dark:border-slate-700"
                      style={{ width: m.dayCount * dayPx }}
                    >
                      {m.dayCount * dayPx >= 72 ? m.label : m.label.split(' ')[0]}
                    </div>
                  ))}
                </div>
                <div className="flex h-[26px]">
                  {days.map((d, i) => {
                    const showLabel =
                      zoom === 'day' ||
                      (zoom === 'week' && (d.date.getDay() === 1 || d.isToday || i === 0)) ||
                      (zoom === 'month' && (d.day === 1 || d.isToday || i === 0));
                    return (
                      <div
                        key={d.key}
                        className={`shrink-0 text-center text-[10px] leading-[26px] border-r border-slate-100 dark:border-slate-800 ${
                          d.isToday
                            ? 'text-rose-600 font-bold bg-rose-50/80 dark:bg-rose-950/30'
                            : d.isWeekend
                              ? 'text-slate-400 bg-slate-50/80 dark:bg-slate-900/40'
                              : 'text-slate-500'
                        }`}
                        style={{ width: dayPx }}
                        title={d.key}
                      >
                        {showLabel ? d.day : ''}
                      </div>
                    );
                  })}
                </div>
                {todayLeft != null && (
                  <div
                    className="absolute top-0 bottom-0 z-20 pointer-events-none"
                    style={{ left: todayLeft }}
                  >
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-500 text-white text-[9px] font-bold shadow-sm whitespace-nowrap">
                      Today
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="relative" style={{ height: Math.max(rows.length * ROW_H, 160) }}>
              {/* Day grid behind bars */}
              <div
                className="absolute top-0 bottom-0 flex pointer-events-none"
                style={{ left: FROZEN_W, width: timelineWidth }}
              >
                {days.map((d) => (
                  <div
                    key={d.key}
                    className={`shrink-0 border-r border-slate-100 dark:border-slate-800/80 h-full ${
                      d.isWeekend ? 'bg-slate-50/70 dark:bg-slate-800/20' : ''
                    } ${d.isToday ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''}`}
                    style={{ width: dayPx }}
                  />
                ))}
              </div>

              {todayLeft != null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-rose-500 z-20 pointer-events-none"
                  style={{ left: FROZEN_W + todayLeft }}
                />
              )}

              {dependencyLinks.length > 0 && (
                <svg
                  className="absolute top-0 z-10 pointer-events-none overflow-visible"
                  style={{ left: FROZEN_W }}
                  width={timelineWidth}
                  height={rows.length * ROW_H}
                >
                  {dependencyLinks.map((link, i) => {
                    const x1 = link.fromBar.left + link.fromBar.width;
                    const y1 = link.from * ROW_H + ROW_H / 2;
                    const x2 = link.toBar.left;
                    const y2 = link.to * ROW_H + ROW_H / 2;
                    const midX = Math.max(x1 + 10, (x1 + x2) / 2);
                    const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
                    return (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth={1.25}
                        markerEnd="url(#gantt-arrow)"
                      />
                    );
                  })}
                  <defs>
                    <marker
                      id="gantt-arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
                    </marker>
                  </defs>
                </svg>
              )}

              {rows.map((row, index) => {
                const rowId = row.kind === 'task' ? row.task.id : row.key;
                const active = isActiveRow(row);
                const dates = rowDates(row);
                const top = index * ROW_H;
                return (
                  <div
                    key={row.key}
                    className="absolute left-0 right-0 flex"
                    style={{ top, height: ROW_H }}
                    onMouseEnter={() => setHoveredId(rowId)}
                    onMouseLeave={() => setHoveredId((id) => (id === rowId ? null : id))}
                  >
                    {/* Frozen task + dates — stick to left like Project Timeline */}
                    <div
                      className={`sticky left-0 z-20 shrink-0 grid border-b border-slate-100 dark:border-slate-800 cursor-pointer ${frozenGlass} ${
                        active ? 'bg-primary-50/90 dark:bg-primary-950/50' : ''
                      }`}
                      style={{
                        width: FROZEN_W,
                        gridTemplateColumns: `${LABEL_W}px ${DATE_W}px ${DATE_W}px`,
                        height: ROW_H,
                      }}
                      onClick={() => selectRow(row)}
                      onDoubleClick={() => {
                        if (row.kind === 'task' && canEdit) onEditTask(row.task);
                      }}
                    >
                      <div className="px-2 flex items-center gap-1 min-w-0">
                        {row.kind === 'group' ? (
                          <button
                            type="button"
                            className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(row.key);
                            }}
                            aria-label={collapsed[row.key] ? 'Expand' : 'Collapse'}
                          >
                            {collapsed[row.key] ? (
                              <ChevronRight className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ) : (
                          <span
                            style={{ width: 14 + (row.kind === 'task' ? row.depth * 12 : 12) }}
                          />
                        )}
                        <span
                          className={`truncate text-sm ${
                            row.kind === 'group'
                              ? 'font-semibold text-slate-800 dark:text-slate-100'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                          title={
                            row.kind === 'group'
                              ? row.label
                              : row.kind === 'task'
                                ? row.task.title
                                : row.title
                          }
                        >
                          {row.kind === 'group'
                            ? `${row.label} (${row.count})`
                            : row.kind === 'task'
                              ? row.task.title
                              : row.title}
                        </span>
                      </div>
                      <div className="px-2 flex items-center text-xs text-slate-500 border-l border-slate-100 dark:border-slate-800 tabular-nums truncate">
                        {dates.start}
                      </div>
                      <div className="px-2 flex items-center text-xs text-slate-500 border-l border-slate-100 dark:border-slate-800 tabular-nums truncate">
                        {dates.end}
                      </div>
                    </div>

                    {/* Timeline bars — scroll with date header */}
                    <div
                      className={`relative shrink-0 border-b border-slate-100 dark:border-slate-800 cursor-pointer ${
                        active
                          ? 'bg-primary-50/40 dark:bg-primary-950/20 ring-1 ring-inset ring-primary-300/50'
                          : ''
                      }`}
                      style={{ width: timelineWidth, height: ROW_H }}
                      onClick={() => selectRow(row)}
                      onDoubleClick={() => {
                        if (row.kind === 'task' && canEdit) onEditTask(row.task);
                      }}
                    >
                      <GanttBarContent
                        row={row}
                        range={range}
                        dayPx={dayPx}
                        assigneeName={
                          row.kind === 'task'
                            ? employees.find((e) => e.id === row.task.assigneeId)?.name
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ToolbarIcon: React.FC<{
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ title, disabled, onClick, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none"
  >
    {children}
  </button>
);

const LegendDot: React.FC<{ className: string; label: string }> = ({ className, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`inline-block w-2.5 h-2.5 rounded-sm ${className}`} />
    {label}
  </span>
);

const GanttBarContent: React.FC<{
  row: GanttRow;
  range: ReturnType<typeof buildTaskGanttRange>;
  dayPx: number;
  assigneeName?: string;
}> = ({ row, range, dayPx, assigneeName }) => {
  if (row.kind === 'milestone') {
    const bar = taskGanttBarPixels(range, dayPx, row.dueDate, row.dueDate);
    if (!bar) return null;
    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 flex items-center gap-2 z-10"
        style={{ left: Math.max(0, bar.left + bar.width / 2 - 7) }}
      >
        <span className="w-3.5 h-3.5 rotate-45 rounded-[2px] bg-violet-500 shadow-sm border border-violet-300 shrink-0" />
        <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300 whitespace-nowrap">
          {row.title}
        </span>
      </div>
    );
  }

  if (row.kind === 'group') {
    const bar = taskGanttBarPixels(range, dayPx, row.startDate, row.endDate);
    if (!bar) return null;
    const pct = Math.max(0, Math.min(100, row.progress));
    const width = Math.max(bar.width, dayPx * 0.8);
    const labelOutside = width < 88;
    return (
      <>
        <div
          className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md overflow-hidden text-white text-[11px] font-semibold flex items-center shadow-sm z-10"
          style={{ left: bar.left, width, background: '#0d9488' }}
          title={`${row.label} · ${toYmd(row.startDate)} → ${toYmd(row.endDate)} · ${pct}%`}
        >
          <div className="absolute inset-y-0 left-0 bg-teal-700/90" style={{ width: `${pct}%` }} />
          {!labelOutside ? <span className="relative px-2 truncate">{row.label}</span> : null}
        </div>
        {labelOutside ? (
          <span
            className="absolute top-1/2 -translate-y-1/2 z-10 text-[11px] font-semibold text-teal-800 dark:text-teal-200 whitespace-nowrap pointer-events-none"
            style={{ left: bar.left + width + 6 }}
          >
            {row.label}
          </span>
        ) : null}
      </>
    );
  }

  const task = row.task;
  const pct = Math.max(0, Math.min(100, task.progress ?? 0));
  const bar = taskGanttBarPixels(
    range,
    dayPx,
    task.startDate || task.dueDate,
    task.dueDate || task.startDate
  );
  if (!bar) return null;

  if (row.milestone) {
    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 flex items-center gap-2 z-10"
        style={{ left: Math.max(0, bar.left + bar.width / 2 - 7) }}
      >
        <span className="w-3.5 h-3.5 rotate-45 rounded-[2px] bg-violet-500 shadow-sm border border-violet-300 shrink-0" />
        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
          {task.title}
        </span>
      </div>
    );
  }

  const width = Math.max(bar.width, dayPx * 0.7);
  const labelOutside = width < 96;
  const tip = `${task.title}${assigneeName ? ` · ${assigneeName}` : ''} · ${toYmd(
    task.startDate || task.dueDate
  )} → ${toYmd(task.dueDate || task.startDate)} · ${pct}%`;

  return (
    <>
      <div
        className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md overflow-hidden text-white text-[11px] font-medium flex items-center shadow-sm z-10"
        style={{ left: bar.left, width, background: '#3b82f6' }}
        title={tip}
      >
        <div className="absolute inset-y-0 left-0 bg-blue-700/85" style={{ width: `${pct}%` }} />
        {!labelOutside ? <span className="relative px-2 truncate">{task.title}</span> : null}
      </div>
      {labelOutside ? (
        <span
          className="absolute top-1/2 -translate-y-1/2 z-10 text-[11px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap pointer-events-none"
          style={{ left: bar.left + width + 6 }}
        >
          {task.title}
        </span>
      ) : null}
    </>
  );
};
