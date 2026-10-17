/** Client-side portal session helpers.
 *
 * Dual-writes to localStorage + IndexedDB so iOS home-screen (standalone) installs
 * keep the JWT across process kills. Safari and the home-screen icon use separate
 * storage jars — sign-in must happen inside the jar you open.
 *
 * Idle expiry follows Settings → Security session timeout (minutes) via sessionExpiresAt
 * returned by the API; JWT may outlive idle and is re-checked on each request.
 */

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;

const LS_KEY = 'hcms_user';
const IDB_NAME = 'hcms_portal_v1';
const IDB_STORE = 'session';
const IDB_KEY = 'hcms_user';

export type StoredPortalSession = {
  token?: string;
  deviceId?: string;
  sessionExpiresAt?: string;
  sessionTimeoutMinutes?: number;
  [key: string]: unknown;
};

function openSessionDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 2_500);
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        finish(req.result);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        finish(null);
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function idbGetRaw(): Promise<string | null> {
  const db = await openSessionDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => {
        const val = req.result;
        resolve(typeof val === 'string' ? val : val != null ? JSON.stringify(val) : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    }
  });
}

async function idbSetRaw(raw: string): Promise<void> {
  const db = await openSessionDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(raw, IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

async function idbClear(): Promise<void> {
  const db = await openSessionDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

function parseSessionRaw(raw: string | null): StoredPortalSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPortalSession;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function readStoredPortalSession(): StoredPortalSession | null {
  try {
    return parseSessionRaw(localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

/** Restore session from IndexedDB into localStorage when LS is empty (standalone cold start). */
export async function hydratePortalSessionFromDurableStore(): Promise<StoredPortalSession | null> {
  const fromLs = readStoredPortalSession();
  if (fromLs?.token) {
    // Keep IDB in sync with the live LS copy.
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) void idbSetRaw(raw);
    } catch {
      /* ignore */
    }
    return fromLs;
  }

  const fromIdb = parseSessionRaw(await idbGetRaw());
  if (!fromIdb?.token) return null;

  try {
    const raw = JSON.stringify(fromIdb);
    localStorage.setItem(LS_KEY, raw);
  } catch {
    /* LS full / blocked — still return IDB session for in-memory use */
  }
  return fromIdb;
}

export function isStoredSessionLocallyExpired(sessionExpiresAt?: string | null): boolean {
  if (!sessionExpiresAt) return false;
  const exp = Date.parse(sessionExpiresAt);
  if (Number.isNaN(exp)) return false;
  return Date.now() > exp;
}

/** Extend local expiry after server confirms activity (GET /auth/session). */
export function resolveSessionTimeoutMinutes(raw?: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  return Math.min(24 * 60, Math.max(1, Math.floor(n)));
}

/** Write full user session JSON (used by AuthContext). */
export function writePortalSessionRaw(rawOrObject: string | Record<string, unknown>): void {
  try {
    const raw = typeof rawOrObject === 'string' ? rawOrObject : JSON.stringify(rawOrObject);
    localStorage.setItem(LS_KEY, raw);
    void idbSetRaw(raw);
  } catch {
    /* ignore */
  }
}

export function persistPortalSession(patch: StoredPortalSession): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = { ...prev, ...patch };
    const encoded = JSON.stringify(next);
    localStorage.setItem(LS_KEY, encoded);
    void idbSetRaw(encoded);
  } catch {
    /* ignore */
  }
}

export function clearPortalSessionStorage(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  void idbClear();
}
