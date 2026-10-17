export function parseTimeToMinutes(time: string): number | null {
  const m = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function computeWorkHoursPerDay(
  timeIn: string,
  timeOut: string,
  breakMinutes = 0
): number {
  const start = parseTimeToMinutes(timeIn);
  const end = parseTimeToMinutes(timeOut);
  if (start == null || end == null) return 8;
  let span = end - start;
  if (span <= 0) span += 24 * 60;
  return Math.round(Math.max(0, (span - Math.max(0, breakMinutes)) / 60) * 100) / 100;
}
