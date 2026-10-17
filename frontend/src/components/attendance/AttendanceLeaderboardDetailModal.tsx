import React from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarDays, Trophy } from 'lucide-react';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { Modal } from '../ui/Modal';
import { EmployeeAvatar } from '../employee/EmployeeAvatar';
import {
  userAvatarUrl,
  userDisplayName,
  userDisplayPosition,
  userNameParts,
} from '../../utils/userProfile';
import {
  ATTENDANCE_SCORE_LATE,
  ATTENDANCE_SCORE_PRESENT,
  type AttendanceLeaderboardDayDetail,
  type AttendanceLeaderboardRow,
} from '../../utils/attendanceLeaderboard';
import { attendanceStatusLabel } from '../../utils/attendanceStatusLabels';
import { formatAttendanceClockDisplay } from '../../utils/attendanceRecordApi';
import { useLanguage } from '../../context/LanguageContext';
import { StatusLabel } from '../ui/StatusLabel';

type Props = {
  row: AttendanceLeaderboardRow | null;
  allRows: AttendanceLeaderboardRow[];
  periodLabel: string;
  onClose: () => void;
};

export const AttendanceLeaderboardDetailModal: React.FC<Props> = ({
  row,
  periodLabel,
  onClose,
}) => {
  const { t, language } = useLanguage();

  const scoredDays = row?.dayDetails.filter((d) => d.points !== 0) ?? [];
  const unscoredDays = row?.dayDetails.filter((d) => d.points === 0) ?? [];

  if (!row) return null;

  const u = row.user;

  return (
    <Modal
      isOpen={!!row}
      onClose={onClose}
      title={t('attendance.leaderboardDetailTitle') || 'Attendance score details'}
      description="Ranking breakdown, tie logic, and day-by-day scoring detail."
      size="xl"
      contentClassName="px-4 py-4 sm:px-5"
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <EmployeeAvatar
              avatarUrl={userAvatarUrl(u)}
              {...userNameParts(u)}
              className="h-12 w-12 shrink-0 border-2 border-slate-200 dark:border-slate-600"
              alt={userDisplayName(u, language)}
            />
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white font-khmer">
                {userDisplayName(u, language)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {row.departmentName} · {userDisplayPosition(u, language)}
              </p>
              <p className="mt-1 text-xs text-slate-400">{periodLabel}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className="inline-flex items-center rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
              {(t('attendance.leaderboardRankLabel') || 'Rank') + ` #${row.rank}`}
              {row.isTied ? ` · ${t('attendance.leaderboardTied') || 'tied'}` : ''}
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-200">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {row.points} {t('attendance.totalPoints') || 'pts'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBox
            label={t('attendance.leaderboardOnTime') || 'On time'}
            value={row.presentDays}
            sub={`+${ATTENDANCE_SCORE_PRESENT}`}
            tone="emerald"
          />
          <StatBox
            label={t('attendance.leaderboardLate') || 'Late'}
            value={row.lateDays}
            sub={`${ATTENDANCE_SCORE_LATE}`}
            tone="amber"
          />
          <StatBox
            label={t('attendance.leaderboardAbsent') || 'Absent'}
            value={row.absentDays}
            sub="0"
            tone="rose"
          />
          <StatBox
            label={t('attendance.leaderboardLeaveOff') || 'Leave / off'}
            value={row.leaveOrOffDays}
            sub="0"
            tone="slate"
          />
        </div>

        <p className="rounded-md bg-slate-100 px-2.5 py-1.5 text-center font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          ({row.presentDays} × {ATTENDANCE_SCORE_PRESENT}) + ({row.lateDays} ×{' '}
          {ATTENDANCE_SCORE_LATE}) ={' '}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{row.points}</span>
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <DayListPanel
            title={t('attendance.leaderboardScoredDays') || 'Days that earned points'}
            count={scoredDays.length}
            emptyMessage={t('attendance.leaderboardNoScoredDays') || 'No scored days in this period.'}
            dateHeader={t('attendance.date') || 'Date'}
            statusHeader={t('common.status') || 'Status'}
          >
            {scoredDays.length > 0 && (
              <ScoredDaysTable days={scoredDays} t={t} />
            )}
          </DayListPanel>

          <DayListPanel
            title={t('attendance.leaderboardUnscoredDays') || 'Days in range (no points)'}
            count={unscoredDays.length}
            emptyMessage={t('attendance.leaderboardNoUnscoredDays') || 'No other days in this period.'}
            dateHeader={t('attendance.date') || 'Date'}
            statusHeader={t('common.status') || 'Status'}
          >
            {unscoredDays.length > 0 && (
              <UnscoredDaysTable days={unscoredDays} t={t} />
            )}
          </DayListPanel>
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-primary-200/60 bg-primary-50/80 px-2.5 py-2 text-xs leading-relaxed text-primary-900 dark:border-primary-800/40 dark:bg-primary-900/20 dark:text-primary-100">
          <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('attendance.leaderboardSortRules') ||
            'List order: points, on-time days, fewer late days, complete clock records, earlier check-in, hours logged, then name.'}
        </p>
      </div>
    </Modal>
  );
};

