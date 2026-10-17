import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Lock,
  CheckCircle2,
  Users,
  XCircle,
  Settings2,
  Save,
  ClipboardList,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Badge } from '../ui/Badge';
import { StatusLabel } from '../ui/StatusLabel';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import { Role } from '../../types';
import { PERM } from '../../constants/permissionKeys';
import { inputClass } from '../../constants/designSystem';
import type {
  AppraisalPeriod,
  ComponentScore,
  EmployeeAppraisal,
  KpiPolicySettings,
} from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import {
  clampKpiScore,
  formatAppraisalScore,
  isAppraisalPeriodEnabled,
  splitAppraisalsByPhase,
  splitEvaluatorAppraisalsByAction,
} from '../../types/appraisal';
import { AppraisalPeriodToolbar } from './AppraisalPeriodToolbar';
import { AppraisalMovementFollowUp } from './AppraisalMovementFollowUp';
import { buildAppraisalMovementPrefill } from './appraisalMovementUtils';
import { ApproverApprovalField, ApproverSummaryCard } from '../workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../workflow/ApproverSelectPanel';
import {
  AppraisalApprovalTracker,
  finalApproverDraftFromAppraisal,
  evaluatorDraftFromAppraisal,
  resolveAppraisalEvaluators,
} from './appraisalApprovalDisplay';
import { mergeAssignedApproverCandidate } from '../../utils/approverCandidateFromAssigned';
import { useWorkflowApproverDirectory } from '../../hooks/useWorkflowApproverDirectory';
import { useLanguage } from '../../context/LanguageContext';
import {
  approveReviewPrompt,
  APPROVE_BUTTON_LABEL,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';
import { AutomaticKpiCalculationHelp } from './AutomaticKpiCalculationHelp';
import { AppraisalDualScoreHelp } from './AppraisalDualScoreHelp';
import { CombinedEvaluatorScoresTable } from './CombinedEvaluatorScoresTable';
import {
  resolveDualScoreSummary,
  computeCombinedWeightedTotal,
  roundComponentWeightedScore,
  resolveStageComponentScore,
  resolveManualDraftScore,
  resolveManualDraftStage,
  computeStageWeightedTotal,
  resolveEmployeeSelfScore,
  computeEmployeeSelfWeightedTotal,
  computeDraftWeightedTotal,
  type ComponentScoreStage,
} from './appraisalDualScore';
import { movementTypeLabel } from '../employee/employeeMovementDisplay';
import {
  APPRAISAL_WIZARD_STEPS,
  appraisalWizardStepsForStatus,
  maxReachableAppraisalWizardStep,
  suggestedAppraisalWizardStep,
} from './appraisalWizardUi';
import {
  EVALUATOR_PHASE_META,
  PHASE_META,
  workflowActionsForStatus,
  workflowStatusBadgeMeta,
  workflowStatusHint,
  type AppraisalListPhase,
} from './appraisalWorkflowUi';
import { WizardSectionCard } from '../employee-wizard/wizardLayout';
import { WorkflowWizardShell } from '../workflow/WorkflowWizardShell';
import { WizardFooterLayout } from '../workflow/WizardFooterLayout';
import {
  WorkflowSelectStep,
  withSelectStep,
  WORKFLOW_STEP_SELECT,
  workflowStepWithSelectOffset,
} from '../workflow/WorkflowSelectStep';
import { type WorkflowFilterSection } from '../workflow/WorkflowQueueFilterMenu';

import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromAppraisalRow,
} from '../employee/EmployeeListIdentity';
import {
  OffboardingWorkflowProgress,
  type OffboardingWorkflowStep,
} from '../employee/OffboardingWorkflowProgress';
import {
  getManagementEvaluationForUser,
  parseEmployeeEvaluationPayload,
} from './appraisalDetailUtils';

function effectiveAssignedManagerUserId(
  row: Pick<EmployeeAppraisal, 'assigned_manager_user_id' | 'manager_id' | 'workflow_status'>
): string | null {
  if (row.assigned_manager_user_id) return String(row.assigned_manager_user_id);
  if (!row.manager_id) return null;
  const status = row.workflow_status;
  if (
    status === 'PENDING_MANAGER' ||
    status === 'MANAGER_REVIEW' ||
    status === 'PENDING_EMPLOYEE' ||
    status === 'PENDING_HR' ||
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'CLOSED' ||
    status === 'SUBMITTED' ||
    status === 'HR_REVIEW'
  ) {
    return String(row.manager_id);
  }
  return null;
}

type AppraisalDetail = {
  appraisal: EmployeeAppraisal;
  componentScores: ComponentScore[];
  auditLog: Array<Record<string, unknown>>;
  linkedMovements?: EmployeeMovementRow[];
};

const WORKFLOW_STEP = {
  SELECT: WORKFLOW_STEP_SELECT,
  SCORE: 1,
  MANAGER: 2,
  EMPLOYEE: 3,
  HR: 4,
  COMPLETE: 5,
} as const;

function buildAppraisalPipelineSteps(
  status: EmployeeAppraisal['workflow_status'],
  locked: boolean
): OffboardingWorkflowStep[] {
  const idx = suggestedAppraisalWizardStep(status, locked);
  const lastIdx = APPRAISAL_WIZARD_STEPS.length - 1;
  const complete = idx >= lastIdx;
  return APPRAISAL_WIZARD_STEPS.map((step, i) => ({
    id: step.id,
    label: step.label,
    done: complete ? true : i < idx,
    current: complete ? false : i === idx,
  }));
}

const KPI_STAT_TONES = {
  slate:
    'border-slate-200/90 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/50 text-slate-800 dark:text-slate-100',
  amber:
    'border-amber-200/90 dark:border-amber-800/70 bg-amber-50/90 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100',
  violet:
    'border-violet-200/90 dark:border-violet-800/70 bg-violet-50/90 dark:bg-violet-950/40 text-violet-900 dark:text-violet-100',
  emerald:
    'border-emerald-200/90 dark:border-emerald-800/70 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100',
} as const;

const KPI_STAT_ACTIVE = {
  slate: 'ring-2 ring-slate-400/80 dark:ring-slate-500 shadow-sm',
  amber: 'ring-2 ring-amber-400/80 dark:ring-amber-500 shadow-sm',
  violet: 'ring-2 ring-violet-400/80 dark:ring-violet-500 shadow-sm',
  emerald: 'ring-2 ring-emerald-400/80 dark:ring-emerald-500 shadow-sm',
} as const;

