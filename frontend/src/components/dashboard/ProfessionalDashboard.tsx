import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Role, User } from '../../types';
import { Api } from '../../services/api';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { useLanguage } from '../../context/LanguageContext';
import {
    Users,
    Clock,
    Calendar,
    CalendarDays,
    CalendarCheck,
    Briefcase,
    CreditCard,
    ArrowRight,
    Building2,
    ClipboardList,
    FileBarChart,
    Wallet,
    Banknote,
    UsersRound,
    UserCheck,
    UserX,
    ContactRound,
    FolderKanban,
    Timer,
    LogIn,
    Activity,
    LineChart,
    TrendingUp,
    Shield,
    Bell,
    Award,
    Gift,
    Cake,
    PartyPopper,
    Mars,
    Venus,
    MapPin,
    Globe2,
} from 'lucide-react';
import { DashboardDateFilter } from './DashboardDateFilter';
import { useDashboardReport, useManagerDashboardReport } from '../../hooks/useDashboardReport';
import { useRegisterPullToRefresh } from '../../context/PullToRefreshContext';
import { formatRangeLabel, todayYmd } from '../../utils/dashboardDateRange';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import { formatPayrollCompact } from '../../utils/payrollCurrencyDisplay';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';
import { onAvatarImageError, resolveMediaUrl } from '../../utils/mediaUrl';
import { DashboardActionInboxSection } from './DashboardActionInboxSection';
import { DashboardWelcomeBanner } from './DashboardWelcomeBanner';
import { resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import { formatRelativeTime } from '../../utils';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { LoadingState } from '../common/LoadingState';
import { ContentSkeleton } from '../common/ContentSkeleton';
import {
    AttendanceChart,
    ChartCard,
    ChartEmptyState,
    COLORS,
    EmploymentStatusChart,
    HeadcountChart,
    HorizontalNamedChart,
    HoursWorkedChart,
    LeaveChart,
    PayrollChart,
    TeamAttendanceRateChart,
    VerticalValueChart,
    asChartRows,
} from './dashboardChartComponents';

function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  return <div className="dashboard-shell space-y-4 sm:space-y-5 md:space-y-6">{children}</div>;
}

const MGMT_PROJECTS_SEARCH = '?scope=manage&tab=overview';
const MGMT_ATTENDANCE_SEARCH = '?scope=manage';
const SELF_ATTENDANCE_SEARCH = '?scope=self';

