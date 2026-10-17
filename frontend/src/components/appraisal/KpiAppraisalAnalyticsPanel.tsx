import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, TrendingUp, Users, Settings2 } from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import type { AppraisalAnalytics, AppraisalPeriod } from '../../types/appraisal';
import { formatAppraisalScore, isAppraisalPeriodEnabled } from '../../types/appraisal';
import { useLanguage } from '../../context/LanguageContext';
import { AppraisalPeriodToolbar } from './AppraisalPeriodToolbar';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type DeptAverageSortCol = 'department' | 'headcount' | 'averageScore';

const deptAverageThClass = 'py-2 text-xs uppercase text-slate-500';

export const KpiAppraisalAnalyticsPanel: React.FC = () => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [periods, setPeriods] = useState<AppraisalPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState<AppraisalAnalytics | null>(null);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<DeptAverageSortCol>();

  const sortedDepartmentAverages = useMemo(() => {
    const rows = data?.departmentAverages ?? [];
    const getSortValue = (
      row: NonNullable<AppraisalAnalytics['departmentAverages']>[number],
      col: DeptAverageSortCol
    ): string | number => {
      switch (col) {
        case 'department':
          return row.departmentId;
        case 'headcount':
          return row.headcount;
        case 'averageScore':
          return row.averageScore;
        default:
          return '';
      }
    };
    return sortRowsByColumn(rows, sortBy, sortOrder, getSortValue);
  }, [data?.departmentAverages, sortBy, sortOrder]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingPeriods(true);
      try {
        const p = await Api.appraisal.getPeriods();
        const all = Array.isArray(p) ? (p as AppraisalPeriod[]) : [];
        const list = all.filter((period) => isAppraisalPeriodEnabled(period));
        if (cancelled) return;
        setPeriods(list);
        setPeriodId((prev) => {
          if (prev && list.some((period) => period.id === prev)) return prev;
          return list[0]?.id ?? '';
        });
      } catch {
        if (!cancelled) showToast(t('appraisalAnalytics.loadPeriodsFailed'), 'error');
      } finally {
        if (!cancelled) setLoadingPeriods(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);

  const loadAnalytics = useCallback(
    async (pid: string) => {
      setLoadingAnalytics(true);
      try {
        const analytics = (await Api.appraisal.getAnalytics(
          pid ? { periodId: pid } : undefined
        )) as AppraisalAnalytics;
        setData(analytics);
      } catch {
        showToast(t('appraisalAnalytics.loadFailed'), 'error');
        setData(null);
      } finally {
        setLoadingAnalytics(false);
      }
    },
    [showToast, t]
  );

  useEffect(() => {
    if (loadingPeriods) return;
    void loadAnalytics(periodId);
  }, [periodId, loadingPeriods, loadAnalytics]);

  if (loadingPeriods) {
    return (
      <ContentSkeleton layout="dashboard" label={t('appraisalAnalytics.loading')} />
    );
  }

  if (!periods.length) {
    return (
      <Card className="py-12 text-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-800 dark:text-slate-200">{t('appraisalAnalytics.noPeriodsTitle')}</p>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          {t('appraisalAnalytics.noPeriodsHint')}
        </p>
        <Button
          className="mt-4"
          size="sm"
          onClick={() => navigate('/performance?tab=kpi-settings')}
        >
          <Settings2 className="w-4 h-4 mr-1" />
          {t('appraisalAnalytics.openConfig')}
        </Button>
      </Card>
    );
  }

  const emptyData = !data?.summary.totalAppraisals;

  return (
    <div className="space-y-4">
      <div className="surface-card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-primary-500 via-primary-400 to-teal-400" />
        <div className="surface-card-pad flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-500/25">
              <BarChart3 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                KPI analytics
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Scores and rankings for the selected appraisal period.
              </p>
            </div>
          </div>
          <AppraisalPeriodToolbar
            id="kpi-analytics-period-select"
            periods={periods}
            periodId={periodId}
            label={t('appraisalAnalytics.periodLabel')}
            className="sm:max-w-md sm:shrink-0"
            onPeriodChange={setPeriodId}
            trailing={
              loadingAnalytics ? (
                <Loader2
                  className="w-5 h-5 animate-spin text-primary-500"
                  aria-label={t('common.loading')}
                />
              ) : null
            }
          />
        </div>
      </div>

      {emptyData && !loadingAnalytics ? (
        <Card className="py-10 text-center">
          <p className="text-slate-600 dark:text-slate-300 font-medium">{t('appraisalAnalytics.noAppraisals')}</p>
          <p className="text-sm text-slate-500 mt-1">
            {t('appraisalAnalytics.noAppraisalsInPeriodHint')}
          </p>
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            onClick={() => navigate('/performance?tab=kpi-appraisals')}
          >
            {t('appraisalAnalytics.goToAppraisals')}
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <Card className="p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <Users className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('appraisalAnalytics.appraisals')}
                  </p>
                  <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white tracking-tight">
                    {data?.summary.totalAppraisals ?? 0}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 sm:p-5 border border-primary-200/70 dark:border-primary-800/50 shadow-sm shadow-primary-500/5 bg-primary-50/30 dark:bg-primary-950/20">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400">
                  <TrendingUp className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-700/80 dark:text-primary-300/80">
                    {t('appraisalAnalytics.averageKpi')}
                  </p>
                  <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-primary-600 dark:text-primary-400 tracking-tight">
                    {formatAppraisalScore(data?.summary.averageScore)}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <BarChart3 className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t('appraisalAnalytics.gradeBands')}
                  </p>
                  <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white tracking-tight">
                    {data?.gradeDistribution.length ?? 0}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <h3 className="font-semibold mb-4">{t('appraisalAnalytics.gradeDistribution')}</h3>
              <div className="space-y-2">
                {(data?.gradeDistribution ?? []).map(({ grade, count }) => (
                  <div key={grade} className="flex items-center gap-3">
                    <span className="w-10 font-bold">{grade}</span>
                    <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full"
                        style={{
                          width: `${Math.min(100, (count / Math.max(1, data?.summary.totalAppraisals ?? 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-slate-500 w-8 text-right">{count}</span>
                  </div>
                ))}
                {!data?.gradeDistribution.length && (
                  <p className="text-sm text-slate-500">{t('appraisalAnalytics.noGradeData')}</p>
                )}
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold mb-4">{t('appraisalAnalytics.topPerformers')}</h3>
              <ul className="space-y-2">
                {(data?.topPerformers ?? []).map((p) => (
                  <li
                    key={p.rank}
                    className="flex justify-between text-sm py-2 border-b border-slate-100 dark:border-slate-800"
                  >
                    <span>
                      #{p.rank} {p.employeeName}
                    </span>
                    <span className="font-semibold">
                      {formatAppraisalScore(p.score)} ({p.grade})
                    </span>
                  </li>
                ))}
                {!data?.topPerformers.length && (
                  <p className="text-sm text-slate-500">{t('appraisalAnalytics.rankingsHint')}</p>
                )}
              </ul>
            </Card>

            <Card className="lg:col-span-2">
              <h3 className="font-semibold mb-4">{t('appraisalAnalytics.departmentAverages')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase text-slate-500 border-b">
                      <SortableTableHeader
                        label={t('appraisalAnalytics.department')}
                        column="department"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={`${deptAverageThClass} text-left`}
                      />
                      <SortableTableHeader
                        label={t('appraisalAnalytics.headcount')}
                        column="headcount"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={`${deptAverageThClass} text-right`}
                        align="right"
                      />
                      <SortableTableHeader
                        label={t('appraisalAnalytics.avgKpi')}
                        column="averageScore"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={`${deptAverageThClass} text-right`}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDepartmentAverages.map((d) => (
                      <tr
                        key={d.departmentId}
                        className="border-b border-slate-100 dark:border-slate-800"
                      >
                        <td className="py-2">{d.departmentId}</td>
                        <td className="py-2 text-right">{d.headcount}</td>
                        <td className="py-2 text-right font-semibold">
                          {formatAppraisalScore(d.averageScore)}
                        </td>
                      </tr>
                    ))}
                    {!data?.departmentAverages.length && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-slate-500">
                          {t('appraisalAnalytics.noDeptData')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
