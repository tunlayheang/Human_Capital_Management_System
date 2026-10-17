/** Build hash-router URL for entrance QR (opens quick clock screen). */
export function buildAttendanceScanUrl(token: string, origin = window.location.origin): string {
  const base = origin.replace(/\/$/, '');
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const prefix = basePath && basePath !== '/' ? `${base}${basePath}` : base;
  return `${prefix}/#/attendance/scan?t=${encodeURIComponent(token)}`;
}

/** Extract attendance QR token from URL, JSON payload, or raw hex token. */
export function parseAttendanceQrToken(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  try {
    const parsed = JSON.parse(s) as { token?: string };
    if (parsed?.token) return String(parsed.token);
  } catch {
    /* not JSON */
  }

  const tryParams = (params: URLSearchParams): string | null =>
    params.get('t') || params.get('token');

  try {
    if (s.includes('://') || s.startsWith('/')) {
      const url = s.includes('://') ? new URL(s) : new URL(s, window.location.origin);
      const fromQuery = tryParams(url.searchParams);
      if (fromQuery) return fromQuery;
      const hash = url.hash || '';
      const qIndex = hash.indexOf('?');
      if (qIndex >= 0) {
        const fromHash = tryParams(new URLSearchParams(hash.slice(qIndex + 1)));
        if (fromHash) return fromHash;
      }
    }
  } catch {
    /* invalid URL */
  }

  if (/^[a-f0-9]{32}$/i.test(s)) return s;
  if (s.length >= 16 && /^[a-zA-Z0-9._-]+$/.test(s)) return s;
  return null;
}