// ===== STAT CARD =====
const StatCard = ({ icon: Icon, label, value, trend, color, onClick, suffix, hint, loading }: {
    icon: React.ElementType;
    label: string;
    value: string | number;
    trend?: number;
    color: string;
    onClick?: () => void;
    suffix?: string;
    hint?: string;
    loading?: boolean;
}) => {
    if (loading) {
        return (
            <div className="surface-card rounded-xl p-5 animate-pulse">
                <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                </div>
                <div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded mb-2"></div>
                <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
            </div>
        );
    }
    return (
        <button 
            onClick={onClick}
            title={hint}
            className="surface-card rounded-xl p-3 sm:p-4 md:p-5 hover:shadow-glass hover:border-primary-300/60 dark:hover:border-primary-600/50 transition-all duration-300 text-left group relative overflow-hidden w-full min-w-0"
        >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-primary-500/10 to-transparent rounded-bl-full -mr-4 -mt-4"></div>
            <div className="flex items-start justify-between mb-2 sm:mb-3 relative">
                <div className={`p-2 sm:p-2.5 rounded-xl ${color} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                {trend !== undefined && (
                    <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                        trend >= 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                        <TrendingUp className={`w-3 h-3 ${trend < 0 ? 'rotate-180' : ''}`} />
                        {Math.abs(trend)}%
                    </div>
                )}
            </div>
            <p className="text-sm sm:text-base md:text-lg font-bold text-slate-900 dark:text-white tabular-nums">{value}{suffix && <span className="text-[10px] sm:text-xs font-medium text-slate-500 ml-1">{suffix}</span>}</p>
            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 font-medium leading-tight line-clamp-2">{label}</p>
            {hint ? (
                <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight line-clamp-1">{hint}</p>
            ) : null}
        </button>
    );
};

// ===== CHART EMPTY STATE =====
// ChartEmptyState / asChartRows imported from dashboardChartComponents

function dashboardNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function readStat(source: Record<string, unknown> | null | undefined, key: string, fallback = 0): number {
    return dashboardNumber(source?.[key], fallback);
}

function DashboardSection({
    title,
    children,
}: {
    title?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="dashboard-section">
            {title ? <h2 className="dashboard-section__title">{title}</h2> : null}
            {children}
        </section>
    );
}

function WorkforceDemoCards({
    stat,
    loading,
    onEmployees,
    onMaleEmployees,
    onFemaleEmployees,
}: {
    stat: Record<string, unknown>;
    loading: boolean;
    onEmployees: () => void;
    onMaleEmployees: () => void;
    onFemaleEmployees: () => void;
}) {
    return (
        <>
            <StatCard
                icon={Mars}
                label="Male"
                value={loading ? '—' : readStat(stat, 'maleCount')}
                loading={loading}
                color="bg-slate-700"
                onClick={onMaleEmployees}
            />
            <StatCard
                icon={Venus}
                label="Female"
                value={loading ? '—' : readStat(stat, 'femaleCount')}
                loading={loading}
                color="bg-sky-600"
                onClick={onFemaleEmployees}
            />
            <StatCard
                icon={MapPin}
                label="Phnom Penh"
                value={loading ? '—' : readStat(stat, 'phnomPenhCount')}
                loading={loading}
                color="bg-blue-800"
                onClick={onEmployees}
            />
            <StatCard
                icon={Globe2}
                label="Provinces"
                value={loading ? '—' : readStat(stat, 'provinceCount')}
                loading={loading}
                color="bg-orange-600"
                onClick={onEmployees}
            />
        </>
    );
}

type ProjectProgressRow = { name: string; deadline: string; status: string; progress: number };

function MasterlistChartSection({
    charts,
    loading,
}: {
    charts: Record<string, unknown> | null | undefined;
    loading: boolean;
}) {
    const employmentStatus = asChartRows<{ name: string; value: number }>(charts?.employmentStatus);
    const salaryByRole = asChartRows<{ name: string; value: number }>(charts?.salaryByRole);
    const staffByRole = asChartRows<{ name: string; value: number }>(charts?.staffByRole);

    const hasEmploymentStatus = employmentStatus.some((r) => Number(r.value) > 0);

    return (
        <DashboardSection title="Workforce composition">
            <div className="dashboard-chart-grid--3">
                <ChartCard
                    title="Active vs inactive"
                    description="Headcount by employment status at the end of the selected period."
                >
                    {hasEmploymentStatus ? (
                        <EmploymentStatusChart data={employmentStatus} />
                    ) : (
                        <ChartEmptyState loading={loading} message="No employment status data for this period." />
                    )}
                </ChartCard>
                <ChartCard
                    title="Base salary by role"
                    description="Sum of contract base salaries grouped by role or position level."
                >
                    {salaryByRole.length > 0 ? (
                        <VerticalValueChart
                            data={salaryByRole}
                            color={COLORS.primary}
                            valueLabel="Base salary"
                            tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
                        />
                    ) : (
                        <ChartEmptyState loading={loading} message="No salary data by role for this period." />
                    )}
                </ChartCard>
                <ChartCard
                    title="Staff by role"
                    description="How many people sit in each role or level."
                >
                    {staffByRole.length > 0 ? (
                        <HorizontalNamedChart
                            data={staffByRole}
                            color={COLORS.info}
                            yWidth={130}
                            valueLabel="People"
                            valueFormatter={(v) => `${v.toLocaleString()} people`}
                        />
                    ) : (
                        <ChartEmptyState loading={loading} message="No staff-by-role data for this period." />
                    )}
                </ChartCard>
            </div>
        </DashboardSection>
    );
}

type CelebrationRow = {
    key: string;
    userName: string;
    avatarUrl?: string;
    eventType: 'birthday' | 'anniversary';
    eventDate: Date;
    daysDiff: number;
    position?: string;
};

function parseDateSafe(raw?: string | null): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function buildNearestAnnualDate(base: Date, today: Date): Date {
    const month = base.getMonth();
    const day = base.getDate();
    const candidates = [
        new Date(today.getFullYear() - 1, month, day),
        new Date(today.getFullYear(), month, day),
        new Date(today.getFullYear() + 1, month, day),
    ];
    let best = candidates[0];
    let bestAbs = Math.abs(candidates[0].getTime() - today.getTime());
    for (let i = 1; i < candidates.length; i++) {
        const abs = Math.abs(candidates[i].getTime() - today.getTime());
        if (abs < bestAbs) {
            bestAbs = abs;
            best = candidates[i];
        }
    }
    return best;
}

function offsetTopWithinAncestor(el: HTMLElement, ancestor: HTMLElement): number {
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== ancestor) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
        if (!node || !ancestor.contains(node)) break;
    }
    return top;
}

function celebrationLabel(daysDiff: number): string {
    if (daysDiff === 0) return 'Today';
    if (daysDiff > 0) return `In ${daysDiff} day${daysDiff > 1 ? 's' : ''}`;
    const abs = Math.abs(daysDiff);
    return `${abs} day${abs > 1 ? 's' : ''} ago`;
}

function sortCelebrationRows(rows: CelebrationRow[]): CelebrationRow[] {
    return [...rows].sort((a, b) => {
        if (b.daysDiff !== a.daysDiff) return b.daysDiff - a.daysDiff;
        return a.userName.localeCompare(b.userName);
    });
}

const CelebrationEventRow: React.FC<{
    item: CelebrationRow;
    ghost?: boolean;
}> = ({ item, ghost }) => {
    const isToday = item.daysDiff === 0;
    const isUrgentUpcoming = item.daysDiff > 0 && item.daysDiff <= 3;
    const initials =
        item.userName
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join('') || 'E';
    const label = celebrationLabel(item.daysDiff);
    const isBirthday = item.eventType === 'birthday';

    return (
        <div
            className={`flex items-center gap-2.5 min-w-0 rounded-md px-1 py-1.5 ${
                ghost ? 'invisible' : ''
            } ${
                isToday
                    ? 'bg-rose-50/90 dark:bg-rose-950/25'
                    : isUrgentUpcoming
                      ? 'bg-amber-50/70 dark:bg-amber-950/20'
                      : ''
            }`}
        >
            {item.avatarUrl ? (
                <img
                    src={resolveMediaUrl(item.avatarUrl) || item.avatarUrl}
                    alt={item.userName}
                    className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200/80 dark:ring-slate-600"
                    loading="lazy"
                    onError={onAvatarImageError}
                />
            ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600">
                    {initials}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                    {item.userName}
                </p>
                <p
                    className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${
                        isBirthday
                            ? 'text-pink-600/90 dark:text-pink-400'
                            : 'text-indigo-600/90 dark:text-indigo-400'
                    }`}
                >
                    {isBirthday ? (
                        <Cake className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden />
                    ) : (
                        <Award className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden />
                    )}
                    <span>{isBirthday ? 'Birthday' : 'Anniversary'}</span>
                </p>
            </div>
            <span
                className={`shrink-0 text-[10px] tabular-nums ${
                    isToday
                        ? 'font-semibold text-rose-600 dark:text-rose-300'
                        : isUrgentUpcoming
                          ? 'font-medium text-amber-700 dark:text-amber-300'
                          : 'text-slate-500 dark:text-slate-400'
                }`}
            >
                {label}
            </span>
        </div>
    );
};

