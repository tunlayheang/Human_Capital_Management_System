import { Api } from '../services/api';
import { isPlaceholderDraftEmail } from './employeeDraft';
import { digitsOnly } from './digitsOnlyInput';
import { phonesMatch } from './phone';

export type ContactConflict = { field: 'email' | 'phone'; message: string };

export async function checkEmployeeContactConflicts(params: {
  email?: string;
  phone?: string;
  excludeEmployeeId?: string;
}): Promise<ContactConflict[]> {
  const email = String(params.email ?? '').trim();
  const phone = digitsOnly(String(params.phone ?? ''));
  if (!email && !phone) return [];

  const res = (await Api.employees.checkContact({
    email: email || undefined,
    phone: phone || undefined,
    exclude_employee_id: params.excludeEmployeeId?.trim() || undefined,
  })) as { ok?: boolean; conflicts?: ContactConflict[] };

  return Array.isArray(res?.conflicts) ? res.conflicts : [];
}

/** Mock-mode fallback when API check is unavailable. */
export function mockContactConflicts(
  users: { id?: string; email?: string; phone?: string; employeeId?: string }[],
  params: { email?: string; phone?: string; excludeEmployeeId?: string }
): ContactConflict[] {
  const conflicts: ContactConflict[] = [];
  const exclude = String(params.excludeEmployeeId ?? '').trim();
  const email = String(params.email ?? '').trim().toLowerCase();
  const phone = digitsOnly(String(params.phone ?? ''));

  for (const u of users) {
    if (exclude && (u.id === exclude || u.employeeId === exclude)) continue;
    if (email && !isPlaceholderDraftEmail(email) && u.email?.toLowerCase() === email) {
      conflicts.push({
        field: 'email',
        message: `Work email is already used by ${u.id || 'another employee'}.`,
      });
      break;
    }
  }
  if (!conflicts.some((c) => c.field === 'email') && phone.length >= 8) {
    for (const u of users) {
      if (exclude && (u.id === exclude || u.employeeId === exclude)) continue;
      if (u.phone && phonesMatch(phone, u.phone)) {
        conflicts.push({
          field: 'phone',
          message: `Phone number is already used by ${u.id || 'another employee'}.`,
        });
        break;
      }
    }
  }
  return conflicts;
}
