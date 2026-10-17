/**
 * Client-side GET cache for slow networks: instant revisits + stale-while-revalidate.
 * Persisted in sessionStorage (survives refresh within the tab).
 */

type CacheEntry<T = unknown> = {
  data: T;
  fetchedAt: number;
  ttlMs: number;
};

const memory = new Map<string, CacheEntry>();
const STORAGE_PREFIX = 'hcms_api_cache_v1:';
const STALE_MULTIPLIER = 2;

/** TTL per endpoint path (before query string). null = do not cache. */
export function getCacheTtlMs(endpoint: string): number | null {
  const path = endpoint.split('?')[0].replace(/\/$/, '') || '/';

  if (path === '/menu/me') return 5 * 60 * 1000;
  if (path === '/departments') return 3 * 60 * 1000;
  if (path === '/users') return 2 * 60 * 1000;
  if (path === '/roles') return 10 * 60 * 1000;
  if (path === '/permissions') return null;
  if (path === '/permissions/user-overrides') return 2 * 60 * 1000;
  if (path === '/permissions/modules') return 10 * 60 * 1000;
  if (/^\/users\/[^/]+\/permissions$/.test(path)) return 2 * 60 * 1000;
  if (path === '/employees') return 90 * 1000;
  if (path === '/attendance' && endpoint.includes('date=today')) return 45 * 1000;
  if (path === '/notifications') return 45 * 1000;
  if (path === '/chat/unread-count') return 20 * 1000;
  if (path === '/chat/unread-by-sender') return 20 * 1000;
  if (path === '/chat/inbox') return 20 * 1000;
  if (path === '/chat/mute-settings') return 5 * 60 * 1000;
  if (path === '/leave-types') return 10 * 60 * 1000;
  if (path === '/leaves') return 30 * 1000;
  if (path === '/overtime') return 30 * 1000;
  if (path === '/positions') return 5 * 60 * 1000;
  if (path === '/office-locations') return 5 * 60 * 1000;
  if (path === '/dashboard/analytics' || path === '/dashboard/stats') return 90 * 1000;
  if (path === '/dashboard/team-stats') return 90 * 1000;
  if (path === '/reports/analytics') return 90 * 1000;
  if (path === '/payroll/runs') return 45 * 1000;
  if (path === '/payroll/schedules') return 60 * 1000;
  if (path === '/employees/summary-counts') return 45 * 1000;
  if (path === '/employees/offboarded-hub') return 60 * 1000;
  if (path === '/payroll/preview') return 45 * 1000;
  if (/^\/payroll\/attendance-periods\/\d{4}-\d{2}$/.test(path)) return 60 * 1000;
  if (path === '/approvals/summary') return 45 * 1000;
  if (path === '/actions/required') return 45 * 1000;
  if (/^\/payroll\/runs\/[^/]+\/items$/.test(path)) return 30 * 1000;
  if (path === '/attendance/worksite') return 60 * 1000;
  if (/^\/users\/[^/]+\/attendance$/.test(path)) return 30 * 1000;

  return null;
}

export function shouldCacheGet(endpoint: string, opts?: { noCache?: boolean }): boolean {
  if (opts?.noCache) return false;
  return getCacheTtlMs(endpoint) !== null;
}

export function readApiCache<T>(key: string): { data: T; stale: boolean } | null {
  const ttl = getCacheTtlMs(key);
  if (!ttl) return null;

  const maxAge = ttl * STALE_MULTIPLIER;
  const mem = memory.get(key) as CacheEntry<T> | undefined;
  if (mem) {
    const age = Date.now() - mem.fetchedAt;
    if (age < maxAge) return { data: mem.data, stale: age > mem.ttlMs };
  }

  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    const age = Date.now() - parsed.fetchedAt;
    if (age < maxAge) {
      memory.set(key, parsed as CacheEntry);
      return { data: parsed.data, stale: age > parsed.ttlMs };
    }
    sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    /* ignore */
  }
  return null;
}

/** Empty list/map responses must not be sticky — cold-start or auth races often return []. */
function isEmptyCachePayload(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') {
    const keys = Object.keys(data as object);
    if (keys.length === 0) return true;
    // Common list wrappers
    for (const k of ['items', 'rows', 'data', 'results', 'employees', 'users', 'runs']) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.length === 0 && keys.length <= 3) return true;
    }
  }
  return false;
}

