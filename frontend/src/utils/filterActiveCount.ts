/** Count how many filter fields differ from their empty/default values. */
export function countActiveFilters(
  pairs: Array<{ value: unknown; defaultValue?: unknown }>
): number {
  return pairs.filter(({ value, defaultValue }) => isFilterActive(value, defaultValue)).length;
}

export function isFilterActive(value: unknown, defaultValue: unknown = ''): boolean {
  const d = defaultValue ?? '';
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value !== defaultValue;
  const s = String(value).trim();
  if (s === '' || s === 'ALL' || s === 'all') return false;
  return String(value) !== String(d);
}