function DayListPanel({
  title,
  count,
  emptyMessage,
  dateHeader,
  statusHeader,
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  dateHeader: string;
  statusHeader: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <h4 className="truncate text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {title}
          </h4>
        </div>
        <span className="shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {count}
        </span>
      </header>

      {count === 0 ? (
        <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="max-h-40 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">
                    {dateHeader}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">
                    {statusHeader}
                  </th>
                </tr>
              </thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ScoredDaysTable({
  days,
  t,
}: {
  days: AttendanceLeaderboardDayDetail[];
  t: (key: string) => string | undefined;
}) {
  return (
    <>
      {days.map((d, i) => (
        <tr
          key={d.date}
          className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
            i % 2 === 1 ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''
          }`}
        >
          <td className="px-3 py-2">
            <DateCell dateKey={d.date} />
          </td>
          <td className="px-3 py-2 text-right">
            <div className="flex flex-col items-end gap-1">
              <StatusPill status={d.status} t={t} />
              <span
                className={`font-mono text-[11px] font-semibold tabular-nums ${
                  d.points > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {d.points > 0 ? `+${d.points}` : d.points} {t('attendance.leaderboardPts') || 'pts'}
                {d.clockIn ? ` · ${formatAttendanceClockDisplay(d.clockIn)}` : ''}
              </span>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function UnscoredDaysTable({
  days,
  t,
}: {
  days: AttendanceLeaderboardDayDetail[];
  t: (key: string) => string | undefined;
}) {
  return (
    <>
      {days.map((d, i) => (
        <tr
          key={d.date}
          className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
            i % 2 === 1 ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''
          }`}
        >
          <td className="px-3 py-2">
            <DateCell dateKey={d.date} />
          </td>
          <td className="px-3 py-2 text-right">
            <StatusPill status={d.status} t={t} />
          </td>
        </tr>
      ))}
    </>
  );
}

function DateCell({ dateKey }: { dateKey: string }) {
  try {
    const d = parseISO(dateKey);
    return (
      <div className="leading-tight">
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {formatDateOnlyDisplay(d)}
        </span>
        <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          {format(d, 'EEE')}
        </span>
      </div>
    );
  } catch {
    return <span className="text-slate-600 dark:text-slate-400">{dateKey}</span>;
  }
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: (key: string) => string | undefined;
}) {
  return (
    <StatusLabel
      status={status}
      context="attendance"
      label={attendanceStatusLabel(status, t)}
      size="sm"
    />
  );
}

function StatBox({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
}) {
  const valueTone = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    slate: 'text-slate-800 dark:text-slate-100',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-center dark:border-slate-600 dark:bg-slate-800/80">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${valueTone}`}>{value}</p>
      <p className="text-[10px] text-slate-400">{sub} pts</p>
    </div>
  );
}
