import type { Language } from '../i18n/types';
import type { Department, LeaveType, OvertimeType, Position } from '../types';

/** Pick English vs Khmer entity text for the active UI language (fallback to the other). */
export function resolveLocalizedLabel(
  english?: string | null,
  khmer?: string | null,
  language: Language = 'en'
): string {
  const en = String(english ?? '').trim();
  const kh = String(khmer ?? '').trim();
  if (language === 'km') return kh || en || '—';
  return en || kh || '—';
}

/** Apply Khmer font when showing Khmer-preferred text that actually came from a Khmer field. */
export function localizedLabelUsesKhmerFont(
  english?: string | null,
  khmer?: string | null,
  language: Language = 'en'
): boolean {
  if (language !== 'km') return false;
  return Boolean(String(khmer ?? '').trim());
}

export function resolveDepartmentDisplayName(
  dept: Pick<Department, 'name' | 'nameKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!dept) return '—';
  return resolveLocalizedLabel(dept.name, dept.nameKh, language);
}

export function resolvePositionTitle(
  pos: Pick<Position, 'title' | 'titleKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!pos) return '—';
  return resolveLocalizedLabel(pos.title, pos.titleKh, language);
}

export function resolveLeaveTypeDisplayName(
  type: Pick<LeaveType, 'name' | 'nameKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!type) return '—';
  return resolveLocalizedLabel(type.name, type.nameKh, language);
}

export function resolveLeaveTypeDescription(
  type: Pick<LeaveType, 'description' | 'descriptionKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!type) return '';
  return resolveLocalizedLabel(type.description, type.descriptionKh, language);
}

export function resolveOvertimeTypeDisplayName(
  type: Pick<OvertimeType, 'name' | 'nameKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!type) return '—';
  return resolveLocalizedLabel(type.name, type.nameKh, language);
}

export function resolveOvertimeTypeDescription(
  type: Pick<OvertimeType, 'description' | 'descriptionKh'> | null | undefined,
  language: Language = 'en'
): string {
  if (!type) return '';
  return resolveLocalizedLabel(type.description, type.descriptionKh, language);
}

/** Resolve a leave request's stored English type name using optional typeKh or a catalog. */
export function resolveStoredLeaveTypeLabel(
  storedType: string | null | undefined,
  language: Language = 'en',
  opts?: {
    typeKh?: string | null;
    leaveTypes?: Array<Pick<LeaveType, 'id' | 'name' | 'nameKh' | 'code'>>;
  }
): string {
  const stored = String(storedType ?? '').trim();
  if (!stored) return '—';
  if (opts?.typeKh != null && String(opts.typeKh).trim()) {
    // Prefer catalog English name when the stored value is still an id/code.
    const catalog = opts.leaveTypes?.find((lt) => {
      const key = stored.toLowerCase();
      return (
        String(lt.id ?? '').toLowerCase() === key ||
        String(lt.code ?? '').toLowerCase() === key ||
        String(lt.name ?? '').trim().toLowerCase() === key
      );
    });
    const english = catalog?.name ?? stored;
    return resolveLocalizedLabel(english, opts.typeKh, language);
  }
  const match = opts?.leaveTypes?.find((lt) => {
    const key = stored.toLowerCase();
    return (
      String(lt.id ?? '').toLowerCase() === key ||
      String(lt.code ?? '').toLowerCase() === key ||
      String(lt.name ?? '').trim().toLowerCase() === key
    );
  });
  if (match) return resolveLeaveTypeDisplayName(match, language);
  // Fallback: strip common id prefix "lt-" → "annual" → "Annual"
  if (/^lt-/i.test(stored)) {
    const rest = stored.replace(/^lt-/i, '').replace(/[-_]+/g, ' ').trim();
    if (rest) {
      return rest.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return stored;
}

export function resolveOvertimeRequestTypeLabel(
  request: {
    otTypeName?: string | null;
    otTypeNameKh?: string | null;
    otTypeId?: string | null;
  },
  language: Language = 'en',
  types?: Array<Pick<OvertimeType, 'id' | 'name' | 'nameKh'>>
): string {
  if (request.otTypeNameKh != null || request.otTypeName != null) {
    return resolveLocalizedLabel(request.otTypeName, request.otTypeNameKh, language);
  }
  const id = String(request.otTypeId ?? '').trim();
  if (id && types?.length) {
    const match = types.find((t) => t.id === id);
    if (match) return resolveOvertimeTypeDisplayName(match, language);
  }
  return '—';
}

/** Free-text bilingual employee fields (address, emergency name, spouse, etc.). */
export function resolveBilingualText(
  english?: string | null,
  khmer?: string | null,
  language: Language = 'en'
): string {
  return resolveLocalizedLabel(english, khmer, language);
}

/** Department row that may use camelCase or snake_case Khmer name from API. */
export function resolveDepartmentRowName(
  dept:
    | { name?: string | null; nameKh?: string | null; name_kh?: string | null }
    | null
    | undefined,
  language: Language = 'en'
): string {
  if (!dept) return '—';
  return resolveLocalizedLabel(dept.name, dept.nameKh ?? dept.name_kh, language);
}

/** Position row that may use camelCase or snake_case Khmer title from API. */
export function resolvePositionRowTitle(
  pos:
    | { title?: string | null; titleKh?: string | null; title_kh?: string | null }
    | null
    | undefined,
  language: Language = 'en'
): string {
  if (!pos) return '—';
  return resolveLocalizedLabel(pos.title, pos.titleKh ?? pos.title_kh, language);
}
