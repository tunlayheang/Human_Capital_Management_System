const MENU_CACHE_PREFIX = 'hcms_menu_me:';
const MENU_CACHE_TTL_MS = 5 * 60 * 1000;

export type CachedMenuPayload = {
  paths: string[];
  routeGuards: Record<string, string[]>;
  fetchedAt: number;
};

export function readCachedMenu(userId: string): CachedMenuPayload | null {
  try {
    const raw = sessionStorage.getItem(MENU_CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMenuPayload;
    if (!parsed?.paths?.length || Date.now() - parsed.fetchedAt > MENU_CACHE_TTL_MS) {
      sessionStorage.removeItem(MENU_CACHE_PREFIX + userId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedMenu(userId: string, data: { paths: string[]; routeGuards: Record<string, string[]> }): void {
  try {
    const payload: CachedMenuPayload = {
      paths: data.paths,
      routeGuards: data.routeGuards,
      fetchedAt: Date.now(),
    };
    sessionStorage.setItem(MENU_CACHE_PREFIX + userId, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Bump when admin saves menu config — other tabs pick this up on refresh/poll. */
export const MENU_CONFIG_REVISION_KEY = 'hcms_menu_config_revision';

export function readMenuConfigRevision(): number {
  try {
    const n = Number(localStorage.getItem(MENU_CONFIG_REVISION_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function bumpMenuConfigRevision(): void {
  try {
    localStorage.setItem(MENU_CONFIG_REVISION_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function clearCachedMenu(userId?: string): void {
  try {
    if (userId) {
      sessionStorage.removeItem(MENU_CACHE_PREFIX + userId);
      return;
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(MENU_CACHE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
