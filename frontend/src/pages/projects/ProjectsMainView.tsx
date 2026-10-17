import React, { useMemo, useState } from 'react';
import {
  Layout,
  LineChart,
  Zap,
  CheckCircle2,
  Clock,
  Plus,
  X,
  Settings,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { Project, ProjectStatus, Task, User } from '../../types';
import { Button } from '../../components/ui/Button';
import { ResponsiveRowActions } from '../../components/ui/ResponsiveRowActions';
import { ListSearchFilterBar } from '../../components/ui/page';
import {
  FilterMenuDateRange,
  FilterMenuRadioGroup,
  FilterMenuSelect,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  intervalOverlapsDateRange,
  recordMatchesDateRange,
  countDateRangeFilters,
  type DateRangeValue,
} from '../../utils/dateRangeFilter';
import { StatusLabel } from '../../components/ui/StatusLabel';
import {
  EnrichedProject,
  enrichProjects,
  formatTimelineRange,
  getProgressBarStyle,
  ganttBarPosition,
  resolveRoadmapRange,
  roadmapWeekHeaders,
  roadmapTodayPercent,
  formatRoadmapRangeLabel,
  resolveUserName,
  ROADMAP_PERIOD_OPTIONS,
  type RoadmapRange,
  type RoadmapPeriodWeeks,
} from './projectUtils';

/** Roadmap grid geometry (px) — shared by the header row, bars and the today marker. */
const TIMELINE_LABEL_WIDTH = 250;
const TIMELINE_WEEK_WIDTH = 96;

type MainTab = 'overview' | 'timeline';
type StatusFilter = 'ALL' | ProjectStatus | 'DELETED';

type Props = {
  projects: Project[];
  allTasks: Task[];
  employees: User[];
  /** When true, copy reflects self-service list (projects with my tasks). */
  scopedToMyAssignments?: boolean;
  /** Management view scoped to lead/assigned projects (Manager/Staff). */
  assignmentScoped?: boolean;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  mainTab: MainTab;
  /** Management overview/timeline — driven from sidebar when true. */
  showMainTabs?: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canConfigure: boolean;
  onOpenCreate: () => void;
  onOpenDetails: (id: string) => void;
  onOpenSettings: (project: Project) => void;
  onDeleteProject: (id: string) => void;
};

export const ProjectsMainView: React.FC<Props> = ({
  projects,
  allTasks,
  employees,
  scopedToMyAssignments = false,
  assignmentScoped = false,
  statusFilter,
  onStatusFilterChange,
  searchTerm,
  onSearchChange,
  mainTab,
  showMainTabs = false,
  canCreate,
  canDelete,
  canConfigure,
  onOpenCreate,
  onOpenDetails,
  onOpenSettings,
  onDeleteProject,
}) => {
  const { t } = useLanguage();
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  /** Timeline: selected schedule window (also filters by schedule overlap). */
  const [timelineDateRange, setTimelineDateRange] = useState(EMPTY_DATE_RANGE);
  /** Timeline: fixed period length, or auto-fit. */
  const [timelinePeriodWeeks, setTimelinePeriodWeeks] = useState<RoadmapPeriodWeeks>('auto');
  /** Timeline: filter by project created date (not schedule overlap). */
  const [createdDateRange, setCreatedDateRange] = useState(EMPTY_DATE_RANGE);

  const activeTasks = useMemo(
    () => allTasks.filter((t) => !t.deletedAt),
    [allTasks]
  );

  const filteredProjects = useMemo(() => {
    const byStatus =
      statusFilter === 'ALL' || statusFilter === 'DELETED'
        ? projects
        : projects.filter((p) => p.status === statusFilter);
    const bySchedule = byStatus.filter((p) =>
      intervalOverlapsDateRange(p.startDate, p.deadline, dateRange)
    );
    const q = searchTerm.trim().toLowerCase();
    if (!q) return bySchedule;
    return bySchedule.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
    );
  }, [projects, statusFilter, dateRange, searchTerm]);

  const timelineProjects = useMemo(() => {
    const byCreated = filteredProjects.filter((p) =>
      recordMatchesDateRange(p.createdAt || p.startDate, createdDateRange)
    );
    return byCreated.filter((p) =>
      intervalOverlapsDateRange(p.startDate, p.deadline, timelineDateRange)
    );
  }, [filteredProjects, createdDateRange, timelineDateRange]);

  const enrichedProjects = useMemo(
    () => enrichProjects(filteredProjects, activeTasks),
    [filteredProjects, activeTasks]
  );

  const counts = useMemo(() => {
    const all = enrichProjects(projects, activeTasks);
    const active = all.filter((p) => p.status === ProjectStatus.ACTIVE).length;
    const completed = all.filter((p) => p.status === ProjectStatus.COMPLETED).length;
    const overallProgress =
      all.length > 0
        ? Math.round(all.reduce((s, p) => s + p.progress, 0) / all.length)
        : 0;
    return { all: all.length, active, completed, overallProgress };
  }, [projects, activeTasks]);

  const roadmapRange = useMemo(
    () => resolveRoadmapRange(timelineProjects, timelineDateRange, timelinePeriodWeeks),
    [timelineProjects, timelineDateRange, timelinePeriodWeeks]
  );
  const weekHeaders = useMemo(() => roadmapWeekHeaders(roadmapRange), [roadmapRange]);
  const timelineEnriched = useMemo(
    () => enrichProjects(timelineProjects, activeTasks),
    [timelineProjects, activeTasks]
  );

  const showOverview = !showMainTabs || mainTab === 'overview';

  return (
    <div className="space-y-6">
      {showOverview && (
      <div className="group relative overflow-hidden surface-card p-6 md:p-8">
        <HeaderBlur />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary-500 text-white">
              <Layout className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {t('projects.title') || 'Projects'}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mt-1">
                {scopedToMyAssignments
                  ? filteredProjects.length === 0
                    ? 'No projects with tasks assigned to you yet'
                    : `${filteredProjects.length} project${filteredProjects.length === 1 ? '' : 's'} with tasks assigned to you`
                  : assignmentScoped
                    ? filteredProjects.length === 0
                      ? 'No projects assigned to you yet'
                      : `${filteredProjects.length} project${filteredProjects.length === 1 ? '' : 's'} assigned to you`
                    : `${filteredProjects.length} project${filteredProjects.length === 1 ? '' : 's'} in your list`}
              </p>
            </div>
          </div>
          {canCreate && (
            <Button
              onClick={onOpenCreate}
              className="bg-primary-600 hover:bg-primary-700 group-hover:scale-105 transition-transform"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          )}
        </div>
      </div>
      )}

      {showOverview && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMini
          label="Total Projects"
          value={counts.all}
          icon={<LineChart className="w-5 h-5" />}
          color="text-blue-500 bg-blue-50 dark:bg-blue-900/30"
        />
        <StatMini
          label="Active Projects"
          value={counts.active}
          icon={<Zap className="w-5 h-5" />}
          color="text-amber-500 bg-amber-50 dark:bg-amber-900/30"
        />
        <StatMini
          label="Completed Projects"
          value={counts.completed}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"
        />
        <StatMini
          label="Overall Progress"
          value={`${counts.overallProgress}%`}
          icon={<Clock className="w-5 h-5" />}
          color="text-primary-500 bg-primary-50 dark:bg-primary-900/30"
        />
      </div>
      )}

      {showOverview ? (
        <OverviewTab
          enriched={enrichedProjects}
          employees={employees}
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          canDelete={canDelete}
          canConfigure={canConfigure}
          onOpenDetails={onOpenDetails}
          onOpenSettings={onOpenSettings}
          onDeleteProject={onDeleteProject}
        />
      ) : (
        <TimelineTab
          projects={timelineEnriched}
          range={roadmapRange}
          weekHeaders={weekHeaders}
          scopedToMyAssignments={scopedToMyAssignments}
          assignmentScoped={assignmentScoped}
          timelineDateRange={timelineDateRange}
          onTimelineDateRangeChange={setTimelineDateRange}
          timelinePeriodWeeks={timelinePeriodWeeks}
          onTimelinePeriodWeeksChange={setTimelinePeriodWeeks}
          createdDateRange={createdDateRange}
          onCreatedDateRangeChange={setCreatedDateRange}
        />
      )}
    </div>
  );
};

