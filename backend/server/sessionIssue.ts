import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { User, UserDeviceSession } from './db.js';
import { enforcePinPolicyForUser } from './pinSecurity.js';
import { serializeUserForClient, stripUserSecrets } from './userAccountService.js';
import {
  SESSION_JWT_MAX_DAYS,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  activityTouchIntervalMs,
  getSessionTimeoutMinutes,
  getSessionTimeoutMs,
} from './securitySessionPolicy.js';

function isPortalAccountAllowedSession(user: {
  status?: string | null;
  isActive?: boolean | null;
} | null): boolean {
  if (!user || user.isActive === false) return false;
  const status = String(user.status ?? 'ACTIVE')
    .trim()
    .toUpperCase();
  return status !== 'INACTIVE' && status !== 'FROZEN' && status !== 'DISABLED';
}

export const MAX_CONCURRENT_DEVICES = 2;
/** @deprecated Idle timeout is now minutes from Settings → Security; kept for JWT ceiling. */
export const INACTIVITY_DAYS = SESSION_JWT_MAX_DAYS;
/** Fallback when policy cannot be loaded yet. */
export const INACTIVITY_MS = DEFAULT_SESSION_TIMEOUT_MINUTES * 60 * 1000;
/** Throttle DB writes while the user is actively using the app (upper bound). */
export const ACTIVITY_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
export const SESSION_JWT_EXPIRES_IN = `${SESSION_JWT_MAX_DAYS}d` as const;

export function sessionExpiresAtFrom(
  lastActivity: Date | string | null | undefined,
  now = new Date(),
  timeoutMs = INACTIVITY_MS
): string {
  const base = lastActivity ? new Date(lastActivity) : now;
  return new Date(base.getTime() + timeoutMs).toISOString();
}

export function isSessionIdleExpired(
  lastActivity: Date | string | null | undefined,
  now = new Date(),
  timeoutMs = INACTIVITY_MS
): boolean {
  if (!lastActivity) return false;
  return now.getTime() - new Date(lastActivity).getTime() > timeoutMs;
}

export async function sessionExpiresAtFromPolicy(
  lastActivity: Date | string | null | undefined,
  now = new Date()
): Promise<string> {
  const timeoutMs = await getSessionTimeoutMs();
  return sessionExpiresAtFrom(lastActivity, now, timeoutMs);
}

export async function revokeDeviceSession(
  userId: string,
  sessionToken: string,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null
): Promise<void> {
  await UserDeviceSession.destroy({ where: { userId, sessionToken } });
  if (user && user.sessionToken === sessionToken) {
    user.sessionToken = null;
    if (typeof user.save === 'function') await user.save();
  }
}

/** End the portal session bound to a specific device id (profile menu / security). */
export async function revokeDeviceSessionByDeviceId(
  userId: string,
  deviceId: string,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null
): Promise<boolean> {
  const devId = String(deviceId || '').trim();
  if (!devId) return false;
  const row: any = await UserDeviceSession.findOne({ where: { userId, deviceId: devId } });
  if (!row) return false;
  await revokeDeviceSession(userId, row.sessionToken, user);
  return true;
}

/** Revoke all portal device sessions for a user (e.g. password reset from login). */
export async function revokeAllDeviceSessions(
  userId: string,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null,
  transaction?: import('sequelize').Transaction
): Promise<void> {
  await UserDeviceSession.destroy({ where: { userId }, transaction });
  if (user) {
    user.sessionToken = null;
    if (typeof user.save === 'function') await user.save({ transaction } as any);
  }
}

/**
 * Revoke every device session except the one the user is changing password on,
 * so they stay signed in on this page. Other devices must sign in again.
 */
export async function revokeOtherDeviceSessions(
  userId: string,
  keepSessionToken: string,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null
): Promise<number> {
  const keep = String(keepSessionToken || '').trim();
  if (!keep) {
    await revokeAllDeviceSessions(userId, user);
    return 0;
  }

  const removed = await UserDeviceSession.destroy({
    where: {
      userId,
      sessionToken: { [Op.ne]: keep },
    },
  });

  if (user) {
    user.sessionToken = keep;
    if (typeof user.save === 'function') await user.save();
  }
  return Number(removed) || 0;
}

/**
 * Enforce max devices: when a new device signs in, remove the least-recently-used
 * sessions until at most (MAX_CONCURRENT_DEVICES - 1) remain before adding the new one.
 * Prefer evicting ordinary browser sessions before home-screen / installed app sessions.
 */
