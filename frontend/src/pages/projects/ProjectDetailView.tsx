import React, { useMemo, useState } from 'react';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  ArrowLeft,
  Calendar,
  Target,
  CheckCircle2,
  ListChecks,
  Users,
  Settings,
  Clock,
  Search,
  AlertCircle,
  Pencil,
  X,
  BarChart2,
  Plus,
  Activity,
  Mail,
  Phone,
  Briefcase,
  BadgeCheck,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import {
  Project,
  Task,
  TaskStatus,
  User,
  Role,
  ProjectMilestone,
} from '../../types';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ListSearchFilterBar, UnderlineTabs } from '../../components/ui/page';
import {
  FilterMenuDateRange,
  FilterMenuRadioGroup,
  FilterMenuSelect,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  countDateRangeFilters,
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  type DateRangeValue,
} from '../../utils/dateRangeFilter';
import {
  computeTasksProgress,
  formatLongDate,
  formatShortDate,
  isTaskDone,
  isTaskOverdue,
  resolveUserName,
} from './projectUtils';
import { TaskActivityTab } from './TaskActivityTab';
import { ProjectTaskGantt } from './ProjectTaskGantt';

export type ProjectDetails = {
  project: Project;
  tasks: Task[];
  members: string[];
  milestones: ProjectMilestone[];
};

type DetailTab = 'tasks' | 'timeline' | 'team' | 'activity';
const DETAIL_TABS = ['tasks', 'timeline', 'team', 'activity'] as const;

type Props = {
  details: ProjectDetails;
  employees: User[];
  onBack: () => void;
  hasPermission: (key: string) => boolean;
  onDeleteTask: (taskId: string) => void;
  onEditTask: (task: Task) => void;
  onAddTask: () => void;
  onOpenSettings?: () => void;
};

