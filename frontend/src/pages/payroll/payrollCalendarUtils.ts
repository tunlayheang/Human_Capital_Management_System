import { differenceInCalendarDays, parseISO, startOfDay } from 'date-fns';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

export function dateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function upcomingPayrollRunAlerts(
  runDates: string[],
  withinDays = 7
): Array<{ date: string; label: string }> {
  const today = startOfDay(new Date());
  const alerts: Array<{ date: string; label: string }> = [];

  for (const d of runDates) {
    const key = d.slice(0, 10);
    const runDay = startOfDay(parseISO(key));
    const diff = differenceInCalendarDays(runDay, today);
    if (diff >= 0 && diff <= withinDays) {
      const label =
        diff === 0
          ? 'Payroll run scheduled today'
          : diff === 1
            ? 'Payroll run scheduled tomorrow'
            : `Payroll run in ${diff} days`;
      alerts.push({ date: key, label: `${label} (${formatDateOnlyDisplay(runDay)})` });
    }
  }

  return alerts.sort((a, b) => a.date.localeCompare(b.date));
}

export function togglePayrollRunDate(key: string, runDates: string[]): string[] {
  const runs = new Set(runDates.map((d) => d.slice(0, 10)));
  if (runs.has(key)) runs.delete(key);
  else runs.add(key);
  return [...runs].sort();
}

export function cycleMarkersForDay(
  key: string,
  cycle?: {
    periodStart?: string;
    periodEnd?: string;
    attendanceCutoffDate?: string;
    payrollCalculationDate?: string;
    payrollApprovalDate?: string;
    paymentDate?: string;
  }
): Array<'cutoff' | 'calc' | 'approval' | 'payment'> {
  if (!cycle) return [];
  const markers: Array<'cutoff' | 'calc' | 'approval' | 'payment'> = [];
  if (cycle.attendanceCutoffDate?.slice(0, 10) === key) markers.push('cutoff');
  if (cycle.payrollCalculationDate?.slice(0, 10) === key) markers.push('calc');
  if (cycle.payrollApprovalDate?.slice(0, 10) === key) markers.push('approval');
  if (cycle.paymentDate?.slice(0, 10) === key) markers.push('payment');
  return markers;
}

export function fillDefaultRunDates(year: number, dayOfMonth: number): string[] {
  const dates: string[] = [];
  for (let m = 0; m < 12; m++) {
    const last = new Date(year, m + 1, 0).getDate();
    const d = Math.min(Math.max(1, dayOfMonth), last);
    dates.push(dateKey(year, m, d));
  }
  return dates;
}