const HeaderBlur: React.FC = () => (
  <div
    className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-60"
    style={{
      background: 'radial-gradient(circle, rgba(var(--color-primary-500, 0 120 193), 0.15), transparent 70%)',
    }}
  />
);

const StatMini: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, icon, color }) => (
  <div className="surface-card p-4 rounded-2xl group">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
      </div>
      <div
        className={`p-3 rounded-xl ${color} group-hover:scale-110 transition-transform`}
      >
        {icon}
      </div>
    </div>
  </div>
);

const OverviewTab: React.FC<{
  enriched: EnrichedProject[];
  employees: User[];
  searchTerm: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  dateRange: DateRangeValue;
  onDateRangeChange: (range: DateRangeValue) => void;
  canDelete: boolean;
  canConfigure: boolean;
  onOpenDetails: (id: string) => void;
  onOpenSettings: (project: Project) => void;
  onDeleteProject: (id: string) => void;
}> = ({
  enriched,
  employees,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateRange,
  onDateRangeChange,
  canDelete,
  canConfigure,
  onOpenDetails,
  onOpenSettings,
  onDeleteProject,
}) => {
  const projectFilterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: statusFilter, defaultValue: 'ALL' }]) +
      countDateRangeFilters(dateRange),
    [statusFilter, dateRange]
  );

  return (
  <>
    <ListSearchFilterBar
      searchValue={searchTerm}
      onSearchChange={onSearchChange}
      searchPlaceholder="Search projects..."
      filter={
      <PageFilterMenu
        activeCount={projectFilterActiveCount}
        onClear={() => {
          onStatusFilterChange('ALL');
          onDateRangeChange(EMPTY_DATE_RANGE);
        }}
      >
        <FilterMenuDateRange
          from={dateRange.from}
          to={dateRange.to}
          onChange={onDateRangeChange}
          fromLabel="Timeline from"
          toLabel="Timeline to"
          hint="Projects overlapping this range are shown."
        />
        <FilterMenuRadioGroup
          label="Show"
          value={statusFilter}
          defaultValue="ALL"
          onChange={(v) => onStatusFilterChange(v as StatusFilter)}
          options={[
            { value: 'ALL', label: 'All projects' },
            { value: ProjectStatus.ACTIVE, label: 'Active' },
            { value: ProjectStatus.PLANNING, label: 'Planning' },
            { value: ProjectStatus.COMPLETED, label: 'Completed' },
            { value: 'DELETED', label: 'Cancelled' },
          ]}
        />
      </PageFilterMenu>
      }
    />

    {enriched.length === 0 ? (
      <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl py-16 text-center">
        <Layout className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-800 dark:text-white">No Projects Found</h3>
        <p className="text-slate-500 text-sm mt-1">Try adjusting your search or filters.</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {enriched.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            employees={employees}
            canDelete={canDelete}
            canConfigure={canConfigure}
            onOpenDetails={onOpenDetails}
            onOpenSettings={onOpenSettings}
            onDeleteProject={onDeleteProject}
          />
        ))}
      </div>
    )}
  </>
);
};

