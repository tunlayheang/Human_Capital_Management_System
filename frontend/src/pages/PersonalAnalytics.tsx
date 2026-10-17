import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUrlSyncedTab } from '../hooks/useUrlSyncedTab';
import { useLanguage } from '../context/LanguageContext';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  BarChart3,
  Calendar,
  Clock,
  LayoutGrid,
  Target,
  TrendingUp,
} from 'lucide-react';
import { usePersonalAnalytics, type PersonalAnalyticsFilter } from '../hooks/usePersonalAnalytics';
import { PersonalHubWorkspace } from '../components/personal-analytics/PersonalHubWorkspace';
import {
  PaField,
  PaInput,
  PaMetricTile,
  PaPeriodBar,
  PaSection,
  PaSectionTabs,
  PaStatCard,
} from '../components/personal-analytics/personalAnalyticsUi';
import { TrendBadge } from '../components/personal-analytics/TrendBadge';
import { selectClass } from '../constants/designSystem';
import { PageHeader, PageShell, ContentSkeleton } from '../components/ui/page';
import type { PersonalAnalyticsPreset } from '../types/personalAnalytics';
import { orderInclusiveStartEnd } from '../utils/dateRangeFilter';

const PRESET_IDS: PersonalAnalyticsPreset[] = [
  'current_month',
  'last_3_months',
  'last_6_months',
  'current_year',
  'custom',
];

const PIE_COLORS = ['#0078C1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b'];

const sectionIconClass = 'w-4 h-4';