export function writeApiCache(key: string, data: unknown): void {
  const ttl = getCacheTtlMs(key);
  if (!ttl) return;
  // Never persist empty payloads — they make successful saves look like they vanished.
  if (isEmptyCachePayload(data)) {
    invalidateApiCache(key.split('?')[0]);
    return;
  }
  const entry: CacheEntry = { data, fetchedAt: Date.now(), ttlMs: ttl };
  memory.set(key, entry);
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    pruneApiCacheStorage();
    try {
      sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      /* quota full — memory cache still helps this session */
    }
  }
}

function pruneApiCacheStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.sort();
    const drop = Math.ceil(keys.length / 2);
    for (let i = 0; i < drop; i++) sessionStorage.removeItem(keys[i]);
  } catch {
    /* ignore */
  }
}

/** Drop cached GET entries (call after mutations). */
export function invalidateApiCache(pathFragment?: string): void {
  const needle = pathFragment?.trim() || '';
  for (const k of [...memory.keys()]) {
    if (!needle || k.includes(needle)) memory.delete(k);
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX) && (!needle || k.includes(needle))) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

export function invalidateApiCacheForMutation(endpoint: string): void {
  const path = endpoint.split('?')[0];
  if (path.includes('/employees')) {
    invalidateApiCache('/employees');
    invalidateApiCache('/dashboard');
  }
  if (path.includes('/departments')) invalidateApiCache('/departments');
  if (path.includes('/users')) {
    invalidateApiCache('/users');
    invalidateApiCache('/permissions');
  }
  if (path.includes('/menu')) invalidateApiCache('/menu/me');
  if (path.includes('/permissions')) {
    invalidateApiCache('/permissions');
    invalidateApiCache('/permissions/menu');
    invalidateApiCache('/permissions/user-overrides');
    invalidateApiCache('/users/');
    invalidateApiCache('/menu/me');
  }
  if (path.includes('/overrides')) {
    invalidateApiCache('/permissions/user-overrides');
    invalidateApiCache('/permissions');
    invalidateApiCache('/users/');
  }
  if (path.includes('/attendance')) {
    invalidateApiCache('/attendance');
    invalidateApiCache('/users/');
    invalidateApiCache('/dashboard');
    invalidateApiCache('/payroll');
  }
  if (path.includes('/notifications')) invalidateApiCache('/notifications');
  if (path.includes('/chat')) {
    invalidateApiCache('/chat/unread');
    invalidateApiCache('/chat/inbox');
    invalidateApiCache('/chat/mute');
  }
  if (path.includes('/leave')) {
    invalidateApiCache('/leave');
    invalidateApiCache('/approvals');
    invalidateApiCache('/actions');
  }
  if (path.includes('/positions')) invalidateApiCache('/positions');
  if (path.includes('/payroll')) {
    invalidateApiCache('/payroll');
    invalidateApiCache('/dashboard');
    invalidateApiCache('/approvals');
    invalidateApiCache('/actions');
  }
  if (path.includes('/projects') || path.includes('/tasks')) {
    invalidateApiCache('/projects');
    invalidateApiCache('/tasks');
    invalidateApiCache('/dashboard');
  }
  if (path.includes('/appraisal') || path.includes('/reviews') || path.includes('/probation')) {
    invalidateApiCache('/appraisal');
    invalidateApiCache('/reviews');
    invalidateApiCache('/approvals');
    invalidateApiCache('/actions');
    invalidateApiCache('/dashboard');
  }
  if (path.includes('/employee-movements') || path.includes('/movements')) {
    invalidateApiCache('/employees');
    invalidateApiCache('/approvals');
    invalidateApiCache('/actions');
  }
  if (path.includes('/overtime')) {
    invalidateApiCache('/overtime');
    invalidateApiCache('/approvals');
    invalidateApiCache('/actions');
  }
  if (path.includes('/office-locations')) invalidateApiCache('/office-locations');
  if (path.includes('/roles')) invalidateApiCache('/roles');
}