const ProjectCard: React.FC<{
  project: EnrichedProject;
  employees: User[];
  canDelete: boolean;
  canConfigure: boolean;
  onOpenDetails: (id: string) => void;
  onOpenSettings: (project: Project) => void;
  onDeleteProject: (id: string) => void;
}> = ({ project: p, employees, canDelete, canConfigure, onOpenDetails, onOpenSettings, onDeleteProject }) => {
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const progress = p.progress;

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Cancel project?',
      description:
        'Cancel this project from the active list? It stays in history and can be shown with the Cancelled filter.',
      variant: 'danger',
      confirmLabel: 'Cancel project',
    });
    if (ok) onDeleteProject(p.id);
  };

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`View project ${p.title}`}
      onClick={() => onOpenDetails(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetails(p.id);
        }
      }}
      className="group relative surface-card p-5 hover:border-primary-400 hover:shadow-lg transition-all cursor-pointer"
    >
      <ConfirmDialogHost />
      {canConfigure && !p.deletedAt ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings(p);
          }}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-primary-600 hover:border-primary-300 dark:hover:border-primary-700 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
          aria-label={`Settings — ${p.title}`}
          title="Project settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      ) : null}
      <CardHeader project={p} hasSettingsAction={canConfigure && !p.deletedAt} />
      <p className="text-sm text-slate-500 line-clamp-2 mt-2 min-h-[2.5rem]">
        {p.description || 'No description available for this project.'}
      </p>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${progress}%`, ...getProgressBarStyle(progress) }}
          />
        </div>
      </div>
      <div className="responsive-form-grid gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-500">
        <div>
          <p className="font-medium text-slate-400">Timeline</p>
          <p>{formatTimelineRange(p.startDate, p.deadline)}</p>
        </div>
        <div>
          <p className="font-medium text-slate-400">Resources</p>
          <p>
            {p.totalTasks} Tasks • {resolveUserName(employees, p.leadId)}
          </p>
        </div>
      </div>
      {canDelete ? (
        <div className="flex gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
          <ResponsiveRowActions
            menuLabel="Project actions"
            actions={[
              {
                key: 'cancel',
                label: 'Cancel project',
                icon: <X className="w-4 h-4" />,
                destructive: true,
                onClick: () => void handleDelete(),
              },
            ]}
          />
        </div>
      ) : null}
    </article>
  );
};

const CardHeader: React.FC<{ project: EnrichedProject; hasSettingsAction?: boolean }> = ({
  project: p,
  hasSettingsAction = false,
}) => (
  <div className={`space-y-2 ${hasSettingsAction ? 'pr-10' : ''}`}>
    <h3 className="font-semibold text-slate-900 dark:text-white break-words line-clamp-2 group-hover:text-primary-600 transition-colors">
      {p.title}
    </h3>
    <StatusLabel
      status={p.deletedAt ? 'CANCELLED' : p.status}
      context="project"
      label={p.deletedAt ? 'Cancelled' : p.status.replace('_', ' ')}
      size="sm"
    />
  </div>
);

const TimelineTab: React.FC<{
  projects: EnrichedProject[];
  range: RoadmapRange;
  weekHeaders: string[];
  scopedToMyAssignments?: boolean;
  assignmentScoped?: boolean;
  timelineDateRange: DateRangeValue;
  onTimelineDateRangeChange: (range: DateRangeValue) => void;
  timelinePeriodWeeks: RoadmapPeriodWeeks;
  onTimelinePeriodWeeksChange: (weeks: RoadmapPeriodWeeks) => void;
  createdDateRange: DateRangeValue;
  onCreatedDateRangeChange: (range: DateRangeValue) => void;
}> = ({
  projects,
  range,
  weekHeaders,
  scopedToMyAssignments = false,
  assignmentScoped = false,
  timelineDateRange,
  onTimelineDateRangeChange,
  timelinePeriodWeeks,
  onTimelinePeriodWeeksChange,
  createdDateRange,
  onCreatedDateRangeChange,
}) => {
  const todayPercent = roadmapTodayPercent(range);
  const gridWidth = TIMELINE_LABEL_WIDTH + range.weekCount * TIMELINE_WEEK_WIDTH;
  const selectedFilterCount = countDateRangeFilters(timelineDateRange);
  const createFilterCount = countDateRangeFilters(createdDateRange);
  const periodFilterCount = timelinePeriodWeeks === 'auto' ? 0 : 1;
  const filterActiveCount = selectedFilterCount + createFilterCount + periodFilterCount;

  const periodSummary = useMemo(() => {
    const bits: string[] = [];
    if (timelineDateRange.from || timelineDateRange.to) {
      bits.push(`${timelineDateRange.from || '…'} → ${timelineDateRange.to || '…'}`);
    }
    if (timelinePeriodWeeks !== 'auto') {
      bits.push(`${timelinePeriodWeeks}w`);
    }
    if (createdDateRange.from || createdDateRange.to) {
      bits.push(`Created ${createdDateRange.from || '…'} → ${createdDateRange.to || '…'}`);
    }
    return bits.length ? bits.join(' · ') : formatRoadmapRangeLabel(range);
  }, [timelineDateRange, timelinePeriodWeeks, createdDateRange, range]);

  const clearFilters = () => {
    onTimelineDateRangeChange(EMPTY_DATE_RANGE);
    onTimelinePeriodWeeksChange('auto');
    onCreatedDateRangeChange(EMPTY_DATE_RANGE);
  };

  return (
  <div className="surface-card rounded-2xl overflow-hidden">
    <div className="p-4 flex items-center justify-between gap-3 border-b dark:border-slate-700">
      <div className="min-w-0">
        <h3 className="font-bold text-slate-900 dark:text-white">Project timeline</h3>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PageFilterMenu
          title="Timeline filters"
          activeCount={filterActiveCount}
          periodSummary={periodSummary}
          onClear={clearFilters}
        >
          <FilterMenuDateRange
            from={timelineDateRange.from}
            to={timelineDateRange.to}
            onChange={onTimelineDateRangeChange}
            fromLabel="Selected from"
            toLabel="Selected to"
            hint="Sets the visible timeline window and shows projects that overlap this period."
          />
          <FilterMenuSelect
            label="Period length"
            value={String(timelinePeriodWeeks)}
            onChange={(v) =>
              onTimelinePeriodWeeksChange(
                v === 'auto' ? 'auto' : (Number(v) as RoadmapPeriodWeeks)
              )
            }
            options={ROADMAP_PERIOD_OPTIONS.map((o) => ({
              value: String(o.value),
              label: o.label,
            }))}
            hint="Fixed length overrides Auto sizing. Anchors on Selected from (or to / today)."
          />
          <FilterMenuDateRange
            from={createdDateRange.from}
            to={createdDateRange.to}
            onChange={onCreatedDateRangeChange}
            fromLabel="Created from"
            toLabel="Created to"
            hint="Optional. Limit to projects created in this period."
          />
        </PageFilterMenu>
      </div>
    </div>
    {projects.length === 0 ? (
      <div className="py-16 text-center">
        <Layout className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500">
          {filterActiveCount > 0
            ? 'No projects match the timeline filters.'
            : scopedToMyAssignments
              ? 'You are not assigned to any projects yet. Ask your manager to add you to a project or assign you a task.'
              : assignmentScoped
                ? 'No projects assigned to you yet.'
                : 'No projects to display'}
        </p>
      </div>
    ) : (
      <div className="hcms-table-scroll custom-scrollbar relative">
        <div
          className="relative"
          style={{
            display: 'grid',
            gridTemplateColumns: `${TIMELINE_LABEL_WIDTH}px repeat(${range.weekCount}, ${TIMELINE_WEEK_WIDTH}px)`,
            minWidth: `${gridWidth}px`,
          }}
        >
          <div className="sticky left-0 z-30 hcms-sticky-glass border-b border-white/40 dark:border-white/10 dark:border-slate-700 p-2" />
          {weekHeaders.map((h, i) => (
            <div
              key={`${h}-${i}`}
              className="sticky top-0 z-30 hcms-sticky-glass border-b border-white/40 dark:border-white/10 border-l dark:border-slate-700 p-2 text-xs text-center text-slate-500"
            >
              {h}
            </div>
          ))}
          {todayPercent !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none"
              style={{
                left: `${TIMELINE_LABEL_WIDTH + (todayPercent / 100) * range.weekCount * TIMELINE_WEEK_WIDTH}px`,
              }}
            />
          )}
          {projects.map((p) => {
            const { left, width } = ganttBarPosition(range, p.startDate, p.deadline);
            const progress = Math.min(100, Math.max(0, Math.round(p.progress)));
            return (
              <React.Fragment key={p.id}>
                <div className="sticky left-0 z-10 flex items-center gap-2 p-3 border-b border-r border-white/40 dark:border-white/10 hcms-sticky-glass">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate dark:text-white">{p.title}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span>{p.status}</span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                        ·
                      </span>
                      <span className="tabular-nums font-semibold text-slate-600 dark:text-slate-300">
                        {progress}%
                      </span>
                    </p>
                  </div>
                </div>
                <div
                  className="border-b dark:border-slate-700 relative h-14"
                  style={{ gridColumn: `span ${range.weekCount} / span ${range.weekCount}` }}
                  title={`${p.title} — ${formatTimelineRange(p.startDate, p.deadline)} — ${progress}% complete`}
                >
                  <GanttBar left={left} width={width} progress={progress} />
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    )}
  </div>
  );
};

/** Full bar = project schedule length; filled shade = real progress %. */
const GanttBar: React.FC<{ left: number; width: number; progress: number }> = ({
  left,
  width,
  progress,
}) => {
  const pct = Math.min(100, Math.max(0, progress));
  const showLabel = width >= 6;

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 h-7 rounded-full overflow-hidden border border-slate-300/70 dark:border-slate-600 shadow-sm"
      style={{ left: `${left}%`, width: `${width}%`, minWidth: '14px' }}
      role="img"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% complete`}
    >
      {/* Unfinished portion of the schedule */}
      <div className="absolute inset-0 bg-slate-200/90 dark:bg-slate-700/80" />
      {/* Completed shade relative to full project length */}
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
        style={{
          width: `${pct}%`,
          ...getProgressBarStyle(pct),
          borderRadius: pct >= 100 ? undefined : '9999px 0 0 9999px',
        }}
      />
      {showLabel ? (
        <span
          className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums tracking-tight pointer-events-none ${
            pct >= 45
              ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]'
              : 'text-slate-700 dark:text-slate-100'
          }`}
        >
          {pct}%
        </span>
      ) : null}
    </div>
  );
};