export const ProjectDetailView: React.FC<Props> = ({
  details,
  employees,
  onBack,
  hasPermission,
  onDeleteTask,
  onEditTask,
  onAddTask,
  onOpenSettings,
}) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [detailsTab, setDetailsTab] = useUrlSyncedTab<DetailTab>({
    values: DETAIL_TABS,
    defaultValue: 'tasks',
    param: 'view',
  });
  const [taskVisibility, setTaskVisibility] = useState<'active' | 'deleted'>('active');

  const isEmployee = user?.role === Role.EMPLOYEE;
  const activeProjectTasks = useMemo(
    () => details.tasks.filter((t) => !t.deletedAt),
    [details.tasks]
  );
  const deletedProjectTasks = useMemo(
    () => details.tasks.filter((t) => Boolean(t.deletedAt)),
    [details.tasks]
  );
  const sourceTasks = taskVisibility === 'deleted' ? deletedProjectTasks : activeProjectTasks;
  const visibleTasks = useMemo(() => {
    if (!isEmployee || !user) return sourceTasks;
    return sourceTasks.filter((t) => t.assigneeId === user.id);
  }, [sourceTasks, isEmployee, user]);

  const detailProgress = useMemo(
    () => computeTasksProgress(activeProjectTasks),
    [activeProjectTasks]
  );
  const doneCount = activeProjectTasks.filter(isTaskDone).length;

  const showConfigure =
    !details.project.deletedAt &&
    (hasPermission('projects.edit.info') ||
      hasPermission('projects.edit.lead') ||
      hasPermission('projects.edit.status'));

  const teamStats = useMemo(() => {
    const map = new Map<
      string,
      { userId: string; name: string; total: number; sumProgress: number; done: number }
    >();
    for (const t of activeProjectTasks) {
      const uid = t.assigneeId || 'unassigned';
      const cur = map.get(uid) ?? {
        userId: uid,
        name: uid === 'unassigned' ? 'Unassigned' : resolveUserName(employees, uid),
        total: 0,
        sumProgress: 0,
        done: 0,
      };
      cur.total += 1;
      cur.sumProgress += t.progress ?? 0;
      if (isTaskDone(t)) cur.done += 1;
      map.set(uid, cur);
    }
    return Array.from(map.values()).map((m) => ({
      ...m,
      progress: m.total ? Math.round(m.sumProgress / m.total) : 0,
    }));
  }, [activeProjectTasks, employees]);

  const teamProgressTotal =
    teamStats.length > 0
      ? Math.round(teamStats.reduce((s, m) => s + m.progress, 0) / teamStats.length)
      : 0;

  const activityRefreshKey = useMemo(
    () =>
      details.tasks
        .map((t) => `${t.id}:${t.assigneeId}:${t.progress ?? 0}:${t.status}:${t.title}`)
        .join('|'),
    [details.tasks]
  );

  const tabs: { id: DetailTab; label: string; icon: React.ElementType }[] = [
    { id: 'tasks', label: 'Tasks', icon: ListChecks },
    { id: 'timeline', label: 'Gantt Chart', icon: Calendar },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'activity', label: 'Activity', icon: Activity },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 group"
      >
        <span className="p-2 rounded-lg border group-hover:bg-primary-50 dark:group-hover:bg-primary-900/20 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </span>
        {t('projects.backToProjects') || '← Back to projects'}
      </button>

      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="relative bg-gradient-to-br from-primary-700 to-indigo-800 dark:from-slate-900 dark:to-slate-800 p-8 text-white">
          <div className="absolute top-4 right-4 w-24 h-24 rounded-full bg-white/5 blur-2xl" />
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 relative">
            <div>
              <ProjectChips project={details.project} />
              <h2 className="text-4xl font-bold mt-4">{details.project.title}</h2>
              <p className="text-primary-100/80 text-lg max-w-2xl mt-2">
                {details.project.description || 'No description'}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 min-w-[180px]">
              <p className="text-3xl font-black">{detailProgress}%</p>
              <p className="text-sm text-primary-100/80">Progress</p>
              <DetailProgressBar pct={detailProgress} />
            </div>
            {showConfigure && onOpenSettings ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenSettings}
                icon={<Settings className="w-4 h-4" />}
                className="shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                Settings
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-white dark:bg-slate-800">
          <MetaCell
            label="STARTED"
            icon={<Calendar className="w-4 h-4 text-primary-500" />}
            value={formatLongDate(details.project.startDate)}
          />
          <MetaCell
            label="DUE"
            icon={<Target className="w-4 h-4 text-rose-500" />}
            value={formatLongDate(details.project.deadline)}
          />
          <MetaCell
            label="TASKS DONE"
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            value={`${doneCount} / ${visibleTasks.length} completed`}
          />
          <MetaCell
            label="PROJECT LEAD"
            icon={
              <div className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-bold">
                {resolveUserName(employees, details.project.leadId).charAt(0)}
              </div>
            }
            value={resolveUserName(employees, details.project.leadId)}
          />
        </div>
      </div>

      <UnderlineTabs
        value={detailsTab}
        onChange={(id) => setDetailsTab(id)}
        tabs={tabs}
        ariaLabel="Project detail sections"
      />

      <div className="surface-card rounded-2xl min-h-[200px]">
        {detailsTab === 'tasks' && (
          <TasksTab
            visibleTasks={visibleTasks}
            taskVisibility={taskVisibility}
            onTaskVisibilityChange={setTaskVisibility}
            deletedCount={deletedProjectTasks.length}
            employees={employees}
            isEmployee={isEmployee}
            hasPermission={hasPermission}
            userId={user?.id}
            onAddTask={onAddTask}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        )}
        {detailsTab === 'timeline' && (
          <ProjectTaskGantt
            project={details.project}
            tasks={
              isEmployee && user
                ? activeProjectTasks.filter((t) => t.assigneeId === user.id)
                : activeProjectTasks
            }
            milestones={details.milestones ?? details.project.milestones ?? []}
            employees={employees}
            canEdit={
              !isEmployee &&
              !details.project.deletedAt &&
              (hasPermission('tasks.create') ||
                hasPermission('tasks.assign') ||
                hasPermission('tasks.edit.info') ||
                hasPermission('tasks.edit.dates') ||
                hasPermission('tasks.progress') ||
                hasPermission('tasks.delete'))
            }
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        )}
        {detailsTab === 'team' && (
          <TeamTab
            teamStats={teamStats}
            tasks={activeProjectTasks}
            employees={employees}
            visibleCount={activeProjectTasks.length}
            doneCount={doneCount}
            teamProgressTotal={teamProgressTotal}
            onEditTask={onEditTask}
          />
        )}
        {detailsTab === 'activity' && (
          <TaskActivityTab
            projectId={details.project.id}
            tasksOnly={isEmployee}
            refreshKey={activityRefreshKey}
          />
        )}
      </div>
    </div>
  );
};