export async function evictOldestDeviceSessions(
  userId: string,
  sessions: Array<{
    id: string;
    sessionToken: string;
    deviceId?: string | null;
    lastActivity?: Date | string | null;
    deviceLabel?: string | null;
  }>,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null,
  /** When pruning without adding a device, set roomForNewDevice=false. */
  roomForNewDevice = true
): Promise<number> {
  const allowedBeforeAdd = roomForNewDevice
    ? MAX_CONCURRENT_DEVICES - 1
    : MAX_CONCURRENT_DEVICES;
  const excess = sessions.length - allowedBeforeAdd;
  if (excess <= 0) return 0;

  const isHomeScreen = (label?: string | null) =>
    /home screen|standalone|installed app/i.test(String(label || ''));

  const sorted = [...sessions].sort((a, b) => {
    const aHome = isHomeScreen(a.deviceLabel) ? 1 : 0;
    const bHome = isHomeScreen(b.deviceLabel) ? 1 : 0;
    if (aHome !== bHome) return aHome - bHome; // browsers first
    return new Date(a.lastActivity ?? 0).getTime() - new Date(b.lastActivity ?? 0).getTime();
  });
  const toEvict = sorted.slice(0, excess);
  let clearedUserToken = false;
  for (const row of toEvict) {
    await UserDeviceSession.destroy({ where: { id: row.id } });
    if (user && user.sessionToken === row.sessionToken) {
      user.sessionToken = null;
      clearedUserToken = true;
    }
  }
  if (user && clearedUserToken && typeof user.save === 'function') {
    await user.save();
  }
  return toEvict.length;
}

/**
 * Drop oldest sessions when the account is already over the concurrent-device cap
 * (e.g. after lowering MAX_CONCURRENT_DEVICES). Always keeps `keepDeviceId` if present.
 */
export async function pruneExcessDeviceSessions(
  userId: string,
  keepDeviceId?: string | null,
  user?: { sessionToken?: string | null; save?: () => Promise<unknown> } | null
): Promise<number> {
  const sessions: any[] = await UserDeviceSession.findAll({
    where: { userId },
    order: [['lastActivity', 'ASC']],
  });
  const excess = sessions.length - MAX_CONCURRENT_DEVICES;
  if (excess <= 0) return 0;

  const keepId = String(keepDeviceId || '').trim();
  const isHomeScreen = (label?: string | null) =>
    /home screen|standalone|installed app/i.test(String(label || ''));

  const sorted = [...sessions].sort((a, b) => {
    const aKeep = keepId && String(a.deviceId || '') === keepId ? 1 : 0;
    const bKeep = keepId && String(b.deviceId || '') === keepId ? 1 : 0;
    if (aKeep !== bKeep) return aKeep - bKeep; // evict non-current first
    const aHome = isHomeScreen(a.deviceLabel) ? 1 : 0;
    const bHome = isHomeScreen(b.deviceLabel) ? 1 : 0;
    if (aHome !== bHome) return aHome - bHome;
    return new Date(a.lastActivity ?? 0).getTime() - new Date(b.lastActivity ?? 0).getTime();
  });

  const toEvict = sorted.slice(0, excess).filter((row) => {
    if (!keepId) return true;
    return String(row.deviceId || '') !== keepId;
  });
  // If filtering the keep device left us short, take next candidates.
  if (toEvict.length < excess) {
    for (const row of sorted) {
      if (toEvict.length >= excess) break;
      if (toEvict.some((r) => String(r.id) === String(row.id))) continue;
      if (keepId && String(row.deviceId || '') === keepId) continue;
      toEvict.push(row);
    }
  }

  let clearedUserToken = false;
  for (const row of toEvict) {
    await UserDeviceSession.destroy({ where: { id: row.id } });
    if (user && user.sessionToken === row.sessionToken) {
      user.sessionToken = null;
      clearedUserToken = true;
    }
  }
  if (user && clearedUserToken && typeof user.save === 'function') {
    await user.save();
  }
  return toEvict.length;
}

export async function touchSessionActivity(
  user: { lastActivity?: Date | string | null; save?: () => Promise<unknown> },
  deviceSession: { lastActivity?: Date | string | null; save?: () => Promise<unknown> } | null,
  now = new Date()
): Promise<void> {
  const timeoutMs = await getSessionTimeoutMs();
  const touchInterval = activityTouchIntervalMs(timeoutMs);
  const touchUser =
    !user.lastActivity ||
    now.getTime() - new Date(user.lastActivity).getTime() > touchInterval;
  if (touchUser && typeof user.save === 'function') {
    user.lastActivity = now;
    await user.save();
  }
  if (deviceSession) {
    const touchDev =
      !deviceSession.lastActivity ||
      now.getTime() - new Date(deviceSession.lastActivity).getTime() > touchInterval;
    if (touchDev && typeof deviceSession.save === 'function') {
      deviceSession.lastActivity = now;
      await deviceSession.save();
    }
  }
}

export type ResolvedPortalSession = {
  user: any;
  deviceSession: any | null;
  deviceId: string;
  sessionToken: string;
};

