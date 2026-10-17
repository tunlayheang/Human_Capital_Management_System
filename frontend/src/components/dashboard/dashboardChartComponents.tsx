import React, { useId, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { LoadingState } from '../common/LoadingState';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

export const COLORS = {
  primary: '#2563EB',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#0EA5E9',
  violet: '#7C3AED',
  slate: '#64748B',
};

export const CHART_COLORS = [
  '#2563EB',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#0EA5E9',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

const GRID_STROKE = 'rgba(148, 163, 184, 0.28)';
const AXIS_STROKE = 'rgba(148, 163, 184, 0.55)';
const TICK = { fontSize: 11, fill: '#94A3B8' } as const;

/** Turn raw codes / messy labels into readable chart copy. */
export function friendlyChartLabel(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return 'Other';

  const tenureMap: Record<string, string> = {
    'Staff More than 5 year': '5+ years',
    'Staff less than 5 year': '3–5 years',
    'Staff Less than 3 years': '1–3 years',
    'Staff Less than 1 Year': 'Under 1 year',
    '5+ years': '5+ years',
    '3–5 years': '3–5 years',
    '1–3 years': '1–3 years',
    'Under 1 year': 'Under 1 year',
  };
  if (tenureMap[value]) return tenureMap[value];

  let cleaned = value
    .replace(/^lt[-_]/i, '')
    .replace(/^ot[-_]/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return cleaned || 'Other';
}

export function withFriendlyNames<T extends { name: string }>(rows: T[]): Array<T & { name: string }> {
  return rows.map((row) => ({ ...row, name: friendlyChartLabel(row.name) }));
}

type TooltipEntry = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

export const CustomTooltip = ({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  valueFormatter?: (value: number, name?: string) => string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
      {label ? (
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
      ) : null}
      <div className="space-y-1">
        {payload.map((entry, index) => {
          const numeric = typeof entry.value === 'number' ? entry.value : Number(entry.value);
          const display =
            valueFormatter && Number.isFinite(numeric)
              ? valueFormatter(numeric, entry.name)
              : typeof entry.value === 'number'
                ? entry.value.toLocaleString()
                : String(entry.value ?? '—');
          return (
            <div key={`${entry.name}-${index}`} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color || COLORS.primary }}
              />
              <span className="text-slate-600 dark:text-slate-300">{entry.name}</span>
              <span className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-white">
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ChartEmptyState = ({
  message,
  loading = false,
}: {
  message: string;
  loading?: boolean;
}) =>
  loading ? (
    <LoadingState variant="inline" layout="cards" rows={1} label={message} className="h-[220px]" />
  ) : (
    <div className="flex h-[220px] flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 dark:bg-slate-800">
        <Activity className="h-5 w-5 text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nothing to show yet</p>
      <p className="mt-1 max-w-[16rem] text-xs text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );

export function asChartRows<T = Record<string, unknown>>(rows: unknown): T[] {
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function ChartCard({
  title,
  description,
  icon,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={cn(
        'glass-card relative flex h-full min-w-0 w-full flex-col overflow-hidden p-3 xs:p-3.5 sm:p-5 md:p-6 transition-all duration-300 hover:shadow-glass',
        className
      )}
    >
      <div className="mb-3 flex items-start gap-2.5 border-b border-white/40 pb-2.5 dark:border-white/10 sm:mb-4 sm:pb-3">
        {icon ? (
          <div className="glass-inset shrink-0 rounded-lg p-1.5 sm:p-2">{icon}</div>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold tracking-tight text-slate-800 dark:text-white sm:text-lg">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className={cn('dashboard-chart-body flex-1', bodyClassName)}>{children}</div>
    </div>
  );
}

function ChartShell({ children, height = 220 }: { children: React.ReactNode; height?: number }) {
  const chartHeight = Math.max(160, height);
  return (
    <div className="min-w-0 w-full overflow-hidden" style={{ height: chartHeight, minHeight: chartHeight }}>
      <ResponsiveContainer width="100%" height={chartHeight} minWidth={1} minHeight={1} debounce={50}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function legendFormatter(value: string) {
  return <span className="text-xs text-slate-600 dark:text-slate-300">{value}</span>;
}

export const LeaveChart = ({ data }: { data: Array<{ name: string; value: number }> }) => {
  const rows = useMemo(() => withFriendlyNames(data), [data]);
  const total = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);

  return (
    <ChartShell height={240}>
      <PieChart>
        <Pie
          data={rows}
          cx="50%"
          cy="46%"
          innerRadius={58}
          outerRadius={84}
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
          stroke="none"
        >
          {rows.map((row, index) => (
            <Cell key={`leave-${row.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          content={
            <CustomTooltip
              valueFormatter={(value, name) => {
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return `${value.toLocaleString()} requests · ${pct}%`;
              }}
            />
          }
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          iconType="circle"
          formatter={legendFormatter}
        />
        <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" fill="#0F172A" fontSize={22} fontWeight={700}>
          {total}
        </text>
        <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fill="#64748B" fontSize={10} letterSpacing="0.06em">
          REQUESTS
        </text>
      </PieChart>
    </ChartShell>
  );
};

export const PayrollChart = ({ data }: { data: Array<{ month: string; amount: number }> }) => {
  const gradientId = useId().replace(/:/g, '');
  return (
    <ChartShell>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`payroll-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="month" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
        <YAxis
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
        />
        <Tooltip
          content={
            <CustomTooltip valueFormatter={(value) => `$${value.toLocaleString()}`} />
          }
        />
        <Area
          type="monotone"
          dataKey="amount"
          name="Net payroll"
          stroke={COLORS.primary}
          strokeWidth={2.5}
          fill={`url(#payroll-fill-${gradientId})`}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartShell>
  );
};

export const HeadcountChart = ({ data }: { data: Array<{ month: string; count: number }> }) => (
  <ChartShell>
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="month" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
      <YAxis
        tick={TICK}
        stroke={AXIS_STROKE}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
        width={36}
      />
      <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v.toLocaleString()} people`} />} />
      <Bar dataKey="count" name="Employees" fill={COLORS.info} radius={[8, 8, 0, 0]} maxBarSize={36} />
    </BarChart>
  </ChartShell>
);

export const AttendanceChart = ({
  data,
}: {
  data: Array<{ day: string; present: number; absent: number }>;
}) => {
  const rows = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        day: String(row.day || '')
          .replace(/^(\w{3})\s/, '$1 ')
          .trim(),
      })),
    [data]
  );

  return (
    <ChartShell height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="day" tick={{ ...TICK, fontSize: 10 }} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
        <YAxis
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={32}
        />
        <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v.toLocaleString()} people`} />} />
        <Legend iconType="circle" formatter={legendFormatter} />
        <Bar dataKey="present" name="Present" fill={COLORS.success} radius={[6, 6, 0, 0]} maxBarSize={18} />
        <Bar dataKey="absent" name="Absent" fill={COLORS.danger} radius={[6, 6, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartShell>
  );
};

export const EmploymentStatusChart = ({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) => {
  const rows = useMemo(() => withFriendlyNames(data), [data]);
  const total = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  const palette = [COLORS.violet, COLORS.warning, COLORS.info, COLORS.slate];

  return (
    <ChartShell height={240}>
      <PieChart>
        <Pie
          data={rows}
          cx="50%"
          cy="46%"
          innerRadius={58}
          outerRadius={84}
          paddingAngle={4}
          dataKey="value"
          nameKey="name"
          stroke="none"
        >
          {rows.map((row, index) => (
            <Cell key={`status-${row.name}`} fill={palette[index % palette.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v.toLocaleString()} people`} />} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={legendFormatter} />
        <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" fill="#0F172A" fontSize={22} fontWeight={700}>
          {total}
        </text>
        <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fill="#64748B" fontSize={10} letterSpacing="0.06em">
          PEOPLE
        </text>
      </PieChart>
    </ChartShell>
  );
};

export const VerticalValueChart = ({
  data,
  valueKey = 'value',
  color = COLORS.primary,
  tickFormatter,
  valueLabel = 'Amount',
}: {
  data: Array<Record<string, string | number>>;
  valueKey?: string;
  color?: string;
  tickFormatter?: (v: number) => string;
  valueLabel?: string;
}) => {
  const rows = useMemo(
    () =>
      data.map((row) => ({
        ...row,
        name: friendlyChartLabel(row.name),
      })),
    [data]
  );

  return (
    <ChartShell height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 40 }} barCategoryGap="24%">
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ ...TICK, fontSize: 10 }}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-24}
          textAnchor="end"
          height={52}
        />
        <YAxis
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          tickFormatter={tickFormatter}
          allowDecimals={false}
          width={40}
        />
        <Tooltip
          content={
            <CustomTooltip
              valueFormatter={(v) =>
                tickFormatter ? tickFormatter(v) : v.toLocaleString()
              }
            />
          }
        />
        <Bar dataKey={valueKey} name={valueLabel} fill={color} radius={[8, 8, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ChartShell>
  );
};

export const HorizontalNamedChart = ({
  data,
  color = COLORS.primary,
  yWidth = 120,
  valueLabel = 'Count',
  valueFormatter,
}: {
  data: Array<{ name: string; value: number }>;
  color?: string;
  yWidth?: number;
  valueLabel?: string;
  valueFormatter?: (value: number) => string;
}) => {
  const rows = useMemo(() => withFriendlyNames(data), [data]);
  const height = Math.max(220, Math.min(360, rows.length * 34 + 48));

  return (
    <ChartShell height={height}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
        barCategoryGap="18%"
      >
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} horizontal={false} />
        <XAxis
          type="number"
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...TICK, fontSize: 11 }}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          width={Math.min(Math.max(yWidth, 88), 160)}
        />
        <Tooltip
          content={
            <CustomTooltip
              valueFormatter={(v) => (valueFormatter ? valueFormatter(v) : v.toLocaleString())}
            />
          }
        />
        <Bar dataKey="value" name={valueLabel} fill={color} radius={[0, 8, 8, 0]} maxBarSize={18} />
      </BarChart>
    </ChartShell>
  );
};

export const TeamAttendanceRateChart = ({
  data,
}: {
  data: Array<{ name: string; performance: number }>;
}) => {
  const rows = useMemo(
    () =>
      data.map((row) => ({
        name: friendlyChartLabel(row.name),
        rate: Number(row.performance) || 0,
      })),
    [data]
  );

  return (
    <ChartShell height={Math.max(220, Math.min(340, rows.length * 34 + 48))}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...TICK, fontSize: 11 }}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v}% present`} />} />
        <Bar dataKey="rate" name="Present rate" fill={COLORS.success} radius={[0, 8, 8, 0]} maxBarSize={16} />
      </BarChart>
    </ChartShell>
  );
};

export const HoursWorkedChart = ({
  data,
}: {
  data: Array<{ day: string; hours: number; status?: string }>;
}) => (
  <ChartShell>
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="day" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
      <YAxis
        tick={TICK}
        stroke={AXIS_STROKE}
        axisLine={false}
        tickLine={false}
        width={32}
        tickFormatter={(v) => `${v}h`}
      />
      <Tooltip content={<CustomTooltip valueFormatter={(v) => `${Number(v).toFixed(1)} hrs`} />} />
      <Bar dataKey="hours" name="Hours worked" fill={COLORS.success} radius={[8, 8, 0, 0]} maxBarSize={28} />
    </BarChart>
  </ChartShell>
);

export const AttendanceSnapshotChart = ({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) => {
  const rows = useMemo(() => withFriendlyNames(data), [data]);
  return (
    <ChartShell>
      <PieChart>
        <Pie
          data={rows}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={4}
          dataKey="value"
          nameKey="name"
          stroke="none"
        >
          {rows.map((_, index) => (
            <Cell key={`att-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend iconType="circle" formatter={legendFormatter} />
      </PieChart>
    </ChartShell>
  );
};

export const AttendanceRateLineChart = ({
  data,
}: {
  data: Array<{ month: string; attendanceRatePct: number }>;
}) => (
  <ChartShell height={240}>
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="month" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
      <YAxis
        tick={TICK}
        stroke={AXIS_STROKE}
        axisLine={false}
        tickLine={false}
        domain={[0, 100]}
        tickFormatter={(v) => `${v}%`}
        width={40}
      />
      <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v}%`} />} />
      <Line
        type="monotone"
        dataKey="attendanceRatePct"
        name="Attendance rate"
        stroke={COLORS.primary}
        strokeWidth={2.5}
        dot={{ r: 3, strokeWidth: 0 }}
        activeDot={{ r: 5 }}
      />
    </LineChart>
  </ChartShell>
);

export const LateTrendLineChart = ({
  data,
}: {
  data: Array<{ month: string; late: number }>;
}) => (
  <ChartShell height={240}>
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="month" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
      <YAxis
        tick={TICK}
        stroke={AXIS_STROKE}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
        width={32}
      />
      <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v} late`} />} />
      <Line
        type="monotone"
        dataKey="late"
        name="Late arrivals"
        stroke={COLORS.warning}
        strokeWidth={2.5}
        dot={{ r: 3, strokeWidth: 0 }}
      />
    </LineChart>
  </ChartShell>
);

export const MonthlyMetricBarChart = ({
  data,
  dataKey,
  name,
  color = COLORS.primary,
  valueFormatter,
}: {
  data: Array<{ month: string } & Record<string, string | number>>;
  dataKey: string;
  name: string;
  color?: string;
  valueFormatter?: (value: number) => string;
}) => (
  <ChartShell height={240}>
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
      <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="month" tick={TICK} stroke={AXIS_STROKE} axisLine={false} tickLine={false} />
      <YAxis
        tick={TICK}
        stroke={AXIS_STROKE}
        axisLine={false}
        tickLine={false}
        allowDecimals={false}
        width={36}
      />
      <Tooltip
        content={
          <CustomTooltip
            valueFormatter={(value) =>
              valueFormatter ? valueFormatter(value) : value.toLocaleString()
            }
          />
        }
      />
      <Bar dataKey={dataKey} name={name} fill={color} radius={[8, 8, 0, 0]} maxBarSize={32} />
    </BarChart>
  </ChartShell>
);

export const DepartmentRateChart = ({
  data,
}: {
  data: Array<{ name: string; ratePct: number }>;
}) => {
  const rows = useMemo(() => withFriendlyNames(data as Array<{ name: string; ratePct: number }>), [data]);
  return (
    <ChartShell height={240}>
      <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 20, left: 8, bottom: 5 }}>
        <CartesianGrid strokeDasharray="4 6" stroke={GRID_STROKE} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={TICK}
          stroke={AXIS_STROKE}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<CustomTooltip valueFormatter={(v) => `${v}%`} />} />
        <Bar dataKey="ratePct" name="Attendance rate" fill={COLORS.success} radius={[0, 8, 8, 0]} maxBarSize={18} />
      </BarChart>
    </ChartShell>
  );
};

export const DepartmentChart = ({ data }: { data: Array<{ name: string; value: number }> }) => (
  <HorizontalNamedChart data={data} color={COLORS.primary} yWidth={100} valueLabel="Employees" />
);