export const PersonalAnalytics: React.FC = () => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get('userId') ?? undefined;
  const [preset, setPreset] = useState<PersonalAnalyticsPreset>('last_6_months');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useUrlSyncedTab({
    values: ['analytics', 'workspace'] as const,
    defaultValue: 'workspace',
    param: 'tab',
  });

  const filter: PersonalAnalyticsFilter = useMemo(
    () => ({
      preset,
      startDate: preset === 'custom' ? startDate : undefined,
      endDate: preset === 'custom' ? endDate : undefined,
      userId: targetUserId,
    }),
    [preset, startDate, endDate, targetUserId]
  );

  const { data, loading, error } = usePersonalAnalytics(filter);

  const sectionTabs = useMemo(
    () => [
      { id: 'workspace' as const, label: t('personalAnalytics.hub.tab'), icon: LayoutGrid },
      { id: 'analytics' as const, label: t('personalAnalytics.analyticsTab'), icon: BarChart3 },
    ],
    [t]
  );

  return (
    <PageShell className="w-full min-w-0">
      <PageHeader
        title={t('personalAnalytics.title')}
        subtitle={
          activeTab === 'analytics'
            ? t('personalAnalytics.subtitle')
            : t('personalAnalytics.hub.subtitle')
        }
        iconComponent={BarChart3}
      />

      <PaSectionTabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'analytics' | 'workspace')}
        tabs={sectionTabs}
        ariaLabel={t('personalAnalytics.title')}
      />

      {activeTab === 'analytics' ? (
        <div className="flex flex-wrap items-end gap-2">
          <PaField label={t('personalAnalytics.period')}>
            <select
              className={`${selectClass} min-w-[11rem]`}
              value={preset}
              onChange={(e) => setPreset(e.target.value as PersonalAnalyticsPreset)}
            >
              {PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`personalAnalytics.presets.${id}`)}
                </option>
              ))}
            </select>
          </PaField>
          {preset === 'custom' ? (
            <>
              <PaField label="From">
                <PaInput
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(e.target.value, endDate, 'startDate');
                    setStartDate(next.startDate);
                    setEndDate(next.endDate);
                  }}
                />
              </PaField>
              <PaField label="To">
                <PaInput
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(startDate, e.target.value, 'endDate');
                    setStartDate(next.startDate);
                    setEndDate(next.endDate);
                  }}
                />
              </PaField>
            </>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'workspace' ? <PersonalHubWorkspace targetUserId={targetUserId} /> : null}

      {activeTab === 'analytics' && loading ? (
        <ContentSkeleton layout="dashboard" label={t('personalAnalytics.loading')} />
      ) : activeTab === 'analytics' && error ? (
        <p className="text-sm text-red-600 dark:text-red-400 py-12 text-center">{error}</p>
      ) : activeTab === 'analytics' && data ? (
        <div className="space-y-5">
          <PaPeriodBar
            label={t('personalAnalytics.periodRange', {
              start: data.range.startDate,
              end: data.range.endDate,
              label: data.range.label,
            })}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PaStatCard
              label={t('personalAnalytics.summary.attendanceRate')}
              value={`${data.summary.attendanceRatePct}%`}
              footer={<TrendBadge trend={data.summary.trends.attendance} />}
              accent="text-emerald-700 dark:text-emerald-300"
            />
            <PaStatCard
              label={t('personalAnalytics.summary.leaveBalance')}
              value={
                data.summary.leaveBalanceDays != null
                  ? `${data.summary.leaveBalanceDays} days`
                  : '—'
              }
              sub={t('personalAnalytics.summary.leaveBalanceSub')}
            />
            <PaStatCard
              label={t('personalAnalytics.summary.otHours')}
              value={String(data.summary.otHours)}
              sub={t('personalAnalytics.summary.otHoursSub')}
              footer={<TrendBadge trend={data.summary.trends.overtime} />}
            />
            <PaStatCard
              label={t('personalAnalytics.summary.kpiGrade')}
              value={data.summary.kpiGrade ?? '—'}
              sub={
                data.kpi.performanceScorePct != null
                  ? t('personalAnalytics.summary.score', { score: data.kpi.performanceScorePct })
                  : t('personalAnalytics.summary.noReview')
              }
              accent="text-primary-700 dark:text-primary-300"
            />
          </div>

          <PaSection
            title={t('personalAnalytics.attendance')}
            icon={<Calendar className={sectionIconClass} />}
            action={
              <div className="flex flex-wrap gap-1.5 justify-end">
                <TrendBadge trend={data.attendance.trends.attendanceRate} />
                <TrendBadge trend={data.attendance.trends.punctuality} />
              </div>
            }
          >
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                [t('personalAnalytics.metrics.workingDays'), data.attendance.summary.workingDays],
                [t('personalAnalytics.metrics.present'), data.attendance.summary.presentDays],
                [t('personalAnalytics.metrics.absent'), data.attendance.summary.absentDays],
                [t('personalAnalytics.metrics.late'), data.attendance.summary.lateDays],
                [t('personalAnalytics.metrics.earlyOut'), data.attendance.summary.earlyDepartures],
                [
                  t('personalAnalytics.metrics.punctuality'),
                  `${data.attendance.summary.punctualityRatePct}%`,
                ],
              ].map(([label, value]) => (
                <PaMetricTile key={String(label)} label={String(label)} value={value as string | number} />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2 min-w-0">
              <ChartBlock title={t('personalAnalytics.charts.monthlyAttendance')}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.attendance.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="present" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="absent" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartBlock>
              <ChartBlock title={t('personalAnalytics.charts.lateTrend')}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.attendance.lateTrend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="late" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartBlock>
            </div>
          </PaSection>

          <PaSection title={t('personalAnalytics.leave')} icon={<Activity className={sectionIconClass} />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PaStatCard
                label={t('personalAnalytics.metrics.annualRemaining')}
                value={
                  data.leave.balances.annualRemaining != null
                    ? `${data.leave.balances.annualRemaining} days`
                    : '—'
                }
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.annualUsed')}
                value={`${data.leave.balances.annualUsed} days`}
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.sickUsed')}
                value={`${data.leave.balances.sickUsed} days`}
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.unpaidUsed')}
                value={`${data.leave.balances.unpaidUsed} days`}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2 min-w-0">
              <ChartBlock title={t('personalAnalytics.charts.leaveDistribution')}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.leave.distribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {data.leave.distribution.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </ChartBlock>
              <ChartBlock title={t('personalAnalytics.charts.monthlyLeave')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.leave.monthlyUsage}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="days" fill="#0078C1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartBlock>
            </div>
            {data.leave.insights.length ? (
              <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside space-y-1 rounded-xl bg-slate-50 dark:bg-slate-800/40 px-3 py-2">
                {data.leave.insights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </PaSection>

          <PaSection title={t('personalAnalytics.overtime')} icon={<Clock className={sectionIconClass} />}>
            <div className="grid gap-3 sm:grid-cols-3">
              <PaStatCard
                label={t('personalAnalytics.metrics.totalOt')}
                value={String(data.overtime.totalHours)}
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.avgMonthlyOt')}
                value={`${data.overtime.averageMonthlyHours} h`}
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.approvedHours')}
                value={String(data.overtime.approvedHours)}
                footer={<TrendBadge trend={data.overtime.trend} />}
              />
            </div>
            <ChartBlock title={t('personalAnalytics.charts.monthlyOt')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.overtime.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBlock>
          </PaSection>

          <PaSection title={t('personalAnalytics.kpi')} icon={<Target className={sectionIconClass} />}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PaStatCard
                label={t('personalAnalytics.metrics.currentGrade')}
                value={data.kpi.currentGrade ?? '—'}
                accent="text-primary-700 dark:text-primary-300"
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.performanceScore')}
                value={
                  data.kpi.performanceScorePct != null
                    ? `${data.kpi.performanceScorePct}%`
                    : '—'
                }
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.deptAvg')}
                value={
                  data.kpi.departmentAveragePct != null
                    ? `${data.kpi.departmentAveragePct}%`
                    : '—'
                }
              />
              <PaStatCard
                label={t('personalAnalytics.metrics.companyAvg')}
                value={
                  data.kpi.companyAveragePct != null ? `${data.kpi.companyAveragePct}%` : '—'
                }
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2 min-w-0">
              <ChartBlock title={t('personalAnalytics.charts.gradeProgression')}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.kpi.history}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 6]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number, _n, p) => [
                        (p?.payload as { grade?: string })?.grade ?? v,
                        'Grade',
                      ]}
                    />
                    <Line type="monotone" dataKey="numeric" stroke="#8b5cf6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartBlock>
              <ChartBlock title={t('personalAnalytics.charts.gradeFrequency')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.kpi.gradeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="grade" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartBlock>
            </div>
            {data.kpi.categoryBreakdown.length ? (
              <ChartBlock title={t('personalAnalytics.charts.kpiBreakdown')} tall>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={data.kpi.categoryBreakdown}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <Radar
                      name="Score %"
                      dataKey="scorePct"
                      stroke="#0078C1"
                      fill="#0078C1"
                      fillOpacity={0.35}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </ChartBlock>
            ) : null}
            {(data.kpi.strengthAreas?.length || data.kpi.improvementAreas?.length) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.kpi.strengthAreas?.length ? (
                  <div className="rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 px-3 py-2.5">
                    <p className="text-xs font-semibold text-green-800 dark:text-green-200">Strength areas</p>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 mt-1 list-disc list-inside">
                      {data.kpi.strengthAreas.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.kpi.improvementAreas?.length ? (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Improvement areas</p>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 mt-1 list-disc list-inside">
                      {data.kpi.improvementAreas.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {data.kpi.insights.length ? (
              <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/30 px-3 py-2.5">
                <p className="text-xs font-semibold text-primary-800 dark:text-primary-200 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden />
                  {t('personalAnalytics.insights')}
                </p>
                <ul className="text-xs text-slate-700 dark:text-slate-300 mt-1 list-disc list-inside space-y-0.5">
                  {data.kpi.insights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </PaSection>

          <p className="text-xs text-slate-500 text-center">{t('personalAnalytics.readOnlyNote')}</p>
        </div>
      ) : null}
    </PageShell>
  );
};

function ChartBlock({
  title,
  children,
  tall,
}: {
  title: string;
  children: React.ReactNode;
  tall?: boolean;
}) {
  const chartHeight = tall ? 256 : 224;
  return (
    <div className="space-y-2 min-w-0">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{title}</p>
      <div
        className="w-full min-w-0"
        style={{ height: chartHeight, minHeight: chartHeight, minWidth: 0 }}
      >
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
                minWidth: 0,
                minHeight: chartHeight,
              })
            : child
        )}
      </div>
    </div>
  );
}

export default PersonalAnalytics;
