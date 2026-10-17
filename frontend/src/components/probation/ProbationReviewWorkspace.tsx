import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../ui/Button';
import { StatusLabel } from '../ui/StatusLabel';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import { Role } from '../../types';
import type {
  Department,
  ProbationManagerAssignee,
  ProbationRatingLevel,
  ProbationReviewHistoryItem,
  ProbationReviewRecommendation,
  ProbationReviewSummary,
  ProbationRow,
  Position,
} from '../../types';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  PauseCircle,
  Users,
  XCircle,
} from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import {
  PROBATION_EXTENSION_OPTIONS,
  PROBATION_RATING_OPTIONS,
  addDaysIso,
  buildProbationListTabsForPhase,
  deriveClientRecommendation,
  filterProbationRowsByTab,
  probationListEmptyMessage,
  probationStatusLabel,
  type ProbationListTabId,
} from './probationReviewUi';
import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromProbationRow,
} from '../employee/EmployeeListIdentity';
import {
  OffboardingWorkflowProgress,
  type OffboardingWorkflowStep,
} from '../employee/OffboardingWorkflowProgress';
import { WizardSectionCard } from '../employee-wizard/wizardLayout';
import { probationRowStepLabel } from './probationWizardUi';
import {
  PROBATION_PIPELINE_STEPS,
  PROBATION_WIZARD_STEPS,
  maxReachableProbationWizardStep,
  probationPipelineStepIndex,
  splitProbationByPhase,
  suggestedProbationWizardStep,
  type ProbationListPhase,
} from './probationWizardUi';
import { WorkflowWizardShell } from '../workflow/WorkflowWizardShell';
import { WizardFooterLayout } from '../workflow/WizardFooterLayout';
import {
  WorkflowSelectStep,
  withSelectStep,
  WORKFLOW_STEP_SELECT,
  workflowStepWithSelectOffset,
} from '../workflow/WorkflowSelectStep';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { AlertCircle } from 'lucide-react';
import {
  hasPositionSalaryRange,
  positionSalaryBounds,
  validateSalaryInPositionRange,
} from '../../utils/positionSalary';
import {
  contractInputToUsd,
  convertContractAmount,
  formatContractMoneyAmount,
  formatContractMoneyFromUsd,
  normalizeContractCurrency,
} from '../../utils/contractMoney';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import { ApproverApprovalField, ApproverSummaryCard } from '../workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../workflow/ApproverSelectPanel';
import {
  evaluatorDraftFromProbationRow,
  ProbationApprovalTracker,
  resolveProbationEvaluators,
} from './probationApprovalDisplay';
import { mergeAssignedApproverCandidate } from '../../utils/approverCandidateFromAssigned';
import { useWorkflowApproverDirectory } from '../../hooks/useWorkflowApproverDirectory';
import { useLanguage } from '../../context/LanguageContext';
import { CombinedProbationScoresTable } from './CombinedProbationScoresTable';
import { computeCombinedProbationRatings } from './probationDualScore';
import { hydrateProbationEvaluatorDraft } from './probationEvaluatorDraft';

type RatingDraft = {
  jobPerformance: ProbationRatingLevel | '';
  attendance: ProbationRatingLevel | '';
  workAttitude: ProbationRatingLevel | '';
  teamwork: ProbationRatingLevel | '';
};

const EMPTY_RATINGS: RatingDraft = {
  jobPerformance: '',
  attendance: '',
  workAttitude: '',
  teamwork: '',
};

const PHASE_META: Record<
  ProbationListPhase,
  { title: string; subtitle: string; empty: string }
