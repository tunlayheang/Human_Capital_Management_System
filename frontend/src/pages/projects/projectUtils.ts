import type { CSSProperties } from 'react';
import { isValid, format } from 'date-fns';
import { Project, Task, TaskStatus, User, ProjectMilestone } from '../../types';
import {
  formatDateOnlyDisplay,
  parseDisplayDateInput,
} from '../../utils/formatDisplayDate';
export type EnrichedProject = Project & {
  totalTasks: number;
  completedTasks: number;
  progress: number;
};

/** Calendar-safe parse for Gantt / project dates (avoids UTC day-shift on YYYY-MM-DD). */
export function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = parseDisplayDateInput(value);
  return d && isValid(d) ? d : null;
}

/** Prefer the chronologically earlier calendar date string. */
export function earlierCalendarDate(
  a?: string,
  b?: string
): string | undefined {
  const ta = parseDate(a)?.getTime();
  const tb = parseDate(b)?.getTime();
  if (ta == null && tb == null) return undefined;
  if (ta == null) return b;
  if (tb == null) return a;
  return ta <= tb ? a : b;
}

/** Prefer the chronologically later calendar date string. */
export function laterCalendarDate(
  a?: string,
  b?: string
): string | undefined {
  const ta = parseDate(a)?.getTime();
  const tb = parseDate(b)?.getTime();
  if (ta == null && tb == null) return undefined;
  if (ta == null) return b;
  if (tb == null) return a;
  return ta >= tb ? a : b;
}

export function formatShortDate(value?: string): string {
  const formatted = formatDateOnlyDisplay(value, '');
  if (!formatted) return 'N/A';
  // Short form: dd/MM (drop year) when a full date was available
  return formatted.length === 10 ? formatted.slice(0, 5) : formatted;
}

export function formatLongDate(value?: string): string {
  const formatted = formatDateOnlyDisplay(value, '');
  return formatted || 'Not set';
}

export function formatTimelineRange(start?: string, end?: string): string {
  const s = formatShortDate(start);
  const e = formatShortDate(end);
  if (s === 'N/A' && e === 'N/A') return 'N/A';
  if (s !== 'N/A' && e !== 'N/A') return `${s} — ${e}`;
  if (s !== 'N/A') return `${s} — N/A`;
  return `N/A — ${e}`;
}

export function isTaskDone(t: Task): boolean {
  return t.status === TaskStatus.DONE || (t.progress ?? 0) >= 100;
}

export function computeTasksProgress(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const sum = tasks.reduce((acc, t) => acc + (t.progress ?? 0), 0);
  return Math.round(sum / tasks.length);
}

export function enrichProjects(projects: Project[], allTasks: Task[]): EnrichedProject[] {
  return projects.map((p) => {
    const tasks = allTasks.filter((t) => t.projectId === p.id);
    const completedTasks = tasks.filter(isTaskDone).length;
    return {
      ...p,
      totalTasks: tasks.length,
      completedTasks,
      progress: computeTasksProgress(tasks),
    };
  });
}

export function getProgressBarStyle(pct: number): CSSProperties {
  if (pct >= 100) return { background: 'linear-gradient(90deg, #10b981, #059669)' };
  if (pct >= 70) return { background: 'linear-gradient(90deg, #8b5cf6, #6d28d9)' };
  if (pct >= 30) return { background: 'linear-gradient(90deg, #0A87D4, #0078C1)' };
  return { background: 'linear-gradient(90deg, #f97316, #ea580c)' };
}

export function resolveUserName(employees: User[], id?: string): string {
  if (!id) return 'Unassigned';
  return employees.find((e) => e.id === id)?.name ?? 'Unassigned';
}

export function isTaskOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === TaskStatus.DONE) return false;
  const due = parseDate(t.dueDate);
  if (!due) return false;
  return due < new Date();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ROADMAP_MIN_WEEKS = 8;
/** Keeps the scrollable grid to a workable width (~2 years). */
const ROADMAP_MAX_WEEKS = 104;

/**
 * Week-aligned window the roadmap grid and its bars are both measured against.
 * `end` is exclusive: it is exactly `weekCount` weeks after `start`.
 */
export type RoadmapRange = {
  start: Date;
  end: Date;
  weekCount: number;
};

/** Preset timeline lengths (`auto` fits projects / selected dates). */
export type RoadmapPeriodWeeks = 'auto' | 8 | 13 | 26 | 52 | 104;

export const ROADMAP_PERIOD_OPTIONS: Array<{ value: RoadmapPeriodWeeks; label: string }> = [
  { value: 'auto', label: 'Auto (fit projects)' },
  { value: 8, label: '8 weeks (~2 months)' },
  { value: 13, label: '13 weeks (~3 months)' },
  { value: 26, label: '26 weeks (~6 months)' },
  { value: 52, label: '52 weeks (~1 year)' },
  { value: 104, label: '104 weeks (~2 years)' },
];

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

