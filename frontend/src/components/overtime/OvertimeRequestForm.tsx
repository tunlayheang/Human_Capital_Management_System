import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OvertimeRateTier, OvertimeRequest, OvertimeRequestConfig, AttendanceRecord } from '../../types';
import { Api } from '../../services/api';
import {
  activeOvertimeTypes,
  findOvertimeType,
  findRestDayOvertimeType,
} from '../../utils/overtimeConfig';
import { AttendanceStatus } from '../../types';
import { overtimeRateLabel } from '../../utils/overtimeLabels';
import { isoToDatetimeLocalIct } from '../../utils/attendanceForm';
import { attendanceTimeHmFromIso, formatAttendanceClockDisplay } from '../../utils/attendanceRecordApi';
import { inputClass } from '../../constants/designSystem';
import { NumericField } from '../ui/NumericField';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveOvertimeTypeDescription,
  resolveOvertimeTypeDisplayName,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

export type OvertimeFormState = {
  workDate: string;
  hours: string;
  rateTier: OvertimeRateTier;
  reason: string;
  otTypeId: string;
  startTime: string;
  endTime: string;
  clockIn: string;
  clockOut: string;
};

export function overtimeRequestToForm(request: OvertimeRequest): OvertimeFormState {
  return {
    workDate: request.workDate,
    hours: String(request.hours),
    rateTier: request.rateTier,
    reason: request.reason,
    otTypeId: String(request.otTypeId ?? ''),
    startTime: String(request.startTime ?? ''),
    endTime: String(request.endTime ?? ''),
    clockIn: request.clockIn ? isoToDatetimeLocalIct(String(request.clockIn)) : '',
    clockOut: request.clockOut ? isoToDatetimeLocalIct(String(request.clockOut)) : '',
  };
}

export const emptyOvertimeForm = (
  defaultTypeId = '',
  defaultRate: OvertimeRateTier = 'daytime_150'
): OvertimeFormState => ({
  workDate: '',
  hours: '',
  rateTier: defaultRate,
  reason: '',
  otTypeId: defaultTypeId,
  startTime: '',
  endTime: '',
  clockIn: '',
  clockOut: '',
});

type Props = {
  config: OvertimeRequestConfig;
  value: OvertimeFormState;
  userId?: string;
  onChange: React.Dispatch<React.SetStateAction<OvertimeFormState>>;
};