> = {
  all: {
    title: 'All',
    subtitle: 'Active and completed probation reviews',
    empty: 'No probation reviews in scope.',
  },
  active: {
    title: 'Active reviews',
    subtitle: 'Route to managers, collect evaluations, and submit for approval.',
    empty: 'No active probation reviews in this queue.',
  },
  completed: {
    title: 'Completed',
    subtitle: 'Passed, extended, or failed probation records.',
    empty: 'No completed probation records in this queue.',
  },
};

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
  active = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  tone?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const interactive = Boolean(onClick);
  const className = [
    'rounded-lg bg-white/80 dark:bg-slate-900/50 border px-2.5 py-2 sm:px-3 sm:py-2.5 text-left w-full transition',
    interactive &&
      'cursor-pointer hover:shadow-md hover:border-primary-300/80 dark:hover:border-primary-600/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
    active
      ? 'border-primary-400/60 ring-2 ring-primary-500 shadow-md'
      : 'border-slate-200/70 dark:border-slate-700/70',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-8 w-8 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 truncate leading-tight">
          {label}
        </p>
        <p
          className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${tone ?? 'text-slate-900 dark:text-white'}`}
        >
          {value}
        </p>
      </div>
    </div>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className} aria-pressed={active}>
        {inner}
      </button>
    );
  }

  return <div className={className}>{inner}</div>;
}

function EvaluationCriteriaFields({
  ratings,
  onRatingsChange,
  strengths,
  onStrengthsChange,
  areasForImprovement,
  onAreasForImprovementChange,
  readOnly,
}: {
  ratings: RatingDraft;
  onRatingsChange: (next: RatingDraft) => void;
  strengths: string;
  onStrengthsChange: (v: string) => void;
  areasForImprovement: string;
  onAreasForImprovementChange: (v: string) => void;
  readOnly: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(
          [
            ['jobPerformance', 'Job Performance'],
            ['attendance', 'Attendance & Punctuality'],
            ['workAttitude', 'Work Attitude'],
            ['teamwork', 'Teamwork'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">{label}</span>
            {readOnly ? (
              <p className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm bg-slate-50 dark:bg-slate-900/60">
                {ratings[key] || '—'}
              </p>
            ) : (
              <select
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                value={ratings[key]}
                onChange={(e) =>
                  onRatingsChange({ ...ratings, [key]: e.target.value as ProbationRatingLevel })
                }
              >
                <option value="" disabled hidden>Select…</option>
                {PROBATION_RATING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Strengths</span>
          {readOnly ? (
            <p className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm min-h-[80px] bg-slate-50 dark:bg-slate-900/60 whitespace-pre-wrap">
              {strengths || '—'}
            </p>
          ) : (
            <textarea
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
              rows={3}
              value={strengths}
              onChange={(e) => onStrengthsChange(e.target.value)}
              placeholder="What the employee does well…"
            />
          )}
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-1">Areas for improvement</span>
          {readOnly ? (
            <p className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm min-h-[80px] bg-slate-50 dark:bg-slate-900/60 whitespace-pre-wrap">
              {areasForImprovement || '—'}
            </p>
          ) : (
            <textarea
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
              rows={3}
              value={areasForImprovement}
              onChange={(e) => onAreasForImprovementChange(e.target.value)}
              placeholder="What should improve…"
            />
          )}
        </label>
      </div>
    </>
  );
}

function ProbationHistoryBlock({
  history,
  loading,
}: {
  history: ProbationReviewHistoryItem[];
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <History className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold">Probation history</h3>
      </div>
      {loading ? (
        <ContentSkeleton layout="list" rows={2} label="Loading history…" />
      ) : history.length ? (
        <div className="space-y-2">
          {history.map((h) => (
            <div
              key={h.id}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">
                  {h.recommendation || h.status} — {h.reviewDate?.slice(0, 10)}
                </span>
                {h.extensionDays ? (
                  <span className="text-slate-500">+{h.extensionDays} days</span>
                ) : null}
              </div>
              {h.overallRecommendation ? (
                <p className="text-slate-600 dark:text-slate-400 mt-1">{h.overallRecommendation}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No prior probation reviews.</p>
      )}
    </div>
  );
}

function ratingsComplete(ratings: RatingDraft): boolean {
  return Object.values(ratings).every(Boolean);
}

const PROBATION_COMPLETED_STATUSES = new Set(['PASSED', 'EXTENDED', 'FAILED', 'REJECTED']);

function buildProbationPipelineSteps(row: ProbationRow): OffboardingWorkflowStep[] {
  const complete = PROBATION_COMPLETED_STATUSES.has(row.status);
  const idx = probationPipelineStepIndex(row.status);
  return PROBATION_PIPELINE_STEPS.map((step, i) => ({
    id: step.id,
    label: step.label,
    done: complete ? true : i < idx,
    current: complete ? false : i === idx,
  }));
}

const WORKFLOW_STEP = {
  SELECT: WORKFLOW_STEP_SELECT,
  SCORE: 1,
  MANAGER: 2,
  EMPLOYEE: 3,
  HR: 4,
  COMPLETE: 5,
} as const;

export const ProbationReviewWorkspace: React.FC = () => {
  const { showToast } = useToast();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { byUserId: approverDirectory } = useWorkflowApproverDirectory(true);
  const [rows, setRows] = useState<ProbationRow[]>([]);
  const [summary, setSummary] = useState<ProbationReviewSummary>({
    totalOnProbation: 0,
    reviewsDueThisMonth: 0,
    passed: 0,
    extended: 0,
    failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeRow, setActiveRow] = useState<ProbationRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [history, setHistory] = useState<ProbationReviewHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [wizardStep, setWizardStep] = useState<number>(WORKFLOW_STEP.SELECT);
  const [listPhase, setListPhase] = useState<ProbationListPhase>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [recommendation, setRecommendation] = useState<ProbationReviewRecommendation | ''>('');
  const [ratings, setRatings] = useState<RatingDraft>(EMPTY_RATINGS);
  const [strengths, setStrengths] = useState('');
  const [areasForImprovement, setAreasForImprovement] = useState('');
  const [hrNotes, setHrNotes] = useState('');
  const [extensionDays, setExtensionDays] = useState<number>(30);
  const [extensionReason, setExtensionReason] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [movementType, setMovementType] = useState<'promotion' | 'transfer' | 'salary_update'>(
    'promotion'
  );
  const [movementEffectiveDate, setMovementEffectiveDate] = useState('');
  const [movementDepartmentId, setMovementDepartmentId] = useState('');
  const [movementPositionId, setMovementPositionId] = useState('');
  const [movementSalary, setMovementSalary] = useState('');
  const [movementNotes, setMovementNotes] = useState('');
  const [offboardReason, setOffboardReason] = useState('');
  const [offboardLastWorkingDate, setOffboardLastWorkingDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [routeDepartmentId, setRouteDepartmentId] = useState('');
  const [routeManagerId, setRouteManagerId] = useState('');
  const [managerAssignees, setManagerAssignees] = useState<ProbationManagerAssignee[]>([]);
  const [managerAssigneesLoading, setManagerAssigneesLoading] = useState(false);
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [approverCandidates, setApproverCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const [evaluatorUserIds, setEvaluatorUserIds] = useState<string[]>([]);
  const [evaluatorCandidates, setEvaluatorCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const [searchParams] = useSearchParams();
  const [listTab, setListTab] = useState<ProbationListTabId>('all');

  const { active: activeRows, completed: completedRows } = useMemo(
    () => splitProbationByPhase(rows),
    [rows]
  );

  const phaseRows = useMemo(() => {
    const base =
      listPhase === 'all'
        ? [...activeRows, ...completedRows]
        : listPhase === 'active'
          ? activeRows
          : completedRows;
    return filterProbationRowsByTab(base, listTab);
  }, [activeRows, completedRows, listPhase, listTab]);

  const listTabs = useMemo(() => {
    const source =
      listPhase === 'all'
        ? [...activeRows, ...completedRows]
        : listPhase === 'active'
          ? activeRows
          : completedRows;
    return buildProbationListTabsForPhase(source, listPhase);
  }, [activeRows, completedRows, listPhase]);

  const activeListTabLabel = useMemo(
    () => listTabs.find((t) => t.id === listTab)?.label.toLowerCase() ?? 'active reviews',
    [listTab, listTabs]
  );

  const handleListPhaseChange = useCallback((phase: ProbationListPhase) => {
    setListPhase(phase);
    setListTab('all');
    setActiveRow(null);
    setHistory([]);
    setWizardStep(WORKFLOW_STEP.SELECT);
  }, []);

  const handleListTabChange = useCallback((tabId: ProbationListTabId) => {
    setListTab(tabId);
    setActiveRow(null);
    setHistory([]);
    setWizardStep(WORKFLOW_STEP.SELECT);
  }, []);

  const goToProbationSummary = useCallback((phase: ProbationListPhase, tab: ProbationListTabId = 'all') => {
    setListPhase(phase);
    setListTab(tab);
    setActiveRow(null);
    setHistory([]);
    setWizardStep(WORKFLOW_STEP.SELECT);
  }, []);

  const probationQueueFilter = useMemo(
    () => ({
      menuTitle: 'Filters',
      hideInlineTabs: true,
      sections: [
        {
          id: 'phase',
          title: 'Workflow phase',
          tabs: [
            { id: 'all', label: 'All', count: activeRows.length + completedRows.length },
            { id: 'active', label: 'Active reviews', count: activeRows.length },
            { id: 'completed', label: 'Completed', count: completedRows.length },
          ],
          activeTab: listPhase,
          onChange: (id: string) => handleListPhaseChange(id as ProbationListPhase),
          defaultTabId: 'all',
          alwaysShow: true,
        },
        {
          id: 'status',
          title:
            listPhase === 'completed'
              ? 'Outcome'
              : listPhase === 'active'
                ? 'Review status'
                : 'Status',
          tabs: listTabs,
          activeTab: listTab,
          onChange: (id: string) => handleListTabChange(id as ProbationListTabId),
          defaultTabId: 'all',
          urgentTabIds: ['pending_approval', 'pending_hr', 'pending_manager', 'in_review'],
        },
      ],
    }),
    [
      activeRows.length,
      completedRows.length,
      handleListPhaseChange,
      handleListTabChange,
      listPhase,
      listTab,
      listTabs,
    ]
  );

  const filteredPhaseRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return phaseRows;
    return phaseRows.filter((row) => {
      const name = String(row.name ?? '').toLowerCase();
      const code = String(row.employeeId ?? '').toLowerCase();
      const email = String(row.email ?? '').toLowerCase();
      const phone = String(row.phone ?? '').toLowerCase();
      return (
        name.includes(q) ||
        code.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        String(row.userId).toLowerCase().includes(q)
      );
    });
  }, [phaseRows, searchQuery]);

  const employeeStepCountLabel = useMemo(() => {
    const n = filteredPhaseRows.length;
    if (listTab === 'all') {
      if (listPhase === 'all') return `${n} reviews`;
      return listPhase === 'active' ? `${n} active reviews` : `${n} completed reviews`;
    }
    return `${n} ${activeListTabLabel}`;
  }, [filteredPhaseRows.length, listPhase, listTab, activeListTabLabel]);

  const userRole = (user?.role ?? 'EMPLOYEE') as Role;
  const canHrEvaluate =
    Boolean(activeRow?.canEvaluate) &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const isAssignedEvaluator = Boolean(
    user?.id &&
      activeRow &&
      (activeRow.currentEvaluatorUserId ?? activeRow.assignedManagerUserId) &&
      String(user.id) ===
        String(activeRow.currentEvaluatorUserId ?? activeRow.assignedManagerUserId)
  );
  // The current assigned evaluator can evaluate regardless of their base role —
  // the backend (canManagerEdit) already scopes this to the person whose turn it is.
  const canManagerEvaluate = Boolean(activeRow?.canManagerEdit) && isAssignedEvaluator;
  const canRouteToManager =
    Boolean(activeRow?.canRouteToManager) &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const hrWaitingOnManager =
    Boolean(activeRow?.status === 'PENDING_MANAGER') &&
    (userRole === Role.HR || userRole === Role.ADMIN) &&
    !canManagerEvaluate;
  const hrWaitingOnEmployee =
    Boolean(activeRow?.status === 'PENDING_EMPLOYEE') &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const hrWaitingOnApproval =
    Boolean(activeRow?.status === 'PENDING_FINAL_APPROVAL') &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const managerSubmitted = Boolean(activeRow?.managerSubmittedAt);
  const employeeSubmitted = Boolean(
    activeRow?.employeeSubmittedAt || activeRow?.employeeRatings
  );
  const isCompleted =
    activeRow?.status === 'PASSED' ||
    activeRow?.status === 'EXTENDED' ||
    activeRow?.status === 'FAILED' ||
    activeRow?.status === 'REJECTED';
  const managerEvalReadOnly =
    !canManagerEvaluate &&
    (managerSubmitted || hrWaitingOnManager);

  const evaluatorChain = useMemo(
    () => (activeRow ? resolveProbationEvaluators(activeRow) : []),
    [activeRow]
  );
  const evaluatorRefs = useMemo(
    () =>
      evaluatorChain.map((ev) => ({
        userId: ev.userId,
        name: ev.name,
        submitted: ev.phase === 'submitted',
      })),
    [evaluatorChain]
  );
  const hasNextEvaluatorInChain = useMemo(() => {
    if (evaluatorChain.length <= 1) return false;
    const currentIdx = evaluatorChain.findIndex((ev) => ev.phase === 'current');
    return currentIdx >= 0 && currentIdx < evaluatorChain.length - 1;
  }, [evaluatorChain]);
  const hrRoutedForEvaluation = Boolean(
    activeRow?.routedByHrUserId ||
      activeRow?.assignedEvaluatorUserIds?.length ||
      activeRow?.assignedManagerUserId ||
      activeRow?.status === 'PENDING_MANAGER' ||
      activeRow?.status === 'PENDING_EMPLOYEE'
  );
  const showManagerSection =
    canRouteToManager ||
    canManagerEvaluate ||
    hrWaitingOnManager ||
    managerSubmitted ||
    evaluatorChain.length > 0;
  const combinedProbationRatings = useMemo(() => {
    if (!activeRow) return null;
    const submittedIds = evaluatorRefs.filter((ev) => ev.submitted).map((ev) => ev.userId);
    const fromPayload = computeCombinedProbationRatings(
      activeRow.evaluatorRatingsByUserId ?? {},
      submittedIds.length ? submittedIds : Object.keys(activeRow.evaluatorRatingsByUserId ?? {}),
      activeRow.employeeRatings ?? null
    );
    if (fromPayload) return fromPayload;
    if (activeRow.managerRatings && activeRow.employeeRatings) {
      return computeCombinedProbationRatings(
        { manager: activeRow.managerRatings },
        ['manager'],
        activeRow.employeeRatings
      );
    }
    return activeRow.managerRatings ?? null;
  }, [activeRow, evaluatorRefs]);

  const pendingApprovalView = useMemo(() => {
    if (!activeRow || activeRow.status !== 'PENDING_FINAL_APPROVAL' || !activeRow.reviewId) return null;
    return {
      reviewId: activeRow.reviewId,
      userId: activeRow.userId,
      employeeId: activeRow.employeeId ?? null,
      employeeName: activeRow.name,
      departmentName: activeRow.departmentName ?? null,
      status: activeRow.status,
      recommendation: activeRow.recommendation,
      overallRecommendation: activeRow.overallRecommendation,
      probationEnd: activeRow.probationEnd ?? null,
      managerSubmittedAt: activeRow.managerSubmittedAt ?? null,
      employeeSubmittedAt: activeRow.employeeSubmittedAt ?? null,
      hrNotes: activeRow.hrNotes ?? null,
      assignedApproverUserIds: activeRow.assignedApproverUserIds ?? [],
      assignedApprovers: activeRow.assignedApprovers ?? [],
      currentApproverUserId: activeRow.currentApproverUserId ?? null,
      currentApproverName: activeRow.currentApproverName ?? null,
      approvalProgress: activeRow.approvalProgress ?? null,
      canApproverReview: Boolean(activeRow.canApproverReview),
    };
  }, [activeRow]);

  const maxReachableStep = useMemo(
    () =>
      activeRow
        ? workflowStepWithSelectOffset(maxReachableProbationWizardStep(activeRow))
        : WORKFLOW_STEP.SELECT,
    [activeRow]
  );
  const actionStep = useMemo(() => {
    if (!activeRow) return WORKFLOW_STEP.SELECT;
    if (canRouteToManager) return WORKFLOW_STEP.SCORE;
    if (canManagerEvaluate) return WORKFLOW_STEP.MANAGER;
    if (hrWaitingOnEmployee) return WORKFLOW_STEP.EMPLOYEE;
    if (canHrEvaluate && activeRow.status === 'PENDING_HR') return WORKFLOW_STEP.HR;
    if (activeRow.status === 'PENDING_FINAL_APPROVAL') return WORKFLOW_STEP.HR;
    if (activeRow.canApproverReview) return WORKFLOW_STEP.HR;
    if (isCompleted) return WORKFLOW_STEP.COMPLETE;
    return workflowStepWithSelectOffset(suggestedProbationWizardStep(activeRow));
  }, [
    activeRow,
    canRouteToManager,
    canManagerEvaluate,
    canHrEvaluate,
    hrWaitingOnEmployee,
    isCompleted,
  ]);
  const suggestedStep = useMemo(
    () =>
      activeRow
        ? workflowStepWithSelectOffset(suggestedProbationWizardStep(activeRow))
        : WORKFLOW_STEP.SELECT,
    [activeRow]
  );
  const wizardSteps = useMemo(() => withSelectStep(PROBATION_WIZARD_STEPS), []);
  const onActionStep = wizardStep === actionStep;

  const load = useCallback(async (): Promise<ProbationRow[]> => {
    setLoading(true);
    try {
      const data = await Api.reviews.getProbation();
      const payload = data as { items?: ProbationRow[]; summary?: ProbationReviewSummary };
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(data) ? data : [];
      setRows(items);
      if (payload?.summary) {
        setSummary(payload.summary);
      } else {
        // Fallback if API omits summary — derive from visible queue rows.
        setSummary({
          totalOnProbation: items.filter(
            (r) => !PROBATION_COMPLETED_STATUSES.has(String(r.status))
          ).length,
          reviewsDueThisMonth: items.filter((r) => {
            const end = String(r.nextReviewDate ?? r.probationEnd ?? '').slice(0, 7);
            const month = todayYmdInCompanyTz().slice(0, 7);
            return end === month;
          }).length,
          passed: items.filter((r) => r.status === 'PASSED').length,
          extended: items.filter((r) => r.status === 'EXTENDED').length,
          failed: items.filter((r) => r.status === 'FAILED').length,
        });
      }
      return items;
    } catch {
      showToast('Could not load probation reviews', 'error');
      setRows([]);
      setSummary({
        totalOnProbation: 0,
        reviewsDueThisMonth: 0,
        passed: 0,
        extended: 0,
        failed: 0,
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!routeDepartmentId) {
      setManagerAssignees([]);
      setRouteManagerId('');
      return;
    }
    let cancelled = false;
    setManagerAssigneesLoading(true);
    void Api.reviews
      .getProbationManagerAssignees(routeDepartmentId)
      .then((data) => {
        if (cancelled) return;
        setManagerAssignees(Array.isArray(data) ? (data as ProbationManagerAssignee[]) : []);
      })
      .catch(() => {
        if (!cancelled) setManagerAssignees([]);
      })
      .finally(() => {
        if (!cancelled) setManagerAssigneesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeDepartmentId]);

  const autoRecommendation = useMemo(() => deriveClientRecommendation(ratings), [ratings]);

  const managerDisplayRatings = useMemo((): RatingDraft => {
    if (!activeRow) return EMPTY_RATINGS;
    if (canManagerEvaluate) return ratings;
    if (activeRow.managerRatings) {
      return {
        jobPerformance: activeRow.managerRatings.jobPerformance ?? '',
        attendance: activeRow.managerRatings.attendance ?? '',
        workAttitude: activeRow.managerRatings.workAttitude ?? '',
        teamwork: activeRow.managerRatings.teamwork ?? '',
      };
    }
    return EMPTY_RATINGS;
  }, [activeRow, canManagerEvaluate, ratings]);

  useEffect(() => {
    if (!activeRow) {
      setWizardStep(WORKFLOW_STEP.SELECT);
      return;
    }
    setWizardStep((prev) => {
      if (prev === WORKFLOW_STEP.SELECT) return prev;
      return workflowStepWithSelectOffset(suggestedProbationWizardStep(activeRow));
    });
  }, [activeRow?.userId, activeRow?.status]);

  const selectRow = useCallback(async (row: ProbationRow) => {
    setActiveRow(row);
    setRecommendation(row.recommendation ?? '');
    const evaluatorDraftFields = hydrateProbationEvaluatorDraft(row, user?.id);
    setRatings(evaluatorDraftFields.ratings);
    setStrengths(evaluatorDraftFields.strengths);
    setAreasForImprovement(evaluatorDraftFields.areasForImprovement);
    setHrNotes(row.hrNotes ?? '');
    setExtensionDays(30);
    setExtensionReason('');
    setNextReviewDate(row.nextReviewDate ?? addDaysIso(new Date().toISOString(), 30));
    setMovementEffectiveDate(todayYmdInCompanyTz());
    setMovementDepartmentId(row.departmentId ?? '');
    setMovementPositionId(row.positionId ?? '');
    setMovementSalary('');
    setMovementNotes('');
    setOffboardReason(row.areasForImprovement ?? '');
    setOffboardLastWorkingDate(todayYmdInCompanyTz());
    setRouteDepartmentId(row.departmentId ?? '');
    setRouteManagerId(row.assignedManagerUserId ?? '');
    const evaluatorDraft = evaluatorDraftFromProbationRow(row, approverDirectory);
    setEvaluatorUserIds(evaluatorDraft.userIds);
    setEvaluatorCandidates(evaluatorDraft.candidates);
    setManagerAssignees([]);
    setApproverUserIds(row.assignedApproverUserIds ?? []);
    setApproverCandidates(
      (row.assignedApproverUserIds?.length
        ? row.assignedApproverUserIds
        : (row.assignedApprovers ?? []).map((a) => a.userId)
      ).map((userId) => {
        const entry = (row.assignedApprovers ?? []).find((a) => a.userId === userId);
        return mergeAssignedApproverCandidate(
          { userId, name: entry?.name ?? null },
          approverDirectory,
          language
        );
      })
    );
    setDetailLoading(true);
    setHistoryLoading(true);
    try {
      const [depts, pos] = await Promise.all([
        Api.departments.getAll({ activeOnly: true }),
        Api.positions.getAll({ activeOnly: true }),
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setPositions(Array.isArray(pos) ? pos : []);
    } catch {
      setDepartments([]);
      setPositions([]);
    }
    try {
      const hist = await Api.reviews.getProbationHistory(row.userId);
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
      setDetailLoading(false);
    }
  }, [user?.id, approverDirectory, language]);

  useEffect(() => {
    if (!activeRow || approverDirectory.size === 0) return;
    const evaluatorDraft = evaluatorDraftFromProbationRow(activeRow, approverDirectory);
    setEvaluatorCandidates((prev) => {
      if (!evaluatorDraft.candidates.length) return prev;
      const same =
        prev.length === evaluatorDraft.candidates.length &&
        prev.every((row, i) => {
          const next = evaluatorDraft.candidates[i];
          return (
            row.userId === next.userId &&
            row.name === next.name &&
            row.employeeCode === next.employeeCode &&
            row.departmentName === next.departmentName
          );
        });
      return same ? prev : evaluatorDraft.candidates;
    });
    const approverIds =
      activeRow.assignedApproverUserIds?.length
        ? activeRow.assignedApproverUserIds
        : (activeRow.assignedApprovers ?? []).map((a) => a.userId);
    if (!approverIds.length) return;
    const nextApprovers = approverIds.map((userId) => {
      const entry = (activeRow.assignedApprovers ?? []).find((a) => a.userId === userId);
      return mergeAssignedApproverCandidate(
        { userId, name: entry?.name ?? null },
        approverDirectory,
        language
      );
    });
    setApproverCandidates((prev) => {
      const same =
        prev.length === nextApprovers.length &&
        prev.every((row, i) => {
          const next = nextApprovers[i];
          return (
            row.userId === next.userId &&
            row.name === next.name &&
            row.employeeCode === next.employeeCode &&
            row.departmentName === next.departmentName
          );
        });
      return same ? prev : nextApprovers;
    });
  }, [activeRow, approverDirectory, language]);

  const deepLinkUserId = searchParams.get('userId')?.trim() || null;
  const deepLinkHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!deepLinkUserId || loading) return;
    if (deepLinkHandledRef.current === deepLinkUserId) return;
    const row = activeRows.find((r) => String(r.userId) === deepLinkUserId);
    if (!row) return;
    deepLinkHandledRef.current = deepLinkUserId;
    setListPhase('active');
    if (row.status === 'PENDING_MANAGER') {
      setListTab('pending_manager');
    }
    void selectRow(row).then(() => {
      setWizardStep(workflowStepWithSelectOffset(suggestedProbationWizardStep(row)));
    });
  }, [deepLinkUserId, loading, activeRows, selectRow]);

  const clearSelection = () => {
    setActiveRow(null);
    setHistory([]);
    setWizardStep(WORKFLOW_STEP.SELECT);
  };

  const filteredPositions = useMemo(() => {
    if (!movementDepartmentId) return positions;
    return positions.filter((p) => p.departmentId === movementDepartmentId);
  }, [positions, movementDepartmentId]);

  const movementSalaryRangePosition = useMemo(() => {
    if (movementPositionId) {
      return positions.find((p) => p.id === movementPositionId);
    }
    if (activeRow?.positionId) {
      return positions.find((p) => p.id === activeRow.positionId);
    }
    if (activeRow?.departmentId && activeRow?.position) {
      return positions.find(
        (p) =>
          p.departmentId === activeRow.departmentId &&
          String(p.title ?? '').trim() === String(activeRow.position ?? '').trim()
      );
    }
    return undefined;
  }, [positions, movementPositionId, activeRow?.positionId, activeRow?.departmentId, activeRow?.position]);

  const movementPayCurrency = normalizeContractCurrency(activeRow?.currency);
  const movementExchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');
  const currentBaseSalary = Number(activeRow?.baseSalary ?? 0) || 0;

  const movementSalaryInputBounds = useMemo(() => {
    if (!movementSalaryRangePosition || !hasPositionSalaryRange(movementSalaryRangePosition)) {
      return null;
    }
    const { min, max } = positionSalaryBounds(movementSalaryRangePosition);
    return {
      min: convertContractAmount(min, 'USD', movementPayCurrency, movementExchangeRate),
      max: convertContractAmount(max, 'USD', movementPayCurrency, movementExchangeRate),
    };
  }, [movementSalaryRangePosition, movementPayCurrency, movementExchangeRate]);

  const movementSalaryRangeWarning = useMemo(() => {
    const amount = Number(movementSalary);
    if (!Number.isFinite(amount) || amount <= 0 || !movementSalaryRangePosition) return null;
    return validateSalaryInPositionRange(
      contractInputToUsd(amount, movementPayCurrency, movementExchangeRate),
      movementSalaryRangePosition
    );
  }, [
    movementSalary,
    movementSalaryRangePosition,
    movementPayCurrency,
    movementExchangeRate,
  ]);

  const clampMovementSalaryInput = (
    raw: string,
    bounds: { min: number; max: number } | null = movementSalaryInputBounds
  ): string => {
    if (raw.trim() === '') return '';
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return raw;
    if (!bounds) return raw;
    const clamped = Math.min(bounds.max, Math.max(bounds.min, amount));
    if (clamped === amount) return raw;
    return movementPayCurrency === 'KHR'
      ? String(Math.round(clamped))
      : String(Math.round(clamped * 100) / 100);
  };

  const salaryBoundsForPosition = (positionId: string) => {
    const pos = positions.find((p) => p.id === positionId);
    if (!pos || !hasPositionSalaryRange(pos)) return null;
    const { min, max } = positionSalaryBounds(pos);
    return {
      min: convertContractAmount(min, 'USD', movementPayCurrency, movementExchangeRate),
      max: convertContractAmount(max, 'USD', movementPayCurrency, movementExchangeRate),
    };
  };

  const buildPayload = (
    action: 'SAVE_DRAFT' | 'SUBMIT_FOR_APPROVAL' | 'ROUTE_TO_MANAGER' | 'SUBMIT_TO_HR'
  ): Record<string, unknown> => ({
    userId: activeRow?.userId,
    reviewId: activeRow?.reviewId,
    action,
    recommendation: recommendation || undefined,
    ratings,
    strengths,
    areasForImprovement,
    hrNotes,
    assignedManagerUserId:
      action === 'ROUTE_TO_MANAGER'
        ? (evaluatorUserIds[0] ?? routeManagerId) || undefined
        : undefined,
    assignedEvaluatorUserIds: action === 'ROUTE_TO_MANAGER' ? evaluatorUserIds : undefined,
    assignedApproverUserIds:
      action === 'SUBMIT_FOR_APPROVAL' ? approverUserIds : undefined,
    extensionDays: recommendation === 'EXTEND' ? extensionDays : undefined,
    extensionReason: recommendation === 'EXTEND' ? extensionReason : undefined,
    nextReviewDate: recommendation === 'EXTEND' ? nextReviewDate : undefined,
    reviewedBy: user?.id,
    periodEnd: activeRow?.probationEnd,
    movementOutcome:
      recommendation === 'PASS'
        ? {
            movementType,
            effectiveDate: movementEffectiveDate,
            toDepartmentId: movementDepartmentId,
            toPositionId: movementPositionId,
            toBaseSalary: movementSalary ? Number(movementSalary) : undefined,
            notes: movementNotes,
          }
        : undefined,
    offboardOutcome:
      recommendation === 'FAIL'
        ? {
            reason: offboardReason,
            lastWorkingDate: offboardLastWorkingDate,
          }
        : undefined,
  });

  const validateManagerEval = (): boolean => {
    if (!ratingsComplete(ratings)) {
      showToast('Complete all evaluation ratings', 'warning');
      return false;
    }
    return true;
  };

  const validateStep1 = (): boolean => {
    if (!ratingsComplete(ratings)) {
      showToast('Complete all evaluation ratings', 'warning');
      return false;
    }
    if (!recommendation) {
      showToast('Select a probation outcome (Pass, Extend, or Fail)', 'warning');
      return false;
    }
    return true;
  };

  const validateStep2 = (): boolean => {
    if (recommendation === 'EXTEND' && !extensionReason.trim()) {
      showToast('Extension reason is required', 'warning');
      return false;
    }
    if (recommendation === 'FAIL' && !offboardReason.trim()) {
      showToast('Termination reason is required', 'warning');
      return false;
    }
    if (recommendation === 'PASS' && !movementEffectiveDate) {
      showToast('Movement effective date is required', 'warning');
      return false;
    }
    if (recommendation === 'PASS' && movementSalary.trim()) {
      const amount = Number(movementSalary);
      if (!Number.isFinite(amount) || amount <= 0) {
        showToast('Enter a valid new base salary greater than zero', 'warning');
        return false;
      }
      if (movementSalaryRangeWarning) {
        showToast(movementSalaryRangeWarning, 'warning');
        return false;
      }
    }
    return true;
  };

  const refreshListAndReselect = async (userId: string, clearAfterManagerSubmit = false) => {
    const items = await load();
    if (clearAfterManagerSubmit) {
      clearSelection();
      return;
    }
    const refreshed = items.find((r) => r.userId === userId);
    if (refreshed) await selectRow(refreshed);
    else clearSelection();
  };

  const submit = async (action: 'SAVE_DRAFT' | 'SUBMIT_FOR_APPROVAL' | 'ROUTE_TO_MANAGER' | 'SUBMIT_TO_HR') => {
    if (!activeRow) return;
    if (action === 'ROUTE_TO_MANAGER') {
      if (!evaluatorUserIds.length && !routeManagerId) {
        showToast('Select at least one evaluator before routing', 'warning');
        return;
      }
    }
    if (action === 'SUBMIT_TO_HR' && !validateManagerEval()) return;
    if (action === 'SUBMIT_FOR_APPROVAL') {
      if (!validateStep1() || !validateStep2()) return;
      if (!approverUserIds.length) {
        showToast('Select at least one approver before submitting', 'warning');
        return;
      }
    }
    setSubmitting(true);
    try {
      const userId = activeRow.userId;
      const result = await Api.reviews.submitProbationReview(buildPayload(action));
      const resultStatus = String((result as { status?: string })?.status ?? '');
      const handedOffToNextEvaluator =
        action === 'SUBMIT_TO_HR' && resultStatus === 'PENDING_MANAGER';
      const defaultMessage =
        action === 'SAVE_DRAFT'
          ? 'Draft saved'
          : action === 'ROUTE_TO_MANAGER'
            ? evaluatorUserIds.length > 1
              ? `Review routed to ${evaluatorUserIds.length} evaluators`
              : 'Review routed to manager'
            : action === 'SUBMIT_TO_HR'
              ? handedOffToNextEvaluator
                ? 'Evaluation submitted — sent to the next evaluator'
                : 'Evaluation submitted — employee self-evaluation is next'
              : action === 'SUBMIT_FOR_APPROVAL'
                ? 'Submitted for approval — approvers have been notified'
                : 'Probation review completed';
      showToast((result as { message?: string })?.message ?? defaultMessage, 'success');
      if (action === 'SUBMIT_TO_HR') {
        await refreshListAndReselect(userId, !handedOffToNextEvaluator);
      } else if (action === 'SUBMIT_FOR_APPROVAL') {
        await refreshListAndReselect(userId);
      } else {
        await refreshListAndReselect(userId);
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not save review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const renderEvaluatorChainPanel = () => {
    if (!evaluatorChain.length) {
      return (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No management evaluators have been assigned yet.
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {evaluatorChain.length > 1
            ? `Management evaluators (${evaluatorChain.length})`
            : 'Management evaluator'}
        </p>
        <div className="space-y-1.5">
          {evaluatorChain.map((ev, index) => {
            const phaseLabel =
              ev.phase === 'submitted'
                ? 'Submitted'
                : ev.phase === 'current'
                  ? 'Evaluating now'
                  : 'Waiting';
            const dotClass =
              ev.phase === 'submitted'
                ? 'bg-emerald-500'
                : ev.phase === 'current'
                  ? 'bg-amber-500'
                  : 'bg-slate-300 dark:bg-slate-600';
            const person =
              evaluatorCandidates.find((c) => c.userId === ev.userId) ??
              mergeAssignedApproverCandidate(
                { userId: ev.userId, name: ev.name },
                approverDirectory,
                language
              );
            return (
              <ApproverSummaryCard
                key={ev.userId}
                person={person}
                step={evaluatorChain.length > 1 ? index + 1 : undefined}
                trailing={
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                    {phaseLabel}
                  </span>
                }
              />
            );
          })}
        </div>
      </div>
    );
  };

  const footerHint = useMemo(() => {
    if (wizardStep === WORKFLOW_STEP.SELECT) {
      return activeRow
        ? `Selected ${activeRow.name}. Use Next to continue the review.`
        : 'Select an employee from the list to continue.';
    }
    if (!activeRow) return null;
    if (isCompleted) return 'This probation review is finalized. View history below.';
    if (hrWaitingOnManager) {
      return `Waiting for ${activeRow.currentEvaluatorName ?? activeRow.assignedManagerName ?? 'the assigned evaluator'} to submit their evaluation.`;
    }
    if (hrWaitingOnEmployee) {
      return 'Waiting for the employee to complete self-evaluation before HR can finalize.';
    }
    if (hrWaitingOnApproval) {
      return 'Submitted for approval — waiting for approvers in the chain to sign off.';
    }
    if (canRouteToManager && wizardStep === WORKFLOW_STEP.SCORE) {
      return 'Select management evaluators in order, then click Next to route for evaluation.';
    }
    if (canManagerEvaluate && wizardStep === WORKFLOW_STEP.MANAGER) {
      return hasNextEvaluatorInChain
        ? 'Complete your ratings and notes, then submit to the next evaluator in the chain.'
        : evaluatorChain.length > 1
          ? 'You are the final management evaluator. Submit to open employee self-evaluation.'
          : 'Complete all criteria and submit for employee self-evaluation when ready.';
    }
    if (canHrEvaluate && wizardStep === WORKFLOW_STEP.HR) {
      return 'Review feedback, choose outcome, assign approvers, then submit for final approval.';
    }
    return wizardSteps[wizardStep]?.description ?? null;
  }, [
    activeRow,
    canHrEvaluate,
    canManagerEvaluate,
    canRouteToManager,
    hrWaitingOnManager,
    hrWaitingOnEmployee,
    hrWaitingOnApproval,
    isCompleted,
    hasNextEvaluatorInChain,
    evaluatorChain.length,
    wizardStep,
    wizardSteps,
  ]);

  const displayFooterHint = onActionStep ? footerHint : wizardSteps[wizardStep]?.description;

  const renderOutcomeDetails = () => {
    if (!activeRow) return null;
    const editable = canHrEvaluate && wizardStep === WORKFLOW_STEP.HR;
    return (
      <>
        {recommendation === 'PASS' && (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-3">
            <h3 className="text-sm font-semibold">Employee movement</h3>
            <p className="text-xs text-slate-500">
              Record role or compensation changes when probation passes. Leave department and position
              unchanged to confirm employment only.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Movement type</span>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={movementType}
                  disabled={!editable}
                  onChange={(e) => setMovementType(e.target.value as typeof movementType)}
                >
                  <option value="promotion">Promotion</option>
                  <option value="transfer">Transfer</option>
                  <option value="salary_update">Salary update</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Effective date</span>
                <DatePickerInput
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={movementEffectiveDate}
                  disabled={!editable}
                  onChange={(e) => setMovementEffectiveDate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Department</span>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={movementDepartmentId}
                  disabled={!editable}
                  onChange={(e) => setMovementDepartmentId(e.target.value)}
                >
                  <option value="" disabled hidden>Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Position</span>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={movementPositionId}
                  disabled={!editable}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setMovementPositionId(nextId);
                    setMovementSalary((prev) =>
                      clampMovementSalaryInput(prev, salaryBoundsForPosition(nextId))
                    );
                  }}
                >
                  <option value="" disabled hidden>Select…</option>
                  {filteredPositions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Previous base salary</span>
                <p className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm bg-slate-50 dark:bg-slate-900/60">
                  {currentBaseSalary > 0
                    ? formatContractMoneyAmount(
                        currentBaseSalary,
                        movementPayCurrency,
                        movementExchangeRate
                      )
                    : 'Not set on employee record'}
                </p>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">New base salary (optional)</span>
                <input
                  type="number"
                  min={movementSalaryInputBounds?.min}
                  max={movementSalaryInputBounds?.max}
                  step={movementPayCurrency === 'KHR' ? '1' : '0.01'}
                  className={`w-full rounded-lg border px-2 py-2 text-sm dark:bg-slate-900 ${
                    movementSalaryRangeWarning
                      ? 'border-red-500 dark:border-red-500'
                      : 'border-slate-200 dark:border-slate-600'
                  }`}
                  value={movementSalary}
                  disabled={!editable}
                  placeholder={
                    currentBaseSalary > 0
                      ? `Current: ${formatContractMoneyAmount(
                          currentBaseSalary,
                          movementPayCurrency,
                          movementExchangeRate
                        )}`
                      : movementSalaryInputBounds
                        ? `${movementSalaryInputBounds.min} – ${movementSalaryInputBounds.max}`
                        : 'Enter new amount'
                  }
                  onChange={(e) => setMovementSalary(e.target.value)}
                  onBlur={() => setMovementSalary((prev) => clampMovementSalaryInput(prev))}
                  aria-invalid={movementSalaryRangeWarning ? true : undefined}
                />
                {movementSalaryRangePosition && hasPositionSalaryRange(movementSalaryRangePosition) ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Position range:{' '}
                    {(() => {
                      const { min, max } = positionSalaryBounds(movementSalaryRangePosition);
                      return `${formatContractMoneyFromUsd(
                        min,
                        movementPayCurrency,
                        movementExchangeRate
                      )} – ${formatContractMoneyFromUsd(
                        max,
                        movementPayCurrency,
                        movementExchangeRate
                      )}`;
                    })()}
                  </p>
                ) : null}
                {movementSalaryRangeWarning ? (
                  <div
                    role="alert"
                    className="mt-2 flex gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                    <p>{movementSalaryRangeWarning}</p>
                  </div>
                ) : null}
              </label>
            </div>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 mb-1">Movement notes</span>
              <textarea
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                rows={2}
                value={movementNotes}
                disabled={!editable}
                onChange={(e) => setMovementNotes(e.target.value)}
              />
            </label>
          </section>
        )}

        {recommendation === 'FAIL' && (
          <section className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 p-3 space-y-3">
            <h3 className="text-sm font-semibold">Offboarding</h3>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 mb-1">Termination reason</span>
              <textarea
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                rows={3}
                value={offboardReason}
                disabled={!editable}
                onChange={(e) => setOffboardReason(e.target.value)}
              />
            </label>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 mb-1">Last working date</span>
              <DatePickerInput
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                value={offboardLastWorkingDate}
                disabled={!editable}
                onChange={(e) => setOffboardLastWorkingDate(e.target.value)}
              />
            </label>
          </section>
        )}

        {recommendation === 'EXTEND' && (
          <section className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-3">
            <h3 className="text-sm font-semibold">Probation extension</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Extension duration</span>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={extensionDays}
                  disabled={!editable}
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    setExtensionDays(days);
                    setNextReviewDate(addDaysIso(new Date().toISOString(), days));
                  }}
                >
                  {PROBATION_EXTENSION_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Next review date</span>
                <DatePickerInput
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                  value={nextReviewDate}
                  disabled={!editable}
                  onChange={(e) => setNextReviewDate(e.target.value)}
                />
              </label>
            </div>
            <label className="text-sm block">
              <span className="block text-xs text-slate-500 mb-1">Extension reason</span>
              <textarea
                className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
                rows={2}
                value={extensionReason}
                disabled={!editable}
                onChange={(e) => setExtensionReason(e.target.value)}
              />
            </label>
          </section>
        )}

        {(editable || isCompleted) && (
          <label className="text-sm block">
            <span className="block text-xs text-slate-500 mb-1">HR notes (internal only)</span>
            <textarea
              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-2 text-sm dark:bg-slate-900"
              rows={2}
              value={hrNotes}
              disabled={!editable}
              onChange={(e) => setHrNotes(e.target.value)}
            />
          </label>
        )}
      </>
    );
  };

  const canWizardNext =
    wizardStep < maxReachableStep && wizardStep < wizardSteps.length - 1;
  const showWizardNextButton = wizardStep < wizardSteps.length - 1;

  const handleWizardNext = useCallback(() => {
    if (submitting) return;

    if (wizardStep === WORKFLOW_STEP.SELECT) {
      if (!activeRow || detailLoading) {
        showToast('Select an employee from the list to continue.', 'warning');
        return;
      }
      setWizardStep(
        suggestedStep > WORKFLOW_STEP.SELECT ? suggestedStep : WORKFLOW_STEP.SCORE
      );
      return;
    }

    if (onActionStep) {
      if (hrWaitingOnManager || hrWaitingOnEmployee || hrWaitingOnApproval) {
        showToast(
          footerHint ?? 'Waiting for another party to complete their step before you can continue.',
          'info'
        );
        return;
      }
      if (wizardStep === WORKFLOW_STEP.SCORE && canRouteToManager) {
        void submit('ROUTE_TO_MANAGER');
        return;
      }
      if (wizardStep === WORKFLOW_STEP.MANAGER && canManagerEvaluate) {
        void submit('SUBMIT_TO_HR');
        return;
      }
      if (
        wizardStep === WORKFLOW_STEP.HR &&
        canHrEvaluate &&
        !hrWaitingOnManager &&
        !hrWaitingOnEmployee
      ) {
        void submit('SUBMIT_FOR_APPROVAL');
        return;
      }
    }

    if (canWizardNext) {
      setWizardStep((s) => Math.min(s + 1, maxReachableStep));
      return;
    }

    const remark =
      typeof displayFooterHint === 'string'
        ? displayFooterHint
        : typeof footerHint === 'string'
          ? footerHint
          : 'Complete the required actions on this step before continuing.';
    showToast(remark, 'warning');
  }, [
    submitting,
    wizardStep,
    activeRow,
    detailLoading,
    suggestedStep,
    onActionStep,
    hrWaitingOnManager,
    hrWaitingOnEmployee,
    hrWaitingOnApproval,
    footerHint,
    displayFooterHint,
    canRouteToManager,
    canManagerEvaluate,
    canHrEvaluate,
    canWizardNext,
    maxReachableStep,
    showToast,
    submit,
  ]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {wizardStep === WORKFLOW_STEP.SELECT ? (
        <>
      {pendingApprovalView ? (
        <div className="rounded-xl border border-teal-200/80 dark:border-teal-900/50 bg-teal-50/40 dark:bg-teal-950/20 p-4">
          <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
            Awaiting final approval
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            This review has been submitted to the approval chain. Outcome will be applied after all
            required sign-offs.
          </p>
          <ProbationApprovalTracker row={pendingApprovalView} viewerUserId={user?.id} />
        </div>
      ) : null}

      <div className="relative surface-card overflow-hidden">
        <RulesConfigHelp
          help="probation.reviewWorkflow"
          className="absolute top-3 right-3 z-10"
        />
        <div className="surface-card-pad space-y-3 sm:space-y-4 border-b border-slate-100 dark:border-slate-800 pr-10">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
              Probation review workflow
            </h3>
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 p-2.5 sm:p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-0.5">
              Filter by status
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <SummaryCard
                label="On Probation"
                value={summary.totalOnProbation}
                icon={Users}
                active={listPhase === 'active' && listTab === 'all'}
                onClick={() => goToProbationSummary('active', 'all')}
              />
              <SummaryCard
                label="Due This Month"
                value={summary.reviewsDueThisMonth}
                icon={CalendarClock}
                tone="text-amber-600 dark:text-amber-400"
                active={listPhase === 'active' && listTab === 'in_review'}
                onClick={() => goToProbationSummary('active', 'in_review')}
              />
              <SummaryCard
                label="Passed"
                value={summary.passed}
                icon={CheckCircle2}
                tone="text-emerald-600 dark:text-emerald-400"
                active={listPhase === 'completed' && listTab === 'passed'}
                onClick={() => goToProbationSummary('completed', 'passed')}
              />
              <SummaryCard
                label="Extended"
                value={summary.extended}
                icon={PauseCircle}
                tone="text-sky-600 dark:text-sky-400"
                active={listPhase === 'completed' && listTab === 'extended'}
                onClick={() => goToProbationSummary('completed', 'extended')}
              />
              <SummaryCard
                label="Failed"
                value={summary.failed}
                icon={XCircle}
                tone="text-red-600 dark:text-red-400"
                active={listPhase === 'completed' && listTab === 'failed'}
                onClick={() => goToProbationSummary('completed', 'failed')}
              />
            </div>
          </div>
        </div>

        <div className="surface-card-pad">
          <WorkflowSelectStep
          fullWidth
          layout="detail"
          itemLabel="employees"
          resetKey={`${listPhase}:${listTab}`}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          rows={filteredPhaseRows}
          loading={loading}
          selectedKey={null}
          selectedIdentity={null}
          getKey={(r) => String(r.userId)}
          getIdentity={(r) => employeeListIdentityFromProbationRow(r)}
          onSelect={(r) => {
            if (r === null) return;
            const targetStep = workflowStepWithSelectOffset(suggestedProbationWizardStep(r));
            void selectRow(r).then(() =>
              setWizardStep(targetStep > WORKFLOW_STEP.SELECT ? targetStep : WORKFLOW_STEP.SCORE)
            );
          }}
          countLabel={employeeStepCountLabel}
          pickHint="Tap an employee to open their review"
          emptyMessage={
            searchQuery.trim()
              ? 'No employees match your search.'
              : probationListEmptyMessage(listTab, {
                  assignedOnly: userRole === Role.MANAGER,
                })
          }
          queueFilter={probationQueueFilter}
          renderCard={(row) => {
            const done = PROBATION_COMPLETED_STATUSES.has(row.status);
            const canStart =
              Boolean(row.canManagerEdit) ||
              Boolean(row.canEvaluate) ||
              Boolean(row.canRouteToManager) ||
              Boolean(row.canApproverReview) ||
              Boolean(row.canEmployeeSelfEvaluate) ||
              Boolean(row.canHrDecide);
            const ctaLabel = done ? 'View' : canStart ? 'Start evaluation' : 'View';
            return (
              <article
                className={`rounded-xl border bg-white dark:bg-slate-900/60 surface-card-pad transition-shadow hover:shadow-md ${
                  done
                    ? 'border-emerald-200 dark:border-emerald-900/50'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="min-w-0 flex-1 space-y-3">
                    <EmployeeListIdentityBlock
                      data={employeeListIdentityFromProbationRow(row)}
                      avatarClassName="w-11 h-11 shrink-0 ring-2 ring-white dark:ring-slate-800 shadow-sm"
                      nameExtra={
                        <StatusLabel
                          status={row.status}
                          context="probation"
                          label={probationStatusLabel(row.status)}
                          size="sm"
                        />
                      }
                    />

                    <OffboardingWorkflowProgress
                      variant="pipeline"
                      widthClassName="max-w-2xl"
                      ariaLabel="Probation progress"
                      steps={buildProbationPipelineSteps(row)}
                    />

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        <span className="text-slate-400">Stage:</span>{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {probationRowStepLabel(row.status)}
                        </span>
                      </span>
                      <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          row.overdue ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {row.daysRemaining < 0
                          ? `${Math.abs(row.daysRemaining)}d overdue`
                          : `${row.daysRemaining}d left`}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2 shrink-0 lg:min-w-[9rem]">
                    <span
                      className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm ${
                        canStart && !done
                          ? 'bg-primary-600 text-white'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {ctaLabel}
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                    </span>
                  </div>
                </div>
              </article>
            );
          }}
        />
          </div>
        </div>
        </>
      ) : (
      <WorkflowWizardShell
        header={
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setWizardStep(WORKFLOW_STEP.SELECT)}
              className="mt-0.5 -ml-1 p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors shrink-0"
              aria-label="Back to employee list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  Probation review workflow
                </h2>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                    isCompleted
                      ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                      : activeRow
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {isCompleted ? 'Complete' : activeRow ? 'In progress' : 'New'}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {activeRow
                  ? `${activeRow.employeeId ?? activeRow.userId} · ${activeRow.name}`
                  : `${PHASE_META[listPhase].title} — select an employee to begin`}
              </p>
            </div>
            </div>
          </div>
        }
        steps={wizardSteps}
        currentStep={wizardStep}
        maxReachableStep={maxReachableStep}
        onStepChange={setWizardStep}
        stepHeader={{
          title: wizardSteps[wizardStep]?.label ?? '',
          description: wizardSteps[wizardStep]?.description,
        }}
        footer={
          <WizardFooterLayout
            left={
              wizardStep > WORKFLOW_STEP.SELECT ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setWizardStep((s) => Math.max(WORKFLOW_STEP.SELECT, s - 1))}
                  className="h-9 px-2.5 text-slate-600 dark:text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4 mr-1.5" />
                  Back
                </Button>
              ) : (
                <p className="text-xs text-slate-500 max-w-[10rem] lg:hidden">{displayFooterHint}</p>
              )
            }
            hint={
              wizardStep > WORKFLOW_STEP.SELECT && displayFooterHint ? displayFooterHint : undefined
            }
            right={
              showWizardNextButton ? (
                <>
                  {onActionStep &&
                  ((wizardStep === WORKFLOW_STEP.MANAGER && canManagerEvaluate) ||
                    (wizardStep === WORKFLOW_STEP.HR &&
                      canHrEvaluate &&
                      !hrWaitingOnManager &&
                      !hrWaitingOnEmployee)) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-auto"
                      disabled={submitting}
                      onClick={() => submit('SAVE_DRAFT')}
                    >
                      Save draft
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 w-auto shadow-md shadow-primary-500/20 px-5"
                    disabled={submitting}
                    onClick={handleWizardNext}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              ) : null
            }
          />
        }
      >
        {detailLoading ? (
          <ContentSkeleton layout="form" rows={1} />
        ) : !activeRow ? (
          <p className="text-sm text-slate-500 text-center py-12">
            Select an employee on the Employee step to continue.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
              <EmployeeListIdentityBlock
                data={employeeListIdentityFromProbationRow(activeRow)}
                avatarClassName="h-10 w-10 shrink-0"
                className="min-w-0 flex-1"
              />
              <StatusLabel
                status={activeRow.status}
                context="probation"
                label={probationStatusLabel(activeRow.status)}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 p-3 mb-4">
              <div>
                <p className="text-xs text-slate-500">Join date</p>
                <p className="font-medium">{activeRow.joinDate}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Probation end</p>
                <p className="font-medium">{activeRow.probationEnd}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Days remaining</p>
                <p className={`font-medium ${activeRow.overdue ? 'text-red-600' : ''}`}>
                  {activeRow.daysRemaining < 0
                    ? `${Math.abs(activeRow.daysRemaining)}d overdue`
                    : `${activeRow.daysRemaining}d`}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Suggested outcome</p>
                <p className="font-medium text-slate-700 dark:text-slate-200 text-xs leading-snug">
                  {canHrEvaluate && wizardStep >= WORKFLOW_STEP.HR
                    ? autoRecommendation
                    : activeRow.managerOverallRecommendation ||
                      activeRow.overallRecommendation ||
                      'Route to manager first'}
                </p>
              </div>
            </div>

            {wizardStep === WORKFLOW_STEP.SCORE ? (
              <WizardSectionCard
                icon={wizardSteps[WORKFLOW_STEP.SCORE].icon as React.ComponentType<{ className?: string }>}
                title={
                  canRouteToManager
                    ? 'Route to management evaluation'
                    : hrRoutedForEvaluation
                      ? 'Management evaluators routed'
                      : wizardSteps[WORKFLOW_STEP.SCORE].label
                }
                description={
                  canRouteToManager
                    ? 'Assign one or more management evaluators in order. Each person evaluates in sequence before employee self-evaluation.'
                    : hrRoutedForEvaluation
                      ? 'These evaluators were assigned by HR to evaluate this employee in order.'
                      : wizardSteps[WORKFLOW_STEP.SCORE].description
                }
              >
                {canRouteToManager ? (
                  <ApproverApprovalField
                    required
                    value={evaluatorUserIds}
                    selected={evaluatorCandidates}
                    defaultExpandedDepartmentId={activeRow.departmentId ?? null}
                    onChange={(userIds, candidates) => {
                      setEvaluatorUserIds(userIds);
                      setEvaluatorCandidates(candidates);
                      setRouteManagerId(userIds[0] ?? '');
                    }}
                    label="Management evaluators"
                    hint="Assign one or more evaluators. Top of the list evaluates first, then each person below in order."
                    buttonLabel="Select evaluators"
                    modalTitle="Select management evaluators"
                  />
                ) : (
                  renderEvaluatorChainPanel()
                )}
              </WizardSectionCard>
            ) : null}

            {wizardStep === WORKFLOW_STEP.MANAGER ? (
              <WizardSectionCard
                icon={wizardSteps[WORKFLOW_STEP.MANAGER].icon as React.ComponentType<{ className?: string }>}
                title={
                  canManagerEvaluate
                    ? evaluatorChain.length > 1
                      ? `Management evaluation (${evaluatorChain.findIndex((ev) => ev.phase === 'current') + 1} of ${evaluatorChain.length})`
                      : 'Management evaluation'
                    : 'Management evaluation'
                }
                description={
                  hrWaitingOnManager && !managerSubmitted
                    ? `Waiting for ${activeRow.currentEvaluatorName ?? activeRow.assignedManagerName ?? 'the assigned evaluator'}.`
                    : canManagerEvaluate
                      ? hasNextEvaluatorInChain
                        ? 'Rate performance criteria and submit to the next evaluator in the chain.'
                        : evaluatorChain.length > 1
                          ? 'You are the final management evaluator. Submit to open employee self-evaluation.'
                          : 'Rate performance criteria and submit for employee self-evaluation.'
                      : 'Management evaluators rate performance criteria and submit in order.'
                }
              >
                <div className="space-y-5">
                  {showManagerSection ? (
                    <div className="space-y-3">
                      {renderEvaluatorChainPanel()}
                      {hrWaitingOnManager && !managerSubmitted ? (
                        <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                          Waiting for{' '}
                          <span className="font-medium">
                            {activeRow.currentEvaluatorName ??
                              activeRow.assignedManagerName ??
                              'the assigned evaluator'}
                          </span>{' '}
                          to submit their evaluation.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {canManagerEvaluate || managerSubmitted ? (
                    <>
                      {activeRow.managerOverallRecommendation && managerEvalReadOnly ? (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          Manager suggested outcome: {activeRow.managerOverallRecommendation}
                        </p>
                      ) : null}
                      {canManagerEvaluate && evaluatorChain.length > 1 ? (
                        <p className="text-xs text-slate-500">
                          Your ratings are saved separately for this evaluation. Other evaluators
                          cannot see what you enter here.
                        </p>
                      ) : null}
                      <EvaluationCriteriaFields
                        ratings={canManagerEvaluate ? ratings : managerDisplayRatings}
                        onRatingsChange={setRatings}
                        strengths={canManagerEvaluate ? strengths : activeRow.managerStrengths ?? ''}
                        onStrengthsChange={setStrengths}
                        areasForImprovement={
                          canManagerEvaluate
                            ? areasForImprovement
                            : activeRow.managerAreasForImprovement ?? ''
                        }
                        onAreasForImprovementChange={setAreasForImprovement}
                        readOnly={managerEvalReadOnly}
                      />
                    </>
                  ) : !showManagerSection ? (
                    <p className="text-sm text-slate-500">No manager evaluation yet.</p>
                  ) : null}
                </div>
              </WizardSectionCard>
            ) : null}

            {wizardStep === WORKFLOW_STEP.EMPLOYEE ? (
              <WizardSectionCard
                icon={wizardSteps[WORKFLOW_STEP.EMPLOYEE].icon as React.ComponentType<{ className?: string }>}
                title="Self evaluation"
                description="Employee completes self-ratings after management evaluation."
              >
                {hrWaitingOnEmployee ? (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-100">
                    <p className="font-medium">Waiting for employee self-evaluation</p>
                    <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
                      The employee completes this from <strong>Performance</strong> under Self Service on
                      their dashboard.
                    </p>
                  </div>
                ) : employeeSubmitted ? (
                  <EvaluationCriteriaFields
                    ratings={{
                      jobPerformance: activeRow.employeeRatings?.jobPerformance ?? '',
                      attendance: activeRow.employeeRatings?.attendance ?? '',
                      workAttitude: activeRow.employeeRatings?.workAttitude ?? '',
                      teamwork: activeRow.employeeRatings?.teamwork ?? '',
                    }}
                    onRatingsChange={() => undefined}
                    strengths={activeRow.employeeStrengths ?? ''}
                    onStrengthsChange={() => undefined}
                    areasForImprovement={activeRow.employeeAreasForImprovement ?? ''}
                    onAreasForImprovementChange={() => undefined}
                    readOnly
                  />
                ) : (
                  <p className="text-sm text-slate-500">
                    Employee self-evaluation opens after the manager submits their review.
                  </p>
                )}
              </WizardSectionCard>
            ) : null}

            {wizardStep === WORKFLOW_STEP.HR ? (
              <WizardSectionCard
                icon={wizardSteps[WORKFLOW_STEP.HR].icon as React.ComponentType<{ className?: string }>}
                title={wizardSteps[WORKFLOW_STEP.HR].label}
                description={wizardSteps[WORKFLOW_STEP.HR].description}
              >
                    {hrWaitingOnManager ? (
                      <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                        Waiting for manager submission before HR can finalize.
                      </p>
                    ) : hrWaitingOnEmployee ? (
                      <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                        Waiting for employee self-evaluation before HR can finalize.
                      </p>
                    ) : hrWaitingOnApproval ? (
                      pendingApprovalView ? (
                        <ProbationApprovalTracker row={pendingApprovalView} viewerUserId={user?.id} />
                      ) : (
                        <p className="text-sm text-slate-500">
                          Submitted for approval — waiting for approvers in the chain.
                        </p>
                      )
                    ) : (
                      <>
                        {(managerSubmitted || employeeSubmitted) && (
                          <div className="mb-4">
                            <CombinedProbationScoresTable
                              row={activeRow}
                              evaluators={evaluatorRefs}
                              description="Per-criterion average from all management evaluators and the employee self-evaluation."
                            />
                            {combinedProbationRatings && activeRow.managerOverallRecommendation ? (
                              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">
                                Management suggested outcome: {activeRow.managerOverallRecommendation}
                              </p>
                            ) : null}
                          </div>
                        )}
                        <EvaluationCriteriaFields
                          ratings={ratings}
                          onRatingsChange={setRatings}
                          strengths={strengths}
                          onStrengthsChange={setStrengths}
                          areasForImprovement={areasForImprovement}
                          onAreasForImprovementChange={setAreasForImprovement}
                          readOnly={!canHrEvaluate}
                        />
                        {canHrEvaluate ? (
                          <section className="mt-4">
                            <h3 className="text-sm font-semibold mb-2">Probation outcome</h3>
                            <p className="text-xs text-slate-500 mb-2">Suggested: {autoRecommendation}</p>
                            <div className="flex flex-wrap gap-2">
                              {(
                                [
                                  ['PASS', 'Pass Probation'],
                                  ['EXTEND', 'Extend Probation'],
                                  ['FAIL', 'Fail Probation'],
                                ] as const
                              ).map(([value, label]) => (
                                <Button
                                  key={value}
                                  size="sm"
                                  variant={recommendation === value ? 'primary' : 'outline'}
                                  className={
                                    recommendation === value
                                      ? value === 'FAIL'
                                        ? 'bg-red-600 hover:bg-red-700'
                                        : value === 'EXTEND'
                                          ? 'bg-amber-500 hover:bg-amber-600'
                                          : ''
                                      : ''
                                  }
                                  onClick={() => setRecommendation(value)}
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>
                          </section>
                        ) : isCompleted ? (
                          <p className="text-sm mt-3">
                            Outcome:{' '}
                            <span className="font-semibold">
                              {activeRow.recommendation ?? activeRow.overallRecommendation ?? '—'}
                            </span>
                          </p>
                        ) : null}
                        {canHrEvaluate && recommendation ? (
                          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
                            {renderOutcomeDetails()}
                            <ApproverApprovalField
                              value={approverUserIds}
                              selected={approverCandidates}
                              onChange={(ids, candidates) => {
                                setApproverUserIds(ids);
                                setApproverCandidates(candidates);
                              }}
                              required
                              label="Final approvers"
                              hint="Assign one or more approvers. Top of the list approves first, then each person below in order."
                              buttonLabel="Select approvers"
                              modalTitle="Select final approvers"
                              modalDescription="Approvers review in order. The first approver is notified immediately; others are notified when it is their turn."
                            />
                          </div>
                        ) : null}
                      </>
                    )}
                  </WizardSectionCard>
            ) : null}

            {wizardStep === WORKFLOW_STEP.COMPLETE ? (
              <WizardSectionCard
                icon={wizardSteps[WORKFLOW_STEP.COMPLETE].icon as React.ComponentType<{ className?: string }>}
                    title="Review complete"
                    description="Finalized probation record."
                  >
                    <div className="space-y-3 text-sm">
                      <p>
                        <span className="text-slate-500">Outcome:</span>{' '}
                        <span className="font-semibold">
                          {probationStatusLabel(activeRow.status)}
                          {activeRow.recommendation ? ` (${activeRow.recommendation})` : ''}
                        </span>
                      </p>
                      {activeRow.overallRecommendation ? (
                        <p className="text-slate-600 dark:text-slate-300">{activeRow.overallRecommendation}</p>
                      ) : null}
                      {activeRow.reviewedAt ? (
                        <p className="text-xs text-slate-500">
                          Reviewed {activeRow.reviewedAt.slice(0, 10)}
                        </p>
                      ) : null}
                    </div>
                    <ProbationHistoryBlock history={history} loading={historyLoading} />
                  </WizardSectionCard>
            ) : null}

            {wizardStep !== WORKFLOW_STEP.COMPLETE ? (
              <ProbationHistoryBlock history={history} loading={historyLoading} />
            ) : null}
          </>
        )}
      </WorkflowWizardShell>
      )}
    </div>
  );
};
