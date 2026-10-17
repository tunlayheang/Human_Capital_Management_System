/**
 * Join given + family name in Khmer order: Last (family) then First (given).
 * Field semantics stay unchanged — only display concatenation order.
 */
export function joinEmployeeNameParts(
  first?: string | null,
  last?: string | null
): string {
  return `${String(last ?? '').trim()} ${String(first ?? '').trim()}`.trim();
}

/** True when a stored name is empty or a UI placeholder (—, -, --, N/A). */
export function isBlankPersonName(value?: string | null): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  const normalized = s.replace(/\s+/g, ' ');
  if (/^[—–−\-_.]+$/.test(normalized.replace(/\s/g, ''))) return true;
  if (/^(n\/?a|null|undefined|unknown)$/i.test(normalized)) return true;
  return false;
}

type EmployeeNameSource = {
  first_name?: string | null;
  last_name?: string | null;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  email?: string | null;
};

/**
 * Prefer English names, then Khmer, then email local-part.
 * Treats placeholder dashes as missing so listings never show "— —".
 */
export function resolveEmployeeRecordName(row: EmployeeNameSource | null | undefined): string {
  if (!row) return '';
  const english = joinEmployeeNameParts(row.first_name, row.last_name);
  if (!isBlankPersonName(english)) return english;
  const khmer = joinEmployeeNameParts(row.first_name_kh, row.last_name_kh);
  if (!isBlankPersonName(khmer)) return khmer;
  const email = String(row.email ?? '').trim();
  if (email.includes('@')) {
    const local = email.split('@')[0]?.trim() ?? '';
    if (!isBlankPersonName(local)) return local;
  }
  return '';
}
