const DEVICE_KEY = 'hcms_device_id';
const DEVICE_LABEL_KEY = 'hcms_device_label';

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function buildDeviceLabelFromNavigator(): string {
  if (typeof navigator === 'undefined') return 'Web browser';

  const ua = navigator.userAgent;
  const os = /windows nt/i.test(ua)
    ? 'Windows'
    : /android/i.test(ua)
      ? 'Android'
      : /(iphone|ipad|ipod)/i.test(ua)
        ? 'iOS'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : null;

  const standalone = isStandaloneDisplay();
  const browser = standalone
    ? 'Home screen app'
    : /edg\//i.test(ua)
      ? 'Edge'
      : /opr\/|opera/i.test(ua)
        ? 'Opera'
        : /chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\/|opera/i.test(ua)
          ? 'Chrome'
          : /firefox\//i.test(ua)
            ? 'Firefox'
            : /safari\//i.test(ua) && !/chrome\//i.test(ua)
              ? 'Safari'
              : null;

  const deviceType = /mobile|iphone|ipod|android.+mobile/i.test(ua)
    ? 'Mobile'
    : /ipad|tablet|android(?!.*mobile)/i.test(ua)
      ? 'Tablet'
      : 'Desktop';

  if (browser && os) return `${browser} on ${os} (${deviceType})`;
  if (os) return `${os} (${deviceType})`;
  if (browser) return `${browser} (${deviceType})`;
  return `Web browser (${deviceType})`;
}

/** Decode JWT payload without verifying (client-side device rebinding only). */
export function readJwtDeviceId(token?: string | null): string {
  if (!token || typeof token !== 'string') return '';
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { deviceId?: string };
    return String(json?.deviceId ?? '').trim();
  } catch {
    return '';
  }
}

function readStoredUserDeviceId(): string {
  try {
    const raw = localStorage.getItem('hcms_user');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { deviceId?: string; token?: string };
    const fromField = String(parsed?.deviceId ?? '').trim();
    if (fromField) return fromField;
    return readJwtDeviceId(parsed?.token);
  } catch {
    return '';
  }
}

/**
 * Resolve the portal device id. Never invent a new UUID while a Bearer session
 * already encodes a deviceId — that mismatch causes false 401 / forced logout.
 */
export function getOrCreateDeviceId(): string {
  const fromKey = String(localStorage.getItem(DEVICE_KEY) || '').trim();
  if (fromKey) return fromKey;

  const fromSession = readStoredUserDeviceId();
  if (fromSession) {
    localStorage.setItem(DEVICE_KEY, fromSession);
    return fromSession;
  }

  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, id);
  return id;
}

/** Bind local device id to the active session before authenticated API calls. */
export function syncDeviceIdWithSession(opts?: {
  deviceId?: string | null;
  token?: string | null;
}): string {
  const preferred =
    String(opts?.deviceId ?? '').trim() ||
    readJwtDeviceId(opts?.token) ||
    readStoredUserDeviceId() ||
    String(localStorage.getItem(DEVICE_KEY) || '').trim();

  if (preferred) {
    localStorage.setItem(DEVICE_KEY, preferred);
    try {
      const raw = localStorage.getItem('hcms_user');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.deviceId !== preferred) {
          const next = { ...parsed, deviceId: preferred };
          localStorage.setItem('hcms_user', JSON.stringify(next));
          // Keep IndexedDB backup in sync for home-screen cold starts.
          void import('./portalSession').then((m) => m.writePortalSessionRaw(next));
        }
      }
    } catch {
      /* ignore */
    }
    return preferred;
  }

  return getOrCreateDeviceId();
}

/** Ask the OS to keep this origin's storage (helps home-screen installs). */
export function requestPersistentStorage(): void {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  void navigator.storage.persist().catch(() => undefined);
}

/** Human-readable label stored in audit logs and device sessions. */
export function getDeviceLabel(): string {
  const cached = localStorage.getItem(DEVICE_LABEL_KEY);
  const standalone = isStandaloneDisplay();
  if (cached?.trim()) {
    // Refresh label if this install became a home-screen app after first visit.
    if (!standalone || /home screen/i.test(cached)) return cached.trim();
  }
  const label = buildDeviceLabelFromNavigator();
  localStorage.setItem(DEVICE_LABEL_KEY, label);
  return label;
}

export function rememberDeviceLabel(label: string): void {
  if (label?.trim()) {
    localStorage.setItem(DEVICE_LABEL_KEY, label.trim());
  }
}

/** Sent on login / OTP so the API can record device + IP even if headers are stripped. */
export function getDeviceAuthPayload(): {
  deviceId: string;
  deviceLabel: string;
  userAgent: string;
} {
  return {
    deviceId: getOrCreateDeviceId(),
    deviceLabel: getDeviceLabel(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
}
