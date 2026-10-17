/** True when an entity is assignable / available (handles boolean, 0/1, and "0"/"1"). */
export function isActiveFlag(value: unknown): boolean {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return true;
}
