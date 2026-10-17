export type LeaveHalfDayPeriod = 'AM' | 'PM';

export type LeaveDurationInput = {
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: LeaveHalfDayPeriod | string | null;
};

/** Inclusive day count; half-day on one date counts as 0.5. */
export function calculateLeaveDays(
  startOrInput: string | LeaveDurationInput,
  endDate?: string
): number {
  const input: LeaveDurationInput =
    typeof startOrInput === 'string'
      ? { startDate: startOrInput, endDate: endDate ?? '' }
      : startOrInput;

  const startDate = String(input.startDate ?? '').slice(0, 10);
  const end = String(input.endDate ?? '').slice(0, 10);
  if (!startDate || !end) return 0;

  if (input.isHalfDay) {
    if (startDate !== end) return 0;
    return 0.5;
  }

  const start = new Date(`${startDate}T00:00:00`);
  const endDt = new Date(`${end}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDt.getTime())) return 0;
  const diff = Math.abs(endDt.getTime() - start.getTime());
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
}

export function formatLeaveDateRange(input: LeaveDurationInput): string {
  const startDate = String(input.startDate ?? '').slice(0, 10);
  const endDate = String(input.endDate ?? '').slice(0, 10);
  if (input.isHalfDay && startDate && startDate === endDate) {
    const period =
      String(input.halfDayPeriod ?? '').toUpperCase() === 'PM'
        ? 'Afternoon'
        : String(input.halfDayPeriod ?? '').toUpperCase() === 'AM'
          ? 'Morning'
          : 'Half day';
    return `${startDate} (${period})`;
  }
  if (startDate === endDate) return startDate;
  return `${startDate} → ${endDate}`;
}

export function formatLeaveDurationLabel(
  days: number,
  labels?: { day: string; days: string; halfDay?: string }
): string {
  if (days === 0.5) return labels?.halfDay ?? '½ day';
  const dayLabel = labels?.day ?? 'day';
  const daysLabel = labels?.days ?? 'days';
  if (days === 1) return `1 ${dayLabel}`;
  return `${days} ${daysLabel}`;
}

/** Numeric duration only (no "days" suffix) — for compact list tables. */
export function formatLeaveDurationNumber(days: number): string {
  if (days === 0.5) return '0.5';
  if (Number.isInteger(days)) return String(days);
  return String(Math.round(days * 100) / 100);
}
