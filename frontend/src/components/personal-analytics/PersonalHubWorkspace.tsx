import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightLeft,
  Bell,
  Briefcase,
  Cake,
  CalendarDays,
  Clock,
  FileText,
  Hourglass,
  Inbox,
  StickyNote,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { isAdminRole } from '../../utils/adminNavScope';
import {
  usePersonalHubOverview,
  usePersonalRequests,
  useWorkRoster,
} from '../../hooks/usePersonalHub';
import {
  PaField,
  PaHint,
  PaInfoStrip,
  PaInput,
  PaLoading,
  PaSection,
  paSectionClass,
} from './personalAnalyticsUi';
import { PersonalAlertsCalendar } from './PersonalAlertsCalendar';
import { PersonalNotesNotebook } from './PersonalNotesNotebook';
import { StatusLabel } from '../ui/StatusLabel';
import type { StatusContext } from '../../constants/statusPalette';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import {
  leadingEmptyCount,
  parseYearMonth,
  SUNDAY_FIRST_WEEKDAY_LABELS,
  trailingEmptyCount,
} from '../../utils/monthCalendarGrid';
import type { PersonalRequestItem } from '../../types/personalHub';

const ICON = 'w-4 h-4';

const ROSTER_COLORS: Record<string, string> = {
  working: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  off: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  leave: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  holiday: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
};

const REQUEST_KIND_META: Record<
  PersonalRequestItem['kind'],
  { icon: typeof Briefcase; tone: string; statusContext: StatusContext }
> = {
  leave: {
    icon: Briefcase,
    tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
    statusContext: 'leave',
  },
  overtime: {
    icon: Hourglass,
    tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
    statusContext: 'overtime',
  },
  movement: {
    icon: ArrowRightLeft,
    tone: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    statusContext: 'movement',
  },
};

function isPendingRequestStatus(status: string): boolean {
  const code = status.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (
    code === 'PENDING' ||
    code === 'PENDING_APPROVAL' ||
    code === 'MANAGER_APPROVED' ||
    code === 'RETURNED' ||
    code === 'IN_REVIEW' ||
    code === 'SUBMITTED'
  );
}

function prettifyRequestTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '—';
  if (!/[_\-]/.test(trimmed) && trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRequestDateLabel(raw: string): string {
  const text = raw.trim();
  if (!text) return '—';
  if (text.includes('–') || text.includes('—') || text.includes(' - ')) {
    const parts = text.split(/\s*[–—]\s*|\s+-\s+/);
    if (parts.length === 2) {
      return `${formatDateOnlyDisplay(parts[0], parts[0])} – ${formatDateOnlyDisplay(parts[1], parts[1])}`;
    }
  }
  return formatDateOnlyDisplay(text, text);
}

function requestHref(kind: PersonalRequestItem['kind']): string {
  if (kind === 'leave') return '/leaves?scope=self';
  if (kind === 'overtime') return '/overtime?scope=self';
  return '/employees/movements';
}

function BirthdayBanner({ targetUserId }: { targetUserId?: string }) {
  const { t } = useLanguage();
  const { data } = usePersonalHubOverview(targetUserId);
  const b = data?.birthday;
  if (!b?.hasBirthDate || b.messageKey === 'none') return null;

  const isToday = b.isToday;
  return (
    <div
      className={`${paSectionClass} px-4 py-3 flex items-start gap-3 ${
        isToday
          ? 'border-pink-300/80 dark:border-pink-800 bg-gradient-to-r from-pink-50/90 to-amber-50/90 dark:from-pink-950/30 dark:to-amber-950/20'
          : 'border-primary-200/80 dark:border-primary-800'
      }`}
    >
      <span className="shrink-0 p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/50">
        <Cake className={`w-5 h-5 ${isToday ? 'text-pink-500' : 'text-primary-500'}`} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {isToday
            ? t('personalAnalytics.hub.birthdayToday', { name: b.displayName ?? '' })
            : t('personalAnalytics.hub.birthdayUpcoming', {
                name: b.displayName ?? '',
                days: String(b.daysUntil ?? 0),
              })}
        </p>
        {b.age != null ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            {t('personalAnalytics.hub.birthdayAge', { age: String(b.age) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NotesPanel({ isSelf }: { isSelf: boolean }) {
  const { t } = useLanguage();
  return (
    <PaSection dense title={t('personalAnalytics.hub.notes')} icon={<StickyNote className={ICON} />}>
      <PersonalNotesNotebook isSelf={isSelf} compact />
    </PaSection>
  );
}

function AlertsPanel({
  isSelf,
  schedule,
}: {
  isSelf: boolean;
  schedule: { timeIn?: string | null; timeOut?: string | null } | null;
}) {
  const { t } = useLanguage();

  return (
    <PaSection dense title={t('personalAnalytics.hub.scheduleAlerts')} icon={<Bell className={ICON} />}>
      {schedule?.timeIn || schedule?.timeOut ? (
        <PaInfoStrip compact icon={<Clock className="w-3 h-3 text-slate-500 shrink-0" />}>
          {t('personalAnalytics.hub.shiftSchedule')}: {schedule.timeIn ?? '—'} – {schedule.timeOut ?? '—'}
        </PaInfoStrip>
      ) : (
        <PaInfoStrip compact icon={<Clock className="w-3 h-3 text-slate-500 shrink-0" />}>
          {t('personalAnalytics.hub.noShift')}
        </PaInfoStrip>
      )}
      <PersonalAlertsCalendar isSelf={isSelf} defaultReminderTime={schedule?.timeIn} />
    </PaSection>
  );
}

function WorkRosterPanel({ targetUserId }: { targetUserId?: string }) {
  const { t } = useLanguage();
  const [month, setMonth] = useState(() => todayYmdInCompanyTz().slice(0, 7));
  const { days, loading } = useWorkRoster(month, targetUserId);

  const legend = useMemo(
    () => [
      { key: 'working', label: t('personalAnalytics.hub.rosterWorking') },
      { key: 'off', label: t('personalAnalytics.hub.rosterOff') },
      { key: 'leave', label: t('personalAnalytics.hub.rosterLeave') },
      { key: 'holiday', label: t('personalAnalytics.hub.rosterHoliday') },
    ],
    [t]
  );

  const monthParts = parseYearMonth(month);
  const lead = monthParts ? leadingEmptyCount(monthParts.year, monthParts.monthIndex) : 0;
  const trail = monthParts ? trailingEmptyCount(monthParts.year, monthParts.monthIndex) : 0;

  return (
    <PaSection title={t('personalAnalytics.hub.workScheduled')} icon={<CalendarDays className={ICON} />}>
      <div className="flex flex-wrap items-end gap-3">
        <PaField label={t('personalAnalytics.period')}>
          <PaInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-[11rem]" />
        </PaField>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {legend.map((l) => (
            <span key={l.key} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ROSTER_COLORS[l.key]}`}>
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <PaLoading />
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-7 gap-1 text-[10px] font-semibold text-slate-500 text-center">
            {SUNDAY_FIRST_WEEKDAY_LABELS.map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
            {Array.from({ length: lead }).map((_, i) => (
              <div key={`lead-${i}`} className="rounded-lg min-h-[2.75rem]" aria-hidden />
            ))}
            {days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.leaveType}`}
                className={`rounded-lg px-0.5 py-1.5 min-h-[2.75rem] flex flex-col justify-center ${ROSTER_COLORS[d.category]}`}
              >
                <span className="font-bold">{d.day}</span>
                <span className="truncate leading-tight opacity-75 text-[9px]">{d.leaveType}</span>
              </div>
            ))}
            {Array.from({ length: trail }).map((_, i) => (
              <div key={`trail-${i}`} className="rounded-lg min-h-[2.75rem]" aria-hidden />
            ))}
          </div>
        </div>
      )}
    </PaSection>
  );
}

function RequestsPanel({ targetUserId }: { targetUserId?: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { items, loading } = usePersonalRequests(targetUserId);
  const fillCard = isAdminRole(user?.role);

  const visible = items.slice(0, 8);
  const pendingCount = useMemo(
    () => items.filter((item) => isPendingRequestStatus(item.status)).length,
    [items]
  );

  const kindLabel = (kind: PersonalRequestItem['kind']) => {
    if (kind === 'leave') return t('personalAnalytics.hub.requestLeave');
    if (kind === 'overtime') return t('personalAnalytics.hub.requestOvertime');
    return t('personalAnalytics.hub.requestMovement');
  };

  return (
    <PaSection
      dense
      fill={fillCard}
      title={t('personalAnalytics.hub.requests')}
      icon={<FileText className={ICON} />}
      action={
        items.length > 0 ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
            {items.length}
          </span>
        ) : null
      }
    >
      {loading ? (
        <div className={fillCard ? 'flex flex-1 min-h-0 items-center justify-center' : ''}>
          <PaLoading />
        </div>
      ) : items.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-6 text-center ${
            fillCard ? 'flex-1 min-h-0' : ''
          }`}
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white dark:bg-slate-900 text-slate-400 shadow-sm">
            <Inbox className="w-4 h-4" aria-hidden />
          </span>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t('personalAnalytics.hub.noRequests')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[14rem]">
            {t('personalAnalytics.hub.noRequestsHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
              <FileText className="w-3 h-3 opacity-70" aria-hidden />
              {t('personalAnalytics.hub.requestsTotal', { count: String(items.length) })}
            </span>
            {pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/90 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                <Clock className="w-3 h-3 opacity-80" aria-hidden />
                {t('personalAnalytics.hub.requestsPending', { count: String(pendingCount) })}
              </span>
            ) : null}
          </div>

          <ul
            className={`space-y-2 overflow-y-auto pr-0.5 custom-scrollbar ${
              fillCard ? 'flex-1 min-h-0' : 'max-h-52'
            }`}
          >
            {visible.map((item) => {
              const meta = REQUEST_KIND_META[item.kind];
              const KindIcon = meta.icon;
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => navigate(requestHref(item.kind))}
                    className="group w-full text-left rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/50 px-2.5 py-2.5 shadow-sm transition-colors hover:border-primary-300/70 hover:bg-primary-50/40 dark:hover:border-primary-700/50 dark:hover:bg-primary-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}
                        aria-hidden
                      >
                        <KindIcon className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {kindLabel(item.kind)}
                          </p>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white break-words leading-snug">
                            {prettifyRequestTitle(item.title)}
                          </p>
                        </div>
                        <StatusLabel
                          status={item.status}
                          context={meta.statusContext}
                          size="sm"
                          className="max-w-full"
                        />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <CalendarDays className="w-3 h-3 opacity-70 shrink-0" aria-hidden />
                            {formatRequestDateLabel(item.dateLabel)}
                          </span>
                          {item.detail ? (
                            <span className="break-words min-w-0">{item.detail}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {items.length > 8 ? (
            <PaHint>{t('personalAnalytics.hub.requestsMore', { count: String(items.length - 8) })}</PaHint>
          ) : null}
        </>
      )}
    </PaSection>
  );
}

export function PersonalHubWorkspace({ targetUserId }: { targetUserId?: string }) {
  const { user } = useAuth();
  const isSelf = !targetUserId || targetUserId === user?.id;
  const { data: overview } = usePersonalHubOverview(targetUserId);

  return (
    <div className="space-y-5">
      <BirthdayBanner targetUserId={targetUserId} />
      <div className="grid gap-4 lg:grid-cols-3">
        <NotesPanel isSelf={isSelf} />
        <AlertsPanel isSelf={isSelf} schedule={overview?.schedule ?? null} />
        <RequestsPanel targetUserId={targetUserId} />
      </div>
      <WorkRosterPanel targetUserId={targetUserId} />
    </div>
  );
}
