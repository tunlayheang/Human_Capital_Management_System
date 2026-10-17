import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Award,
  ArrowRightLeft,
  ClipboardList,
  Clock,
  History,
  Loader2,
  UserCheck,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { StatusLabel } from '../components/ui/StatusLabel';
import { Modal } from '../components/ui/Modal';
import { PageShell } from '../components/ui/page';
import { Api } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { inputClass } from '../constants/designSystem';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { ProfileSectionCard } from '../components/profile/ProfileSectionCard';
import {
  ProfileSectionTabs,
  type SectionTab,
} from '../components/profile/ProfileSectionTabs';
import { EmployeeMovementHistoryTable } from '../components/employee/EmployeeMovementHistoryTable';
import { isAdminRole } from '../utils/adminNavScope';
import { isSystemPortalAccount, userDisplayEmployeeCode } from '../utils/userProfile';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';
import type { EmployeeAppraisal, AppraisalWorkflowStatus, ComponentScore } from '../types/appraisal';
import { WORKFLOW_LABELS, formatAppraisalScore } from '../types/appraisal';
import {
  EmployeeKpiSelfEvaluationForm,
  type EmployeeSelfEvalDraft,
} from '../components/appraisal/EmployeeKpiSelfEvaluationForm';
import {
  resolveDualScoreSummary,
  resolveEmployeeSelfScore,
  computeEmployeeSelfWeightedTotal,
} from '../components/appraisal/appraisalDualScore';
import type { ProbationEvaluationRatings, ProbationRatingLevel } from '../types';
import {
  PROBATION_RATING_OPTIONS,
  probationStatusLabel,
} from '../components/probation/probationReviewUi';

type PerformanceSectionId = 'action' | 'history' | 'movements';

const VALID_SECTIONS = new Set<PerformanceSectionId>(['action', 'history', 'movements']);

function parseSectionTab(raw: string | null): PerformanceSectionId {
  if (raw && VALID_SECTIONS.has(raw as PerformanceSectionId)) {
    return raw as PerformanceSectionId;
  }
  return 'action';
}

function isFinalizedStatus(status: string): boolean {
  return status === 'APPROVED' || status === 'CLOSED';
}

type ProbationSelfEval = {
  reviewId: string;
  userId: string;
  status: 'PENDING_EMPLOYEE';
  managerSubmittedAt: string | null;
  managerRatings: ProbationEvaluationRatings | null;
  managerStrengths: string;
  managerAreasForImprovement: string;
  managerOverallRecommendation: string | null;
};

type ProbationHistoryItem = {
  id: string;
  reviewDate: string;
  status: string;
  recommendation: string | null;
  overallRecommendation: string | null;
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  hrNotes: string;
};

type MyPerformanceHub = {
  summary: {
    pendingCount: number;
    completedCount: number;
    kpiCount: number;
    probationCount: number;
  };
  pending: {
    kpi: EmployeeAppraisal[];
    probation: ProbationSelfEval | null;
  };
  history: {
    kpi: EmployeeAppraisal[];
    probation: ProbationHistoryItem[];
  };
};

type KpiDetail = {
  appraisal: EmployeeAppraisal;
  componentScores: ComponentScore[];
  managerEvaluation: {
    strengths?: string | null;
    weaknesses?: string | null;
    managerRecommendations?: string | null;
  } | null;
  employeeEvaluation: {
    strengths?: string | null;
    weaknesses?: string | null;
    notes?: string | null;
    submittedAt?: string | null;
    weightedScore?: number | null;
    scores?: Array<{
      componentId: string;
      componentName: string;
      rawScore: number;
      weightPercent: number;
      weightedScore: number;
    }>;
  } | null;
};

const PROBATION_SELF_CRITERIA: Array<{
  key: keyof ProbationEvaluationRatings;
  label: string;
}> = [
  { key: 'jobPerformance', label: 'Job Performance' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'workAttitude', label: 'Work Attitude' },
  { key: 'teamwork', label: 'Teamwork' },
];

