/** Extract calendar birth year from ISO date strings or Date values. */
export function birthYearFromDate(raw: string | Date | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.getFullYear();
  }
  const s = String(raw).trim();
  if (!s) return null;
  const isoMatch = s.match(/^(\d{4})-/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    return Number.isFinite(year) ? year : null;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

/**
 * Age in whole years: reference year minus birth year.
 * Defaults to the current calendar year.
 */
export function ageFromBirthDate(
  raw: string | Date | null | undefined,
  referenceYear: number = new Date().getFullYear()
): number | null {
  const birthYear = birthYearFromDate(raw);
  if (birthYear == null) return null;
  const age = referenceYear - birthYear;
  if (!Number.isFinite(age) || age < 0 || age > 150) return null;
  return age;
}

/** Display age for tables and forms; em dash when unknown. */
export function formatEmployeeAge(
  raw: string | Date | null | undefined,
  referenceYear?: number
): string {
  const age = ageFromBirthDate(raw, referenceYear);
  return age == null ? '—' : String(age);
}
