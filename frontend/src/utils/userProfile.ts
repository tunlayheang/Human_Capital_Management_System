import { resolveMediaUrl } from './mediaUrl';
import type { Language } from '../i18n/types';
import { resolvePersonDisplayName } from './personDisplayName';
import { normalizeEmployeeDisplayId } from './index';

/** Employee payload nested on GET /users (and login) after enrichUsersWithEmployee. */
export type LinkedEmployeeProfile = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  first_name_kh?: string;
  last_name_kh?: string;
  full_name_kh?: string;
  avatar_url?: string | null;
  position_title?: string | null;
  position_title_kh?: string | null;
  department_name?: string | null;
  department_name_kh?: string | null;
};

export type EnrichedUserLike = {
  name?: string;
  avatarUrl?: string;
  position?: string;
  role?: string;
  accountType?: 'system' | 'employee_linked' | 'user';
  displayEmployeeId?: string | null;
  loginId?: string | null;
  employee?: (LinkedEmployeeProfile & { employee_id?: string }) | null;
};

/** Portal administrator account with no linked HR employee record. */
export function isSystemPortalAccount(
  u: EnrichedUserLike | null | undefined
): boolean {
  if (!u) return false;
  if (u.accountType === 'system') return true;
  const role = String(u.role ?? '').toUpperCase();
  return role === 'ADMIN' && !String(u.employee?.employee_id ?? '').trim();
}

/**
 * Login / badge EmpID: ROC##### for employees, ADM##### for portal-only admins.
 */
export function userDisplayEmployeeCode(
  u: EnrichedUserLike | null | undefined
): string {
  const code =
    String(u?.displayEmployeeId ?? '').trim() ||
    String(u?.loginId ?? '').trim() ||
    String(u?.employee?.employee_id ?? '').trim();
  if (!code) return '—';
  return normalizeEmployeeDisplayId(code) || '—';
}

export function userDisplayName(
  u: EnrichedUserLike | null | undefined,
  language: Language = 'en'
): string {
  return resolvePersonDisplayName(u, language);
}

export function userDisplayPosition(
  u: EnrichedUserLike | null | undefined,
  language: Language = 'en'
): string {
  if (!u) return '—';
  const emp = u.employee as
    | {
        position_title?: string | null;
        position_title_kh?: string | null;
        positionTitleKh?: string | null;
        position?: { title?: string | null; titleKh?: string | null; title_kh?: string | null };
      }
    | null
    | undefined;
  const en = emp?.position_title || emp?.position?.title || u.position || '';
  const kh =
    emp?.position_title_kh ||
    emp?.positionTitleKh ||
    emp?.position?.titleKh ||
    emp?.position?.title_kh ||
    '';
  if (language === 'km') return String(kh || en || '—').trim() || '—';
  return String(en || kh || '—').trim() || '—';
}

/** Prefer Employees.avatar_url only — ignore legacy User.pravatar URLs. */
export function userAvatarUrl(u: EnrichedUserLike | null | undefined): string | null | undefined {
  if (!u) return null;
  const fromEmployee = u.employee?.avatar_url?.trim();
  if (fromEmployee) return resolveMediaUrl(fromEmployee) ?? undefined;
  const legacy = u.avatarUrl?.trim();
  if (legacy && !legacy.includes('pravatar.cc')) {
    return resolveMediaUrl(legacy) ?? undefined;
  }
  return null;
}

export function userNameParts(u: EnrichedUserLike | null | undefined): {
  firstName: string;
  lastName: string;
} {
  if (!u) return { firstName: '', lastName: '' };
  const emp = u.employee;
  if (emp?.first_name || emp?.last_name) {
    return { firstName: emp.first_name || '', lastName: emp.last_name || '' };
  }
  // Display names use Khmer order (Last First); invert when splitting.
  const parts = (u.name || '').trim().split(/\s+/).filter(Boolean);
  return { lastName: parts[0] || '', firstName: parts.slice(1).join(' ') };
}
