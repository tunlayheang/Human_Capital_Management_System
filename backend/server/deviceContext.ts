import type { Request } from 'express';

export type DeviceType = 'Mobile' | 'Tablet' | 'Desktop' | 'Unknown';

export type DeviceContext = {
  deviceId: string;
  deviceLabel: string;
  userAgent: string | null;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  deviceType: DeviceType;
};

export function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  const ip = req.ip || req.socket?.remoteAddress;
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '');
}

export function inferDeviceFromUserAgent(userAgent: string | null | undefined): Omit<
  DeviceContext,
  'deviceId' | 'ipAddress'
> {
  const ua = String(userAgent || '').trim();

  const os = !ua
    ? null
    : /windows nt/i.test(ua)
      ? 'Windows'
      : /android/i.test(ua)
        ? 'Android'
        : /(iphone|ipad|ipod|ios)/i.test(ua)
          ? 'iOS'
          : /mac os x|macintosh/i.test(ua)
            ? 'macOS'
            : /linux/i.test(ua)
              ? 'Linux'
              : null;

  const browser = !ua
    ? null
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

  const deviceType: DeviceType = !ua
    ? 'Unknown'
    : /mobile|iphone|ipod|android.+mobile/i.test(ua)
      ? 'Mobile'
      : /ipad|tablet|android(?!.*mobile)/i.test(ua)
        ? 'Tablet'
        : 'Desktop';

  let deviceLabel: string;
  if (browser && os) deviceLabel = `${browser} on ${os} (${deviceType})`;
  else if (os) deviceLabel = `${os} (${deviceType})`;
  else if (browser) deviceLabel = `${browser} (${deviceType})`;
  else if (ua) deviceLabel = `Web client (${deviceType})`;
  else deviceLabel = `Unknown device (${deviceType})`;

  return { deviceLabel, userAgent: ua || null, browser, os, deviceType };
}

export function buildAuthDeviceContext(
  req: Request,
  body: { deviceId?: string; deviceLabel?: string; userAgent?: string } = {}
): DeviceContext {
  const ua =
    String(body.userAgent || req.get('user-agent') || '').trim() || null;
  const inferred = inferDeviceFromUserAgent(ua);
  const clientLabel = String(body.deviceLabel || '').trim();
  return {
    deviceId: String(body.deviceId || '').trim(),
    deviceLabel: clientLabel || inferred.deviceLabel,
    userAgent: ua,
    ipAddress: getClientIp(req),
    browser: inferred.browser,
    os: inferred.os,
    deviceType: inferred.deviceType,
  };
}

export function deviceContextToAuditMetadata(
  ctx: DeviceContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    deviceId: ctx.deviceId || null,
    deviceLabel: ctx.deviceLabel,
    deviceName: ctx.deviceLabel,
    userAgent: ctx.userAgent,
    ipAddress: ctx.ipAddress,
    browser: ctx.browser,
    os: ctx.os,
    deviceType: ctx.deviceType,
    ...extra,
  };
}

export function parseAuditMetadata(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function resolveDeviceLabelFromMetadata(
  meta: Record<string, unknown>,
  sessionLabel?: string | null
): string {
  const fromMeta = String(
    meta.deviceLabel || meta.deviceName || meta.device || ''
  ).trim();
  if (fromMeta) return fromMeta;
  if (sessionLabel?.trim()) return sessionLabel.trim();

  const inferred = inferDeviceFromUserAgent(
    String(meta.userAgent || '') || null
  );
  if (inferred.userAgent) return inferred.deviceLabel;

  const fromId = String(meta.deviceId || '').trim();
  if (fromId) return `Device ${fromId.slice(0, 8)}…`;

  return 'Unknown device';
}