function addWeeksTo(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function clampWeekCount(weeks: number): number {
  return Math.min(ROADMAP_MAX_WEEKS, Math.max(ROADMAP_MIN_WEEKS, Math.round(weeks)));
}

function rangeFromStartAndWeeks(start: Date, weekCount: number): RoadmapRange {
  const weeks = clampWeekCount(weekCount);
  return { start, end: addWeeksTo(start, weeks), weekCount: weeks };
}

/** Derive the roadmap window from the projects on screen, snapped to whole weeks. */
function buildRoadmapRange(projects: Project[]): RoadmapRange {
  const bounds = projects.flatMap((p) =>
    [parseDate(p.startDate), parseDate(p.deadline)].filter((d): d is Date => d !== null)
  );
  const today = new Date();
  const earliest = bounds.length
    ? new Date(Math.min(...bounds.map((d) => d.getTime())))
    : startOfWeekMonday(today);
  const latest = bounds.length
    ? new Date(Math.max(...bounds.map((d) => d.getTime())))
    : addWeeksTo(startOfWeekMonday(today), ROADMAP_MIN_WEEKS);

  const start = startOfWeekMonday(earliest);
  // +1 day so a deadline falling on the last day still needs its own week column.
  const spanDays = Math.ceil((latest.getTime() + MS_PER_DAY - start.getTime()) / MS_PER_DAY);
  return rangeFromStartAndWeeks(start, Math.ceil(spanDays / 7));
}

/**
 * Resolve the visible timeline window from optional selected dates + period length.
 * - Fixed period: anchor on selected from (else to, else today).
 * - Auto + selected from/to: span those dates (min 8 weeks).
 * - Auto + no dates: fit projects (same as `buildRoadmapRange`).
 */
export function resolveRoadmapRange(
  projects: Project[],
  selected: { from?: string; to?: string },
  periodWeeks: RoadmapPeriodWeeks = 'auto'
): RoadmapRange {
  const fromDate = parseDate(selected.from?.trim() || undefined);
  const toDate = parseDate(selected.to?.trim() || undefined);
  const todayStart = startOfWeekMonday(new Date());

  if (periodWeeks !== 'auto') {
    if (fromDate) {
      return rangeFromStartAndWeeks(startOfWeekMonday(fromDate), periodWeeks);
    }
    if (toDate) {
      const endWeek = startOfWeekMonday(toDate);
      // Inclusive end week: show through the week that contains `to`.
      const start = addWeeksTo(endWeek, -(periodWeeks - 1));
      return rangeFromStartAndWeeks(start, periodWeeks);
    }
    return rangeFromStartAndWeeks(todayStart, periodWeeks);
  }

  if (fromDate || toDate) {
    const start = startOfWeekMonday(fromDate ?? toDate ?? new Date());
    const latest = toDate ?? fromDate ?? addWeeksTo(start, ROADMAP_MIN_WEEKS);
    const spanDays = Math.ceil((latest.getTime() + MS_PER_DAY - start.getTime()) / MS_PER_DAY);
    return rangeFromStartAndWeeks(start, Math.ceil(spanDays / 7));
  }

  return buildRoadmapRange(projects);
}

export function roadmapWeekHeaders(range: RoadmapRange): string[] {
  return Array.from({ length: range.weekCount }, (_, i) =>
    format(addWeeksTo(range.start, i), 'dd/MM/yyyy')
  );
}

export function formatRoadmapRangeLabel(range: RoadmapRange): string {
  const monthYear = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const lastDay = new Date(range.end.getTime() - MS_PER_DAY);
  return `${monthYear(range.start)} — ${monthYear(lastDay)}`;
}

/** Horizontal position of "now" as a percentage, or null when outside the window. */
export function roadmapTodayPercent(range: RoadmapRange, now: Date = new Date()): number | null {
  const total = range.end.getTime() - range.start.getTime();
  const offset = now.getTime() - range.start.getTime();
  if (offset < 0 || offset > total) return null;
  return (offset / total) * 100;
}

export function ganttBarPosition(
  range: RoadmapRange,
  start?: string,
  end?: string
): { left: number; width: number } {
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const total = rangeEnd - rangeStart;
  const parsedStart = parseDate(start)?.getTime() ?? rangeStart;
  // Deadlines are inclusive days, so the bar runs to the end of that day.
  const parsedEnd = (parseDate(end)?.getTime() ?? parsedStart) + MS_PER_DAY;

  const clampedStart = Math.max(rangeStart, Math.min(parsedStart, rangeEnd));
  const clampedEnd = Math.max(clampedStart, Math.min(parsedEnd, rangeEnd));

  const left = ((clampedStart - rangeStart) / total) * 100;
  const oneDayPercent = (MS_PER_DAY / total) * 100;
  const width = Math.min(
    100 - left,
    Math.max(oneDayPercent, ((clampedEnd - clampedStart) / total) * 100)
  );
  return { left, width };
}

const MS_PER_DAY_LOCAL = 24 * 60 * 60 * 1000;

type TaskGanttRange = {
  start: Date;
  end: Date;
  dayCount: number;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}

function addLocalDays(date: Date, days: number): Date {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Inclusive calendar day span for the task Gantt, padded around project/task dates. */
export function buildTaskGanttRange(
  project: Project,
  tasks: Task[],
  milestones: ProjectMilestone[] = [],
  now: Date = new Date()
): TaskGanttRange {
  const dates: Date[] = [];
  const push = (value?: string) => {
    const d = parseDate(value);
    if (d) dates.push(startOfLocalDay(d));
  };
  push(project.startDate);
  push(project.deadline);
  for (const t of tasks) {
    push(t.startDate);
    push(t.dueDate);
  }
  for (const m of milestones) push(m.dueDate);

  const today = startOfLocalDay(now);
  if (dates.length === 0) {
    return {
      start: addLocalDays(today, -7),
      end: addLocalDays(today, 21),
      dayCount: 29,
    };
  }

  let min = Math.min(...dates.map((d) => d.getTime()));
  let max = Math.max(...dates.map((d) => d.getTime()));
  min = Math.min(min, today.getTime());
  max = Math.max(max, today.getTime());

  // Pad a few days so bars are not flush against the edges.
  const start = addLocalDays(new Date(min), -3);
  const end = addLocalDays(new Date(max), 7);
  const dayCount = Math.max(
    14,
    Math.round((end.getTime() - start.getTime()) / MS_PER_DAY_LOCAL) + 1
  );
  return { start, end: addLocalDays(start, dayCount - 1), dayCount };
}

type TaskGanttDayHeader = {
  key: string;
  day: number;
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
};

type TaskGanttMonthBand = {
  key: string;
  label: string;
  startIndex: number;
  dayCount: number;
};

export function buildTaskGanttDayHeaders(
  range: TaskGanttRange,
  now: Date = new Date()
): { days: TaskGanttDayHeader[]; months: TaskGanttMonthBand[] } {
  const today = startOfLocalDay(now);
  const days: TaskGanttDayHeader[] = [];
  for (let i = 0; i < range.dayCount; i++) {
    const date = addLocalDays(range.start, i);
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    days.push({
      key: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
      date,
      isToday: date.getTime() === today.getTime(),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }

  const months: TaskGanttMonthBand[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i].date;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.dayCount += 1;
    } else {
      months.push({ key, label, startIndex: i, dayCount: 1 });
    }
  }

  return { days, months };
}

/** Pixel left/width for a task bar inside a day-column Gantt. */
export function taskGanttBarPixels(
  range: TaskGanttRange,
  dayPx: number,
  start?: string,
  end?: string
): { left: number; width: number } | null {
  const startDate = parseDate(start) ?? parseDate(end);
  const endDate = parseDate(end) ?? parseDate(start);
  if (!startDate || !endDate) return null;

  const rangeStart = startOfLocalDay(range.start).getTime();
  const rawStartMs = startOfLocalDay(startDate).getTime();
  const rawEndMs = startOfLocalDay(endDate).getTime();
  const startMs = Math.min(rawStartMs, rawEndMs);
  // Inclusive end day: bar covers through that calendar day.
  const endMs = Math.max(rawStartMs, rawEndMs) + MS_PER_DAY_LOCAL;
  const rangeEndExclusive = startOfLocalDay(range.end).getTime() + MS_PER_DAY_LOCAL;

  const clampedStart = Math.max(rangeStart, Math.min(startMs, rangeEndExclusive));
  const clampedEnd = Math.max(clampedStart + MS_PER_DAY_LOCAL * 0.35, Math.min(endMs, rangeEndExclusive));

  const left = ((clampedStart - rangeStart) / MS_PER_DAY_LOCAL) * dayPx;
  const width = Math.max(dayPx * 0.35, ((clampedEnd - clampedStart) / MS_PER_DAY_LOCAL) * dayPx);
  return { left, width };
}

export function taskGanttTodayLeft(
  range: TaskGanttRange,
  dayPx: number,
  now: Date = new Date()
): number | null {
  const today = startOfLocalDay(now).getTime();
  const rangeStart = startOfLocalDay(range.start).getTime();
  const rangeEnd = startOfLocalDay(range.end).getTime();
  if (today < rangeStart || today > rangeEnd) return null;
  return ((today - rangeStart) / MS_PER_DAY_LOCAL) * dayPx + dayPx / 2;
}

export function isTaskMilestoneLike(task: Task): boolean {
  if (!task.startDate || !task.dueDate) return false;
  const a = parseDate(task.startDate);
  const b = parseDate(task.dueDate);
  if (!a || !b) return false;
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}