/** Validate Bearer JWT against DB session; returns null if expired or revoked. */
export async function resolvePortalSession(
  decoded: { id?: string; sessionToken?: string; deviceId?: string },
  reqDeviceIdHeader?: string | null
): Promise<ResolvedPortalSession | null> {
  if (!decoded?.id || !decoded?.sessionToken) return null;

  const user: any = await User.findByPk(decoded.id);
  if (!user) return null;

  if (!isPortalAccountAllowedSession(user.get ? user.get({ plain: true }) : user)) {
    // Freeze / deactivate must kill open sessions immediately.
    await revokeAllDeviceSessions(user.id, user);
    return null;
  }

  const deviceSession: any = await UserDeviceSession.findOne({
    where: { userId: user.id, sessionToken: decoded.sessionToken },
  });
  const legacyMatch = !deviceSession && user.sessionToken === decoded.sessionToken;
  if (!deviceSession && !legacyMatch) return null;

  const jwtDeviceId = String(decoded.deviceId ?? deviceSession?.deviceId ?? '').trim();
  // Session token is authoritative. Do not kill a valid JWT when the client
  // regenerated localStorage device id (common after home-screen / storage quirks).
  // Prefer JWT/DB deviceId; optionally refresh the stored label from this UA later.
  if (jwtDeviceId && reqDeviceIdHeader) {
    const headerId = String(reqDeviceIdHeader).trim();
    if (headerId && headerId !== jwtDeviceId) {
      console.warn(
        `[session] device-id header mismatch for user ${decoded.id}: jwt=${jwtDeviceId} header=${headerId}`
      );
    }
  }

  const now = new Date();
  const timeoutMs = await getSessionTimeoutMs();
  const activityAnchor = deviceSession?.lastActivity ?? user.lastActivity;
  if (isSessionIdleExpired(activityAnchor, now, timeoutMs)) {
    await revokeDeviceSession(user.id, decoded.sessionToken, user);
    return null;
  }

  await touchSessionActivity(user, deviceSession, now);

  return {
    user,
    deviceSession,
    deviceId: jwtDeviceId || String(deviceSession?.deviceId ?? ''),
    sessionToken: decoded.sessionToken,
  };
}

/** Why a Bearer token was rejected (for clearer 401 messages). */
export async function explainSessionRejection(
  decoded: { id?: string; sessionToken?: string; deviceId?: string }
): Promise<'DEVICE_LIMIT' | 'SESSION_EXPIRED' | 'ACCOUNT_DISABLED' | null> {
  if (!decoded?.id || !decoded?.sessionToken) return null;
  const user: any = await User.findByPk(decoded.id);
  if (!user) return null;

  if (!isPortalAccountAllowedSession(user.get ? user.get({ plain: true }) : user)) {
    return 'ACCOUNT_DISABLED';
  }

  const stillValid = await UserDeviceSession.findOne({
    where: { userId: user.id, sessionToken: decoded.sessionToken },
  });
  const timeoutMs = await getSessionTimeoutMs();
  if (stillValid) {
    if (isSessionIdleExpired(stillValid.lastActivity, new Date(), timeoutMs)) return 'SESSION_EXPIRED';
    return null;
  }

  const legacyMatch = user.sessionToken === decoded.sessionToken;
  if (legacyMatch) {
    if (isSessionIdleExpired(user.lastActivity, new Date(), timeoutMs)) return 'SESSION_EXPIRED';
    return null;
  }

  const devId = String(decoded.deviceId ?? '').trim();
  if (devId) {
    const onDevice = await UserDeviceSession.findOne({
      where: { userId: user.id, deviceId: devId },
    });
    if (onDevice) return 'DEVICE_LIMIT';
  }

  const activeCount = await UserDeviceSession.count({ where: { userId: user.id } });
  if (activeCount > 0 && activeCount <= MAX_CONCURRENT_DEVICES) return 'DEVICE_LIMIT';

  if (isSessionIdleExpired(user.lastActivity, new Date(), timeoutMs)) return 'SESSION_EXPIRED';
  return 'SESSION_EXPIRED';
}

