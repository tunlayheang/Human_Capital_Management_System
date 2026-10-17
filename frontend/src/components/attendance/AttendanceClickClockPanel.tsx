import React from 'react';
import { LogIn, LogOut, RefreshCw, CheckCircle, Clock, MapPin } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { AttendanceRecord } from '../../types';
import { formatAttendanceClockDisplay } from '../../utils/attendanceRecordApi';

export type AttendanceClickClockPanelProps = {
  todayRecord: AttendanceRecord | null;
  loadingAction: 'in' | 'out' | null;
  loadingLoc: boolean;
  canClockIn: boolean;
  canClockOut: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  shiftRange?: string | null;
  statusHint?: string;
  className?: string;
  zoneLabel?: string;
  zoneTone?: 'success' | 'warning' | 'neutral' | 'danger';
  clickToRecordLabel?: string;
};

const FOOTER_TONE: Record<NonNullable<AttendanceClickClockPanelProps['zoneTone']>, string> = {
  success:
    'border-primary-500/40 bg-primary-50 text-primary-800 dark:border-primary-500/35 dark:bg-primary-500/[0.08] dark:text-primary-300',
  danger:
    'border-rose-500/40 bg-rose-50 text-rose-800 dark:border-rose-500/35 dark:bg-rose-500/[0.08] dark:text-rose-300',
  warning:
    'border-amber-500/40 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/[0.08] dark:text-amber-200',
  neutral:
    'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-400',
};