const ProjectChips: React.FC<{ project: Project }> = ({ project }) => (
  <div className="flex flex-wrap gap-2">
    {project.deletedAt ? (
      <span className="px-3 py-1 rounded-full bg-rose-500/30 text-sm backdrop-blur">Cancelled</span>
    ) : null}
    <span className="px-3 py-1 rounded-full bg-white/10 text-sm backdrop-blur">
      {(project.status || 'ACTIVE').replace('_', ' ')}
    </span>
    <span className="px-3 py-1 rounded-full bg-white/10 text-sm backdrop-blur font-mono">
      {project.id}
    </span>
  </div>
);

const DetailProgressBar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="mt-2 h-2 rounded-full bg-white/20 overflow-hidden">
    <div className="h-full bg-white rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
  </div>
);

const MetaCell: React.FC<{
  label: string;
  icon: React.ReactNode;
  value: string;
}> = ({ label, icon, value }) => (
  <div>
    <p className="text-[10px] font-bold tracking-wider text-slate-400">{label}</p>
    <div className="flex items-center gap-2 mt-1">
      {icon}
      <span className="text-sm font-medium text-slate-800 dark:text-white">{value}</span>
    </div>
  </div>
);

const TasksTab: React.FC<{
  visibleTasks: Task[];
  taskVisibility: 'active' | 'deleted';
  onTaskVisibilityChange: (mode: 'active' | 'deleted') => void;
  deletedCount: number;
  employees: User[];
  isEmployee: boolean;
  hasPermission: (k: string) => boolean;
  userId?: string;
  onAddTask: () => void;
  onEditTask: (t: Task) => void;
  onDeleteTask: (id: string) => void;
}> = ({
  visibleTasks,
  taskVisibility,
  onTaskVisibilityChange,
  deletedCount,
  employees,
  isEmployee,
  hasPermission,
  userId,
  onAddTask,
  onEditTask,
  onDeleteTask,
}) => {
  const canCreate = hasPermission('tasks.create') && taskVisibility === 'active' && !isEmployee;
  const canDelete = hasPermission('tasks.delete') && taskVisibility === 'active' && !isEmployee;
  const canEdit =
    taskVisibility === 'active' &&
    !isEmployee &&
    (hasPermission('tasks.assign') ||
      hasPermission('tasks.edit.info') ||
      hasPermission('tasks.edit.dates') ||
      hasPermission('tasks.progress'));

  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | string>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | 'unassigned' | string>('ALL');
  const [searchValue, setSearchValue] = useState('');
  const [dueDateRange, setDueDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);

  const assigneeOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const t of visibleTasks) {
      ids.add(t.assigneeId ? String(t.assigneeId) : 'unassigned');
    }
    return Array.from(ids).sort((a, b) => {
      if (a === 'unassigned') return -1;
      if (b === 'unassigned') return 1;
      return a.localeCompare(b);
    });
  }, [visibleTasks]);

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: taskVisibility, defaultValue: 'active' },
        { value: statusFilter, defaultValue: 'ALL' },
        { value: priorityFilter, defaultValue: 'ALL' },
        { value: assigneeFilter, defaultValue: 'ALL' },
      ]) + countDateRangeFilters(dueDateRange),
    [taskVisibility, statusFilter, priorityFilter, assigneeFilter, dueDateRange]
  );

  const clearFilters = () => {
    onTaskVisibilityChange('active');
    setStatusFilter('ALL');
    setPriorityFilter('ALL');
    setAssigneeFilter('ALL');
    setDueDateRange(EMPTY_DATE_RANGE);
  };

  type TaskSortCol = 'id' | 'task' | 'assignee' | 'priority' | 'status' | 'progress';
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<TaskSortCol>();
  const taskThClass =
    'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  const filteredTasks = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    return visibleTasks.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      const pr = String(t.priority ?? 'MEDIUM').toUpperCase();
      if (priorityFilter !== 'ALL' && pr !== String(priorityFilter).toUpperCase()) return false;
      if (assigneeFilter !== 'ALL') {
        if (assigneeFilter === 'unassigned') {
          if (t.assigneeId) return false;
        } else if (String(t.assigneeId ?? '') !== String(assigneeFilter)) {
          return false;
        }
      }
      if (!recordMatchesDateRange(t.dueDate || t.startDate, dueDateRange)) return false;
      if (q) {
        const assigneeName =
          t.assigneeId != null
            ? employees.find((e) => e.id === t.assigneeId)?.name ?? ''
            : 'unassigned';
        const hay = `${String(t.title ?? '')} ${String(t.id ?? '')} ${assigneeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    visibleTasks,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    searchValue,
    dueDateRange,
    employees,
  ]);

  const sortedTasks = useMemo(() => {
    const getSortValue = (task: Task, col: TaskSortCol): string | number => {
      switch (col) {
        case 'id':
          return String(task.id ?? '');
        case 'task':
          return String(task.title ?? '');
        case 'assignee':
          return task.assigneeId
            ? employees.find((e) => e.id === task.assigneeId)?.name ?? String(task.assigneeId)
            : 'Unassigned';
        case 'priority':
          return String(task.priority ?? 'MEDIUM');
        case 'status':
          return String(task.status ?? '');
        case 'progress':
          return task.progress ?? 0;
        default:
          return '';
      }
    };
    return sortRowsByColumn(filteredTasks, sortBy, sortOrder, getSortValue);
  }, [filteredTasks, sortBy, sortOrder, employees]);

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold dark:text-white">
            {isEmployee ? 'My tasks' : 'Tasks'}
          </h3>
          <p className="text-sm text-slate-500">
            {taskVisibility === 'deleted'
              ? `${sortedTasks.length} cancelled task${sortedTasks.length === 1 ? '' : 's'}`
              : isEmployee
                ? `${sortedTasks.length} task${sortedTasks.length === 1 ? '' : 's'} assigned to you`
                : `${sortedTasks.length} task${sortedTasks.length === 1 ? '' : 's'} in this project`}
          </p>
        </div>
        {canCreate && (
          <Button onClick={onAddTask} className="bg-primary-600">
            <Plus className="w-4 h-4 mr-1" />
            Add Task
          </Button>
        )}
      </div>

      <div className="mb-5">
        <ListSearchFilterBar
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder="Search task, ticket, or assignee…"
          filter={
            <PageFilterMenu activeCount={filterActiveCount} onClear={clearFilters}>
              <FilterMenuDateRange
                from={dueDateRange.from}
                to={dueDateRange.to}
                onChange={setDueDateRange}
                fromLabel="Due from"
                toLabel="Due to"
              />
              <FilterMenuRadioGroup
                label="Show"
                value={taskVisibility}
                defaultValue="active"
                onChange={(v) => onTaskVisibilityChange(v)}
                options={[
                  { value: 'active', label: 'Active' },
                  {
                    value: 'deleted',
                    label: deletedCount > 0 ? `Cancelled (${deletedCount})` : 'Cancelled',
                  },
                ]}
              />
              <FilterMenuSelect
                label="Status"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as 'ALL' | TaskStatus)}
                options={[
                  { value: 'ALL', label: 'All statuses' },
                  { value: TaskStatus.TODO, label: 'To do' },
                  { value: TaskStatus.IN_PROGRESS, label: 'In progress' },
                  { value: TaskStatus.REVIEW, label: 'Review' },
                  { value: TaskStatus.BLOCKED, label: 'Blocked' },
                  { value: TaskStatus.DONE, label: 'Done' },
                ]}
              />
              <FilterMenuSelect
                label="Priority"
                value={priorityFilter}
                onChange={setPriorityFilter}
                options={[
                  { value: 'ALL', label: 'All priorities' },
                  { value: 'LOW', label: 'LOW' },
                  { value: 'MEDIUM', label: 'MEDIUM' },
                  { value: 'HIGH', label: 'HIGH' },
                  { value: 'CRITICAL', label: 'CRITICAL' },
                ]}
              />
              <FilterMenuSelect
                label="Assignee"
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                options={[
                  { value: 'ALL', label: 'All assignees' },
                  ...assigneeOptions.map((id) => ({
                    value: id,
                    label:
                      id === 'unassigned'
                        ? 'Unassigned'
                        : employees.find((e) => e.id === id)?.name ?? id,
                  })),
                ]}
              />
            </PageFilterMenu>
          }
        />
      </div>

      {sortedTasks.length === 0 ? (
        <div className="py-12 text-center">
          <ListChecks className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-slate-400 uppercase text-sm tracking-wide">
            {taskVisibility === 'deleted' ? 'No cancelled tasks found' : 'No active tasks found'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-left">
                <SortableTableHeader
                  label="ID"
                  column="id"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${taskThClass} w-[80px]`}
                />
                <SortableTableHeader
                  label="Task"
                  column="task"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={taskThClass}
                />
                <SortableTableHeader
                  label="Assignee"
                  column="assignee"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${taskThClass} w-[150px]`}
                />
                <SortableTableHeader
                  label="Priority"
                  column="priority"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${taskThClass} w-[100px]`}
                />
                <SortableTableHeader
                  label="Status"
                  column="status"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${taskThClass} w-[120px]`}
                />
                <SortableTableHeader
                  label="Progress"
                  column="progress"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${taskThClass} w-[140px]`}
                />
                <th className={`${taskThClass} w-[90px] text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {sortedTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  employees={employees}
                  isEmployee={isEmployee}
                  userId={userId}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const priorityBar: Record<string, string> = {
  LOW: 'bg-emerald-500',
  MEDIUM: 'bg-amber-500',
  HIGH: 'bg-orange-500',
  CRITICAL: 'bg-red-500',
};

const priorityPill: Record<string, string> = {
  LOW: 'bg-emerald-50 text-emerald-600',
  MEDIUM: 'bg-amber-50 text-amber-600',
  HIGH: 'bg-orange-50 text-orange-600',
  CRITICAL: 'bg-red-50 text-red-600',
};

const TaskRow: React.FC<{
  task: Task;
  employees: User[];
  isEmployee: boolean;
  userId?: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
}> = ({ task: t, employees, isEmployee, userId, canEdit, canDelete, onEdit, onDelete }) => {
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const assignee = employees.find((e) => e.id === t.assigneeId);
  const pr = t.priority ?? 'MEDIUM';
  const pct = t.progress ?? 0;
  // Mirrors canProgressTask in Projects.tsx: assignees can update their own progress.
  const canOpenEdit = canEdit || (!!userId && t.assigneeId === userId);

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Cancel task?',
      description:
        'Cancel this task from the active list? It stays in history and can be shown with the Cancelled filter.',
      variant: 'danger',
      confirmLabel: 'Cancel task',
    });
    if (ok) onDelete(t.id);
  };

  return (
    <tr className="group hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors relative">
      <ConfirmDialogHost />

      {/* ID column */}
      <td className="px-3 py-3">
        <span className="font-mono text-xs font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
          {t.id}
        </span>
      </td>

      {/* Task title + due date */}
      <td className="px-3 py-3 relative">
        <span
          className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full opacity-60 group-hover:opacity-100 ${priorityBar[pr]}`}
        />
        <p className="font-semibold text-slate-800 dark:text-white group-hover:text-primary-600 leading-tight line-clamp-2">
          {t.title}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <Calendar className="w-3 h-3 text-slate-400" />
          <span className="text-xs text-slate-500">{formatShortDate(t.dueDate) || '—'}</span>
          {isTaskOverdue(t) && (
            <span className="text-[9px] uppercase tracking-wider text-rose-500 font-bold">
              Overdue
            </span>
          )}
        </div>
      </td>

      {/* Assignee */}
      <td className="px-3 py-3">
        {assignee ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {assignee.name.charAt(0).toUpperCase()}
            </div>
            <span className="truncate text-sm text-slate-700 dark:text-slate-200">{assignee.name}</span>
          </div>
        ) : (
          <span className="text-xs italic text-slate-400">Unassigned</span>
        )}
      </td>

      {/* Priority */}
      <td className="px-3 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${priorityPill[pr]}`}>
          {pr}
        </span>
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <StatusPill status={t.status} />
      </td>

      {/* Progress */}
      <td className="px-3 py-3">
        <ExecBar pct={pct} />
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          {isEmployee ? (
            <Button size="sm" className="bg-primary-600 h-8 px-2.5 text-xs" onClick={() => onEdit(t)}>
              <Target className="w-3 h-3 mr-1" />
              Update
            </Button>
          ) : (
            <>
              {canOpenEdit && (
                <button
                  type="button"
                  title="Edit task"
                  onClick={() => onEdit(t)}
                  className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-600 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  title="Cancel task"
                  aria-label="Cancel task"
                  onClick={() => void handleDelete()}
                  className="w-8 h-8 rounded-lg border border-rose-200 dark:border-rose-900/50 flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

const ExecBar: React.FC<{ pct: number }> = ({ pct }) => (
  <div>
    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
      <div className="h-full bg-primary-500 transition-all duration-1000" style={{ width: `${pct}%` }} />
    </div>
    <span className="text-xs text-slate-500">{pct}%</span>
  </div>
);

const StatusPill: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const map: Record<TaskStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    [TaskStatus.TODO]: {
      label: 'To do',
      cls: 'bg-slate-100 text-slate-600',
      icon: <ListChecks className="w-3 h-3" />,
    },
    [TaskStatus.IN_PROGRESS]: {
      label: 'In progress',
      cls: 'bg-primary-50 text-primary-600',
      icon: <Clock className="w-3 h-3" />,
    },
    [TaskStatus.REVIEW]: {
      label: 'In review',
      cls: 'bg-indigo-50 text-indigo-600',
      icon: <Search className="w-3 h-3" />,
    },
    [TaskStatus.DONE]: {
      label: 'Done',
      cls: 'bg-emerald-50 text-emerald-600',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    [TaskStatus.BLOCKED]: {
      label: 'Blocked',
      cls: 'bg-rose-50 text-rose-600',
      icon: <AlertCircle className="w-3 h-3" />,
    },
  };
  const m = map[status] ?? map[TaskStatus.TODO];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
};

type TeamMemberStat = {
  userId: string;
  name: string;
  progress: number;
  total: number;
  done: number;
};

const TeamTab: React.FC<{
  teamStats: TeamMemberStat[];
  tasks: Task[];
  employees: User[];
  visibleCount: number;
  doneCount: number;
  teamProgressTotal: number;
  onEditTask: (task: Task) => void;
}> = ({
  teamStats,
  tasks,
  employees,
  visibleCount,
  doneCount,
  teamProgressTotal,
  onEditTask,
}) => {
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const detailMember = useMemo(
    () => teamStats.find((m) => m.userId === detailUserId) ?? null,
    [teamStats, detailUserId]
  );
  const detailUser = useMemo(
    () =>
      detailUserId && detailUserId !== 'unassigned'
        ? employees.find((e) => e.id === detailUserId) ?? null
        : null,
    [employees, detailUserId]
  );
  const memberTasks = useMemo(() => {
    if (!detailUserId) return [];
    return tasks
      .filter((t) => (t.assigneeId || 'unassigned') === detailUserId)
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  }, [tasks, detailUserId]);

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <TeamStat
          label="Team members"
          value={teamStats.length}
          icon={<Users className="w-4 h-4 text-blue-500" />}
        />
        <TeamStat
          label="Tasks"
          value={visibleCount}
          icon={<ListChecks className="w-4 h-4 text-purple-500" />}
        />
        <TeamStat
          label="Completed"
          value={doneCount}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        />
        <TeamStat
          label="Overall progress"
          value={`${teamProgressTotal}%`}
          icon={<BarChart2 className="w-4 h-4 text-primary-500" />}
        />
      </div>

      {teamStats.length === 0 ? (
        <TeamEmpty />
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {teamStats.map((m) => {
            const user = m.userId === 'unassigned' ? null : employees.find((e) => e.id === m.userId);
            const avatar = user ? resolveMediaUrl(user.avatarUrl) : '';
            return (
              <div
                key={m.userId}
                className="py-2.5 px-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    className="w-9 h-9 rounded-xl object-cover shrink-0 ring-1 ring-slate-200 dark:ring-slate-600"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {m.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                    {m.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {user?.position || `${m.total} task${m.total === 1 ? '' : 's'} assigned`}
                  </p>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden max-w-xs">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-indigo-500 transition-all"
                      style={{ width: `${m.progress}%` }}
                    />
                  </div>
                  <div className="flex gap-3 mt-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {m.done} done
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      {m.total - m.done} active
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold tabular-nums dark:text-white leading-none">
                    {m.progress}%
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Progress</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1.5 h-7 px-2 text-xs"
                    onClick={() => setDetailUserId(m.userId)}
                  >
                    View details
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={Boolean(detailMember)}
        onClose={() => setDetailUserId(null)}
        size="md"
        title={detailMember?.name || 'Member details'}
        description="Assignment summary and contact details"
      >
        {detailMember && (
          <PersonnelDetailBody
            member={detailMember}
            user={detailUser}
            tasks={memberTasks}
            onEditTask={(task) => {
              setDetailUserId(null);
              onEditTask(task);
            }}
          />
        )}
      </Modal>
    </div>
  );
};

const PersonnelDetailBody: React.FC<{
  member: TeamMemberStat;
  user: User | null;
  tasks: Task[];
  onEditTask: (task: Task) => void;
}> = ({ member, user, tasks, onEditTask }) => {
  const avatar = user ? resolveMediaUrl(user.avatarUrl) : '';
  const displayId =
    user?.displayEmployeeId ||
    user?.employee?.employee_id ||
    (user?.employeeId ? String(user.employeeId) : '');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-slate-600"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-indigo-600 text-white flex items-center justify-center text-lg font-bold">
            {member.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-900 dark:text-white truncate">{member.name}</p>
          <p className="text-xs text-slate-500 truncate">
            {user?.position || user?.employee?.position_title || 'No position listed'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
              {member.progress}% output
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              {member.done}/{member.total} done
            </span>
          </div>
        </div>
      </div>

      {(user?.email || user?.phone || displayId || user?.position) && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {user?.position && (
            <DetailFact icon={Briefcase} label="Role" value={user.position} />
          )}
          {user?.email && <DetailFact icon={Mail} label="Email" value={user.email} />}
          {user?.phone && <DetailFact icon={Phone} label="Phone" value={user.phone} />}
          {displayId && <DetailFact icon={BadgeCheck} label="Display ID" value={displayId} />}
        </ul>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assigned tasks ({tasks.length})
          </h4>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No tasks assigned on this project.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden max-h-64 overflow-y-auto custom-scrollbar">
            {tasks.map((task) => {
              const pct = task.progress ?? 0;
              const overdue = isTaskOverdue(task);
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => onEditTask(task)}
                    className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {task.title}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Due {formatShortDate(task.dueDate)}
                          {overdue ? ' · Overdue' : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          task.status === TaskStatus.DONE
                            ? 'bg-emerald-50 text-emerald-700'
                            : task.status === TaskStatus.IN_PROGRESS
                              ? 'bg-blue-50 text-blue-700'
                              : task.status === TaskStatus.BLOCKED
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-primary-500"
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const DetailFact: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <li className="flex items-start gap-2 rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-800/60">
    <Icon className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{value}</p>
    </div>
  </li>
);

const TeamEmpty: React.FC = () => (
  <div className="py-10 text-center">
    <Users className="w-8 h-8 text-slate-200 mx-auto" />
    <p className="text-sm text-slate-400 mt-2">No team members assigned yet</p>
  </div>
);

const TeamStat: React.FC<{ label: string; value: string | number; icon: React.ReactNode }> = ({
  label,
  value,
  icon,
}) => (
  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40">
    <div className="mb-1">{icon}</div>
    <p className="text-lg font-bold dark:text-white leading-tight">{value}</p>
    <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{label}</p>
  </div>
);