export async function issueUserSession(
  user: any,
  jwtSecret: string,
  deviceId?: string,
  deviceLabel?: string
) {
  const devId = deviceId || crypto.randomUUID();
  const sessionToken = crypto.randomUUID();
  const now = new Date();

  const sessions: any[] = await UserDeviceSession.findAll({
    where: { userId: user.id },
    order: [['lastActivity', 'ASC']],
  });

  let devicesEvicted = 0;
  const label = deviceLabel?.trim() || 'Web browser';
  const existing = sessions.find((s) => s.deviceId === devId);
  if (existing) {
    await existing.update({
      sessionToken,
      lastActivity: now,
      deviceLabel: label || existing.deviceLabel,
    });
    // Existing device refresh can still leave the account over the cap.
    devicesEvicted = await pruneExcessDeviceSessions(user.id, devId, user);
  } else {
    devicesEvicted = await evictOldestDeviceSessions(user.id, sessions, user, true);
    await UserDeviceSession.create({
      id: `uds-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      userId: user.id,
      deviceId: devId,
      deviceLabel: label,
      sessionToken,
      lastActivity: now,
    });
  }

  const activeSession: any =
    existing ||
    (await UserDeviceSession.findOne({ where: { userId: user.id, deviceId: devId } }));
  const storedDeviceLabel = String(activeSession?.deviceLabel || label);

  user.sessionToken = sessionToken;
  user.lastActivity = now;
  await enforcePinPolicyForUser(user);
  await user.save();

  const token = jwt.sign(
    { id: user.id, role: user.role, sessionToken, deviceId: devId },
    jwtSecret,
    { expiresIn: SESSION_JWT_EXPIRES_IN }
  );

  const profile = await serializeUserForClient(stripUserSecrets(user.get ? user.get({ plain: true }) : user));
  const sessionTimeoutMinutes = await getSessionTimeoutMinutes();
  const timeoutMs = sessionTimeoutMinutes * 60 * 1000;

  return {
    user: profile,
    token,
    deviceId: devId,
    deviceLabel: storedDeviceLabel,
    sessionExpiresAt: sessionExpiresAtFrom(now, now, timeoutMs),
    sessionTimeoutMinutes,
    inactivityDays: INACTIVITY_DAYS,
    maxDevices: MAX_CONCURRENT_DEVICES,
    devicesEvicted,
  };
}

/** Short-lived token so a browser login can be opened once on the home-screen app. */
export function createSessionHandoffToken(
  jwtSecret: string,
  payload: { id: string; sessionToken: string; deviceId: string }
): string {
  return jwt.sign(
    {
      purpose: 'session_handoff',
      id: payload.id,
      sessionToken: payload.sessionToken,
      deviceId: payload.deviceId,
    },
    jwtSecret,
    { expiresIn: '15m' }
  );
}

export async function redeemSessionHandoffToken(
  handoffToken: string,
  jwtSecret: string,
  deviceLabel?: string
): Promise<{
  user: Awaited<ReturnType<typeof serializeUserForClient>>;
  token: string;
  deviceId: string;
  deviceLabel: string;
  sessionExpiresAt: string;
  sessionTimeoutMinutes: number;
  inactivityDays: number;
  maxDevices: number;
  devicesEvicted: number;
} | null> {
  let decoded: {
    purpose?: string;
    id?: string;
    sessionToken?: string;
    deviceId?: string;
  };
  try {
    decoded = jwt.verify(handoffToken, jwtSecret) as typeof decoded;
  } catch {
    return null;
  }
  if (decoded.purpose !== 'session_handoff' || !decoded.id || !decoded.sessionToken) {
    return null;
  }

  const user: any = await User.findByPk(decoded.id);
  if (!user) return null;

  const deviceSession: any = await UserDeviceSession.findOne({
    where: { userId: user.id, sessionToken: decoded.sessionToken },
  });
  const legacyMatch = !deviceSession && user.sessionToken === decoded.sessionToken;
  if (!deviceSession && !legacyMatch) return null;

  const now = new Date();
  const timeoutMs = await getSessionTimeoutMs();
  const activityAnchor = deviceSession?.lastActivity ?? user.lastActivity;
  if (isSessionIdleExpired(activityAnchor, now, timeoutMs)) {
    await revokeDeviceSession(user.id, decoded.sessionToken, user);
    return null;
  }

  const devId =
    String(decoded.deviceId || deviceSession?.deviceId || '').trim() || crypto.randomUUID();
  const label = deviceLabel?.trim() || 'Home screen app';

  if (deviceSession) {
    await deviceSession.update({
      lastActivity: now,
      deviceLabel: /home screen/i.test(label) ? label : deviceSession.deviceLabel || label,
    });
  }

  user.lastActivity = now;
  await enforcePinPolicyForUser(user);
  await user.save();

  const token = jwt.sign(
    { id: user.id, role: user.role, sessionToken: decoded.sessionToken, deviceId: devId },
    jwtSecret,
    { expiresIn: SESSION_JWT_EXPIRES_IN }
  );

  const profile = await serializeUserForClient(
    stripUserSecrets(user.get ? user.get({ plain: true }) : user)
  );
  const sessionTimeoutMinutes = Math.round(timeoutMs / 60_000);

  return {
    user: profile,
    token,
    deviceId: devId,
    deviceLabel: label,
    sessionExpiresAt: sessionExpiresAtFrom(now, now, timeoutMs),
    sessionTimeoutMinutes,
    inactivityDays: INACTIVITY_DAYS,
    maxDevices: MAX_CONCURRENT_DEVICES,
    devicesEvicted: 0,
  };
}
