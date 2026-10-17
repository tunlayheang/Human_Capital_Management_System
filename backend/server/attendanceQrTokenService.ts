import crypto from 'node:crypto';

/** Entrance QR validity — matches previous DB-backed TTL (60 seconds). */
export const ATTENDANCE_QR_TOKEN_TTL_MS = 60_000;

/** Default office when none is selected (see attendanceSettings DEFAULT_OFFICE_LOCATIONS). */
export const DEFAULT_ATTENDANCE_QR_OFFICE_ID = 'off-main';

type SignedQrPayload = {
  o: string;
  e: number;
  s: string;
};

function qrSigningSecret(): string {
  return (
    process.env.ATTENDANCE_QR_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    'hcms-attendance-qr-dev'
  );
}

function signOfficeExpiry(officeId: string, expiresAtMs: number): string {
  const payload = `${officeId}:${expiresAtMs}`;
  return crypto.createHmac('sha256', qrSigningSecret()).update(payload).digest('hex').slice(0, 32);
}

/** Create a self-contained QR token (no database row). */
export function createAttendanceQrToken(officeId: string, ttlMs = ATTENDANCE_QR_TOKEN_TTL_MS): {
  token: string;
  officeId: string;
  expiresAt: Date;
  ttlSeconds: number;
} {
  const normalizedOfficeId = String(officeId || DEFAULT_ATTENDANCE_QR_OFFICE_ID).trim();
  const expiresAtMs = Date.now() + ttlMs;
  const payload: SignedQrPayload = {
    o: normalizedOfficeId,
    e: expiresAtMs,
    s: signOfficeExpiry(normalizedOfficeId, expiresAtMs),
  };
  const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    token,
    officeId: normalizedOfficeId,
    expiresAt: new Date(expiresAtMs),
    ttlSeconds: Math.max(1, Math.floor(ttlMs / 1000)),
  };
}

/** Validate a QR token and return its office + expiry, or null if invalid/expired. */
export function verifyAttendanceQrToken(token: string): {
  officeId: string;
  expiresAtMs: number;
} | null {
  const raw = String(token || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SignedQrPayload;
    const officeId = String(parsed.o || '').trim();
    const expiresAtMs = Number(parsed.e);
    const sig = String(parsed.s || '').trim();
    if (!officeId || !Number.isFinite(expiresAtMs) || !sig) return null;
    if (expiresAtMs <= Date.now()) return null;
    const expected = signOfficeExpiry(officeId, expiresAtMs);
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { officeId, expiresAtMs };
  } catch {
    return null;
  }
}

export async function dropLegacyAttendanceQrTokensTable(): Promise<void> {
  const { sequelize } = await import('./db.js');
  try {
    const [rows]: unknown = await sequelize.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'attendanceqrtokens'`,
      { raw: true }
    );
    const exists = Number((rows as { c?: number | string }[])[0]?.c ?? 0) > 0;
    if (!exists) return;
    await sequelize.query('DROP TABLE IF EXISTS `attendanceqrtokens`', { raw: true });
    console.log('[db] Dropped legacy attendanceqrtokens table (QR uses signed in-memory tokens).');
  } catch (e) {
    console.warn(
      '[db] Could not drop attendanceqrtokens:',
      (e as Error)?.message || e
    );
  }
}