export const AttendanceClickClockPanel: React.FC<AttendanceClickClockPanelProps> = ({
  todayRecord,
  loadingAction,
  loadingLoc,
  canClockIn,
  canClockOut,
  onClockIn,
  onClockOut,
  shiftRange,
  statusHint,
  className = '',
  zoneLabel,
  zoneTone = 'neutral',
  clickToRecordLabel,
}) => {
  const { t } = useLanguage();
  const clockInLabel = formatAttendanceClockDisplay(todayRecord?.clockIn);
  const clockOutLabel = formatAttendanceClockDisplay(todayRecord?.clockOut);
  const hasIn = !!todayRecord?.clockIn;
  const hasOut = !!todayRecord?.clockOut;
  const dayComplete = hasIn && hasOut;

  const inActive = canClockIn && !hasIn && !loadingAction && !loadingLoc;
  const outActive = canClockOut && !hasOut && !loadingAction && !loadingLoc;

  const renderActionCell = (
    side: 'in' | 'out',
    opts: {
      active: boolean;
      recorded: boolean;
      disabled: boolean;
      onClick: () => void;
      label: string;
      time: string;
      Icon: typeof LogIn;
      subHint?: string;
    }
  ) => {
    const { active, recorded, disabled, onClick, label, time, Icon, subHint } = opts;
    const isLoading = loadingAction === side;

    const cellBase =
      'group relative flex flex-col items-center justify-center gap-2 xs:gap-3 sm:gap-4 py-5 xs:py-6 sm:py-8 md:py-10 px-1.5 xs:px-3 sm:px-4 transition-all duration-200 touch-manipulation min-h-[7.75rem] xs:min-h-[8.75rem] sm:min-h-[10rem] md:min-h-[11rem] w-full';

    let cellState = `${cellBase} cursor-not-allowed opacity-70`;
    if (isLoading) cellState = `${cellBase} cursor-wait`;
    else if (recorded) cellState = `${cellBase} cursor-default`;
    else if (active)
      cellState = `${cellBase} cursor-pointer hover:bg-primary-50 active:scale-[0.99] dark:hover:bg-primary-500/[0.06]`;
    else if (!disabled && !recorded)
      cellState = `${cellBase} cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.03]`;

    const iconWrap =
      recorded && side === 'in'
        ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300/80 shadow-sm dark:bg-primary-500/20 dark:text-primary-300 dark:ring-primary-400/40 dark:shadow-[0_0_20px_rgba(45,212,191,0.15)]'
        : recorded && side === 'out'
          ? 'bg-slate-200 text-slate-600 ring-1 ring-slate-300/80 dark:bg-slate-700/80 dark:text-slate-200 dark:ring-slate-500/40'
          : active && side === 'in'
            ? 'bg-primary-100 text-primary-600 ring-1 ring-primary-400/60 shadow-md shadow-primary-500/20 dark:bg-primary-500/25 dark:text-primary-300 dark:ring-primary-400/50 dark:shadow-[0_0_24px_rgba(45,212,191,0.25)]'
            : active && side === 'out'
              ? 'bg-slate-200 text-slate-700 ring-1 ring-slate-300/70 dark:bg-slate-600/50 dark:text-white dark:ring-slate-400/30'
              : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800/90 dark:text-slate-300 dark:ring-slate-700/80';

    const titleClass = recorded
      ? side === 'in'
        ? 'text-primary-700 dark:text-primary-300/90'
        : 'text-slate-600 dark:text-slate-300'
      : active
        ? side === 'in'
          ? 'text-primary-700 dark:text-primary-300'
          : 'text-slate-800 dark:text-white/95'
        : 'text-slate-500 dark:text-slate-400';

    const timeClass = recorded
      ? side === 'in'
        ? 'text-primary-900 dark:text-primary-100'
        : 'text-slate-800 dark:text-slate-100'
      : active
        ? 'text-slate-900 dark:text-white'
        : 'text-slate-400 dark:text-slate-500';

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={
          isLoading ||
          (side === 'in' && hasIn) ||
          (side === 'out' && hasOut) ||
          (side === 'in' ? !canClockIn && !hasIn : !canClockOut && !hasOut)
        }
        className={cellState}
        aria-label={label}
      >
        {isLoading ? (
          <RefreshCw className="w-7 h-7 xs:w-8 xs:h-8 sm:w-9 sm:h-9 animate-spin text-primary-600 dark:text-primary-400" />
        ) : (
          <>
            <div
              className={`flex h-11 w-11 xs:h-12 xs:w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 items-center justify-center rounded-xl transition-all duration-200 ${iconWrap}`}
            >
              <Icon className="w-5 h-5 xs:w-6 xs:h-6 sm:w-7 sm:h-7 md:w-8 md:h-8" strokeWidth={2.25} />
            </div>
            <div className="text-center w-full min-w-0 px-0.5">
              <p
                className={`text-[9px] xs:text-[10px] sm:text-[11px] md:text-xs font-bold uppercase tracking-[0.12em] xs:tracking-[0.14em] sm:tracking-[0.16em] ${titleClass}`}
              >
                {label}
              </p>
              <p
                className={`mt-1.5 xs:mt-2 text-lg xs:text-xl sm:text-2xl md:text-3xl font-bold font-mono tabular-nums tracking-tight leading-none ${timeClass}`}
              >
                {time}
              </p>
              {recorded && (
                <p className="mt-1.5 xs:mt-2 text-[9px] xs:text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400/80 flex items-center justify-center gap-1">
                  <CheckCircle className="w-2.5 h-2.5 xs:w-3 xs:h-3" />
                  Recorded
                </p>
              )}
              {subHint && !recorded && (
                <p className="mt-1.5 xs:mt-2 text-[9px] xs:text-[10px] text-slate-500 dark:text-slate-500 leading-snug px-1">
                  {subHint}
                </p>
              )}
            </div>
          </>
        )}
      </button>
    );
  };

  return (
    <div className={`w-full min-w-0 ${className}`}>
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60 overflow-hidden dark:border-slate-700/50 dark:bg-[#0a0f1a] dark:shadow-[0_8px_40px_rgba(0,0,0,0.45)]">
        <div
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary-500 via-cyan-400 to-violet-500"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-primary-500/10 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-row items-center justify-between gap-2 xs:gap-3 px-4 xs:px-5 sm:px-3 py-2 xs:py-5 border-b border-slate-200 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 xs:gap-3.5 min-w-0">
            <div className="flex h-10 w-10 xs:h-11 xs:w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 ring-1 ring-primary-300/60 dark:bg-primary-500/15 dark:text-primary-400 dark:ring-primary-400/30 dark:shadow-[0_0_20px_rgba(45,212,191,0.2)]">
              <Clock className="w-4 h-4 xs:w-5 xs:h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] xs:text-[10px] font-bold uppercase tracking-[0.16em] xs:tracking-[0.18em] text-slate-500">
                {t('common.shift') || 'Shift'}
              </p>
              <p className="text-base xs:text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white tracking-tight mt-0.5 truncate">
                {shiftRange?.trim() || '—'}
              </p>
            </div>
          </div>
          {dayComplete && (
            <span className="inline-flex items-center gap-1 xs:gap-1.5 text-[10px] xs:text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 xs:px-3 py-1 xs:py-1.5 rounded-full border border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/25 shrink-0">
              <CheckCircle className="w-3 h-3 xs:w-3.5 xs:h-3.5" />
              <span className="hidden xs:inline">{t('attendance.recordedToday') || 'Day complete'}</span>
              <span className="xs:hidden">Done</span>
            </span>
          )}
        </div>

        <div className="relative px-3 xs:px-4 sm:px-3 py-2 xs:py-5 sm:py-6">
          <p className="text-center text-[9px] xs:text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] xs:tracking-[0.2em] text-slate-500 mb-3 xs:mb-4 sm:mb-5">
            {clickToRecordLabel || t('attendance.clickToRecord') || 'Click to record'}
          </p>

          <div className="relative rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden dark:border-slate-700/70 dark:bg-slate-950/50">
            <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700/80">
              {renderActionCell('in', {
                active: inActive,
                recorded: hasIn,
                disabled: !canClockIn && !hasIn,
                onClick: onClockIn,
                label: t('attendance.clockIn') || 'Clock in',
                time: hasIn ? clockInLabel : '—',
                Icon: LogIn,
              })}
              {renderActionCell('out', {
                active: outActive,
                recorded: hasOut,
                disabled: !canClockOut && !hasOut,
                onClick: onClockOut,
                label: t('attendance.clockOut') || 'Clock out',
                time: hasOut ? clockOutLabel : '—',
                Icon: LogOut,
                subHint:
                  hasIn && !hasOut && !canClockOut && !loadingAction
                    ? loadingLoc
                      ? t('attendance.locating') || 'Locating…'
                      : t('attendance.outOfZone') || 'Not in zone'
                    : undefined,
              })}
            </div>
          </div>

          {statusHint ? (
            <p className="mt-3 xs:mt-4 text-center text-[11px] xs:text-xs leading-relaxed text-slate-600 px-2.5 xs:px-3 py-2 xs:py-2.5 rounded-lg bg-slate-100 border border-slate-200 dark:text-slate-400 dark:bg-slate-900/60 dark:border-slate-800/80">
              {statusHint}
            </p>
          ) : null}
        </div>

        {zoneLabel ? (
          <div className="px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-5">
            <div
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 xs:px-4 py-3 xs:py-3.5 text-xs xs:text-sm font-semibold ${FOOTER_TONE[zoneTone]}`}
            >
              <MapPin className="w-3.5 h-3.5 xs:w-4 xs:h-4 shrink-0 opacity-90" />
              <span className="truncate">{zoneLabel}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