const EMPTY_RATINGS: Record<keyof ProbationEvaluationRatings, ProbationRatingLevel | ''> = {
  jobPerformance: '',
  attendance: '',
  workAttitude: '',
  teamwork: '',
};

const EMPTY_KPI_LIST: EmployeeAppraisal[] = [];

function formatDate(value?: string | null) {
  return formatDateOnlyDisplay(value);
}

function kpiStatusLabel(status: AppraisalWorkflowStatus | string): string {
  const key = String(status).toUpperCase() as AppraisalWorkflowStatus;
  return WORKFLOW_LABELS[key] ?? key.replace(/_/g, ' ');
}

export const MyPerformance: React.FC = () => {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [hub, setHub] = useState<MyPerformanceHub | null>(null);
  const [activeSection, setActiveSection] = useState<PerformanceSectionId>(() =>
    parseSectionTab(searchParams.get('tab'))
  );
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [pendingDetails, setPendingDetails] = useState<Record<string, KpiDetail>>({});
  const [pendingDetailsLoading, setPendingDetailsLoading] = useState(false);
  const [probationRatings, setProbationRatings] = useState(EMPTY_RATINGS);
  const [probationStrengths, setProbationStrengths] = useState('');
  const [probationAreas, setProbationAreas] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KpiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const employeeCode = userDisplayEmployeeCode(user);
  const hasMovementHistory =
    Boolean(user) &&
    !isSystemPortalAccount(user) &&
    !isAdminRole(user?.role) &&
    employeeCode !== '—' &&
    employeeCode.length > 0;

  const setSection = useCallback(
    (id: PerformanceSectionId) => {
      setActiveSection(id);
      const next = new URLSearchParams(searchParams);
      if (id === 'action') next.delete('tab');
      else next.set('tab', id);
      const q = next.toString();
      navigate({ pathname: '/my-performance', search: q ? `?${q}` : '' }, { replace: true });
    },
    [navigate, searchParams]
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const data = (await Api.appraisal.getMyPerformance()) as MyPerformanceHub;
      setHub(data);
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Failed to load performance reviews', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const fromUrl = parseSectionTab(searchParams.get('tab'));
    if (fromUrl === 'movements' && !hasMovementHistory) {
      setSection('action');
      return;
    }
    setActiveSection(fromUrl);
  }, [searchParams, hasMovementHistory, setSection]);

  // Prefer Action required once hub loads when there is pending work and no explicit tab.
  useEffect(() => {
    if (!hub || searchParams.get('tab')) return;
    if (hub.summary.pendingCount > 0) setActiveSection('action');
  }, [hub, searchParams]);

  useEffect(() => {
    const appraisalId = searchParams.get('appraisalId')?.trim();
    if (!appraisalId) return;
    setDetailId(appraisalId);
    setActiveSection('action');
  }, [searchParams]);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    void Api.appraisal
      .getMyPerformanceDetail(detailId)
      .then((d) => setDetail(d as KpiDetail))
      .catch((e: Error) => showToast(e?.message || 'Failed to load details', 'error'))
      .finally(() => setDetailLoading(false));
  }, [detailId, showToast]);

  const pendingKpi = hub?.pending.kpi ?? EMPTY_KPI_LIST;
  const pendingProbation = hub?.pending.probation ?? null;
  const pendingKpiKey = useMemo(
    () => pendingKpi.map((item) => item.id).join(','),
    [pendingKpi]
  );

  useEffect(() => {
    if (!pendingKpiKey) {
      setPendingDetails((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    setPendingDetailsLoading(true);
    void Promise.all(
      pendingKpiKey.split(',').map((id) =>
        Api.appraisal
          .getMyPerformanceDetail(id)
          .then((d) => [id, d as KpiDetail] as const)
          .catch(() => null)
      )
    )
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, KpiDetail> = {};
        for (const row of rows) {
          if (row) next[row[0]] = row[1];
        }
        setPendingDetails(next);
      })
      .finally(() => {
        if (!cancelled) setPendingDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingKpiKey]);
  const historyKpi = hub?.history.kpi ?? [];
  const historyProbation = hub?.history.probation ?? [];
  const hasPending = pendingKpi.length > 0 || Boolean(pendingProbation);
  const hasHistory = historyKpi.length > 0 || historyProbation.length > 0;
  const pendingCount = hub?.summary.pendingCount ?? 0;

  const sectionTabs = useMemo((): SectionTab<PerformanceSectionId>[] => {
    const tabs: SectionTab<PerformanceSectionId>[] = [
      {
        id: 'action',
        label: t('myPerformance.actionRequired'),
        icon: Clock,
        badge: pendingCount > 0 ? pendingCount : undefined,
      },
      {
        id: 'history',
        label: t('myPerformance.reviewHistory'),
        icon: History,
      },
    ];
    if (hasMovementHistory) {
      tabs.push({
        id: 'movements',
        label: t('profile.movementHistory'),
        icon: ArrowRightLeft,
      });
    }
    return tabs;
  }, [t, pendingCount, hasMovementHistory]);

  useEffect(() => {
    if (sectionTabs.length > 0 && !sectionTabs.some((tab) => tab.id === activeSection)) {
      setSection(sectionTabs[0].id);
    }
  }, [sectionTabs, activeSection, setSection]);

  const submitKpi = async (appraisalId: string, draft: EmployeeSelfEvalDraft) => {
    setSubmittingId(appraisalId);
    try {
      await Api.appraisal.submitSelfEvaluation(appraisalId, {
        strengths: draft.strengths.trim() || undefined,
        weaknesses: draft.weaknesses.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        scores: Object.entries(draft.scores).map(([componentId, rawScore]) => ({
          componentId,
          rawScore,
        })),
      });
      showToast('Self-evaluation submitted', 'success');
      await load({ silent: true });
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Failed to submit self-evaluation', 'error');
    } finally {
      setSubmittingId(null);
    }
  };

  const submitProbation = async () => {
    if (!pendingProbation) return;
    if (!Object.values(probationRatings).every(Boolean)) {
      showToast('Complete all self-rating criteria before submitting.', 'error');
      return;
    }
    setSubmittingId(pendingProbation.reviewId);
    try {
      await Api.reviews.submitProbationSelfEvaluation({
        reviewId: pendingProbation.reviewId,
        ratings: probationRatings,
        strengths: probationStrengths,
        areasForImprovement: probationAreas,
      });
      showToast('Probation self-evaluation submitted', 'success');
      setProbationRatings(EMPTY_RATINGS);
      setProbationStrengths('');
      setProbationAreas('');
      await load({ silent: true });
    } catch (e: unknown) {
      showToast((e as Error)?.message || 'Failed to submit probation self-evaluation', 'error');
    } finally {
      setSubmittingId(null);
    }
  };

  const historyItems = useMemo(() => {
    const items: Array<
      | { kind: 'kpi'; id: string; date: string; row: EmployeeAppraisal }
      | { kind: 'probation'; id: string; date: string; row: ProbationHistoryItem }
    > = [];
    for (const row of historyKpi) {
      items.push({
        kind: 'kpi',
        id: row.id,
        date: String(row.periodEndDate ?? row.updated_at ?? ''),
        row,
      });
    }
    for (const row of historyProbation) {
      items.push({ kind: 'probation', id: row.id, date: row.reviewDate, row });
    }
    return items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [historyKpi, historyProbation]);

  const renderActionPanel = () => {
    if (!hasPending) {
      return (
        <ProfileSectionCard
          title={t('myPerformance.actionRequired')}
          description={t('myPerformance.actionRequiredDesc')}
          icon={Clock}
        >
          <p className="text-sm text-slate-500 text-center py-4">{t('myPerformance.noAction')}</p>
          {hasHistory ? (
            <div className="flex justify-center pb-2">
              <Button variant="outline" onClick={() => setSection('history')}>
                {t('myPerformance.viewHistory')}
              </Button>
            </div>
          ) : null}
        </ProfileSectionCard>
      );
    }

    return (
      <div className="space-y-4">
        {pendingDetailsLoading && pendingKpi.length > 0 ? (
          <ContentSkeleton layout="form" rows={1} />
        ) : null}

        {pendingKpi.map((item) => {
          const kpiDetail = pendingDetails[item.id];
          if (!kpiDetail?.componentScores?.length) {
            if (pendingDetailsLoading) return null;
            return (
              <ProfileSectionCard
                key={item.id}
                title={`KPI appraisal — ${item.periodName ?? 'Review period'}`}
                description={t('myPerformance.actionRequiredDesc')}
                icon={ClipboardList}
              >
                <p className="text-sm text-slate-500 text-center py-4">
                  Could not load KPI components. Refresh the page or contact HR.
                </p>
              </ProfileSectionCard>
            );
          }

          return (
            <ProfileSectionCard
              key={item.id}
              title={`KPI appraisal — ${item.periodName ?? 'Review period'}`}
              description={t('myPerformance.actionRequiredDesc')}
              icon={ClipboardList}
              bare
            >
              <EmployeeKpiSelfEvaluationForm
                periodName={item.periodName ?? 'Review period'}
                componentScores={kpiDetail.componentScores}
                managerEvaluation={kpiDetail.managerEvaluation}
                submitting={submittingId === item.id}
                onSubmit={(draft) => submitKpi(item.id, draft)}
              />
            </ProfileSectionCard>
          );
        })}

        {pendingProbation ? (
          <ProfileSectionCard
            title="Probation review"
            description="Rate your own performance, then submit for HR review."
            icon={UserCheck}
          >
            {pendingProbation.managerStrengths || pendingProbation.managerAreasForImprovement ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 text-sm space-y-1 mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Manager feedback
                </p>
                {pendingProbation.managerStrengths ? (
                  <p>
                    <span className="text-slate-500">Strengths: </span>
                    {pendingProbation.managerStrengths}
                  </p>
                ) : null}
                {pendingProbation.managerAreasForImprovement ? (
                  <p>
                    <span className="text-slate-500">Areas for improvement: </span>
                    {pendingProbation.managerAreasForImprovement}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {PROBATION_SELF_CRITERIA.map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <select
                    className={`${inputClass} mt-1 w-full`}
                    value={probationRatings[key]}
                    onChange={(e) =>
                      setProbationRatings((prev) => ({
                        ...prev,
                        [key]: e.target.value as ProbationRatingLevel,
                      }))
                    }
                  >
                    <option value="" disabled hidden>Select rating…</option>
                    {PROBATION_RATING_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Your strengths</label>
                <textarea
                  className={`${inputClass} mt-1 w-full`}
                  rows={2}
                  value={probationStrengths}
                  onChange={(e) => setProbationStrengths(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Areas you want to improve</label>
                <textarea
                  className={`${inputClass} mt-1 w-full`}
                  rows={2}
                  value={probationAreas}
                  onChange={(e) => setProbationAreas(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button
                disabled={submittingId === pendingProbation.reviewId}
                onClick={() => void submitProbation()}
              >
                {submittingId === pendingProbation.reviewId ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Submit self-evaluation'
                )}
              </Button>
            </div>
          </ProfileSectionCard>
        ) : null}
      </div>
    );
  };

  const renderHistoryPanel = () => (
    <ProfileSectionCard
      title={t('myPerformance.reviewHistory')}
      description={t('myPerformance.reviewHistoryDesc')}
      icon={History}
    >
      {!hasHistory ? (
        <p className="text-sm text-slate-500 text-center py-6">{t('myPerformance.noHistory')}</p>
      ) : (
        <div className="space-y-2 -mx-1">
          {historyItems.map((item) =>
            item.kind === 'kpi' ? (
              <button
                key={`kpi-${item.id}`}
                type="button"
                onClick={() => setDetailId(item.id)}
                className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 px-3 py-3 sm:px-4 sm:py-3.5 space-y-2 hover:border-amber-300 dark:hover:border-amber-700 transition-colors"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <ClipboardList className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100 break-words text-sm">
                      KPI — {item.row.periodName ?? 'Appraisal'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 break-words">
                      {formatDate(item.row.periodEndDate)}
                      {item.row.final_grade ? ` · Grade ${item.row.final_grade}` : ''}
                      {item.row.weighted_score != null
                        ? ` · Score ${formatAppraisalScore(Number(item.row.weighted_score))}`
                        : ''}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                </div>
                <StatusLabel
                  status={item.row.workflow_status}
                  context="appraisal"
                  label={kpiStatusLabel(item.row.workflow_status)}
                  size="sm"
                />
              </button>
            ) : (
              <div
                key={`prob-${item.id}`}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 px-3 py-3 sm:px-4 sm:py-3.5 space-y-2"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <UserCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100 text-sm">Probation review</p>
                    <p className="text-xs text-slate-500 mt-0.5 break-words">
                      {formatDate(item.row.reviewDate)}
                      {item.row.overallRecommendation ? ` · ${item.row.overallRecommendation}` : ''}
                    </p>
                  </div>
                </div>
                <StatusLabel
                  status={item.row.status as string}
                  context="probation"
                  label={probationStatusLabel(item.row.status as never)}
                  size="sm"
                />
              </div>
            )
          )}
        </div>
      )}
    </ProfileSectionCard>
  );

  const renderMovementsPanel = () => (
    <ProfileSectionCard
      title={t('profile.movementHistory')}
      description={t('profile.movementHistoryDesc')}
      icon={ArrowRightLeft}
    >
      <EmployeeMovementHistoryTable employeeId={employeeCode} readOnly variant="table" />
    </ProfileSectionCard>
  );

  const panelNeedsHub = activeSection === 'action' || activeSection === 'history';
  const panelLoading = loading && panelNeedsHub;

  const activePanel =
    activeSection === 'action'
      ? renderActionPanel()
      : activeSection === 'history'
        ? renderHistoryPanel()
        : activeSection === 'movements'
          ? renderMovementsPanel()
          : null;

  return (
    <PageShell className="w-full min-w-0 pb-28 lg:pb-12 max-w-5xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-orange-700 text-white p-6 sm:p-8 shadow-lg shadow-orange-900/20">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-white/15 backdrop-blur">
            <Award className="w-8 h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">{t('myPerformance.title')}</h1>
            <p className="text-orange-100 mt-1 text-sm max-w-lg">{t('myPerformance.subtitle')}</p>
          </div>
        </div>
        <div className="responsive-stat-grid mt-6">
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <p className="text-xs text-orange-100">{t('myPerformance.pendingReviews')}</p>
            <p className="text-2xl font-bold">{loading && !hub ? '—' : pendingCount}</p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <p className="text-xs text-orange-100">{t('myPerformance.completedReviews')}</p>
            <p className="text-2xl font-bold">
              {loading && !hub ? '—' : (hub?.summary.completedCount ?? 0)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 lg:mt-6 space-y-4 min-w-0">
        {sectionTabs.length > 1 ? (
          <ProfileSectionTabs
            tabs={sectionTabs}
            active={activeSection}
            onChange={setSection}
            ariaLabel={t('myPerformance.sections')}
          />
        ) : null}

        <div key={activeSection} className="animate-fade-in motion-safe:transition-opacity">
          {panelLoading ? (
            <ContentSkeleton layout="cards" rows={2} showChrome={false} />
          ) : (
            activePanel
          )}
        </div>
      </div>

      <Modal
        isOpen={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={detail?.appraisal.periodName ?? 'KPI appraisal details'}
        size="lg"
      >
        {detailLoading ? (
          <ContentSkeleton layout="form" rows={1} />
        ) : detail ? (
          (() => {
            const managerSubmitted = Boolean(detail.appraisal.manager_submitted_at);
            const employeePayloadScores = detail.employeeEvaluation?.scores?.length
              ? Object.fromEntries(
                  detail.employeeEvaluation.scores.map((s) => [s.componentId, s.rawScore])
                )
              : undefined;
            const employeeSelfTotal =
              computeEmployeeSelfWeightedTotal(detail.componentScores, employeePayloadScores) ??
              detail.employeeEvaluation?.weightedScore ??
              null;

            return (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <StatusLabel
                status={detail.appraisal.workflow_status}
                context="appraisal"
                label={kpiStatusLabel(detail.appraisal.workflow_status)}
              />
              {detail.appraisal.final_grade ? (
                <span className="text-slate-600">
                  Grade: <strong>{detail.appraisal.final_grade}</strong>
                </span>
              ) : null}
              {detail.appraisal.weighted_score != null ? (
                <span className="text-slate-600">
                  Final score:{' '}
                  <strong>{formatAppraisalScore(Number(detail.appraisal.weighted_score))}</strong>
                </span>
              ) : null}
            </div>

            {detail.componentScores.length > 0 ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  KPI scores
                </p>
                <p className="text-xs text-slate-500 mb-2">
                  Final score per component combines all management evaluators and your self-rating.
                </p>
                <div className="space-y-1.5">
                  {detail.componentScores.map((s) => {
                    const combined = resolveDualScoreSummary(s, managerSubmitted).averageScore;
                    const selfScore = resolveEmployeeSelfScore(s, employeePayloadScores);
                    return (
                    <div
                      key={s.component_id ?? s.componentName}
                      className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-700 dark:text-slate-300">{s.componentName}</span>
                        <span className="font-semibold tabular-nums">
                          {formatAppraisalScore(combined)}
                        </span>
                      </div>
                      {selfScore != null ? (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                          Your self-rating: {formatAppraisalScore(selfScore)}
                        </p>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
                {employeeSelfTotal != null ? (
                  <p className="text-sm text-slate-600 mt-2">
                    Your overall self-score:{' '}
                    <strong>{formatAppraisalScore(Number(employeeSelfTotal))}</strong>
                  </p>
                ) : null}
              </div>
            ) : null}

            {detail.managerEvaluation?.strengths || detail.managerEvaluation?.weaknesses ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Manager feedback
                </p>
                {detail.managerEvaluation.strengths ? (
                  <p className="text-slate-700 dark:text-slate-300 mb-1">
                    <span className="text-slate-500">Strengths: </span>
                    {detail.managerEvaluation.strengths}
                  </p>
                ) : null}
                {detail.managerEvaluation.weaknesses ? (
                  <p className="text-slate-700 dark:text-slate-300">
                    <span className="text-slate-500">Areas for improvement: </span>
                    {detail.managerEvaluation.weaknesses}
                  </p>
                ) : null}
              </div>
            ) : null}

            {detail.employeeEvaluation?.notes ||
            detail.employeeEvaluation?.strengths ||
            detail.employeeEvaluation?.weaknesses ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Your self-evaluation
                </p>
                {detail.employeeEvaluation.strengths ? (
                  <p className="text-slate-700 dark:text-slate-300 mb-1">
                    <span className="text-slate-500">Strengths: </span>
                    {String(detail.employeeEvaluation.strengths)}
                  </p>
                ) : null}
                {detail.employeeEvaluation.weaknesses ? (
                  <p className="text-slate-700 dark:text-slate-300 mb-1">
                    <span className="text-slate-500">Areas for improvement: </span>
                    {String(detail.employeeEvaluation.weaknesses)}
                  </p>
                ) : null}
                {detail.employeeEvaluation.notes ? (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {detail.employeeEvaluation.notes}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
            );
          })()
        ) : null}
      </Modal>
    </PageShell>
  );
};

/** @deprecated Use MyPerformance — kept for route alias */
export const MyPerformanceReviews = MyPerformance;
