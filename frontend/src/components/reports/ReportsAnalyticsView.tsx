import React, { useCallback, useMemo } from 'react';
import { ReportsModuleBody } from './ReportsModuleBody';
import { AnalyticsChartCard } from './AnalyticsChartCard';
import { DashboardDateFilter } from '../dashboard/DashboardDateFilter';
import {
  asChartRows,
  AttendanceRateLineChart,
  ChartEmptyState,
  COLORS,
  DepartmentRateChart,
  LateTrendLineChart,
  MonthlyMetricBarChart,
} from '../dashboard/dashboardChartComponents';
import { useOrganizationAnalytics } from '../../hooks/useOrganizationAnalytics';
import { useRegisterPullToRefresh } from '../../context/PullToRefreshContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { formatRangeLabel } from '../../utils/dashboardDateRange';
import {
  exportAnalyticsChartReport,
  type AnalyticsChartExportKind,
  type AnalyticsChartExportLabels,
} from '../../utils/exportAnalyticsChartReport';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';

export const ReportsAnalyticsView: React.FC = () => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { range, setRange, charts, periodLabel, loading, reload } = useOrganizationAnalytics(true);

  useRegisterPullToRefresh(reload);

  const attendanceRate = asChartRows<{ month: string; attendanceRatePct: number }>(
    charts?.monthlyAttendanceRate
  );
  const lateTrend = asChartRows<{ month: string; late: number }>(charts?.monthlyLateTrend);
  const leaveUsage = asChartRows<{ month: string; days: number }>(charts?.monthlyLeaveUsage);
  const overtimeHours = asChartRows<{ month: string; hours: number }>(charts?.monthlyOvertimeHours);
  const separations = asChartRows<{ month: string; count: number }>(charts?.monthlySeparations);
  const departmentRates = asChartRows<{ name: string; ratePct: number }>(
    charts?.departmentAttendanceRates
  );

  const resolvedPeriodLabel = periodLabel || formatRangeLabel(range.startDate, range.endDate);

  const exportLabels = useMemo<AnalyticsChartExportLabels>(
    () => ({
      reportTitle: '',
      periodLabel: resolvedPeriodLabel,
      startDate: range.startDate,
      endDate: range.endDate,
      month: t('reports.analytics.export.month'),
      present: t('reports.analytics.export.present'),
      absent: t('reports.analytics.export.absent'),
      late: t('reports.analytics.export.late'),
      attendanceRate: t('reports.analytics.export.attendanceRate'),
      leaveDays: t('reports.analytics.export.leaveDays'),
      otHours: t('reports.analytics.export.otHours'),
      separations: t('reports.analytics.export.separations'),
      department: t('reports.analytics.export.department'),
      summary: t('reports.analytics.export.summary'),
      total: t('reports.analytics.export.total'),
      average: t('reports.analytics.export.average'),
      periodAverage: t('reports.analytics.export.periodAverage'),
      recordCount: t('reports.analytics.export.recordCount'),
    }),
    [range.endDate, range.startDate, resolvedPeriodLabel, t]
  );

  const handleChartExport = useCallback(
    (
      kind: AnalyticsChartExportKind,
      reportTitle: string,
      rows: unknown[],
      canExport: boolean
    ) => {
      return async (format: ExportFileExt) => {
        if (!canExport || rows.length === 0) {
          showToast(t('reports.analytics.export.noData'), 'warning');
          return;
        }

        const ok = await exportAnalyticsChartReport(format, kind, rows, {
          ...exportLabels,
          reportTitle,
        });

        if (!ok) {
          showToast(t('reports.analytics.export.popupBlocked'), 'warning');
          return;
        }

        const formatLabel = format === 'xlsx' ? 'Excel' : format.toUpperCase();
        showToast(t('reports.analytics.export.success', { format: formatLabel }), 'success');
      };
    },
    [exportLabels, showToast, t]
  );

  const canExportAttendance = attendanceRate.length > 0;
  const canExportLate = lateTrend.length > 0;
  const canExportLeave = leaveUsage.some((row) => Number(row.days) > 0);
  const canExportOvertime = overtimeHours.some((row) => Number(row.hours) > 0);
  const canExportSeparations = separations.some((row) => Number(row.count) > 0);
  const canExportDepartments = departmentRates.length > 0;

  return (
    <ReportsModuleBody>
      <DashboardDateFilter
        value={range}
        onChange={setRange}
        periodLabel={resolvedPeriodLabel}
        loading={loading}
      />

      <p className="text-sm text-slate-500 dark:text-slate-400">{t('reports.analytics.intro')}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsChartCard
          title={t('reports.analytics.charts.attendanceRate')}
          canExport={canExportAttendance}
          onExport={handleChartExport(
            'attendanceRate',
            t('reports.analytics.charts.attendanceRate'),
            attendanceRate,
            canExportAttendance
          )}
        >
          {canExportAttendance ? (
            <AttendanceRateLineChart data={attendanceRate} />
          ) : (
            <ChartEmptyState
              loading={loading}
              message={t('reports.analytics.empty.noAttendanceRate')}
            />
          )}
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title={t('reports.analytics.charts.lateArrivals')}
          canExport={canExportLate}
          onExport={handleChartExport(
            'lateArrivals',
            t('reports.analytics.charts.lateArrivals'),
            lateTrend,
            canExportLate
          )}
        >
          {canExportLate ? (
            <LateTrendLineChart data={lateTrend} />
          ) : (
            <ChartEmptyState
              loading={loading}
              message={t('reports.analytics.empty.noLateArrivals')}
            />
          )}
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title={t('reports.analytics.charts.leaveUsage')}
          canExport={canExportLeave}
          onExport={handleChartExport(
            'leaveUsage',
            t('reports.analytics.charts.leaveUsage'),
            leaveUsage,
            canExportLeave
          )}
        >
          {canExportLeave ? (
            <MonthlyMetricBarChart
              data={leaveUsage}
              dataKey="days"
              name={t('reports.analytics.series.leaveDays')}
              color={COLORS.info}
            />
          ) : (
            <ChartEmptyState loading={loading} message={t('reports.analytics.empty.noLeave')} />
          )}
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title={t('reports.analytics.charts.overtimeHours')}
          canExport={canExportOvertime}
          onExport={handleChartExport(
            'overtimeHours',
            t('reports.analytics.charts.overtimeHours'),
            overtimeHours,
            canExportOvertime
          )}
        >
          {canExportOvertime ? (
            <MonthlyMetricBarChart
              data={overtimeHours}
              dataKey="hours"
              name={t('reports.analytics.series.otHours')}
              color={COLORS.warning}
              valueFormatter={(v) => `${v}h`}
            />
          ) : (
            <ChartEmptyState loading={loading} message={t('reports.analytics.empty.noOvertime')} />
          )}
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title={t('reports.analytics.charts.separations')}
          canExport={canExportSeparations}
          onExport={handleChartExport(
            'separations',
            t('reports.analytics.charts.separations'),
            separations,
            canExportSeparations
          )}
        >
          {canExportSeparations ? (
            <MonthlyMetricBarChart
              data={separations}
              dataKey="count"
              name={t('reports.analytics.series.separations')}
              color={COLORS.danger}
            />
          ) : (
            <ChartEmptyState
              loading={loading}
              message={t('reports.analytics.empty.noSeparations')}
            />
          )}
        </AnalyticsChartCard>

        <AnalyticsChartCard
          title={t('reports.analytics.charts.departmentRates')}
          canExport={canExportDepartments}
          onExport={handleChartExport(
            'departmentRates',
            t('reports.analytics.charts.departmentRates'),
            departmentRates,
            canExportDepartments
          )}
        >
          {canExportDepartments ? (
            <DepartmentRateChart data={departmentRates} />
          ) : (
            <ChartEmptyState
              loading={loading}
              message={t('reports.analytics.empty.noDepartmentRates')}
            />
          )}
        </AnalyticsChartCard>
      </div>
    </ReportsModuleBody>
  );
};

export default ReportsAnalyticsView;