function KpiWorkflowStatPill({
  label,
  value,
  tone = 'slate',
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  tone?: keyof typeof KPI_STAT_TONES;
  active?: boolean;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === 'function';
  const className = [
    'w-full rounded-xl border px-3 py-2.5 sm:px-3.5 sm:py-3 text-left transition-shadow',
    KPI_STAT_TONES[tone],
    active ? KPI_STAT_ACTIVE[tone] : '',
    interactive
      ? 'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75 truncate">{label}</p>
      <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums tracking-tight leading-none">{value}</p>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-pressed={active}
        aria-label={`Filter: ${label}`}
      >
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

export const KpiAppraisalListPanel: React.FC = () => {
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkAppraisalId = searchParams.get('appraisalId')?.trim() || null;
  const deepLinkHandledRef = useRef<string | null>(null);
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const { byUserId: approverDirectory } = useWorkflowApproverDirectory(true);
  const userRole = (user?.role ?? Role.EMPLOYEE) as Role;
  const isHrEvaluationView = userRole === Role.HR || userRole === Role.ADMIN;
  const phaseMeta = isHrEvaluationView ? PHASE_META : EVALUATOR_PHASE_META;
  const canRecordMovement =
    hasPermission(PERM.EMPLOYEE_EDIT_WORK) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_CREATE);

  const [periods, setPeriods] = useState<AppraisalPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [rows, setRows] = useState<EmployeeAppraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AppraisalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listPhase, setListPhase] = useState<AppraisalListPhase | 'all'>('review');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualDraft, setManualDraft] = useState<
    Record<string, { score: string; comment: string; notes: string }>
  >({});
  const [evaluationDraft, setEvaluationDraft] = useState({
    strengths: '',
    weaknesses: '',
    managerRecommendations: '',
  });
  const [rejectReason, setRejectReason] = useState('');
  const [commentThreshold, setCommentThreshold] = useState(60);
  const [saving, setSaving] = useState(false);
  const [finalApproverUserIds, setFinalApproverUserIds] = useState<string[]>([]);
  const [finalApproverCandidates, setFinalApproverCandidates] = useState<
    WorkflowApproverCandidate[]
  >([]);
  const [evaluatorUserIds, setEvaluatorUserIds] = useState<string[]>([]);
  const [evaluatorCandidates, setEvaluatorCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const [wizardStep, setWizardStep] = useState<number>(WORKFLOW_STEP.SELECT);

  const loadPeriods = useCallback(async () => {
    try {
      const p = await Api.appraisal.getPeriods();
      const all = Array.isArray(p) ? (p as AppraisalPeriod[]) : [];
      const list = all.filter((period) => isAppraisalPeriodEnabled(period));
      setPeriods(list);
      setPeriodId((prev) => {
        if (prev && list.some((period) => period.id === prev)) return prev;
        return list[0]?.id ?? '';
      });
      if (!list.length) {
        setRows([]);
        setLoading(false);
      }
    } catch {
      setPeriods([]);
      setPeriodId('');
      setRows([]);
      setLoading(false);
      showToast('Could not load appraisal periods', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void (async () => {
      try {
        const pol = await Api.appraisal.getPolicy();
        setCommentThreshold((pol as KpiPolicySettings).manualCommentThreshold ?? 60);
      } catch {
        /* keep default threshold */
      }
    })();
  }, []);

  const loadAppraisals = useCallback(async () => {
    if (!periodId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await Api.appraisal.listAppraisals({ periodId });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
      showToast('Could not load appraisals', 'error');
    } finally {
      setLoading(false);
    }
  }, [periodId, showToast]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadAppraisals();
  }, [loadAppraisals]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      if (!periodId) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadAppraisals();
      }, 400);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadAppraisals, periodId]);

  useEffect(() => {
    setDetail(null);
    setSearchQuery('');
    setWizardStep(WORKFLOW_STEP.SELECT);
  }, [periodId, user?.id]);

  useEffect(() => {
    if (!detail?.appraisal.id || !periodId) return;
    if (String(detail.appraisal.period_id) !== String(periodId)) {
      setDetail(null);
      setWizardStep(WORKFLOW_STEP.SELECT);
    }
  }, [detail?.appraisal.id, detail?.appraisal.period_id, periodId]);

  useEffect(() => {
    if (loading || userRole === Role.HR || userRole === Role.ADMIN) return;
    if (!detail?.appraisal.id) return;
    if (!rows.some((r) => r.id === detail.appraisal.id)) {
      setDetail(null);
    }
  }, [detail?.appraisal.id, loading, rows, userRole]);

  const { review: reviewRows, appraised: appraisedRows, movement: movementRows } = useMemo(() => {
    if (isHrEvaluationView) return splitAppraisalsByPhase(rows);
    return splitEvaluatorAppraisalsByAction(rows, user?.id);
  }, [isHrEvaluationView, rows, user?.id]);

  const phaseRows = useMemo(() => {
    if (listPhase === 'all') {
      return isHrEvaluationView
        ? [...reviewRows, ...appraisedRows, ...movementRows]
        : [...reviewRows, ...appraisedRows];
    }
    if (listPhase === 'review') return reviewRows;
    if (listPhase === 'appraised') return appraisedRows;
    return movementRows;
  }, [appraisedRows, isHrEvaluationView, listPhase, movementRows, reviewRows]);

  const handleListPhaseChange = useCallback((phase: AppraisalListPhase | 'all') => {
    setListPhase(phase);
    setDetail(null);
    setWizardStep(WORKFLOW_STEP.SELECT);
  }, []);

  useEffect(() => {
    if (!isHrEvaluationView && listPhase === 'movement') {
      setListPhase('review');
    }
  }, [isHrEvaluationView, listPhase]);
  const phaseTitle =
    listPhase === 'all' ? 'All' : phaseMeta[listPhase].title;
  const phaseEmpty =
    listPhase === 'all'
      ? 'No appraisals in this period yet.'
      : phaseMeta[listPhase].empty;

  const kpiQueueFilter = useMemo(
    () => ({
      menuTitle: 'Filters',
      hideInlineTabs: true,
      sections: [
        {
          id: 'phase',
          title: isHrEvaluationView ? 'Workflow phase' : 'My evaluations',
          tabs: isHrEvaluationView
            ? [
                { id: 'all', label: 'Total', count: rows.length },
                { id: 'review', label: 'In review', count: reviewRows.length },
                { id: 'appraised', label: 'Awaiting movement', count: appraisedRows.length },
                { id: 'movement', label: 'Complete', count: movementRows.length },
              ]
            : [
                { id: 'all', label: 'Total', count: rows.length },
                { id: 'review', label: 'Needs evaluation', count: reviewRows.length },
                { id: 'appraised', label: 'Submitted', count: appraisedRows.length },
              ],
          activeTab: listPhase,
          onChange: (id: string) => handleListPhaseChange(id as AppraisalListPhase | 'all'),
          defaultTabId: 'review',
          alwaysShow: true,
        } satisfies WorkflowFilterSection,
      ],
    }),
    [
      handleListPhaseChange,
      isHrEvaluationView,
      listPhase,
      rows.length,
      reviewRows.length,
      appraisedRows.length,
      movementRows.length,
    ]
  );

  const filteredPhaseRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return phaseRows;
    return phaseRows.filter((r) => {
      const name = String(r.employeeName ?? r.user_id).toLowerCase();
      const code = String(r.employeeCode ?? '').toLowerCase();
      const email = String(r.employeeEmail ?? '').toLowerCase();
      const phone = String(r.employeePhone ?? '').toLowerCase();
      return (
        name.includes(q) ||
        code.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        String(r.user_id).toLowerCase().includes(q)
      );
    });
  }, [phaseRows, searchQuery]);

  const redirectOwnSelfEvaluation = useCallback(
    (row: Pick<
      EmployeeAppraisal,
      'id' | 'user_id' | 'canEmployeeSelfEvaluate' | 'workflow_status' | 'manager_submitted_at' | 'self_review_at'
    >) => {
      const actorId = String(user?.id ?? '');
      if (!actorId || String(row.user_id) !== actorId) return false;
      const pendingSelf =
        Boolean(row.canEmployeeSelfEvaluate) ||
        (String(row.workflow_status) === 'PENDING_EMPLOYEE' &&
          Boolean(row.manager_submitted_at) &&
          !row.self_review_at);
      if (!pendingSelf) return false;
      navigate(`/my-performance?appraisalId=${encodeURIComponent(row.id)}`);
      return true;
    },
    [navigate, user?.id]
  );

  const openDetail = useCallback(
    async (id: string, options?: { suppressForbidden?: boolean }) => {
      const listRow = rows.find((r) => r.id === id);
      if (listRow && redirectOwnSelfEvaluation(listRow)) return;
      if (listRow && periodId && String(listRow.period_id) !== String(periodId)) {
        showToast('This appraisal belongs to a different period. Refresh the list.', 'error');
        return;
      }
      if (listRow) {
        setDetail((prev) =>
          prev?.appraisal.id === id
            ? prev
            : {
                appraisal: listRow,
                componentScores: [],
                auditLog: [],
              }
        );
      }
      setDetailLoading(true);
      try {
        const d = (await Api.appraisal.getAppraisal(id)) as AppraisalDetail;
        if (redirectOwnSelfEvaluation(d.appraisal)) return;
        if (periodId && String(d.appraisal.period_id) !== String(periodId)) {
          showToast('This appraisal belongs to a different period. Select the correct period.', 'error');
          setDetail(null);
          setWizardStep(WORKFLOW_STEP.SELECT);
          return;
        }
        setDetail(d);
        const finalDraft = finalApproverDraftFromAppraisal(d.appraisal, approverDirectory);
        setFinalApproverUserIds(finalDraft.userIds);
        setFinalApproverCandidates(finalDraft.candidates);
        const evaluatorDraft = evaluatorDraftFromAppraisal(d.appraisal, approverDirectory);
        setEvaluatorUserIds(evaluatorDraft.userIds);
        setEvaluatorCandidates(evaluatorDraft.candidates);
        const draftStage = resolveManualDraftStage({
          canManagerEvaluate: Boolean(d.appraisal.canManagerEdit),
        });
        const draftScoreOptions =
          d.appraisal.canManagerEdit && user?.id ? { evaluatorUserId: String(user.id) } : undefined;
        const usePerEvaluatorNotes = Boolean(d.appraisal.routed_by_hr_user_id);
        const myManagementEval = usePerEvaluatorNotes
          ? getManagementEvaluationForUser(d.appraisal.outcome_payload_json, String(user?.id ?? ''))
          : null;
        const draft: Record<string, { score: string; comment: string; notes: string }> = {};
        for (const s of d.componentScores ?? []) {
          if (Number(s.auto_calculated) === 0) {
            draft[s.component_id] = {
              score: resolveManualDraftScore(s, draftStage, draftScoreOptions),
              comment: usePerEvaluatorNotes ? '' : (s.comment ?? ''),
              notes: usePerEvaluatorNotes ? '' : (s.evaluation_notes ?? ''),
            };
          }
        }
        setManualDraft(draft);
        setEvaluationDraft({
          strengths: myManagementEval?.strengths ?? (usePerEvaluatorNotes ? '' : d.appraisal.strengths ?? ''),
          weaknesses: myManagementEval?.weaknesses ?? (usePerEvaluatorNotes ? '' : d.appraisal.weaknesses ?? ''),
          managerRecommendations:
            myManagementEval?.managerRecommendations ??
            (usePerEvaluatorNotes ? '' : d.appraisal.manager_recommendations ?? ''),
        });
        setRejectReason('');
      } catch (e: unknown) {
        setDetail(null);
        const message = (e as Error)?.message ?? '';
        const forbidden =
          message.toLowerCase().includes('do not have access') ||
          message.toLowerCase().includes('forbidden');
        if (!options?.suppressForbidden || !forbidden) {
          showToast(message || 'Could not load appraisal detail', 'error');
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [showToast, userRole, rows, periodId, user?.id, redirectOwnSelfEvaluation, approverDirectory]
  );

  useEffect(() => {
    if (!detail?.appraisal || approverDirectory.size === 0) return;
    const evaluatorDraft = evaluatorDraftFromAppraisal(detail.appraisal, approverDirectory);
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
    const finalDraft = finalApproverDraftFromAppraisal(detail.appraisal, approverDirectory);
    setFinalApproverCandidates((prev) => {
      if (!finalDraft.candidates.length) return prev;
      const same =
        prev.length === finalDraft.candidates.length &&
        prev.every((row, i) => {
          const next = finalDraft.candidates[i];
          return (
            row.userId === next.userId &&
            row.name === next.name &&
            row.employeeCode === next.employeeCode &&
            row.departmentName === next.departmentName
          );
        });
      return same ? prev : finalDraft.candidates;
    });
  }, [detail?.appraisal, approverDirectory]);

  useEffect(() => {
    if (!detail?.appraisal) {
      setWizardStep(WORKFLOW_STEP.SELECT);
      return;
    }
    setWizardStep((prev) => {
      if (prev === WORKFLOW_STEP.SELECT) return prev;
      return workflowStepWithSelectOffset(
        suggestedAppraisalWizardStep(detail.appraisal.workflow_status, detail.appraisal.locked === 1)
      );
    });
  }, [detail?.appraisal.id, detail?.appraisal.workflow_status, detail?.appraisal.locked]);

  useEffect(() => {
    if (!deepLinkAppraisalId) return;
    let cancelled = false;
    void Api.appraisal
      .getAppraisal(deepLinkAppraisalId)
      .then((data) => {
        if (cancelled) return;
        const pid = String((data as AppraisalDetail).appraisal.period_id ?? '');
        if (pid) setPeriodId((current) => (current === pid ? current : pid));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deepLinkAppraisalId]);

  useEffect(() => {
    if (!deepLinkAppraisalId || loading) return;
    if (deepLinkHandledRef.current === deepLinkAppraisalId) return;
    const row = rows.find((r) => r.id === deepLinkAppraisalId);
    if (!row) return;
    if (redirectOwnSelfEvaluation(row)) {
      deepLinkHandledRef.current = deepLinkAppraisalId;
      return;
    }
    deepLinkHandledRef.current = deepLinkAppraisalId;
    setListPhase('review');
    void openDetail(deepLinkAppraisalId).then(() => {
      setWizardStep(
        workflowStepWithSelectOffset(
          suggestedAppraisalWizardStep(row.workflow_status, row.locked === 1)
        )
      );
    });
  }, [deepLinkAppraisalId, loading, rows, openDetail, redirectOwnSelfEvaluation]);

  const refreshAndGenerate = async () => {
    if (!periodId) {
      await loadAppraisals();
      return;
    }
    try {
      const res = (await Api.appraisal.bulkCreate(periodId)) as { created: number; skipped?: number };
      const skipped = res.skipped ?? 0;
      if (res.created > 0) {
        showToast(
          skipped > 0
            ? `Added ${res.created} new appraisals (${skipped} already in this period)`
            : `Generated ${res.created} appraisals`,
          'success'
        );
        setListPhase('review');
      }
      await loadAppraisals();
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Refresh failed', 'error');
      await loadAppraisals();
    }
  };

  const validateManualScores = (options?: { requireAllScores?: boolean }): boolean => {
    for (const [, v] of Object.entries(manualDraft)) {
      const scoreText = String(v.score ?? '').trim();
      if (!scoreText) {
        if (options?.requireAllScores) {
          showToast('Enter a score for each manual KPI component', 'error');
          return false;
        }
        continue;
      }
      const score = clampKpiScore(Number(scoreText));
      if (score < commentThreshold && !(v.comment ?? '').trim()) {
        showToast(`Comment required for scores below ${commentThreshold}`, 'error');
        return false;
      }
    }
    return true;
  };

  const saveScores = async (): Promise<boolean> => {
    if (!detail) return false;
    const requireAllScores = Boolean(
      detail.appraisal.canManagerEdit &&
        user?.id &&
        effectiveAssignedManagerUserId(detail.appraisal) === String(user.id)
    );
    if (!validateManualScores({ requireAllScores })) return false;
    const scores = Object.entries(manualDraft).map(([componentId, v]) => ({
      componentId,
      rawScore: clampKpiScore(Number(v.score)),
      comment: v.comment || null,
      evaluationNotes: v.notes || null,
    }));
    await Api.appraisal.saveScores(detail.appraisal.id, scores);
    return true;
  };

  const saveEvaluation = async (): Promise<boolean> => {
    if (!detail) return false;
    await Api.appraisal.saveEvaluation(detail.appraisal.id, evaluationDraft);
    return true;
  };

  const saveAllProgress = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const hasManual = detail.componentScores.some((s) => Number(s.auto_calculated) === 0);
      if (hasManual && canManagerEvaluate && wizardStep === WORKFLOW_STEP.MANAGER) {
        await saveScores();
      }
      if (
        evaluationDraft.strengths.trim() ||
        evaluationDraft.weaknesses.trim() ||
        evaluationDraft.managerRecommendations.trim()
      ) {
        await saveEvaluation();
      }
      showToast('Appraisal progress saved', 'success');
      await openDetail(detail.appraisal.id);
      await loadAppraisals();
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmFinalWorkflowAction = async (
    action: 'approve_final' | 'reject_final' | 'return_final'
  ) => {
    const options =
      action === 'approve_final'
        ? approveReviewPrompt('appraisal')
        : action === 'reject_final'
          ? rejectReviewPrompt('appraisal')
          : returnReviewPrompt('appraisal');
    const notes = asPromptReason(await prompt(options));
    if (notes === null) return;
    void workflowAction(action, notes.trim());
  };

  const workflowAction = async (action: string, notes?: string) => {
    if (!detail) return;
    const appraisalId = detail.appraisal.id;
    const evaluatorJustSubmitted =
      action === 'submit_to_hr' && Boolean(detail.appraisal.canManagerEdit);
    try {
      const shouldPersistManualScores =
        action === 'submit_to_hr' &&
        !locked &&
        detail.componentScores.some((s) => Number(s.auto_calculated) === 0);

      if (shouldPersistManualScores) {
        if (!validateManualScores({ requireAllScores: true })) return;
        await saveScores();
      }
      if (action === 'route_to_manager') {
        if (!evaluatorUserIds.length) {
          showToast('Select at least one evaluator before routing', 'warning');
          return;
        }
      }
      if (action === 'submit_for_final_approval') {
        if (!finalApproverUserIds.length) {
          showToast('Select at least one approver before submitting', 'warning');
          return;
        }
      }
      if (action === 'submit_to_hr') {
        if (
          evaluationDraft.strengths.trim() ||
          evaluationDraft.weaknesses.trim() ||
          evaluationDraft.managerRecommendations.trim()
        ) {
          await saveEvaluation();
        }
      }
      const updatedRow = (await Api.appraisal.workflow(appraisalId, action, {
        notes,
        assignedEvaluatorUserIds: action === 'route_to_manager' ? evaluatorUserIds : undefined,
        assignedFinalApproverUserIds:
          action === 'submit_for_final_approval' ? finalApproverUserIds : undefined,
        evaluation: action === 'submit_to_hr' ? evaluationDraft : undefined,
      })) as EmployeeAppraisal | undefined;
      // When an evaluator chain still has someone pending, submit_to_hr hands off
      // to the next evaluator rather than moving on to the employee self-evaluation.
      const handedOffToNextEvaluator =
        action === 'submit_to_hr' &&
        String(updatedRow?.workflow_status ?? '') === 'PENDING_MANAGER';
      showToast(
        handedOffToNextEvaluator
          ? 'Evaluation submitted — sent to the next evaluator'
          : evaluatorJustSubmitted
            ? isHrEvaluationView
              ? 'Evaluation submitted — employee self-evaluation is next'
              : 'Evaluation submitted — saved under Submitted for your records'
            : 'Workflow updated',
        'success'
      );
      await loadAppraisals();
      if (evaluatorJustSubmitted) {
        setDetail(null);
        setManualDraft({});
        setEvaluationDraft({ strengths: '', weaknesses: '', managerRecommendations: '' });
        if (!isHrEvaluationView) setListPhase('appraised');
      } else {
        await openDetail(appraisalId);
      }
      if (action === 'final_approve' || action === 'approve_final') setListPhase('appraised');
      if (action === 'reopen' && (userRole === Role.HR || userRole === Role.ADMIN)) {
        setListPhase('review');
      }
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Workflow action failed', 'error');
    }
  };

  const locked = detail?.appraisal?.locked === 1;
  const activeRow = detail
    ? {
        ...(rows.find((r) => r.id === detail.appraisal.id) ?? {}),
        ...detail.appraisal,
      }
    : null;
  const isAssignedManager = Boolean(
    user?.id &&
      activeRow &&
      effectiveAssignedManagerUserId(activeRow) &&
      String(user.id) === String(effectiveAssignedManagerUserId(activeRow))
  );
  const canRouteToManager =
    Boolean(activeRow?.canRouteToManager) &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  // The current assigned evaluator can evaluate regardless of their base role —
  // the backend (canManagerEdit) already scopes this to the person whose turn it is.
  const canManagerEvaluate = Boolean(activeRow?.canManagerEdit) && isAssignedManager;
  const canHrFinalize =
    Boolean(activeRow?.canHrFinalize) &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const canFinalApproverReview = Boolean(activeRow?.canFinalApproverReview);
  const canLegacyAdvance =
    Boolean(activeRow?.canLegacyAdvance) &&
    (userRole === Role.HR || userRole === Role.ADMIN);
  const canEditContent = canRouteToManager || canManagerEvaluate || canHrFinalize || canLegacyAdvance;
  const hrWaitingOnManager =
    detail?.appraisal.workflow_status === 'PENDING_MANAGER' &&
    (userRole === Role.HR || userRole === Role.ADMIN) &&
    !canManagerEvaluate;
  const managerSubmitted = Boolean(detail?.appraisal.manager_submitted_at);
  const evaluatorChain = useMemo(
    () => (detail ? resolveAppraisalEvaluators(detail.appraisal) : []),
    [detail]
  );
  const evaluatorScoreOptions = useMemo(
    () => (canManagerEvaluate && user?.id ? { evaluatorUserId: String(user.id) } : undefined),
    [canManagerEvaluate, user?.id]
  );
  const hasNextEvaluatorInChain = useMemo(() => {
    if (evaluatorChain.length <= 1) return false;
    const currentIdx = evaluatorChain.findIndex((ev) => ev.phase === 'current');
    return currentIdx >= 0 && currentIdx < evaluatorChain.length - 1;
  }, [evaluatorChain]);
  const employeeSubmitted = Boolean(detail?.appraisal.self_review_at);
  const employeeEvaluation = parseEmployeeEvaluationPayload(detail?.appraisal.outcome_payload_json);
  const employeePayloadScores = useMemo(() => {
    const scores = employeeEvaluation?.scores as
      | Array<{ componentId: string; rawScore: number }>
      | undefined;
    if (!scores?.length) return undefined;
    return Object.fromEntries(scores.map((s) => [String(s.componentId), Number(s.rawScore)]));
  }, [employeeEvaluation]);
  const employeeSelfWeightedTotal = useMemo(() => {
    if (!detail?.componentScores.length) return null;
    const computed = computeEmployeeSelfWeightedTotal(detail.componentScores, employeePayloadScores);
    if (computed != null) return computed;
    const fromPayload = employeeEvaluation?.weightedScore as number | undefined;
    return fromPayload != null ? Number(fromPayload) : null;
  }, [detail?.componentScores, employeeEvaluation?.weightedScore, employeePayloadScores]);
  const evaluatorRefs = useMemo(
    () =>
      evaluatorChain.map((ev) => ({
        userId: ev.userId,
        name: ev.name,
        submitted: ev.phase === 'submitted',
      })),
    [evaluatorChain]
  );
  const combinedWeightedScore = useMemo(() => {
    if (!detail?.componentScores.length || !managerSubmitted) return null;
    return computeCombinedWeightedTotal(detail.componentScores, managerSubmitted, evaluatorRefs);
  }, [detail?.componentScores, managerSubmitted, evaluatorRefs]);
  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === periodId) ?? null,
    [periodId, periods]
  );
  const hrWaitingOnEmployee =
    detail?.appraisal.workflow_status === 'PENDING_EMPLOYEE' &&
    (userRole === Role.HR || userRole === Role.ADMIN) &&
    !employeeSubmitted;
  const showManagerSection =
    canRouteToManager ||
    canManagerEvaluate ||
    hrWaitingOnManager ||
    managerSubmitted ||
    Boolean(detail?.appraisal.assigned_manager_user_id);
  const managerEvalReadOnly = !canManagerEvaluate && (managerSubmitted || hrWaitingOnManager);
  const scoresReadOnly =
    locked || (managerEvalReadOnly && !canHrFinalize) || (hrWaitingOnManager && !canHrFinalize);
  const scoringReviewStage: ComponentScoreStage =
    canManagerEvaluate && !scoresReadOnly
      ? 'manager'
      : managerSubmitted
        ? 'manager'
        : 'hr';
  const hrRoutedForEvaluation = Boolean(
    detail?.appraisal.routed_by_hr_user_id ||
      evaluatorChain.length ||
      detail?.appraisal.workflow_status === 'PENDING_MANAGER' ||
      detail?.appraisal.workflow_status === 'MANAGER_REVIEW'
  );
  const isHrRoutingStepView =
    wizardStep === WORKFLOW_STEP.SCORE && (canRouteToManager || hrRoutedForEvaluation);

  const kpiScoresEditable =
    !scoresReadOnly &&
    !canRouteToManager &&
    canManagerEvaluate &&
    wizardStep === WORKFLOW_STEP.MANAGER;

  const showScoreSummary = !(
    (wizardStep === WORKFLOW_STEP.MANAGER && !canManagerEvaluate && !managerSubmitted) ||
    isHrRoutingStepView
  );

  const displayWeightedScore = useMemo(() => {
    if (!detail?.componentScores.length) return detail?.appraisal.weighted_score ?? null;

    const components = detail.componentScores;
    const fallback = detail.appraisal.weighted_score ?? null;

    if (wizardStep === WORKFLOW_STEP.SCORE) {
      if (isHrRoutingStepView) return null;
      if (kpiScoresEditable && Object.keys(manualDraft).length > 0) {
        return computeDraftWeightedTotal(components, manualDraft, 'hr');
      }
      return computeStageWeightedTotal(components, 'hr');
    }

    if (wizardStep === WORKFLOW_STEP.MANAGER) {
      if (!canManagerEvaluate && !managerSubmitted) {
        return null;
      }
      if (canManagerEvaluate) {
        return computeDraftWeightedTotal(components, manualDraft, 'manager', evaluatorScoreOptions);
      }
      if (managerSubmitted) {
        return computeStageWeightedTotal(components, 'manager');
      }
      return computeStageWeightedTotal(components, 'hr');
    }

    if (wizardStep === WORKFLOW_STEP.EMPLOYEE) {
      if (employeeSubmitted) {
        return employeeSelfWeightedTotal ?? computeStageWeightedTotal(components, 'employee');
      }
      if (managerSubmitted) {
        return computeStageWeightedTotal(components, 'manager');
      }
      return computeStageWeightedTotal(components, 'hr');
    }

    if (wizardStep === WORKFLOW_STEP.HR || wizardStep === WORKFLOW_STEP.COMPLETE) {
      return combinedWeightedScore ?? fallback;
    }

    return fallback;
  }, [
    canManagerEvaluate,
    combinedWeightedScore,
    detail?.appraisal.weighted_score,
    detail?.componentScores,
    employeeSelfWeightedTotal,
    employeeSubmitted,
    evaluatorScoreOptions,
    isHrRoutingStepView,
    kpiScoresEditable,
    manualDraft,
    managerSubmitted,
    wizardStep,
  ]);

  const displayScoreCaption = useMemo(() => {
    if (wizardStep === WORKFLOW_STEP.SCORE) {
      return isHrRoutingStepView ? null : canRouteToManager ? null : 'HR weighted score';
    }
    if (wizardStep === WORKFLOW_STEP.MANAGER) {
      if (!canManagerEvaluate && !managerSubmitted) return null;
      return canManagerEvaluate ? 'Your weighted score' : 'Management weighted score';
    }
    if (wizardStep === WORKFLOW_STEP.EMPLOYEE) {
      return employeeSubmitted ? 'Employee self-score' : 'Manager weighted score';
    }
    if (wizardStep === WORKFLOW_STEP.HR || wizardStep === WORKFLOW_STEP.COMPLETE) {
      return 'Final combined score';
    }
    return null;
  }, [canManagerEvaluate, canRouteToManager, employeeSubmitted, isHrRoutingStepView, managerSubmitted, wizardStep]);

  const openMovementFromAppraisal = async (
    type: 'promotion' | 'salary_update' | 'transfer'
  ) => {
    if (!detail?.appraisal) return;
    let grades: Array<{ code: string; payRaiseRate?: number }> | null = null;
    try {
      const res = (await Api.analytics.getKpiGrades()) as {
        grades?: Array<{ code: string; payRaiseRate?: number }>;
      };
      grades = res.grades ?? null;
    } catch {
      /* use default rates in buildAppraisalMovementPrefill */
    }
    const prefill = buildAppraisalMovementPrefill(detail.appraisal, type, grades);
    if (!prefill) {
      showToast('This user is not linked to an employee record', 'error');
      return;
    }
    navigate(
      `/employees/movements/wizard?employeeId=${encodeURIComponent(prefill.employeeId)}&appraisalId=${encodeURIComponent(prefill.appraisalId)}&step=1`,
      {
        state: { appraisalPrefill: prefill },
      }
    );
  };

  const workflowActions = detail
    ? workflowActionsForStatus(detail.appraisal.workflow_status, locked)
    : { primary: null, secondary: [] };
  const primaryAction =
    canRouteToManager
      ? { action: 'route_to_manager', label: 'Next', variant: 'primary' as const }
      : canManagerEvaluate
        ? {
            action: 'submit_to_hr',
            label: 'Next',
            variant: 'primary' as const,
          }
        : canHrFinalize
          ? {
              action: 'submit_for_final_approval',
              label: 'Next',
              variant: 'primary' as const,
            }
          : canFinalApproverReview
            ? { action: 'approve_final', label: APPROVE_BUTTON_LABEL, variant: 'primary' as const }
            : canLegacyAdvance
            ? workflowActions.primary
              ? { ...workflowActions.primary, label: 'Next' }
              : null
            : null;
  const legacySecondaryActions = new Set([
    'supervisor_submit',
    'self_review',
    'manager_review',
    'hr_approve',
    'submit_to_hr',
    'route_to_manager',
    'final_approve',
    'submit_for_final_approval',
  ]);
  const visibleSecondaryActions =
    canLegacyAdvance
      ? workflowActions.secondary.filter((a) => !legacySecondaryActions.has(a.action))
      : [];
  const canHrReject =
    (userRole === Role.HR || userRole === Role.ADMIN) &&
    !hrWaitingOnManager &&
    (canRouteToManager || canHrFinalize || canLegacyAdvance);
  const showFooterSave =
    !locked &&
    !hrWaitingOnManager &&
    !hrWaitingOnEmployee &&
    !canRouteToManager &&
    (canManagerEvaluate ||
      canHrFinalize ||
      (canEditContent && !canManagerEvaluate && !canHrFinalize));
  const saveButtonLabel = canManagerEvaluate ? 'Save draft' : 'Save progress';
  const footerHint = locked
    ? null
    : hrWaitingOnManager
      ? `Waiting for ${activeRow?.assignedManagerName ?? 'the assigned manager'} to submit their evaluation.`
      : hrWaitingOnEmployee
        ? 'Waiting for the employee to complete self-evaluation before HR can finalize.'
        : canRouteToManager
          ? wizardStep === WORKFLOW_STEP.SCORE
            ? 'Select one or more management evaluators in order, then route for evaluation.'
            : 'Management evaluators are evaluating this appraisal.'
          : wizardStep === WORKFLOW_STEP.SCORE && hrRoutedForEvaluation
            ? hrWaitingOnManager
              ? `Routed to management evaluation — waiting for ${activeRow?.currentEvaluatorName ?? activeRow?.assignedManagerName ?? 'the current evaluator'} to submit.`
              : 'Management evaluators were assigned in order below. Continue on the Management step to track evaluation progress.'
          : canManagerEvaluate
            ? hasNextEvaluatorInChain
              ? `Complete your KPI scores and evaluation notes, then submit to the next evaluator (${evaluatorChain.find((ev) => ev.phase === 'queued')?.name ?? 'next in chain'}).`
              : evaluatorChain.length > 1
                ? 'You are the final management evaluator — submit when your scores and notes are complete to open employee self-evaluation.'
                : 'Complete your KPI scores and evaluation notes, then submit for employee self-evaluation when ready.'
            : canHrFinalize
              ? 'Review combined scores, select approvers in order, then submit for final approval.'
              : canFinalApproverReview
              ? 'You are the current approver — review the evaluation below, then approve, reject, or return to HR.'
              : detail?.appraisal.workflow_status === 'PENDING_FINAL_APPROVAL'
                ? activeRow?.currentApproverName
                  ? `Waiting for ${activeRow.currentApproverName} to approve (step ${(activeRow.approvalProgress?.approved ?? 0) + 1} of ${activeRow.approvalProgress?.total ?? activeRow.assignedFinalApprovers?.length ?? 1}).`
                  : 'Waiting for the current approver in the chain to sign off.'
                : workflowStatusHint(detail?.appraisal.workflow_status ?? 'DRAFT', locked);

  const wizardSteps = useMemo(
    () =>
      withSelectStep(
        detail
          ? appraisalWizardStepsForStatus(detail.appraisal.workflow_status)
          : APPRAISAL_WIZARD_STEPS
      ),
    [detail?.appraisal.workflow_status]
  );
  const suggestedWizardStep = useMemo(
    () =>
      detail
        ? workflowStepWithSelectOffset(
            suggestedAppraisalWizardStep(detail.appraisal.workflow_status, locked)
          )
        : WORKFLOW_STEP.SELECT,
    [detail?.appraisal.workflow_status, locked]
  );
  const maxReachableWizardStep = useMemo(
    () =>
      detail
        ? workflowStepWithSelectOffset(
            maxReachableAppraisalWizardStep(detail.appraisal.workflow_status, locked)
          )
        : WORKFLOW_STEP.SELECT,
    [detail?.appraisal.workflow_status, locked]
  );
  const onActiveWizardStep = wizardStep === suggestedWizardStep;
  const actionWizardStep = useMemo(() => {
    if (!detail) return WORKFLOW_STEP.SELECT;
    if (canRouteToManager) return WORKFLOW_STEP.SCORE;
    if (canManagerEvaluate) return WORKFLOW_STEP.MANAGER;
    if (hrWaitingOnEmployee) return WORKFLOW_STEP.EMPLOYEE;
    if (canHrFinalize) return WORKFLOW_STEP.HR;
    if (canFinalApproverReview) return WORKFLOW_STEP.HR;
    if (detail.appraisal.workflow_status === 'PENDING_FINAL_APPROVAL') return WORKFLOW_STEP.HR;
    if (locked) return WORKFLOW_STEP.COMPLETE;
    return suggestedWizardStep;
  }, [
    canRouteToManager,
    canManagerEvaluate,
    canHrFinalize,
    canFinalApproverReview,
    detail,
    hrWaitingOnEmployee,
    locked,
    suggestedWizardStep,
  ]);
  const onActionWizardStep = wizardStep === actionWizardStep;
  const displayFooterHint =
    onActionWizardStep ? footerHint : (wizardSteps[wizardStep]?.description ?? footerHint);
  const canWizardNext =
    wizardStep < maxReachableWizardStep && wizardStep < wizardSteps.length - 1;
  const showWizardNextButton = wizardStep < wizardSteps.length - 1;

  const handleWizardNext = useCallback(() => {
    if (saving) return;

    if (wizardStep === WORKFLOW_STEP.SELECT) {
      if (!detail || detailLoading) {
        showToast('Select an employee from the list to continue.', 'warning');
        return;
      }
      setWizardStep(
        suggestedWizardStep > WORKFLOW_STEP.SELECT ? suggestedWizardStep : WORKFLOW_STEP.SCORE
      );
      return;
    }

    if (onActionWizardStep && !locked) {
      if (hrWaitingOnManager || hrWaitingOnEmployee) {
        showToast(
          footerHint ?? 'Waiting for another party to complete their step before you can continue.',
          'info'
        );
        return;
      }
      if (
        detail?.appraisal.workflow_status === 'PENDING_FINAL_APPROVAL' &&
        !canFinalApproverReview
      ) {
        showToast(footerHint ?? 'Waiting for approvers to sign off.', 'info');
        return;
      }
      if (primaryAction) {
        if (primaryAction.action === 'approve_final') {
          void confirmFinalWorkflowAction('approve_final');
          return;
        }
        void workflowAction(primaryAction.action, primaryAction.notes);
        return;
      }
    }

    if (canWizardNext) {
      setWizardStep((s) => Math.min(s + 1, maxReachableWizardStep));
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
    saving,
    wizardStep,
    detail,
    detailLoading,
    suggestedWizardStep,
    onActionWizardStep,
    locked,
    hrWaitingOnManager,
    hrWaitingOnEmployee,
    footerHint,
    displayFooterHint,
    primaryAction,
    canFinalApproverReview,
    canWizardNext,
    maxReachableWizardStep,
    showToast,
    confirmFinalWorkflowAction,
    workflowAction,
  ]);

  const renderKpiScoresTable = (editable: boolean, scoreStage: ComponentScoreStage) => {
    if (!detail) return null;
    const scoreOptions = scoreStage === 'manager' ? evaluatorScoreOptions : undefined;
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[28rem]">
          <thead>
            <tr className="text-xs uppercase text-slate-500 border-b">
              <th className="py-2 text-left pl-1">Component</th>
              <th className="py-2 text-right">Score</th>
              <th className="py-2 text-right">Weight</th>
              <th className="py-2 text-right pr-1">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {detail.componentScores.map((s) => {
              const stageScore = resolveStageComponentScore(s, scoreStage, scoreOptions);
              const draftScore =
                manualDraft[s.component_id]?.score ??
                (stageScore != null ? String(stageScore) : '');
              const displayScore = editable
                ? draftScore.trim() === ''
                  ? null
                  : clampKpiScore(Number(draftScore))
                : stageScore;
              const displayWeighted =
                displayScore == null
                  ? null
                  : roundComponentWeightedScore(displayScore, s.weightPercent);
              const needsComment =
                Number(s.auto_calculated) === 0 &&
                displayScore != null &&
                displayScore < commentThreshold;
              return (
                <React.Fragment key={s.id}>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pl-1">
                      <span className="inline-flex items-center flex-wrap gap-1">
                        <span className="font-medium">{s.componentName}</span>
                        {Number(s.auto_calculated) === 1 ? (
                          <>
                            <Badge variant="success" className="text-[10px]">
                              Auto
                            </Badge>
                            {(s.autoMetric === 'ATTENDANCE' || s.autoMetric === 'TASK_COMPLETION') && (
                              <AutomaticKpiCalculationHelp
                                userId={detail.appraisal.user_id}
                                periodId={detail.appraisal.period_id}
                                metric={s.autoMetric}
                                componentName={s.componentName}
                                periodLabel={detail.appraisal.periodName}
                              />
                            )}
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {Number(s.auto_calculated) === 1 ? (
                        <span className="tabular-nums">{formatAppraisalScore(stageScore)}</span>
                      ) : editable ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          className={`${inputClass} w-[4.5rem] text-right tabular-nums`}
                          value={draftScore}
                          onChange={(e) => {
                            const raw = e.target.value;
                            let nextScore = raw;
                            if (raw.trim() !== '') {
                              const n = Number(raw);
                              nextScore = Number.isFinite(n) ? String(clampKpiScore(n)) : '';
                            }
                            setManualDraft((prev) => ({
                              ...prev,
                              [s.component_id]: {
                                ...prev[s.component_id],
                                score: nextScore,
                                comment: prev[s.component_id]?.comment ?? '',
                                notes: prev[s.component_id]?.notes ?? '',
                              },
                            }));
                          }}
                          onBlur={(e) => {
                            if (e.target.value.trim() === '') return;
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const clamped = String(clampKpiScore(n));
                            if (clamped === e.target.value) return;
                            setManualDraft((prev) => ({
                              ...prev,
                              [s.component_id]: {
                                ...prev[s.component_id],
                                score: clamped,
                                comment: prev[s.component_id]?.comment ?? '',
                                notes: prev[s.component_id]?.notes ?? '',
                              },
                            }));
                          }}
                        />
                      ) : (
                        <span className="tabular-nums">
                          {stageScore == null ? '—' : formatAppraisalScore(stageScore)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-slate-500 tabular-nums">{s.weightPercent}%</td>
                    <td className="py-2 text-right font-semibold tabular-nums pr-1">
                      {displayWeighted == null ? '—' : formatAppraisalScore(displayWeighted, 2)}
                    </td>
                  </tr>
                  {editable && Number(s.auto_calculated) === 0 && needsComment ? (
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-950/20">
                      <td colSpan={4} className="py-2 px-1">
                        <label className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                          {s.componentName} — comment required (score below {commentThreshold})
                        </label>
                        <textarea
                          className={`${inputClass} mt-1 w-full text-sm`}
                          rows={2}
                          value={manualDraft[s.component_id]?.comment ?? ''}
                          onChange={(e) =>
                            setManualDraft((prev) => ({
                              ...prev,
                              [s.component_id]: {
                                score: prev[s.component_id]?.score ?? (stageScore != null ? String(stageScore) : ''),
                                comment: e.target.value,
                                notes: prev[s.component_id]?.notes ?? '',
                              },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderEmployeeSelfScoresTable = () => {
    if (!detail?.componentScores.length) return null;
    let tableWeightedSum = 0;
    let hasScores = false;
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[28rem]">
          <thead>
            <tr className="text-xs uppercase text-slate-500 border-b">
              <th className="py-2 text-left pl-1">Component</th>
              <th className="py-2 text-right">Self score</th>
              <th className="py-2 text-right">Weight</th>
              <th className="py-2 text-right pr-1">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {detail.componentScores.map((s) => {
              const selfScore = resolveEmployeeSelfScore(s, employeePayloadScores);
              const weighted =
                selfScore != null ? roundComponentWeightedScore(selfScore, s.weightPercent) : null;
              if (weighted != null) {
                tableWeightedSum += weighted;
                hasScores = true;
              }
              return (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pl-1 font-medium">{s.componentName}</td>
                  <td className="py-2 text-right tabular-nums">
                    {selfScore != null ? formatAppraisalScore(selfScore) : '—'}
                  </td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">{s.weightPercent}%</td>
                  <td className="py-2 text-right font-semibold tabular-nums pr-1">
                    {weighted != null ? formatAppraisalScore(weighted, 2) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {hasScores ? (
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700">
                <td colSpan={3} className="py-2 pl-1 text-right text-xs font-semibold uppercase text-slate-500">
                  Employee overall
                </td>
                <td className="py-2 text-right font-bold tabular-nums text-primary-600 pr-1">
                  {formatAppraisalScore(
                    employeeSelfWeightedTotal ?? Math.round(tableWeightedSum * 100) / 100
                  )}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  };

  const renderCombinedEvaluatorReviewTable = () => {
    if (!detail?.componentScores.length) return null;
    return (
      <CombinedEvaluatorScoresTable
        componentScores={detail.componentScores}
        evaluators={evaluatorRefs}
        description={
          employeeSubmitted
            ? 'Per-component average from all management evaluators and the employee self-evaluation.'
            : 'Per-component average from all management evaluators who have scored this appraisal.'
        }
      />
    );
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
      <div className="space-y-3">
        {detail?.appraisal.routed_at ? (
          <p className="text-xs text-slate-500">
            Routed for management evaluation
            {detail.appraisal.routed_at
              ? ` on ${new Date(detail.appraisal.routed_at).toLocaleString()}`
              : ''}
            .
          </p>
        ) : null}
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
                      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                      {phaseLabel}
                    </span>
                  }
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderScoringReviewSection = (editable: boolean, scoreStage: ComponentScoreStage) => {
    if (!detail?.componentScores.length) return null;
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {editable ? 'KPI scores' : 'Scoring review'}
        </p>
        <p className="text-xs text-slate-500">
          {editable
            ? evaluatorChain.length > 1
              ? `Enter your own scores for each component. Your scores will be averaged with other management evaluators. Comments are required below ${commentThreshold} points.`
              : `Update manual component scores. Comments are required below ${commentThreshold} points.`
            : scoreStage === 'hr'
              ? 'HR scores for this appraisal period.'
              : scoreStage === 'manager'
                ? evaluatorChain.length > 1
                  ? 'Averaged management evaluator scores for this appraisal period.'
                  : 'Management evaluator scores for this appraisal period.'
                : 'Combined scores from all evaluators.'}
        </p>
        {renderKpiScoresTable(editable, scoreStage)}
      </div>
    );
  };

  if (!loading && !periods.length) {
    return (
      <Card className="py-12 text-center">
        <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-800 dark:text-slate-200">Set up your first appraisal period</p>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          Define a period and KPI weights in Configuration, then return here to generate and score
          appraisals.
        </p>
        <Button className="mt-4" size="sm" onClick={() => navigate('/performance?tab=kpi-settings')}>
          <Settings2 className="w-4 h-4 mr-1" />
          Open configuration
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ConfirmDialogHost />
      {wizardStep === WORKFLOW_STEP.SELECT ? (
        <div className="relative surface-card overflow-hidden">
          <RulesConfigHelp
            help="kpi.appraisalWorkflow"
            className="absolute top-3 right-3 z-10"
          />
          <div className="h-1 bg-gradient-to-r from-primary-500 via-primary-400 to-teal-400" />

          <div className="surface-card-pad border-b border-slate-100 dark:border-slate-800 pr-10">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="p-3 rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-500/25 shrink-0">
                    <ClipboardList className="w-6 h-6" aria-hidden />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                      KPI appraisal workflow
                    </h3>
                  </div>
                </div>

                <AppraisalPeriodToolbar
                  id="kpi-period-select"
                  periods={periods}
                  periodId={periodId}
                  className="lg:shrink-0 lg:max-w-md"
                  onPeriodChange={(id) => {
                    setPeriodId(id);
                    setWizardStep(WORKFLOW_STEP.SELECT);
                  }}
                  trailing={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshAndGenerate()}
                      disabled={!periodId}
                      aria-label="Refresh appraisals and generate missing"
                      title="Refresh list and generate missing appraisals"
                      className="h-[3.25rem] w-[3.25rem] shrink-0 rounded-xl p-0"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  }
                />
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-0.5">
                  Filter by status
                </p>
                <div className={`grid gap-2.5 ${isHrEvaluationView ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                <KpiWorkflowStatPill
                  label="Total"
                  value={rows.length}
                  active={listPhase === 'all'}
                  onClick={() => handleListPhaseChange('all')}
                />
                <KpiWorkflowStatPill
                  label={isHrEvaluationView ? 'In review' : 'Needs evaluation'}
                  value={reviewRows.length}
                  tone="amber"
                  active={listPhase === 'review'}
                  onClick={() => handleListPhaseChange('review')}
                />
                <KpiWorkflowStatPill
                  label={isHrEvaluationView ? 'Awaiting movement' : 'Submitted'}
                  value={appraisedRows.length}
                  tone="violet"
                  active={listPhase === 'appraised'}
                  onClick={() => handleListPhaseChange('appraised')}
                />
                {isHrEvaluationView ? (
                  <KpiWorkflowStatPill
                    label="Complete"
                    value={movementRows.length}
                    tone="emerald"
                    active={listPhase === 'movement'}
                    onClick={() => handleListPhaseChange('movement')}
                  />
                ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="surface-card-pad">
            <WorkflowSelectStep
          fullWidth
          layout="detail"
          itemLabel="employees"
          resetKey={`${listPhase}:${periodId}`}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          rows={filteredPhaseRows}
          loading={loading}
          selectedKey={null}
          selectedIdentity={null}
          getKey={(r) => r.id}
          getIdentity={(r) => employeeListIdentityFromAppraisalRow(r)}
          onSelect={(r) => {
            if (r === null) return;
            const targetStep = workflowStepWithSelectOffset(
              suggestedAppraisalWizardStep(r.workflow_status, r.locked === 1)
            );
            void openDetail(r.id).then(() =>
              setWizardStep(
                targetStep > WORKFLOW_STEP.SELECT ? targetStep : WORKFLOW_STEP.SCORE
              )
            );
          }}
          countLabel={`${filteredPhaseRows.length} in ${phaseTitle.toLowerCase()}`}
          pickHint="Tap an employee to open their evaluation"
          emptyMessage={
            searchQuery.trim() ? 'No employees match your search.' : phaseEmpty
          }
          queueFilter={kpiQueueFilter}
          renderCard={(r) => {
            const meta = workflowStatusBadgeMeta(r.workflow_status);
            const done = r.locked === 1;
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
                      data={employeeListIdentityFromAppraisalRow(r)}
                      avatarClassName="w-11 h-11 shrink-0 ring-2 ring-white dark:ring-slate-800 shadow-sm"
                      nameExtra={
                        <StatusLabel
                          status={r.workflow_status}
                          context="appraisal"
                          label={meta.label}
                          size="sm"
                        />
                      }
                    />

                    <OffboardingWorkflowProgress
                      variant="pipeline"
                      widthClassName="max-w-2xl"
                      ariaLabel="Appraisal progress"
                      steps={buildAppraisalPipelineSteps(r.workflow_status, r.locked === 1)}
                    />

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        <span className="text-slate-400">Period:</span>{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {r.periodName ?? periods.find((p) => p.id === periodId)?.name ?? '—'}
                        </span>
                      </span>
                      {r.final_grade ? (
                        <>
                          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">·</span>
                          <span>
                            <span className="text-slate-400">Grade:</span>{' '}
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {r.final_grade}
                            </span>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2 shrink-0 lg:min-w-[9rem]">
                    <div className="text-center sm:text-right lg:text-right">
                      <p className="text-2xl font-bold text-primary-600 tabular-nums leading-none">
                        {formatAppraisalScore(r.weighted_score)}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Weighted score</p>
                    </div>
                    <span className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
                      {done ? 'View' : 'Start evaluation'}
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
      ) : (
      <WorkflowWizardShell
        header={
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
                KPI appraisal workflow
              </h2>
              {(locked || detail) && (
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                    locked
                      ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {locked ? 'Complete' : 'In progress'}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {detail
                ? `${detail.appraisal.employeeCode ?? detail.appraisal.user_id} · ${detail.appraisal.employeeName ?? 'Employee'}`
                : `${phaseTitle} — select an employee to begin`}
            </p>
            </div>
          </div>
        }
        steps={wizardSteps}
        currentStep={wizardStep}
        maxReachableStep={maxReachableWizardStep}
        onStepChange={setWizardStep}
        stepHeader={{
          title: wizardSteps[wizardStep]?.label ?? '',
          description: wizardSteps[wizardStep]?.description,
        }}
        footer={
          !locked ? (
            <WizardFooterLayout
              left={
                wizardStep > WORKFLOW_STEP.SELECT ? (
                  <Button
                    variant="ghost"
                    size="sm"
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
                    {onActionWizardStep && showFooterSave && !hrWaitingOnManager ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-auto"
                        disabled={saving}
                        onClick={() => void saveAllProgress()}
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        {saveButtonLabel}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 w-auto shadow-md shadow-primary-500/20 px-5"
                      disabled={saving}
                      onClick={handleWizardNext}
                    >
                      {onActionWizardStep && primaryAction?.action === 'approve_final'
                        ? APPROVE_BUTTON_LABEL
                        : 'Next'}
                      {!(onActionWizardStep && primaryAction?.action === 'approve_final') ? (
                        <ChevronRight className="w-4 h-4 ml-2" />
                      ) : null}
                    </Button>
                    {onActionWizardStep && !hrWaitingOnManager
                      ? visibleSecondaryActions.map((a) => (
                          <Button
                            key={a.action}
                            size="sm"
                            variant="outline"
                            className="h-9 w-auto"
                            onClick={() => void workflowAction(a.action, a.notes)}
                          >
                            {a.label}
                          </Button>
                        ))
                      : null}
                  </>
                ) : null
              }
            />
          ) : (
            <WizardFooterLayout
              left={
                wizardStep > WORKFLOW_STEP.SELECT ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setWizardStep((s) => Math.max(WORKFLOW_STEP.SELECT, s - 1))}
                    className="h-9 px-2.5 text-slate-600 dark:text-slate-300"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1.5" />
                    Back
                  </Button>
                ) : (
                  <Badge variant="warning" className="text-xs">
                    <Lock className="w-3 h-3 mr-1 inline" />
                    Locked
                  </Badge>
                )
              }
              right={
                wizardStep < wizardSteps.length - 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 w-auto shadow-md shadow-primary-500/20 px-5"
                    onClick={() => setWizardStep((s) => s + 1)}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                ) : null
              }
            />
          )
        }
      >
        {detailLoading ? (
          <ContentSkeleton layout="form" rows={1} />
        ) : !detail ? (
          <p className="text-sm text-slate-500 text-center py-12">
            Select an employee on the Employee step to continue.
          </p>
        ) : (
          <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                  <div className="min-w-0 flex-1">
                    <EmployeeListIdentityBlock
                      data={employeeListIdentityFromAppraisalRow(detail.appraisal)}
                      avatarClassName="h-10 w-10 shrink-0"
                    />
                    <p className="text-sm text-slate-500 mt-2">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Period:</span>{' '}
                      {detail.appraisal.periodName ?? selectedPeriod?.name ?? '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(() => {
                        const meta = workflowStatusBadgeMeta(detail.appraisal.workflow_status);
                        return (
                          <StatusLabel
                            status={detail.appraisal.workflow_status}
                            context="appraisal"
                            label={meta.label}
                            size="sm"
                          />
                        );
                      })()}
                      {locked ? (
                        <Badge variant="warning" className="text-[10px]">
                          <Lock className="w-3 h-3 mr-0.5 inline" />
                          Locked
                        </Badge>
                      ) : null}
                    </div>
                    {detail.appraisal.rejection_reason ? (
                      <p className="text-xs text-red-600 mt-2">{detail.appraisal.rejection_reason}</p>
                    ) : null}
                  </div>
                  {showScoreSummary ? (
                  <div className="text-right shrink-0">
                    <p className="text-3xl font-bold text-primary-600 tabular-nums">
                      {formatAppraisalScore(displayWeightedScore)}
                    </p>
                    {displayScoreCaption ? (
                      <p className="text-[11px] text-slate-400">{displayScoreCaption}</p>
                    ) : null}
                    <p className="text-sm text-slate-500">
                      Grade <strong>{detail.appraisal.final_grade ?? '—'}</strong>
                      {detail.appraisal.ranking_position != null
                        ? ` · Rank #${detail.appraisal.ranking_position}`
                        : ''}
                    </p>
                    {detail.appraisal.recommendation ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 max-w-[14rem] ml-auto">
                        {detail.appraisal.recommendation}
                      </p>
                    ) : null}
                  </div>
                  ) : null}
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
                          ? 'These evaluators were assigned by HR to score this employee in order.'
                          : wizardSteps[WORKFLOW_STEP.SCORE].description
                    }
                  >
                    {canRouteToManager ? (
                      <ApproverApprovalField
                        required
                        value={evaluatorUserIds}
                        selected={evaluatorCandidates}
                        defaultExpandedDepartmentId={detail.appraisal.departmentId ?? null}
                        onChange={(userIds, candidates) => {
                          setEvaluatorUserIds(userIds);
                          setEvaluatorCandidates(candidates);
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
                      hrWaitingOnManager
                        ? 'HR has routed this case — waiting on the assigned evaluator.'
                        : canManagerEvaluate
                          ? hasNextEvaluatorInChain
                            ? 'Score KPIs and add your evaluation notes, then submit to the next evaluator in the chain.'
                            : evaluatorChain.length > 1
                              ? 'You are the final management evaluator. Submit when your scores and notes are complete to open employee self-evaluation.'
                              : 'Score KPIs and add your evaluation notes, then submit for employee self-evaluation.'
                          : 'Management evaluators score KPIs and submit their evaluation in order.'
                    }
                  >
                    <div className="space-y-5">
                      {showManagerSection && (canManagerEvaluate || hrWaitingOnManager || evaluatorChain.length) ? (
                        <div className="space-y-3">
                          {renderEvaluatorChainPanel()}
                          {hrWaitingOnManager && !managerSubmitted ? (
                            <p className="text-xs text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                              Waiting for{' '}
                              <span className="font-medium">
                                {detail.appraisal.currentEvaluatorName ??
                                  activeRow?.assignedManagerName ??
                                  'the assigned evaluator'}
                              </span>{' '}
                              to submit their evaluation.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {canManagerEvaluate || managerSubmitted
                        ? renderScoringReviewSection(
                            Boolean(canManagerEvaluate && !scoresReadOnly),
                            scoringReviewStage
                          )
                        : null}

                      {(canManagerEvaluate || managerSubmitted || canHrFinalize) && !hrWaitingOnManager ? (
                        <div className="space-y-3 pt-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Evaluation notes
                          </p>
                          {canManagerEvaluate && evaluatorChain.length > 1 ? (
                            <p className="text-xs text-slate-500">
                              Your notes are saved separately for this evaluation. Other evaluators
                              cannot see what you write here.
                            </p>
                          ) : null}
                          <div>
                            <label className="text-xs text-slate-600">Strengths</label>
                            <textarea
                              className={`${inputClass} mt-1 w-full`}
                              rows={2}
                              readOnly={managerEvalReadOnly && !canHrFinalize}
                              value={evaluationDraft.strengths}
                              onChange={(e) =>
                                setEvaluationDraft((p) => ({ ...p, strengths: e.target.value }))
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-600">Weaknesses / improvement areas</label>
                            <textarea
                              className={`${inputClass} mt-1 w-full`}
                              rows={2}
                              readOnly={managerEvalReadOnly && !canHrFinalize}
                              value={evaluationDraft.weaknesses}
                              onChange={(e) =>
                                setEvaluationDraft((p) => ({ ...p, weaknesses: e.target.value }))
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-600">Recommendations</label>
                            <textarea
                              className={`${inputClass} mt-1 w-full`}
                              rows={2}
                              readOnly={managerEvalReadOnly && !canHrFinalize}
                              value={evaluationDraft.managerRecommendations}
                              onChange={(e) =>
                                setEvaluationDraft((p) => ({
                                  ...p,
                                  managerRecommendations: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </WizardSectionCard>
                ) : null}

                {wizardStep === WORKFLOW_STEP.EMPLOYEE ? (
                  <WizardSectionCard
                    icon={wizardSteps[WORKFLOW_STEP.EMPLOYEE].icon as React.ComponentType<{ className?: string }>}
                    title="Employee self-evaluation"
                    description="The employee reflects on their performance after the manager review."
                  >
                    <div className="space-y-4">
                      {employeeSubmitted ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Employee self-scores
                          </p>
                          <p className="text-xs text-slate-500">
                            Scores the employee gave themselves for this appraisal period. These are
                            averaged with HR and manager scores at final evaluation.
                          </p>
                          {renderEmployeeSelfScoresTable()}
                        </div>
                      ) : hrWaitingOnEmployee ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Employee self-scores
                          </p>
                          <p className="text-xs text-slate-500">
                            Waiting for the employee to submit their self-evaluation from{' '}
                            <strong>Performance</strong> under Self Service.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Employee self-evaluation opens after the manager submits their review.
                        </p>
                      )}

                      {hrWaitingOnEmployee ? (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-4 text-sm text-amber-900 dark:text-amber-100">
                          <p className="font-medium">Waiting for employee self-evaluation</p>
                          <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
                            HR can finalize only after both manager and employee submit.
                          </p>
                        </div>
                      ) : employeeSubmitted ? (
                        <div className="space-y-3">
                          {(employeeEvaluation?.strengths as string) ||
                          (employeeEvaluation?.weaknesses as string) ||
                          detail.appraisal.self_review_notes ? (
                            <>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Employee feedback
                              </p>
                              {(employeeEvaluation?.strengths as string) ? (
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                  <span className="font-medium text-slate-500">Strengths: </span>
                                  {String(employeeEvaluation?.strengths ?? '')}
                                </p>
                              ) : null}
                              {employeeEvaluation?.weaknesses ? (
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                  <span className="font-medium text-slate-500">Areas for improvement: </span>
                                  {String(employeeEvaluation.weaknesses)}
                                </p>
                              ) : null}
                              {detail.appraisal.self_review_notes ? (
                                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                                  {detail.appraisal.self_review_notes}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </WizardSectionCard>
                ) : null}

                {wizardStep === WORKFLOW_STEP.HR ? (
                  <WizardSectionCard
                    icon={wizardSteps[WORKFLOW_STEP.HR].icon as React.ComponentType<{ className?: string }>}
                    title={wizardSteps[WORKFLOW_STEP.HR].label}
                    description={wizardSteps[WORKFLOW_STEP.HR].description}
                  >
                    <div className="space-y-4">
                      {renderCombinedEvaluatorReviewTable()}

                      {managerSubmitted || evaluationDraft.strengths || evaluationDraft.weaknesses ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Manager feedback
                          </p>
                          {evaluationDraft.strengths ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Strengths: </span>
                              {evaluationDraft.strengths}
                            </p>
                          ) : null}
                          {evaluationDraft.weaknesses ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Weaknesses: </span>
                              {evaluationDraft.weaknesses}
                            </p>
                          ) : null}
                          {evaluationDraft.managerRecommendations ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Recommendations: </span>
                              {evaluationDraft.managerRecommendations}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No manager evaluation submitted yet.</p>
                      )}
                      {employeeSubmitted ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Employee self-evaluation
                          </p>
                          <p className="text-xs text-slate-500">
                            Component scores average every management evaluator who scored, plus the
                            employee self-evaluation when submitted. Click{' '}
                            <span className="font-semibold">!</span> on an average for the full
                            breakdown.
                          </p>
                          {(employeeEvaluation?.strengths as string) ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Strengths: </span>
                              {String(employeeEvaluation?.strengths)}
                            </p>
                          ) : null}
                          {employeeEvaluation?.weaknesses ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Areas for improvement: </span>
                              {String(employeeEvaluation.weaknesses)}
                            </p>
                          ) : null}
                          {detail.appraisal.self_review_notes ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                              {detail.appraisal.self_review_notes}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {canHrFinalize && !locked ? (
                        <ApproverApprovalField
                          required
                          value={finalApproverUserIds}
                          selected={finalApproverCandidates}
                          defaultExpandedDepartmentId={detail.appraisal.departmentId ?? null}
                          onChange={(userIds, candidates) => {
                            setFinalApproverUserIds(userIds);
                            setFinalApproverCandidates(candidates);
                          }}
                          label="Final approvers"
                          hint="Assign one or more approvers. Top of the list approves first, then each person below in order."
                          modalTitle="Select final approvers"
                        />
                      ) : null}
                      {detail.appraisal.workflow_status === 'PENDING_FINAL_APPROVAL' ? (
                        <AppraisalApprovalTracker appraisal={detail.appraisal} viewerUserId={user?.id} />
                      ) : null}
                    </div>
                  </WizardSectionCard>
                ) : null}

                {wizardStep === WORKFLOW_STEP.HR && canFinalApproverReview && !locked ? (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Button
                      size="sm"
                      onClick={() => void confirmFinalWorkflowAction('approve_final')}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void confirmFinalWorkflowAction('return_final')}
                    >
                      Return
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 dark:border-red-900"
                      onClick={() => void confirmFinalWorkflowAction('reject_final')}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                ) : null}

                {wizardStep === WORKFLOW_STEP.COMPLETE ? (
                  <WizardSectionCard
                    icon={wizardSteps[WORKFLOW_STEP.COMPLETE].icon as React.ComponentType<{ className?: string }>}
                    title={locked ? 'Appraisal complete' : 'Next steps'}
                    description={
                      locked
                        ? 'This appraisal is locked. Record a promotion or pay change if needed.'
                        : 'After HR approval, you can record employee movements from here.'
                    }
                  >
                    {canRecordMovement && detail.appraisal ? (
                      <AppraisalMovementFollowUp
                        appraisal={detail.appraisal}
                        linkedMovements={detail.linkedMovements ?? []}
                        onRecordMovement={openMovementFromAppraisal}
                      />
                    ) : (
                      <p className="text-sm text-slate-500">
                        {locked
                          ? 'No movement permissions for your role.'
                          : 'Complete HR approval to unlock movement follow-up.'}
                      </p>
                    )}
                  </WizardSectionCard>
                ) : null}
            {canHrReject && !locked && wizardStep !== WORKFLOW_STEP.SELECT ? (
              <details className="group text-sm mt-4">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 list-none">
                  <span className="inline-flex items-center gap-1">
                    <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                    Reject appraisal
                  </span>
                </summary>
                <div className="mt-2 flex flex-wrap items-end gap-2 pl-5">
                  <input
                    className={`${inputClass} flex-1 min-w-[10rem] text-sm`}
                    placeholder="Rejection reason (required)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 dark:border-red-900"
                    disabled={!rejectReason.trim()}
                    onClick={() => {
                      const reason = rejectReason.trim();
                      if (!reason) return;
                      void workflowAction('reject', reason);
                    }}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </details>
            ) : null}
          </>
        )}
      </WorkflowWizardShell>
      )}
    </div>
  );
};