const CelebrationSectionLabel: React.FC<{
    kind: 'birthday' | 'anniversary';
}> = ({ kind }) => {
    const isBirthday = kind === 'birthday';
    return (
        <div className="flex items-center gap-1.5 px-1 pt-0.5 pb-0.5 first:pt-0">
            {isBirthday ? (
                <Cake className="h-3 w-3 text-pink-500/80" aria-hidden />
            ) : (
                <Award className="h-3 w-3 text-indigo-500/80" aria-hidden />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {isBirthday ? 'Birthdays' : 'Anniversaries'}
            </span>
        </div>
    );
};

type CelebrationUser = Pick<User, 'id' | 'name' | 'avatarUrl' | 'position' | 'birthDate' | 'joinDate'>;

/** Org-wide for Admin/HR; pass `users` for Manager team-scoped celebrations. */
const BirthdaysAnniversariesCard: React.FC<{
  users?: CelebrationUser[] | null;
  /** When true and users omitted, load all portal users (Admin/HR only). */
  loadOrgUsers?: boolean;
}> = ({ users: usersProp, loadOrgUsers = false }) => {
    const [users, setUsers] = useState<CelebrationUser[]>(() =>
      Array.isArray(usersProp) ? usersProp : []
    );
    const [loading, setLoading] = useState(!Array.isArray(usersProp) && loadOrgUsers);
    const [pinSoonest, setPinSoonest] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const soonestRowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (Array.isArray(usersProp)) {
            setUsers(usersProp);
            setLoading(false);
            return;
        }
        if (!loadOrgUsers) {
            setUsers([]);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        Api.users
            .getDirectory()
            .then((rows) => {
                if (cancelled) return;
                setUsers(Array.isArray(rows) ? (rows as User[]) : []);
            })
            .catch(() => {
                if (cancelled) return;
                setUsers([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [usersProp, loadOrgUsers]);

    const events = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const out: CelebrationRow[] = [];

        for (const u of users) {
            const birth = parseDateSafe(u.birthDate);
            if (birth) {
                const nearest = buildNearestAnnualDate(birth, today);
                const daysDiff = Math.round(
                    (nearest.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysDiff >= -15 && daysDiff <= 15) {
                    out.push({
                        key: `${u.id}-birthday-${nearest.toISOString()}`,
                        userName: u.name || 'Employee',
                        avatarUrl: u.avatarUrl,
                        eventType: 'birthday',
                        eventDate: nearest,
                        daysDiff,
                        position: u.position,
                    });
                }
            }

            const joined = parseDateSafe(u.joinDate);
            if (joined) {
                const nearest = buildNearestAnnualDate(joined, today);
                const daysDiff = Math.round(
                    (nearest.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysDiff >= -15 && daysDiff <= 15) {
                    out.push({
                        key: `${u.id}-anniversary-${nearest.toISOString()}`,
                        userName: u.name || 'Employee',
                        avatarUrl: u.avatarUrl,
                        eventType: 'anniversary',
                        eventDate: nearest,
                        daysDiff,
                        position: u.position,
                    });
                }
            }
        }

        return out;
    }, [users]);

    const birthdayEvents = useMemo(
        () => sortCelebrationRows(events.filter((item) => item.eventType === 'birthday')),
        [events]
    );

    const anniversaryEvents = useMemo(
        () => sortCelebrationRows(events.filter((item) => item.eventType === 'anniversary')),
        [events]
    );

    const soonestIncoming = useMemo(() => {
        const upcoming = events.filter((item) => item.daysDiff >= 0);
        if (!upcoming.length) return null;
        return upcoming.reduce((best, item) => (item.daysDiff < best.daysDiff ? item : best));
    }, [events]);

    const updateSoonestPin = useCallback(() => {
        const list = listRef.current;
        const row = soonestRowRef.current;
        if (!list || !row || !soonestIncoming) {
            setPinSoonest(false);
            return;
        }
        const scrollTop = list.scrollTop;
        const itemTop = offsetTopWithinAncestor(row, list);
        const itemBottom = itemTop + row.offsetHeight;
        setPinSoonest(scrollTop > itemTop && scrollTop < itemBottom);
    }, [soonestIncoming]);

    useLayoutEffect(() => {
        updateSoonestPin();
    }, [events, soonestIncoming, updateSoonestPin]);

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const onScroll = () => updateSoonestPin();
        list.addEventListener('scroll', onScroll, { passive: true });
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSoonestPin) : null;
        ro?.observe(list);
        window.addEventListener('resize', updateSoonestPin);
        return () => {
            list.removeEventListener('scroll', onScroll);
            ro?.disconnect();
            window.removeEventListener('resize', updateSoonestPin);
        };
    }, [updateSoonestPin, events.length, soonestIncoming?.key]);

    const renderEventRows = (items: CelebrationRow[]) =>
        items.map((item) => {
            const isSoonest = soonestIncoming?.key === item.key;
            return (
                <div key={item.key} ref={isSoonest ? soonestRowRef : undefined}>
                    <CelebrationEventRow item={item} ghost={Boolean(pinSoonest && isSoonest)} />
                </div>
            );
        });

    return (
        <Card
            title="Birthdays & Anniversaries"
            icon={<Gift className="w-4 h-4 text-pink-500" />}
            className="dashboard-celebrations-card"
        >
            {loading ? (
                <div className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/40" />
            ) : events.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                    No events in the next 15 days.
                </p>
            ) : (
                <div
                    ref={listRef}
                    className="relative max-h-48 sm:max-h-56 overflow-y-auto pr-0.5"
                >
                    {pinSoonest && soonestIncoming ? (
                        <div
                            className="sticky top-0 z-20 -mx-0.5 mb-1 rounded-md border border-slate-200/70 bg-white/95 px-0.5 py-0.5 shadow-sm backdrop-blur-sm dark:border-slate-600/60 dark:bg-slate-900/95"
                            aria-hidden={false}
                        >
                            <CelebrationEventRow item={soonestIncoming} />
                        </div>
                    ) : null}
                    <div className="flex flex-col gap-0.5">
                        {birthdayEvents.length > 0 ? (
                            <>
                                <CelebrationSectionLabel kind="birthday" />
                                {renderEventRows(birthdayEvents)}
                            </>
                        ) : null}
                        {anniversaryEvents.length > 0 ? (
                            <>
                                <CelebrationSectionLabel kind="anniversary" />
                                {renderEventRows(anniversaryEvents)}
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </Card>
    );
};

// ===== ROLE DASHBOARDS =====

const AdminDashboard = () => {
    const { goTo, navigate } = useWorkspaceNavigate();
    const { t } = useLanguage();
    const { currency } = usePreferredCurrency();
    const { range, setRange, stats, charts, periodLabel, loading, reload } = useDashboardReport(true);
    useRegisterPullToRefresh(reload);
    const stat = (stats ?? {}) as Record<string, unknown>;

    const leaveData = asChartRows<{ name: string; value: number }>(charts?.leaveDistribution).filter(
        (row: { value?: number }) => Number(row.value) > 0
    );
    const lengthOfEmployment = asChartRows<{ name: string; value: number }>(charts?.lengthOfEmployment);
    const payrollData = asChartRows<{ month: string; amount: number }>(charts?.payrollHistory);
    const headcountData = asChartRows<{ month: string; count: number }>(charts?.headcountHistory);
    const attData = asChartRows<{ day: string; present: number; absent: number }>(charts?.attendanceHistory);

    const payrollTotal =
        Number((stat.payrollRun as { inPeriod?: number } | undefined)?.inPeriod ?? stat.payrollInPeriod ?? 0) || 0;
    const payrollLabel =
        payrollTotal > 0 ? formatPayrollCompact(payrollTotal, { currency }) : '—';
    const snapshotLabel = range.endDate === todayYmd() ? 'Today' : range.endDate;

    return (
        <DashboardPageLayout>
            <div className="dashboard-toolbar">
                <div className="dashboard-toolbar__filter">
                    <DashboardDateFilter
                        value={range}
                        onChange={setRange}
                        periodLabel={periodLabel || formatRangeLabel(range.startDate, range.endDate)}
                        loading={loading}
                    />
                </div>
                <div className="dashboard-toolbar__queues">
                    <DashboardActionInboxSection />
                </div>
            </div>

            <DashboardSection title="Operations overview">
                <div className="dashboard-stat-grid--overview">
                    <StatCard icon={Users} label="Employees (period end)" value={loading ? '—' : readStat(stat, 'totalEmployees')} loading={loading} color="bg-blue-600" onClick={() => navigate('/employees')} />
                    <StatCard icon={Building2} label={t('nav.departments') || 'Departments'} value={loading ? '—' : readStat(stat, 'totalDepartments')} loading={loading} color="bg-indigo-600" onClick={() => navigate('/departments')} />
                    <StatCard icon={UserCheck} label={`Present (${snapshotLabel})`} value={loading ? '—' : readStat(stat, 'presentToday')} loading={loading} color="bg-primary-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={UserX} label={`Absent (${snapshotLabel})`} value={loading ? '—' : readStat(stat, 'absentToday')} loading={loading} color="bg-rose-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={FolderKanban} label={t('nav.projects') || 'Active Projects'} value={loading ? '—' : readStat(stat, 'activeProjects')} loading={loading} color="bg-amber-600" onClick={() => goTo('/projects', MGMT_PROJECTS_SEARCH)} />
                    <StatCard icon={Banknote} label="Payroll (period)" value={loading ? '—' : payrollLabel} loading={loading} color="bg-green-600" onClick={() => navigate('/payroll')} />
                </div>
            </DashboardSection>

            <DashboardSection title="Workforce demographics">
                <div className="dashboard-stat-grid--quad">
                    <WorkforceDemoCards
                        stat={stat}
                        loading={loading}
                        onEmployees={() => navigate('/employees')}
                        onMaleEmployees={() => navigate('/employees/onboarding?gender=Male')}
                        onFemaleEmployees={() => navigate('/employees/onboarding?gender=Female')}
                    />
                </div>
            </DashboardSection>

            <DashboardSection title="Attendance & leave">
                <div className="dashboard-mid-grid">
                    <BirthdaysAnniversariesCard loadOrgUsers />
                    <ChartCard
                        title="Daily attendance"
                        description="Present and absent headcount across recent weekdays in this period."
                    >
                        {attData.length > 0 ? (
                            <AttendanceChart data={attData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No attendance records for recent weekdays." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Leave by type"
                        description="Approved and pending leave requests grouped by leave type."
                    >
                        {leaveData.length > 0 ? (
                            <LeaveChart data={leaveData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No leave activity in this period." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Years of service"
                        description="How long current employees have been with the company."
                    >
                        {lengthOfEmployment.some((r) => Number(r.value) > 0) ? (
                            <HorizontalNamedChart
                                data={lengthOfEmployment}
                                color={COLORS.success}
                                yWidth={110}
                                valueLabel="People"
                                valueFormatter={(v) => `${v.toLocaleString()} people`}
                            />
                        ) : (
                            <ChartEmptyState loading={loading} message="No tenure data for this period." />
                        )}
                    </ChartCard>
                </div>
            </DashboardSection>

            <DashboardSection title="Trends">
                <div className="dashboard-chart-grid--2">
                    <ChartCard
                        title="Payroll trend"
                        description="Completed payroll net pay by month in the selected period."
                    >
                        {payrollData.length > 0 ? (
                            <PayrollChart data={payrollData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No completed payroll runs in this period." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Headcount trend"
                        description="Active employee count at the end of each month."
                    >
                        {headcountData.length > 0 ? (
                            <HeadcountChart data={headcountData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No headcount history for this period." />
                        )}
                    </ChartCard>
                </div>
            </DashboardSection>

            <MasterlistChartSection charts={charts as Record<string, unknown> | undefined} loading={loading} />
        </DashboardPageLayout>
    );
};

const HRDashboard = () => {
    const { goTo, navigate } = useWorkspaceNavigate();
    const { t } = useLanguage();
    const { currency } = usePreferredCurrency();
    const { range, setRange, stats, charts, periodLabel, loading, reload } = useDashboardReport(true);
    useRegisterPullToRefresh(reload);
    const stat = (stats ?? {}) as Record<string, unknown>;
    const chartSummary = (charts?.summary ?? {}) as Record<string, unknown>;

    const leaveData = asChartRows<{ name: string; value: number }>(charts?.leaveDistribution).filter(
        (row: { value?: number }) => Number(row.value) > 0
    );
    const lengthOfEmployment = asChartRows<{ name: string; value: number }>(charts?.lengthOfEmployment);
    const payrollData = asChartRows<{ month: string; amount: number }>(charts?.payrollHistory);
    const headcountData = asChartRows<{ month: string; count: number }>(charts?.headcountHistory);
    const attData = asChartRows<{ day: string; present: number; absent: number }>(charts?.attendanceHistory);
    const snapshotLabel = range.endDate === todayYmd() ? 'Today' : range.endDate;
    const payrollTotal =
        Number((stat.payrollRun as { inPeriod?: number } | undefined)?.inPeriod ?? stat.payrollInPeriod ?? 0) || 0;
    const payrollLabel =
        payrollTotal > 0 ? formatPayrollCompact(payrollTotal, { currency }) : '—';

    const criticalAlerts = [
        {
            type: Number(readStat(stat, 'pendingLeaveRequests')) > 0 ? 'urgent' : 'info',
            title: `${readStat(stat, 'pendingLeaveRequests')} pending leave request${readStat(stat, 'pendingLeaveRequests') === 1 ? '' : 's'}`,
            action: 'Open leave approvals',
            href: '/leaves?scope=manage&tab=requests',
        },
        {
            type: Number(readStat(stat, 'absentToday')) > 0 ? 'warning' : 'info',
            title: `${readStat(stat, 'absentToday')} absent employee${readStat(stat, 'absentToday') === 1 ? '' : 's'} on ${snapshotLabel}`,
            action: 'Review attendance',
            href: '/attendance?scope=manage',
        },
        {
            type: Number(readStat(stat, 'turnoverLeavers')) > 0 ? 'warning' : 'info',
            title: `${readStat(stat, 'turnoverLeavers')} employee separation${readStat(stat, 'turnoverLeavers') === 1 ? '' : 's'} in this period`,
            action: 'Review employee list',
            href: '/employees',
        },
    ];

    const liveHrSummary = [
        {
            type: 'review',
            title: `${readStat(stat, 'totalEmployees')} employees across ${readStat(stat, 'totalDepartments')} departments`,
            date: snapshotLabel,
        },
        {
            type: 'training',
            title: `${readStat(stat, 'activeProjects')} active project${readStat(stat, 'activeProjects') === 1 ? '' : 's'}`,
            date: periodLabel || formatRangeLabel(range.startDate, range.endDate),
        },
        {
            type: 'payroll',
            title: `Payroll in period: ${payrollLabel}`,
            date: periodLabel || formatRangeLabel(range.startDate, range.endDate),
        },
        {
            type: 'holiday',
            title: `Present rate ${readStat(stat, 'presentRate').toFixed(1)}%`,
            date: periodLabel || formatRangeLabel(range.startDate, range.endDate),
        }
    ];

    return (
        <DashboardPageLayout>
            <div className="dashboard-toolbar">
                <div className="dashboard-toolbar__filter">
                    <DashboardDateFilter
                        value={range}
                        onChange={setRange}
                        periodLabel={periodLabel || formatRangeLabel(range.startDate, range.endDate)}
                        loading={loading}
                    />
                </div>
                <div className="dashboard-toolbar__queues">
                    <DashboardActionInboxSection />
                </div>
            </div>

            <DashboardSection title="Operations overview">
                <div className="dashboard-stat-grid--overview">
                    <StatCard icon={Users} label="Employees (period end)" value={loading ? '—' : readStat(stat, 'totalEmployees', readStat(chartSummary, 'totalEmployees'))} loading={loading} color="bg-blue-600" onClick={() => navigate('/employees')} />
                    <StatCard icon={Building2} label={t('nav.departments') || 'Departments'} value={loading ? '—' : readStat(stat, 'totalDepartments', readStat(chartSummary, 'totalDepartments'))} loading={loading} color="bg-indigo-600" onClick={() => navigate('/departments')} />
                    <StatCard icon={UserCheck} label={`Present (${snapshotLabel})`} value={loading ? '—' : readStat(stat, 'presentToday', readStat(chartSummary, 'presentToday'))} loading={loading} color="bg-primary-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={UserX} label={`Absent (${snapshotLabel})`} value={loading ? '—' : readStat(stat, 'absentToday', readStat(chartSummary, 'absentToday'))} loading={loading} color="bg-rose-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={FolderKanban} label={t('nav.projects') || 'Active Projects'} value={loading ? '—' : readStat(stat, 'activeProjects', readStat(chartSummary, 'activeProjects'))} loading={loading} color="bg-amber-600" onClick={() => goTo('/projects', MGMT_PROJECTS_SEARCH)} />
                    <StatCard icon={Banknote} label="Payroll (period)" value={loading ? '—' : payrollLabel} loading={loading} color="bg-green-600" onClick={() => navigate('/payroll')} />
                </div>
            </DashboardSection>

            <DashboardSection title="Workforce demographics">
                <div className="dashboard-stat-grid--quad">
                    <WorkforceDemoCards
                        stat={stat}
                        loading={loading}
                        onEmployees={() => navigate('/employees')}
                        onMaleEmployees={() => navigate('/employees/onboarding?gender=Male')}
                        onFemaleEmployees={() => navigate('/employees/onboarding?gender=Female')}
                    />
                </div>
            </DashboardSection>

            <DashboardSection title="Attendance & leave">
                <div className="dashboard-mid-grid">
                    <BirthdaysAnniversariesCard loadOrgUsers />
                    <ChartCard
                        title="Daily attendance"
                        description="Present and absent headcount across recent weekdays in this period."
                    >
                        {attData.length > 0 ? (
                            <AttendanceChart data={attData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No attendance records for recent weekdays." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Leave by type"
                        description="Leave requests in this period grouped by leave type."
                    >
                        {leaveData.length > 0 ? (
                            <LeaveChart data={leaveData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No leave activity in this period." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Years of service"
                        description="How long current employees have been with the company."
                    >
                        {lengthOfEmployment.some((r) => Number(r.value) > 0) ? (
                            <HorizontalNamedChart
                                data={lengthOfEmployment}
                                color={COLORS.success}
                                yWidth={110}
                                valueLabel="People"
                                valueFormatter={(v) => `${v.toLocaleString()} people`}
                            />
                        ) : (
                            <ChartEmptyState loading={loading} message="No tenure data for this period." />
                        )}
                    </ChartCard>
                </div>
            </DashboardSection>

            <DashboardSection title="Alerts & live summary">
                <div className="dashboard-feature-grid">
                    <Card title="Critical Alerts">
                        <div className="space-y-2">
                            {criticalAlerts.map((alert, i) => (
                                <div key={i} className={`p-2.5 rounded-lg border-l-4 ${
                                    alert.type === 'urgent' ? 'bg-red-50 dark:bg-red-900/20 border-red-500' :
                                    alert.type === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-500' :
                                    'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                                }`}>
                                    <p className="font-semibold text-sm text-slate-900 dark:text-white">{alert.title}</p>
                                    <button
                                        type="button"
                                        onClick={() => navigate(alert.href)}
                                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline mt-0.5"
                                    >
                                        {alert.action} →
                                    </button>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card title="Live HR Summary">
                        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                            {liveHrSummary.map((event, i) => (
                                <div key={i} className="p-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        {event.type === 'review' && <ClipboardList className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                                        {event.type === 'training' && <Shield className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                                        {event.type === 'payroll' && <Wallet className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                                        {event.type === 'holiday' && <PartyPopper className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                                        <span className="text-[11px] font-bold text-slate-500">{event.date}</span>
                                    </div>
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">{event.title}</p>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </DashboardSection>

            <DashboardSection title="Trends">
                <div className="dashboard-chart-grid--2">
                    <ChartCard
                        title="Payroll trend"
                        description="Completed payroll net pay by month in the selected period."
                    >
                        {payrollData.length > 0 ? (
                            <PayrollChart data={payrollData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No completed payroll runs in this period." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Headcount trend"
                        description="Active employee count at the end of each month."
                    >
                        {headcountData.length > 0 ? (
                            <HeadcountChart data={headcountData} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No headcount history for this period." />
                        )}
                    </ChartCard>
                </div>
            </DashboardSection>

            <MasterlistChartSection charts={charts as Record<string, unknown> | undefined} loading={loading} />
        </DashboardPageLayout>
    );
};

const ManagerDashboard = () => {
    const { goTo, navigate } = useWorkspaceNavigate();
    const { t, language } = useLanguage();
    const { range, setRange, teamStats, loading, periodLabel: managerPeriodLabel, reload } =
        useManagerDashboardReport(true);
    useRegisterPullToRefresh(reload);
    const team = (teamStats ?? {}) as Record<string, unknown>;
    const snapshotLabel = range.endDate === todayYmd() ? 'Today' : range.endDate;

    const teamPerformance = asChartRows<{ name: string; performance: number }>(team.teamPerformance);
    const weeklyActivities = asChartRows<{ day: string; present: number; absent: number }>(
      team.attendanceHistory
    );
    const projectProgress = asChartRows<ProjectProgressRow>(
      Array.isArray(team.projectProgress) ? team.projectProgress : []
    );

    if (loading) {
        return <ContentSkeleton layout="dashboard" />;
    }

    return (
        <DashboardPageLayout>
            <div className="dashboard-toolbar">
                <div className="dashboard-toolbar__filter">
                    <DashboardDateFilter
                        value={range}
                        onChange={setRange}
                        periodLabel={managerPeriodLabel || formatRangeLabel(range.startDate, range.endDate)}
                        loading={loading}
                    />
                </div>
                <div className="dashboard-toolbar__queues">
                    <DashboardActionInboxSection />
                </div>
            </div>

            <DashboardSection title="Team overview">
                <div className="dashboard-stat-grid">
                    <StatCard
                      icon={UsersRound}
                      label="Team Size"
                      value={readStat(team, 'teamSize')}
                      color="bg-blue-600"
                      onClick={() => {
                        const deptIds = Array.isArray(team.departmentIds)
                          ? (team.departmentIds as string[]).filter(Boolean)
                          : [];
                        if (deptIds.length === 1) {
                          navigate(`/employees?department_id=${encodeURIComponent(deptIds[0])}`);
                        } else {
                          navigate('/employees?filter=myteam');
                        }
                      }}
                    />
                    <StatCard icon={UserCheck} label={`Present (${snapshotLabel})`} value={readStat(team, 'presentToday')} color="bg-primary-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={UserX} label={`Absent (${snapshotLabel})`} value={readStat(team, 'absentToday')} color="bg-rose-600" onClick={() => goTo('/attendance', MGMT_ATTENDANCE_SEARCH)} />
                    <StatCard icon={FolderKanban} label="Active Projects" value={readStat(team, 'activeProjects')} color="bg-amber-600" onClick={() => goTo('/projects', MGMT_PROJECTS_SEARCH)} />
                    <StatCard
                      icon={ClipboardList}
                      label="Pending Leave"
                      value={readStat(team, 'pendingLeaveRequests')}
                      color="bg-violet-600"
                      onClick={() => navigate('/leaves?scope=manage&tab=requests')}
                    />
                </div>
            </DashboardSection>

            <DashboardSection title="Team moments">
                <BirthdaysAnniversariesCard
                  users={
                    Array.isArray(team.celebrationUsers)
                      ? (team.celebrationUsers as CelebrationUser[])
                      : []
                  }
                />
            </DashboardSection>

            <DashboardSection title="Team performance">
                <div className="dashboard-chart-grid--2">
                    <ChartCard
                        title="Team present rate"
                        description="Share of weekdays each team member was present or late in this period."
                    >
                        {teamPerformance.length > 0 ? (
                            <TeamAttendanceRateChart data={teamPerformance} />
                        ) : (
                            <ChartEmptyState message="No team attendance rates for this period yet." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Team attendance"
                        description="Present vs absent headcount for recent weekdays."
                    >
                        {weeklyActivities.length > 0 ? (
                            <AttendanceChart data={weeklyActivities} />
                        ) : (
                            <ChartEmptyState loading={loading} message="No team attendance in this period." />
                        )}
                    </ChartCard>
                    <ChartCard
                        title="Project progress"
                        description="Completion status for projects assigned to you."
                        icon={<Briefcase className="w-5 h-5 text-amber-600" />}
                    >
                        <div className="space-y-3">
                            {projectProgress.length === 0 ? (
                                <ChartEmptyState message="No active projects to display." />
                            ) : null}
                            {projectProgress.map((project, i) => (
                                <div key={i} className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{project.name}</p>
                                            <p className="text-[11px] text-slate-500">Due: {project.deadline}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full shrink-0 ${
                                            project.status === 'on-track' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                        }`}>
                                            {project.status === 'on-track' ? 'On track' : 'At risk'}
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                        <div
                                            className={`h-1.5 rounded-full ${project.status === 'on-track' ? 'bg-green-500' : 'bg-amber-500'}`}
                                            style={{ width: `${project.progress}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ChartCard>
                    <Card title="Team Members" icon={<ContactRound className="w-5 h-5 text-blue-600" />}>
                        <div className="space-y-2">
                            {(Array.isArray(team.teamMembers) ? team.teamMembers : []).slice(0, 5).map((member: any, i: number) => (
                                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer" onClick={() => navigate(`/employees/${member.id}`)}>
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-xs">
                                        {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm truncate font-khmer">
                                            {resolveEmployeeRecordDisplayName(member, language)}
                                        </p>
                                        <p className="text-[11px] text-slate-500 truncate">{member.position}</p>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full shrink-0 ${
                                        member.status === 'present' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                        member.status === 'absent' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                    }`}>
                                        {member.status}
                                    </span>
                                </div>
                            )) || <p className="text-center py-6 text-slate-400 text-sm">No team members found</p>}
                        </div>
                    </Card>
                </div>
            </DashboardSection>

            <DashboardSection title="Reports">
                <Card title={t('nav.reports') || 'Team reports'} icon={<FileBarChart className="w-5 h-5 text-purple-600" />}>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                        View team attendance, performance, and project reports for the selected period.
                    </p>
                    <Button variant="outline" onClick={() => navigate('/reports?category=team')}>
                        {t('nav.reports') || 'Open team reports'}
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </Card>
            </DashboardSection>
        </DashboardPageLayout>
    );
};

const EmployeeDashboard = () => {
    const { goTo, navigate } = useWorkspaceNavigate();
    const { user } = useAuth();
    const { t } = useLanguage();
    const [myData, setMyData] = useState<any>(null);

    const loadMyData = useCallback(async () => {
        const [stats, attendance, announcements] = await Promise.all([
            Api.dashboard.getMyStats().catch(() => ({})),
            Api.attendance.getForUser(user?.id || '', { historyDays: 14 }).catch(() => []),
            Api.chat.getAnnouncements('dashboard').catch(() => []),
        ]);
        setMyData({
            ...(typeof stats === 'object' && stats ? stats : {}),
            recentAttendance: attendance,
            announcements: Array.isArray(announcements) ? announcements : [],
        });
    }, [user?.id]);

    useEffect(() => {
        void loadMyData();
    }, [loadMyData]);

    useRegisterPullToRefresh(loadMyData);

    const weeklyAttendance = useMemo(() => {
        const records = asChartRows(myData?.recentAttendance) as Array<{
            date?: string;
            workHours?: number;
            status?: string;
        }>;
        const byDate = new Map<string, { hours: number; status: string }>();
        for (const row of records) {
            const date = String(row.date || '').slice(0, 10);
            if (!date) continue;
            byDate.set(date, {
                hours: Number(row.workHours) || 0,
                status: String(row.status || '').toLowerCase(),
            });
        }
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const rows: Array<{ day: string; status: string; hours: number }> = [];
        const cursor = new Date();
        let added = 0;
        while (added < 5) {
            const dow = cursor.getDay();
            if (dow >= 1 && dow <= 5) {
                const dateStr = cursor.toISOString().split('T')[0];
                const hit = byDate.get(dateStr);
                rows.unshift({
                    day: labels[dow],
                    status: hit?.status || 'absent',
                    hours: hit?.hours ?? 0,
                });
                added++;
            }
            cursor.setDate(cursor.getDate() - 1);
        }
        return rows;
    }, [myData?.recentAttendance]);

    const weeklyHoursTotal = useMemo(
        () => weeklyAttendance.reduce((sum, row) => sum + (Number(row.hours) || 0), 0),
        [weeklyAttendance]
    );
    const weeklyHoursAvg =
        weeklyAttendance.length > 0 ? weeklyHoursTotal / weeklyAttendance.length : 0;

    const upcomingHolidays = useMemo(() => {
        const rows = Array.isArray(myData?.upcomingHolidays) ? myData.upcomingHolidays : [];
        return rows
            .map((row: any) => ({
                name: String(row?.name ?? '').trim(),
                date: String(row?.date ?? '').slice(0, 10),
            }))
            .filter((row: { name: string; date: string }) => row.name && row.date);
    }, [myData?.upcomingHolidays]);

    const teamUpdates = useMemo(() => {
        const rows = Array.isArray(myData?.announcements) ? myData.announcements : [];
        return rows
            .map((row: any) => ({
                id: String(row?.id ?? ''),
                title: String(row?.title ?? '').trim(),
                message: String(row?.content ?? '').trim().replace(/\s+/g, ' '),
                sender: String(row?.senderName ?? '').trim(),
                at: String(row?.createdAt ?? '').trim(),
            }))
            .filter((row: { title: string; message: string }) => row.title || row.message)
            .slice(0, 3);
    }, [myData?.announcements]);

    return (
        <div className="space-y-3 sm:space-y-4">
            <div className="flex justify-end">
                <DashboardActionInboxSection />
            </div>

            <DashboardSection title="Overview">
                <div className="dashboard-stat-grid">
                    <StatCard
                        icon={LogIn}
                        label="Clock Status"
                        value={myData?.clockedIn ? 'Clocked In' : 'Not Clocked In'}
                        color={myData?.clockedIn ? 'bg-primary-600' : 'bg-slate-500'}
                        onClick={() => goTo('/attendance', SELF_ATTENDANCE_SEARCH)}
                    />
                    <StatCard
                        icon={CalendarDays}
                        label="Leave Balance"
                        value={
                          myData?.leaveBalance?.remaining != null
                            ? Number(myData.leaveBalance.remaining)
                            : '—'
                        }
                        suffix={myData?.leaveBalance?.remaining != null ? 'days' : undefined}
                        color="bg-violet-600"
                        onClick={() => navigate('/leaves')}
                    />
                    <StatCard
                        icon={Timer}
                        label="Today&apos;s Hours"
                        value={myData?.workHoursToday ?? '0.0'}
                        suffix="hrs"
                        color="bg-blue-600"
                        onClick={() => goTo('/attendance', SELF_ATTENDANCE_SEARCH)}
                    />
                    <StatCard
                        icon={CalendarCheck}
                        label="Pending Leave"
                        value={myData?.pendingRequests != null ? Number(myData.pendingRequests) : '—'}
                        color="bg-green-600"
                        onClick={() => navigate('/leaves')}
                    />
                </div>
            </DashboardSection>

            <DashboardSection title="Updates & holidays">
                <div className="dashboard-panel-grid">
                    <Card title="Team Updates" icon={<Bell className="w-5 h-5 text-blue-600" />}>
                        <div className="space-y-2">
                            {teamUpdates.length > 0 ? teamUpdates.map((update: any, i: number) => (
                                <div key={update.id || i} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <div className="p-1.5 rounded-lg mt-0.5 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                        <Bell className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{update.title || update.message}</p>
                                        {update.title && update.message && (
                                            <p className="text-[11px] text-slate-500">{update.message}</p>
                                        )}
                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                            {[update.sender, formatRelativeTime(update.at)].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                </div>
                            )) : <p className="text-center py-6 text-slate-400 text-sm">No team updates</p>}
                        </div>
                    </Card>

                    <Card title="Upcoming Holidays" icon={<PartyPopper className="w-5 h-5 text-violet-600" />}>
                        <div className="space-y-2">
                            {upcomingHolidays.length > 0 ? upcomingHolidays.map((holiday: any, i: number) => (
                                <div key={`${holiday.date}-${i}`} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <div className="p-1.5 rounded-lg bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                                        <CalendarDays className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{holiday.name}</p>
                                        <p className="text-[11px] text-slate-500">{formatDateOnlyDisplay(holiday.date, holiday.date)}</p>
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                        public
                                    </span>
                                </div>
                            )) : <p className="text-center py-6 text-slate-400 text-sm">No upcoming holidays</p>}
                        </div>
                    </Card>
                </div>
            </DashboardSection>

            <DashboardSection title="Activity & attendance">
                <div className="dashboard-panel-grid">
                    <Card title="Recent Activity" icon={<Activity className="w-5 h-5 text-blue-600" />}>
                        <div className="space-y-2">
                            {myData?.recentActivity?.length ? myData.recentActivity.map((item: any, i: number) => (
                                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <div className={`p-1.5 rounded-lg ${
                                        item.type === 'clock_in' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                        item.type === 'leave' ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' :
                                        'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                    }`}>
                                        {item.type === 'clock_in' && <Clock className="w-3.5 h-3.5" />}
                                        {item.type === 'leave' && <Calendar className="w-3.5 h-3.5" />}
                                        {item.type === 'payslip' && <CreditCard className="w-3.5 h-3.5" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{item.title}</p>
                                        <p className="text-[11px] text-slate-500">{formatRelativeTime(item.at) || item.date}</p>
                                    </div>
                                </div>
                            )) : <p className="text-center py-6 text-slate-400 text-sm">No recent activity</p>}
                        </div>
                    </Card>

                    <ChartCard
                        title="This week's hours"
                        description="Hours you worked on recent weekdays."
                    >
                        {weeklyAttendance.some((row) => row.hours > 0 || row.status !== 'absent') ? (
                            <>
                                <HoursWorkedChart
                                    data={weeklyAttendance.map((row) => ({
                                        day: row.day,
                                        hours: row.hours,
                                        status: row.status,
                                    }))}
                                />
                                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                                    <div className="flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="text-slate-600 dark:text-slate-300">
                                          Total: {weeklyHoursTotal.toFixed(1)} hrs
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                                        <span className="text-slate-600 dark:text-slate-300">
                                          Avg: {weeklyHoursAvg.toFixed(1)} hrs/day
                                        </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <ChartEmptyState message="No attendance recorded for recent weekdays." />
                        )}
                    </ChartCard>
                </div>
            </DashboardSection>

            <DashboardSection title="Insights">
                <Card title={t('personalAnalytics.nav') || 'Personal analytics'} icon={<LineChart className="w-5 h-5 text-indigo-600" />}>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                        Open personal analytics for attendance, leave, overtime, and KPI trends.
                    </p>
                    <Button variant="outline" onClick={() => navigate('/personal-analytics')}>
                        {t('personalAnalytics.title') || 'View personal analytics'}
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </Card>
            </DashboardSection>
        </div>
    );
};

// ===== MAIN COMPONENT =====
export const ProfessionalDashboard: React.FC = () => {
    const { user, hasRole } = useAuth();

    if (!user) {
        return <LoadingState variant="page" layout="dashboard" />;
    }

    const renderDashboard = () => {
        if (hasRole(Role.ADMIN)) return <AdminDashboard />;
        if (hasRole(Role.HR)) return <HRDashboard />;
        if (hasRole(Role.MANAGER)) return <ManagerDashboard />;
        return <EmployeeDashboard />;
    };

    return (
        <div className="dashboard-shell pb-6 sm:pb-8 space-y-3 sm:space-y-4">
            <DashboardWelcomeBanner />
            {renderDashboard()}
        </div>
    );
};

export default ProfessionalDashboard;