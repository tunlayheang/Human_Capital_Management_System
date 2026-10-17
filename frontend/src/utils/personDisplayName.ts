import type { Language } from '../i18n/types';
import type { EnrichedUserLike } from './userProfile';

/** True when a name is empty or a UI placeholder (—, -, --, N/A). */
export function isBlankPersonName(value?: string | null): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  const compact = s.replace(/\s+/g, '');
  if (/^[—–−\-_.]+$/.test(compact)) return true;
  if (/^(n\/?a|null|undefined|unknown)$/i.test(s)) return true;
  return false;
}

/** Join given + family name in Khmer order: Last (family) then First (given). */
export function joinPersonNameParts(
  first?: string | null,
  last?: string | null
): string {
  return `${String(last ?? '').trim()} ${String(first ?? '').trim()}`.trim();
}

export type PersonNameFields = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  full_name_kh?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  firstNameKh?: string | null;
  lastNameKh?: string | null;
};

/** Full display name for an employee row — Khmer when UI language is km, else English. */
export function resolveEmployeeRecordDisplayName(
  row: PersonNameFields,
  language: Language = 'en'
): string {
  const english =
    joinPersonNameParts(row.first_name ?? row.firstName, row.last_name ?? row.lastName) ||
    String(row.full_name ?? row.name ?? '').trim();
  const khmer =
    joinPersonNameParts(row.first_name_kh ?? row.firstNameKh, row.last_name_kh ?? row.lastNameKh) ||
    String(row.full_name_kh ?? '').trim();

  if (language === 'km') {
    if (!isBlankPersonName(khmer)) return khmer;
    if (!isBlankPersonName(english)) return english;
    return '—';
  }
  if (!isBlankPersonName(english)) return english;
  if (!isBlankPersonName(khmer)) return khmer;
  return '—';
}

/** Full display name for a portal user — prefers linked employee profile when present. */
export function resolvePersonDisplayName(
  u: EnrichedUserLike | null | undefined,
  language: Language = 'en'
): string {
  if (!u) return 'Unknown';

  const emp = u.employee as PersonNameFields | null | undefined;
  if (emp) {
    const fromEmp = resolveEmployeeRecordDisplayName(emp, language);
    if (fromEmp && fromEmp !== '—') return fromEmp;
  }

  const fromUser = resolveEmployeeRecordDisplayName(
    {
      firstName: (u as { firstName?: string }).firstName,
      lastName: (u as { lastName?: string }).lastName,
      name: u.name,
    },
    language
  );
  if (fromUser && fromUser !== '—') return fromUser;

  return String(u.name ?? '').trim() || 'Unknown';
}