export const OvertimeRequestForm: React.FC<Props> = ({ config, value, userId, onChange }) => {
  const { language } = useLanguage();
  const types = activeOvertimeTypes(config);
  const selected = useMemo(
    () => (value.otTypeId ? findOvertimeType(config, value.otTypeId) : undefined),
    [config, value.otTypeId]
  );

  const [attendanceHint, setAttendanceHint] = useState<string | null>(null);
  const [attendanceSynced, setAttendanceSynced] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const attendanceFetchRef = useRef(0);

  const set = (patch: Partial<OvertimeFormState>) => onChange((f) => ({ ...f, ...patch }));

  const applyAttendanceRecord = (
    rec: AttendanceRecord,
    workDate: string,
    current: OvertimeFormState
  ): OvertimeFormState => {
    const clockIn = isoToDatetimeLocalIct(rec.clockIn);
    const clockOut = isoToDatetimeLocalIct(rec.clockOut);
    const dayOffWorked =
      rec.workedOnDayOff ||
      (rec.status === AttendanceStatus.DAY_OFF && Boolean(rec.clockIn));
    const hoursFromAttendance =
      rec.otEligibleHours != null && Number.isFinite(rec.otEligibleHours)
        ? String(rec.otEligibleHours)
        : rec.workHours != null && Number.isFinite(rec.workHours)
          ? String(rec.workHours)
          : '';

    const next: OvertimeFormState = {
      ...current,
      clockIn,
      clockOut,
      startTime: rec.clockIn ? attendanceTimeHmFromIso(rec.clockIn) : '',
      endTime: rec.clockOut ? attendanceTimeHmFromIso(rec.clockOut) : '',
    };

    if (dayOffWorked) {
      const restType = findRestDayOvertimeType(config);
      if (restType) {
        next.otTypeId = restType.id;
        next.rateTier = restType.rateTier;
      } else {
        next.rateTier = 'rest_holiday_200';
      }
      if (!current.reason.trim()) {
        next.reason = 'Worked on scheduled day off (attendance recorded).';
      }
    }

    if (hoursFromAttendance && !current.hours.trim()) {
      next.hours = hoursFromAttendance;
    }

    return next;
  };

  const buildAttendanceHint = (rec: AttendanceRecord, clockIn: string, clockOut: string): string => {
    const filled: string[] = [];
    if (clockIn) filled.push('clock-in');
    if (clockOut) filled.push('clock-out');
    const dayOffWorked =
      rec.workedOnDayOff ||
      (rec.status === AttendanceStatus.DAY_OFF && Boolean(rec.clockIn));

    if (dayOffWorked) {
      return `Scheduled day off with attendance recorded (${filled.join(' & ')}). Rest-day/holiday OT (200%) is suggested.`;
    }
    if (filled.length) {
      const inLabel = rec.clockIn ? formatAttendanceClockDisplay(rec.clockIn) : null;
      const outLabel = rec.clockOut ? formatAttendanceClockDisplay(rec.clockOut) : null;
      const times =
        inLabel && outLabel
          ? `${inLabel} – ${outLabel}`
          : inLabel
            ? `in at ${inLabel}`
            : outLabel
              ? `out at ${outLabel}`
              : filled.join(' & ');
      return `Filled from your attendance record (${times}).`;
    }
    return rec.isGridPlaceholder
      ? 'No clock-in/out recorded for this date yet. Clock attendance first, or enter times manually.'
      : 'Attendance record found but no clock-in/out times yet.';
  };

  useEffect(() => {
    if (!value.otTypeId) return;
    const cat = findOvertimeType(config, value.otTypeId);
    if (!cat || value.rateTier === cat.rateTier) return;
    onChange((f) => (f.otTypeId === value.otTypeId ? { ...f, rateTier: cat.rateTier } : f));
  }, [value.otTypeId, value.rateTier, config, onChange]);

  useEffect(() => {
    if (!userId || !value.workDate) {
      setAttendanceHint(null);
      setAttendanceSynced(false);
      setAttendanceLoading(false);
      return;
    }

    const workDate = value.workDate.slice(0, 10);
    const fetchId = ++attendanceFetchRef.current;
    let cancelled = false;
    setAttendanceLoading(true);
    setAttendanceHint('Loading attendance…');
    setAttendanceSynced(false);

    void Api.attendance
      .getForUserOnDate(userId, workDate)
      .then((rec) => {
        if (cancelled || fetchId !== attendanceFetchRef.current) return;
        setAttendanceLoading(false);

        if (!rec) {
          setAttendanceHint('No attendance record for this date.');
          setAttendanceSynced(false);
          onChange((f) =>
            f.workDate.slice(0, 10) !== workDate
              ? f
              : { ...f, clockIn: '', clockOut: '', startTime: '', endTime: '' }
          );
          return;
        }

        const clockIn = isoToDatetimeLocalIct(rec.clockIn);
        const clockOut = isoToDatetimeLocalIct(rec.clockOut);

        if (!clockIn && !clockOut) {
          setAttendanceHint(buildAttendanceHint(rec, clockIn, clockOut));
          setAttendanceSynced(false);
          onChange((f) =>
            f.workDate.slice(0, 10) !== workDate
              ? f
              : { ...f, clockIn: '', clockOut: '', startTime: '', endTime: '' }
          );
          return;
        }

        setAttendanceHint(buildAttendanceHint(rec, clockIn, clockOut));
        setAttendanceSynced(true);
        onChange((f) => {
          if (f.workDate.slice(0, 10) !== workDate) return f;
          return applyAttendanceRecord(rec, workDate, f);
        });
      })
      .catch(() => {
        if (cancelled || fetchId !== attendanceFetchRef.current) return;
        setAttendanceLoading(false);
        setAttendanceHint('Could not load attendance for this date.');
        setAttendanceSynced(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, value.workDate, onChange, config]);

  const rules = selected?.rules;

  if (types.length === 0) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
        No OT categories are configured yet. Ask HR to add types under Configuration.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Core</h4>
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Work date *
            <DatePickerInput required
              value={value.workDate}
              onChange={(e) => set({ workDate: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Hours *
            <NumericField
              kind="decimal"
              filterOptions={{ maxDecimals: 2 }}
              required
              value={value.hours}
              onValueChange={(v) => set({ hours: v })}
              className={`${inputClass} mt-1`}
            />
            {selected ? (
              <span className="text-xs text-slate-500 mt-1 block">
                {rules?.minHours ?? 0.25}–{rules?.maxHoursPerDay ?? 12}h for this category · company max{' '}
                {config.globalMaxHoursPerMonth}h/month
              </span>
            ) : (
              <span className="text-xs text-slate-500 mt-1 block">Total overtime hours for that date</span>
            )}
          </label>

          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            OT category *
            <select
              required
              value={value.otTypeId}
              onChange={(e) => {
                const id = e.target.value;
                const cat = findOvertimeType(config, id);
                set({
                  otTypeId: id,
                  ...(cat ? { rateTier: cat.rateTier } : {}),
                });
              }}
              className={`${inputClass} mt-1`}
            >
              <option value="" disabled hidden>Select category…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {resolveOvertimeTypeDisplayName(t, language)} ({overtimeRateLabel(t.rateTier)})
                </option>
              ))}
            </select>
            {selected && resolveOvertimeTypeDescription(selected, language) ? (
              <span
                className={cn(
                  'text-xs text-slate-500 mt-1 block',
                  localizedLabelUsesKhmerFont(
                    selected.description,
                    selected.descriptionKh,
                    language
                  ) && 'font-khmer'
                )}
              >
                {resolveOvertimeTypeDescription(selected, language)}
              </span>
            ) : null}
            {selected && (
              <span className="text-xs text-slate-500 mt-1 block">
                Pay rate: {overtimeRateLabel(selected.rateTier)}
              </span>
            )}
          </label>

          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Reason / justification *
            <textarea
              required
              rows={3}
              value={value.reason}
              onChange={(e) => set({ reason: e.target.value })}
              className={`${inputClass} mt-1`}
              placeholder="Why was overtime necessary?"
            />
          </label>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">
          Clock times
        </h4>
        <p className="text-xs text-slate-500 mb-3">
          Pulled from attendance when you pick a work date. Required when the OT category requires
          clock-in and clock-out.
        </p>
        {attendanceHint && (
          <p className="text-xs text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/30 rounded-lg px-3 py-2 mb-3">
            {attendanceHint}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Clock-in {rules?.requireClockInOut ? '*' : ''}
            <input
              type="datetime-local"
              required={!!rules?.requireClockInOut}
              value={value.clockIn}
              onChange={(e) => {
                setAttendanceSynced(false);
                set({ clockIn: e.target.value });
              }}
              className={`${inputClass} mt-1`}
              disabled={attendanceLoading}
            />
            <span className="text-xs text-slate-500 font-normal">
              {attendanceSynced && value.clockIn
                ? 'From attendance record'
                : 'Filled when you select a work date with clock-in'}
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
            Clock-out {rules?.requireClockInOut ? '*' : ''}
            <input
              type="datetime-local"
              required={!!rules?.requireClockInOut}
              value={value.clockOut}
              onChange={(e) => {
                setAttendanceSynced(false);
                set({ clockOut: e.target.value });
              }}
              className={`${inputClass} mt-1`}
              disabled={attendanceLoading}
            />
            <span className="text-xs text-slate-500 font-normal">
              {attendanceSynced && value.clockOut
                ? 'From attendance record'
                : 'Filled when you select a work date with clock-out'}
            </span>
          </label>
        </div>
        {rules?.requireClockInOut && (
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
            Clock-in and clock-out are required for the selected OT category.
          </p>
        )}
      </section>
    </div>
  );
};
