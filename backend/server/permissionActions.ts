/** Normalize role permission `actions` from DB (JSON column or legacy string). */
export function normalizeRoleActions(actions: unknown): string[] {
  if (Array.isArray(actions)) {
    return actions.map((action) => String(action)).filter(Boolean);
  }
  if (typeof actions === 'string') {
    const trimmed = actions.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((action) => String(action)).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
  }
  return [];
}

export function isRoleActionGranted(actions: unknown): boolean {
  return normalizeRoleActions(actions).length > 0;
}
