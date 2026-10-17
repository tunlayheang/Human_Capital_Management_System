/**
 * Formerly forced grants (dashboard / profile / account / notifications).
 * Matrix Grant/Deny is now authoritative for every catalog key — including those.
 * Shell routes that only require login still use ALWAYS_AUTH_PATHS on the frontend.
 */
export const ALWAYS_ON_PERMISSION_KEYS = [] as const;

export type AlwaysOnPermissionKey = (typeof ALWAYS_ON_PERMISSION_KEYS)[number];

const ALWAYS_ON_SET = new Set<string>(ALWAYS_ON_PERMISSION_KEYS);

export function isAlwaysOnPermissionKey(key: string): boolean {
  return ALWAYS_ON_SET.has(String(key || '').trim().toLowerCase());
}

/** No-op — kept so callers that previously forced shell grants still compile. */
export function applyAlwaysOnPermissions(
  effective: Record<string, { actions: string[]; source: string }>
): Record<string, { actions: string[]; source: string }> {
  return effective;
}
