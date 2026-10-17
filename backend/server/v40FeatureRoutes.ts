import type { RequestHandler, Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import {
  User,
  UserDeviceSession,
  AttendanceRecord,
  EmployeeReview,
  Payslip,
  AuditLog,
  Employee,
} from './db.js';
import {
  ATTENDANCE_QR_TOKEN_TTL_MS,
  createAttendanceQrToken,
  verifyAttendanceQrToken,
} from './attendanceQrTokenService.js';
import { parseAuditMetadata, resolveDeviceLabelFromMetadata } from './deviceContext.js';
import {
  createSessionHandoffToken,
  explainSessionRejection,
  INACTIVITY_DAYS,
  INACTIVITY_MS,
  MAX_CONCURRENT_DEVICES,
  pruneExcessDeviceSessions,
  redeemSessionHandoffToken,
  revokeDeviceSessionByDeviceId,
  sessionExpiresAtFrom,
  sessionExpiresAtFromPolicy,
} from './sessionIssue.js';
import { getSessionTimeoutMinutes, getSessionTimeoutMs } from './securitySessionPolicy.js';
import {
  isPinRequiredRole,
  PIN_MAX_FAILED_ATTEMPTS,
  resolveMaskedRecoveryEmail,
  resolvePinSecurity,
} from './pinSecurity.js';
import {
  canBypassAdminPinEmailRecovery,
  clearPinRecoveryState,
  isAdminPinSelfRecoveryRole,
  isPinRecoveryVerified,
  markAdminPinRecoveryReadyWithoutEmail,
  sendPinRecoveryOtp,
  triggerPinLockout,
  verifyPinRecoveryOtp,
} from './pinRecoveryService.js';
import {
  enrichUsersWithEmployee,
  serializeUserForClient,
  stripUserSecrets,
  USER_ACCOUNT_ATTRIBUTES,
} from './userAccountService.js';
import { pinBruteForceLimiter } from './authRateLimits.js';
import { isEmailConfigured, getGmailSetupMessage } from './services/OtpDeliveryService.js';

const isValidPin = (pin: unknown) => /^\d{4}$/.test(String(pin || ''));
const hashSecurityPin = async (pin: string) => bcrypt.hash(pin, 10);
const verifySecurityPin = async (pin: string, hash: string | null) => {
  if (!hash) return false;
  return bcrypt.compare(pin, hash);
};

const isInOfficeZone = (
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  sideMeters: number
) => {
  const half = sideMeters / 2;
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return (
    lat >= centerLat - dLat &&
    lat <= centerLat + dLat &&
    lng >= centerLng - dLng &&
    lng <= centerLng + dLng
  );
};

const QR_TOKEN_TTL_MS = ATTENDANCE_QR_TOKEN_TTL_MS;

function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

async function staffProfilesForReviews() {
  const users: any[] = await User.findAll({
    where: { role: { [Op.in]: ['EMPLOYEE', 'MANAGER', 'HR'] } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  const safe = users.map((u) => stripUserSecrets(u.get({ plain: true })));
  const enriched = await enrichUsersWithEmployee(safe);
  return Promise.all(enriched.map((row) => serializeUserForClient(row, null)));
}

export type V40RouteDeps = {
  jwtSecret: string;
  adminOnly: RequestHandler;
  hrAccess: RequestHandler;
  adminOrHr: RequestHandler;
  hrManagerAccess: RequestHandler;
  requireEffectivePermission?: (...keys: string[]) => RequestHandler;
  clearCachePrefix?: (prefix: string) => void;
};

/** PIN, logout, security — uses authMiddleware user, not requireAuth. */
export function mountV40AuthRoutes(router: Router, deps: V40RouteDeps) {
  const { jwtSecret } = deps;

  router.post('/auth/logout', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded: any = jwt.verify(authHeader.substring(7), jwtSecret);
        await UserDeviceSession.destroy({
          where: { userId: decoded.id, sessionToken: decoded.sessionToken },
        });
        const user: any = await User.findByPk(decoded.id);
        if (user?.sessionToken === decoded.sessionToken) {
          user.sessionToken = null;
          await user.save();
        }
      } catch {
        /* ignore */
      }
    }
    res.json({ message: 'Logged out' });
  });

  router.get('/auth/security', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    const security = resolvePinSecurity(currentUser);
    let maskedEmail: string | undefined;
    if (security.pinRequiresOtpRecovery) {
      maskedEmail = await resolveMaskedRecoveryEmail(currentUser);
    }
    res.json({
      ...security,
      ...(maskedEmail ? { maskedEmail } : {}),
      maxDevices: MAX_CONCURRENT_DEVICES,
      inactivityDays: INACTIVITY_DAYS,
      sessionTimeoutMinutes: await getSessionTimeoutMinutes(),
    });
  });

  router.get('/auth/devices', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const currentDeviceId = String((req as any).sessionDeviceId || '').trim();
      await pruneExcessDeviceSessions(currentUser.id, currentDeviceId, currentUser);
      const sessions: any[] = await UserDeviceSession.findAll({
        where: { userId: currentUser.id },
        order: [['lastActivity', 'DESC']],
      });
      const auditRows: any[] = await AuditLog.findAll({
        where: { entityType: 'auth_login', entityId: currentUser.id },
        order: [['createdAt', 'DESC']],
        limit: 120,
      });
      const logsByDevice = new Map<string, Array<Record<string, unknown>>>();
      for (const row of auditRows) {
        const plain = row.get ? row.get({ plain: true }) : row;
        const meta = parseAuditMetadata(plain.metadata);
        const deviceId = String(meta.deviceId || '').trim();
        if (!deviceId) continue;
        const list = logsByDevice.get(deviceId) || [];
        if (list.length >= 8) continue;
        list.push({
          id: plain.id,
          action: plain.action,
          reason: plain.reason || null,
          createdAt: plain.createdAt,
          ipAddress: meta.ipAddress || null,
          deviceLabel: resolveDeviceLabelFromMetadata(meta, String(meta.deviceLabel || '')),
          browser: meta.browser || null,
          os: meta.os || null,
          deviceType: meta.deviceType || null,
        });
        logsByDevice.set(deviceId, list);
      }
      const timeoutMs = await getSessionTimeoutMs();
      const devices = sessions.map((s) => {
        const plain = s.get ? s.get({ plain: true }) : s;
        const deviceId = String(plain.deviceId || '');
        return {
          deviceId,
          deviceLabel: String(plain.deviceLabel || 'Web browser'),
          lastActivity: plain.lastActivity,
          signedInAt: plain.createdAt,
          sessionExpiresAt: sessionExpiresAtFrom(plain.lastActivity, new Date(), timeoutMs),
          isCurrent: Boolean(currentDeviceId && deviceId === currentDeviceId),
          recentLogs: logsByDevice.get(deviceId) || [],
        };
      });
      res.json({
        maxDevices: MAX_CONCURRENT_DEVICES,
        currentDeviceId: currentDeviceId || null,
        devices,
        sessionTimeoutMinutes: Math.round(timeoutMs / 60_000),
      });
    } catch (error) {
      console.error('Error listing auth devices:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/auth/my-audit-log', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });

    const { action, startDate, endDate, limit = '200' } = req.query as Record<string, string>;
    const userId = String(currentUser.id);

    try {
      const where: Record<string, unknown> = {
        [Op.or]: [
          { entityType: 'auth_login', entityId: userId },
          { performedBy: userId },
        ],
      };
      if (action) where.action = action;
      if (startDate || endDate) {
        const createdAt: Record<symbol, Date> = {};
        if (startDate) createdAt[Op.gte] = new Date(startDate);
        if (endDate) createdAt[Op.lte] = new Date(endDate);
        where.createdAt = createdAt;
      }

      const rows = await AuditLog.findAll({
        where: where as any,
        order: [['createdAt', 'DESC']],
        limit: Math.min(Math.max(Number(limit) || 200, 1), 500),
      });

      const sessionByKey = new Map<string, string>();
      const pairs = rows
        .map((row: any) => {
          const plain = row.get({ plain: true });
          const meta = parseAuditMetadata(plain.metadata);
          const entityId = String(plain.entityId || plain.performedBy || '');
          const deviceId = String(meta.deviceId || '');
          return entityId && deviceId ? { userId: entityId, deviceId } : null;
        })
        .filter(Boolean) as Array<{ userId: string; deviceId: string }>;

      if (pairs.length > 0) {
        const sessions = (await UserDeviceSession.findAll({
          where: { [Op.or]: pairs.map((p) => ({ userId: p.userId, deviceId: p.deviceId })) },
          attributes: ['userId', 'deviceId', 'deviceLabel'],
        })) as any[];
        for (const s of sessions) {
          const plain = s.get ? s.get({ plain: true }) : s;
          sessionByKey.set(`${plain.userId}:${plain.deviceId}`, String(plain.deviceLabel || ''));
        }
      }

      const payload = rows.map((row: any) => {
        const plain = row.get({ plain: true });
        const meta = parseAuditMetadata(plain.metadata);
        const entityId = String(plain.entityId || plain.performedBy || '');
        const deviceId = String(meta.deviceId || '');
        const sessionLabel = deviceId ? sessionByKey.get(`${entityId}:${deviceId}`) : undefined;
        const deviceLabel = resolveDeviceLabelFromMetadata(meta, sessionLabel);
        return {
          id: plain.id,
          action: plain.action,
          entityType: plain.entityType,
          entityId: plain.entityId,
          reason: plain.reason || null,
          metadata: { ...meta, deviceLabel },
          createdAt: plain.createdAt,
          ipAddress: meta.ipAddress || null,
          deviceLabel,
        };
      });

      res.json(payload);
    } catch (error) {
      console.error('Error fetching personal audit log:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.delete('/auth/devices/:deviceId', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) return res.status(400).json({ message: 'Device id is required' });
    try {
      const fresh: any = await User.findByPk(currentUser.id);
      if (!fresh) return res.status(404).json({ message: 'User not found' });
      const revoked = await revokeDeviceSessionByDeviceId(currentUser.id, deviceId, fresh);
      if (!revoked) return res.status(404).json({ message: 'No active session for this device' });
      const isCurrent =
        String((req as any).sessionDeviceId || '').trim() === deviceId;
      res.json({
        message: isCurrent
          ? 'This device was signed out.'
          : 'Device session ended.',
        revokedDeviceId: deviceId,
        isCurrent,
      });
    } catch (error) {
      console.error('Error revoking device session:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/auth/session', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) {
      const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
      let code: string = hasBearer ? 'SESSION_EXPIRED' : 'NOT_AUTHENTICATED';
      let message = hasBearer
        ? 'Your session has expired due to inactivity. Please sign in again.'
        : 'Not authenticated';
      if (hasBearer) {
        try {
          const decoded: any = jwt.verify(req.headers.authorization!.substring(7), jwtSecret);
          const reason = await explainSessionRejection(decoded);
          if (reason === 'ACCOUNT_DISABLED') {
            code = 'ACCOUNT_DISABLED';
            message = 'This account is inactive or frozen. Please contact an administrator.';
          } else if (reason === 'DEVICE_LIMIT') {
            code = 'DEVICE_LIMIT';
            message =
              'This device was signed out because your account is already active on other devices. Only 2 devices can be signed in at once.';
          }
        } catch {
          /* ignore */
        }
      }
      return res.status(401).json({ message, code });
    }
    const deviceSession = (req as any).deviceSession;
    const anchor = deviceSession?.lastActivity ?? currentUser.lastActivity;
    const activeDevices = await UserDeviceSession.count({ where: { userId: currentUser.id } });
    const sessionTimeoutMinutes = await getSessionTimeoutMinutes();
    res.json({
      inactivityDays: INACTIVITY_DAYS,
      sessionTimeoutMinutes,
      sessionExpiresAt: await sessionExpiresAtFromPolicy(anchor),
      deviceId: (req as any).sessionDeviceId || deviceSession?.deviceId || null,
      maxDevices: MAX_CONCURRENT_DEVICES,
      activeDevices,
    });
  });

  /** Create a one-time transfer link so a Safari login can open the home-screen app signed-in. */
  router.post('/auth/handoff', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    try {
      const deviceSession = (req as any).deviceSession;
      let sessionToken = String(
        deviceSession?.sessionToken ||
          deviceSession?.get?.('sessionToken') ||
          currentUser.sessionToken ||
          ''
      ).trim();
      let deviceId = String(
        (req as any).sessionDeviceId || deviceSession?.deviceId || deviceSession?.get?.('deviceId') || ''
      ).trim();

      if ((!sessionToken || !deviceId) && req.headers.authorization?.startsWith('Bearer ')) {
        try {
          const decoded: any = jwt.verify(req.headers.authorization.substring(7), jwtSecret);
          if (!sessionToken) sessionToken = String(decoded.sessionToken || '').trim();
          if (!deviceId) deviceId = String(decoded.deviceId || '').trim();
        } catch {
          /* ignore */
        }
      }

      if (!sessionToken || !deviceId) {
        return res.status(400).json({ message: 'No active device session to transfer.' });
      }
      const handoffToken = createSessionHandoffToken(jwtSecret, {
        id: String(currentUser.id),
        sessionToken,
        deviceId,
      });
      res.json({
        handoffToken,
        expiresInMinutes: 15,
        openPath: `/login?handoff=${encodeURIComponent(handoffToken)}`,
      });
    } catch (error) {
      console.error('Error creating session handoff:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  /** Redeem a handoff token inside the home-screen / shortcut storage jar. */
  router.post('/auth/handoff/redeem', async (req, res) => {
    try {
      const handoffToken = String(req.body?.handoffToken || req.body?.token || '').trim();
      if (!handoffToken) {
        return res.status(400).json({ message: 'Missing handoff token.' });
      }
      const deviceLabel = String(req.body?.deviceLabel || '').trim() || undefined;
      const result = await redeemSessionHandoffToken(handoffToken, jwtSecret, deviceLabel);
      if (!result) {
        return res.status(401).json({
          message: 'This transfer link expired or is no longer valid. Please sign in again.',
          code: 'HANDOFF_INVALID',
        });
      }
      res.json(result);
    } catch (error) {
      console.error('Error redeeming session handoff:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/auth/pin/verify', pinBruteForceLimiter, async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    const pin = String(req.body.pin || '');
    if (!isValidPin(pin)) {
      return res.status(400).json({ message: 'PIN must be exactly 4 digits' });
    }
    const pinState = resolvePinSecurity(currentUser);
    if (!pinState.pinLockEnabled) {
      return res.json({ verified: true, disabled: true });
    }
    if (currentUser.pinLockedRequiresAdminReset) {
      return res.status(403).json({
        message:
          'Your PIN is locked. Contact an administrator to reset it, then sign in again.',
        requiresAdminPinReset: true,
        pinRequiresAdminReset: true,
        forceLogout: true,
      });
    }
    if (!currentUser.securityPinHash) {
      if (
        currentUser.pinLockedRequiresOtp &&
        !isPinRecoveryVerified(currentUser) &&
        !canBypassAdminPinEmailRecovery(currentUser)
      ) {
        return res.status(403).json({
          message: 'Verify the email code before entering a PIN.',
          requiresOtpRecovery: true,
          pinRequiresOtpRecovery: true,
        });
      }
      return res.status(400).json({
        message: 'Create your 4-digit PIN to continue.',
        needsPinSetup: true,
      });
    }
    const ok = await verifySecurityPin(pin, currentUser.securityPinHash);
    if (!ok) {
      const attempts = Math.max(0, Number(currentUser.pinFailedAttempts) || 0) + 1;
      currentUser.pinFailedAttempts = attempts;
      if (attempts >= PIN_MAX_FAILED_ATTEMPTS) {
        const lockout = await triggerPinLockout(currentUser);
        if (lockout.mode === 'otp') {
          return res.status(403).json({
            message:
              'Too many incorrect PIN attempts. You will be signed out. Sign in again and enter the email verification code to create a new PIN.',
            requiresOtpRecovery: true,
            pinRequiresOtpRecovery: true,
            forceLogout: true,
            maskedEmail: lockout.maskedEmail,
            failedAttempts: PIN_MAX_FAILED_ATTEMPTS,
            ...(lockout.devOtp && process.env.NODE_ENV !== 'production'
              ? { devOtp: lockout.devOtp }
              : {}),
          });
        }
        return res.status(403).json({
          message:
            'Too many incorrect PIN attempts. You will be signed out. Ask an administrator to reset your PIN, then sign in again.',
          requiresAdminPinReset: true,
          pinRequiresAdminReset: true,
          forceLogout: true,
          failedAttempts: PIN_MAX_FAILED_ATTEMPTS,
        });
      }
      await currentUser.save();
      const remaining = PIN_MAX_FAILED_ATTEMPTS - attempts;
      return res.status(401).json({
        message: `Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        failedAttempts: attempts,
        remainingAttempts: remaining,
      });
    }
    if (currentUser.pinFailedAttempts) {
      currentUser.pinFailedAttempts = 0;
      await currentUser.save();
    }
    res.json({ verified: true });
  });

  router.post('/auth/pin/set', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    if (!isPinRequiredRole(currentUser.role)) {
      return res.status(400).json({ message: 'This account does not use a security PIN' });
    }
    const pin = String(req.body.pin || '');
    const currentPin = String(req.body.currentPin || '');
    if (!isValidPin(pin)) {
      return res.status(400).json({ message: 'PIN must be exactly 4 digits' });
    }

    if (currentUser.pinLockedRequiresAdminReset) {
      return res.status(403).json({
        message:
          'Your PIN is locked. An administrator must reset it before you can create a new PIN.',
        requiresAdminPinReset: true,
        pinRequiresAdminReset: true,
      });
    }

    const recoveryLocked = Boolean(currentUser.pinLockedRequiresOtp);
    const recoveryOk =
      isPinRecoveryVerified(currentUser) || canBypassAdminPinEmailRecovery(currentUser);

    if (!currentUser.securityPinHash) {
      if (recoveryLocked && !recoveryOk) {
        return res.status(403).json({
          message: 'Verify the email code before creating a new PIN.',
          requiresOtpRecovery: true,
          pinRequiresOtpRecovery: true,
        });
      }
    } else {
      if (!isValidPin(currentPin)) {
        return res.status(400).json({ message: 'Current PIN is required' });
      }
      const ok = await verifySecurityPin(currentPin, currentUser.securityPinHash);
      if (!ok) return res.status(401).json({ message: 'Current PIN is incorrect' });
    }

    currentUser.securityPinHash = await hashSecurityPin(pin);
    currentUser.pinLockEnabled = true;
    currentUser.pinFailedAttempts = 0;
    clearPinRecoveryState(currentUser);
    if (req.body.autoLockMinutes != null) {
      const mins = Number(req.body.autoLockMinutes);
      if (mins >= 1 && mins <= 120) currentUser.pinAutoLockMinutes = mins;
    }
    await currentUser.save();
    res.json({ message: 'PIN updated', pinSet: true, ...resolvePinSecurity(currentUser) });
  });

  router.put('/auth/pin/settings', async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    if (!isPinRequiredRole(currentUser.role)) {
      return res.status(400).json({ message: 'This account does not use a security PIN' });
    }

    if (req.body.pinLockEnabled !== undefined) {
      if (!req.body.pinLockEnabled) {
        return res.status(400).json({
          message: 'PIN lock is required for all portal accounts and cannot be turned off.',
        });
      }
      currentUser.pinLockEnabled = !!req.body.pinLockEnabled;
      if (currentUser.pinLockEnabled && !currentUser.securityPinHash) {
        return res.status(400).json({
          message: 'Set a 4-digit PIN before enabling PIN lock.',
          needsPinSetup: true,
        });
      }
    }

    if (req.body.autoLockMinutes != null) {
      const mins = Number(req.body.autoLockMinutes);
      if (!Number.isFinite(mins) || mins < 1 || mins > 120) {
        return res.status(400).json({ message: 'autoLockMinutes must be between 1 and 120' });
      }
      currentUser.pinAutoLockMinutes = mins;
    }

    if (isPinRequiredRole(currentUser.role)) {
      currentUser.pinLockEnabled = true;
    }
    await currentUser.save();
    res.json(resolvePinSecurity(currentUser));
  });

  router.post('/auth/pin/recovery/send-otp', pinBruteForceLimiter, async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    if (!isPinRequiredRole(currentUser.role)) {
      return res.status(400).json({ message: 'This account does not use a security PIN' });
    }
    if (!isAdminPinSelfRecoveryRole(currentUser.role)) {
      return res.status(403).json({
        message:
          'Email PIN recovery is only available for Admin accounts. Contact an administrator to reset your PIN.',
        code: 'ADMIN_RESET_REQUIRED',
        requiresAdminPinReset: true,
        pinRequiresAdminReset: true,
      });
    }
    if (!currentUser.pinLockedRequiresOtp) {
      return res.status(400).json({ message: 'PIN recovery is not required for this account.' });
    }
    if (isPinRecoveryVerified(currentUser)) {
      return res.json({
        message: 'Email already verified. You can create a new PIN.',
        pinRecoveryReady: true,
        ...resolvePinSecurity(currentUser),
      });
    }
    if (!isEmailConfigured()) {
      // Production is missing GMAIL_APP_PASSWORD / OAuth — do not hard-lock admins.
      await markAdminPinRecoveryReadyWithoutEmail(currentUser);
      return res.json({
        message:
          'Email delivery is not configured on this server. You can create a new PIN now (you are already signed in).',
        code: 'EMAIL_NOT_CONFIGURED',
        pinRecoveryReady: true,
        emailBypassed: true,
        hint: getGmailSetupMessage(),
        ...resolvePinSecurity(currentUser),
      });
    }
    try {
      const sent = await sendPinRecoveryOtp(currentUser);
      const { OTP_EXPIRY_MINUTES, OTP_EXPIRY_SECONDS } = await import('./otpExpiryConfig.js');
      res.json({
        message: 'Verification code sent to your email.',
        maskedEmail: sent.maskedEmail,
        expiresInSeconds: OTP_EXPIRY_SECONDS.pinRecovery,
        expiresInMinutes: OTP_EXPIRY_MINUTES.pinRecovery,
        ...(sent.devOtp && process.env.NODE_ENV !== 'production' ? { devOtp: sent.devOtp } : {}),
      });
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code || '')
          : '';
      // Delivery failure with credentials present — still unlock admin so portal is usable.
      if (isAdminPinSelfRecoveryRole(currentUser.role)) {
        await markAdminPinRecoveryReadyWithoutEmail(currentUser);
        return res.json({
          message:
            'Could not send the verification email. You can create a new PIN now (you are already signed in).',
          code: code || 'EMAIL_DELIVERY_FAILED',
          pinRecoveryReady: true,
          emailBypassed: true,
          ...resolvePinSecurity(currentUser),
        });
      }
      res.status(503).json({
        message: err instanceof Error ? err.message : 'Could not send verification email.',
        code: code || 'EMAIL_DELIVERY_FAILED',
      });
    }
  });

  router.post('/auth/pin/recovery/verify-otp', pinBruteForceLimiter, async (req, res) => {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    if (!isAdminPinSelfRecoveryRole(currentUser.role)) {
      return res.status(403).json({
        message:
          'Email PIN recovery is only available for Admin accounts. Contact an administrator to reset your PIN.',
        code: 'ADMIN_RESET_REQUIRED',
        requiresAdminPinReset: true,
        pinRequiresAdminReset: true,
      });
    }
    if (!currentUser.pinLockedRequiresOtp) {
      return res.status(400).json({ message: 'PIN recovery is not required.' });
    }
    const otp = String(req.body.otp || '').trim();
    if (!/^\d{4,8}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the verification code from your email.' });
    }
    const ok = await verifyPinRecoveryOtp(currentUser, otp);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid or expired verification code.' });
    }
    res.json({
      message: 'Email verified. Create your new 4-digit PIN.',
      pinRecoveryReady: true,
      ...resolvePinSecurity(currentUser),
    });
  });

}

/** QR attendance, reviews, payslip access guard — after requireAuth. */
export function mountV40AppRoutes(router: Router, deps: V40RouteDeps) {
  const { hrAccess, adminOrHr, adminOnly, clearCachePrefix, hrManagerAccess, requireEffectivePermission } = deps;
  const usersManage =
    requireEffectivePermission?.('users.manage') ?? adminOnly;

  router.post('/users/:id/pin/reset', usersManage, async (req, res) => {
    try {
      const admin: any = (req as any).user;
      if (!admin) return res.status(401).json({ message: 'Not authenticated' });

      const adminPin = String(req.body.adminPin || '');
      if (!isValidPin(adminPin)) {
        return res.status(400).json({
          message: 'Enter your 4-digit PIN to authorize this reset.',
        });
      }
      if (!admin.securityPinHash) {
        return res.status(403).json({
          message: 'Set your own security PIN in Settings before resetting other users.',
        });
      }
      const adminPinOk = await verifySecurityPin(adminPin, admin.securityPinHash);
      if (!adminPinOk) {
        return res.status(401).json({ message: 'Your PIN is incorrect.' });
      }

      const targetId = String(req.params.id || '');
      if (targetId === String(admin.id)) {
        return res.status(400).json({
          message: 'Use Account Settings to change your own PIN.',
        });
      }

      const user: any = await User.findByPk(targetId);
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (!isPinRequiredRole(user.role)) {
        return res.status(400).json({
          message: 'PIN reset applies to portal user accounts only.',
        });
      }
      user.securityPinHash = null;
      user.pinLockEnabled = true;
      user.pinFailedAttempts = 0;
      clearPinRecoveryState(user);
      await user.save();
      res.json({
        message:
          'PIN reset. The user must sign in and create a new 4-digit PIN before using the system.',
        userId: user.id,
        pinSet: false,
        pinMandatory: true,
        ...resolvePinSecurity(user),
      });
    } catch (error) {
      console.error('Error resetting PIN:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  const attendanceQrGenerator = adminOrHr;
  const attendanceQrScanner = (req: any, res: any, next: any) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (['EMPLOYEE', 'HR', 'MANAGER', 'ADMIN'].includes(role)) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };

  router.get('/payroll/payslips/user/:userId', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const targetId = req.params.userId;
      const role = String(currentUser?.role || '').toUpperCase();
      const isSelf = currentUser?.id === targetId;
      const isHrOrAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'HR';
      if (!isSelf && !isHrOrAdmin) {
        return res.status(403).json({ message: 'You can only view your own payslips' });
      }
      const payslips = await Payslip.findAll({
        where: { userId: targetId },
        order: [['month', 'DESC']],
      });
      const { serializePayslipForApi } = await import('./payrollCalculation.js');
      const { employeeCanViewPayslipDisbursement } = await import(
        './payroll/payslipDisbursementService.js'
      );
      const { PayrollRun } = await import('./db.js');
      const payload = [];
      for (const ps of payslips) {
        const plain = ps.get({ plain: true }) as { payrollRunId?: string; disbursementStatus?: string };
        let runStatus: string | null = null;
        if (plain.payrollRunId) {
          const run = await PayrollRun.findByPk(String(plain.payrollRunId), { attributes: ['status'] });
          runStatus = run ? String(run.get('status') ?? '') : null;
        }
        const runApproved =
          runStatus &&
          ['APPROVED', 'LOCKED', 'PAYMENT_PROCESSING', 'PAID', 'COMPLETED'].includes(
            runStatus.toUpperCase()
          );
        if (!isHrOrAdmin) {
          if (!runApproved || !employeeCanViewPayslipDisbursement(plain.disbursementStatus)) {
            continue;
          }
        }
        payload.push(await serializePayslipForApi(ps, undefined, { runStatus }));
      }
      res.json(payload);
    } catch (error) {
      console.error('Error fetching user payslips:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/attendance/qr/generate', attendanceQrGenerator, async (req, res) => {
    try {
      const { getOfficeById, getPrimaryOfficeLocation } = await import('./attendanceSettings.js');
      let { officeId } = req.body;
      if (!officeId) {
        officeId = (await getPrimaryOfficeLocation()).id;
      }
      if (!officeId) {
        return res.status(400).json({
          message: 'No office location configured. Add a zone under Attendance settings.',
        });
      }
      const office = await getOfficeById(String(officeId));
      if (!office) return res.status(404).json({ message: 'Office not found' });

      const issued = createAttendanceQrToken(String(officeId), QR_TOKEN_TTL_MS);

      const payload = JSON.stringify({ type: 'hcms-attendance', officeId: issued.officeId, token: issued.token });
      const frontendBase = String(process.env.FRONTEND_URL || process.env.VITE_PUBLIC_URL || '').replace(
        /\/$/,
        ''
      );
      const checkInUrl = frontendBase
        ? `${frontendBase}/#/attendance/scan?t=${encodeURIComponent(issued.token)}`
        : undefined;
      res.json({
        token: issued.token,
        payload,
        checkInUrl,
        officeId: issued.officeId,
        officeName: office.name,
        expiresAt: issued.expiresAt.toISOString(),
        ttlSeconds: issued.ttlSeconds,
      });
    } catch (error: unknown) {
      console.error('Error generating QR token:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/attendance/qr/scan', attendanceQrScanner, async (req, res) => {
    const currentUser = (req as any).user;
    const { token, action, latitude, longitude } = req.body;
    if (!token) return res.status(400).json({ message: 'QR token is required' });

    try {
      const verified = verifyAttendanceQrToken(String(token));
      if (!verified) {
        return res.status(400).json({
          message: 'QR code expired or invalid. Ask an admin to refresh the entrance display.',
        });
      }
      const { getOfficeById, getAttendanceGeofenceConfig } = await import('./attendanceSettings.js');
      const office = await getOfficeById(String(verified.officeId));
      if (!office) return res.status(404).json({ message: 'Office not found' });

      const settings = await getAttendanceGeofenceConfig();
      const rules = settings?.rules;
      const userId = currentUser.id;
      const today = new Date().toISOString().split('T')[0];
      const existing: any = await AttendanceRecord.findOne({ where: { userId, date: today } });

      const explicitIn = action === 'in';
      const explicitOut = action === 'out';
      const shouldClockOut =
        explicitOut || (!explicitIn && existing?.clockIn && !existing?.clockOut);

      const requireGps = shouldClockOut
        ? rules?.requireGpsOnClockOut !== false
        : rules?.requireGps !== false;
      const requireInZone = shouldClockOut
        ? rules?.requireInZoneToClockOut === true
        : rules?.requireInZoneToClockIn !== false;

      const hasCoords = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
      if (requireGps && !hasCoords) {
        return res.status(400).json({
          message: 'GPS location is required. Enable location and try again.',
        });
      }

      let location = {
        lat: Number(office.latitude),
        lng: Number(office.longitude),
      };
      if (hasCoords) {
        const lat = Number(latitude);
        const lng = Number(longitude);
        location = { lat, lng };
        if (requireInZone) {
          const side = Number(office.radiusMeters) || 20;
          const inZone = isInOfficeZone(
            lat,
            lng,
            Number(office.latitude),
            Number(office.longitude),
            side
          );
          if (!inZone) {
            return res.status(403).json({
              message: `You must be inside the ${office.name} attendance zone (${side}m area) to scan QR.`,
            });
          }
        }
      }

      const { performClockIn, performClockOut, AttendanceClockError } = await import(
        './attendanceClockService.js'
      );

      if (shouldClockOut) {
        if (!existing?.id) {
          return res.status(400).json({ message: 'You have not clocked in today' });
        }
        const record = await performClockOut({
          recordId: String(existing.id),
          location: hasCoords || requireGps ? location : null,
        });
        clearCachePrefix?.('report_stats');
        return res.json({ action: 'clock-out', record, office: office?.name });
      }

      const record = await performClockIn({
        userId,
        dateKey: today,
        location: hasCoords || requireGps ? location : null,
      });
      clearCachePrefix?.('report_stats');
      res.status(201).json({ action: 'clock-in', record, office: office?.name });
    } catch (error) {
      const { AttendanceClockError } = await import('./attendanceClockService.js');
      if (error instanceof AttendanceClockError) {
        return res.status(error.statusCode).json({ message: error.message, code: error.code });
      }
      console.error('Error scanning QR:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews', hrAccess, async (req, res) => {
    try {
      const { type } = req.query;
      const where: Record<string, unknown> = {};
      if (type) where.reviewType = type;
      const reviews = await EmployeeReview.findAll({ where, order: [['createdAt', 'DESC']] });
      res.json(reviews);
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation/hr-assignees', hrManagerAccess, async (_req, res) => {
    try {
      const { listProbationHrAssignees } = await import('./probation/probationReviewService.js');
      res.json(await listProbationHrAssignees());
    } catch (error) {
      console.error('Error fetching HR assignees:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation/manager-assignees', hrManagerAccess, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const role = String(currentUser?.role ?? '').toUpperCase();
      if (role !== 'HR' && role !== 'ADMIN') {
        return res.status(403).json({ message: 'Only HR can list manager assignees for routing.' });
      }
      const departmentId = req.query.departmentId ? String(req.query.departmentId) : undefined;
      const { listProbationManagerAssignees } = await import('./probation/probationReviewService.js');
      res.json(await listProbationManagerAssignees(departmentId));
    } catch (error) {
      console.error('Error fetching manager assignees:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation', hrManagerAccess, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { listProbationReviewQueue, resolveActorEmployeePk } = await import(
        './probation/probationReviewService.js'
      );
      const employeePk = currentUser?.id
        ? await resolveActorEmployeePk(String(currentUser.id))
        : null;
      const { items, summary } = await listProbationReviewQueue({
        userId: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
        employeePk,
      });
      res.json({ items, summary });
    } catch (error) {
      console.error('Error fetching probation list:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation/history/:userId', hrManagerAccess, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { listProbationReviewHistory, listProbationReviewQueue, resolveActorEmployeePk } =
        await import('./probation/probationReviewService.js');
      const role = String(currentUser?.role ?? '').toUpperCase();
      if (role === 'MANAGER') {
        const employeePk = currentUser?.id
          ? await resolveActorEmployeePk(String(currentUser.id))
          : null;
        const { items } = await listProbationReviewQueue({
          userId: String(currentUser?.id ?? ''),
          role,
          employeePk,
        });
        const allowed = items.some((row) => String(row.userId) === String(req.params.userId));
        if (!allowed) {
          return res.status(403).json({ message: 'You can only view probation history for assigned staff.' });
        }
      }
      const history = await listProbationReviewHistory(req.params.userId);
      res.json(history);
    } catch (error) {
      console.error('Error fetching probation history:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation/my-history', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { listProbationReviewHistory } = await import('./probation/probationReviewService.js');
      res.json(await listProbationReviewHistory(String(currentUser.id)));
    } catch (error) {
      console.error('Error fetching my probation history:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.get('/reviews/probation/my-self-evaluation', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { listMyPendingProbationSelfEvaluation } = await import(
        './probation/probationReviewService.js'
      );
      res.json(await listMyPendingProbationSelfEvaluation(String(currentUser.id)));
    } catch (error) {
      console.error('Error fetching probation self-evaluation:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/reviews/probation/self-evaluation', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
      const { submitProbationReview } = await import('./probation/probationReviewService.js');
      const result = await submitProbationReview({
        ...req.body,
        userId: currentUser.id,
        action: 'SUBMIT_SELF_EVALUATION',
        reviewedBy: currentUser.id,
        actorUserId: currentUser.id,
        actorRole: currentUser.role,
      });
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Self-evaluation submission failed';
      res.status(400).json({ message });
    }
  });

  router.post('/reviews/probation/submit', hrManagerAccess, async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { submitProbationReview } = await import('./probation/probationReviewService.js');
      const action = String(req.body?.action ?? 'SUBMIT').toUpperCase();
      const role = String(currentUser?.role ?? '').toUpperCase();
      if (action === 'ROUTE_TO_MANAGER') {
        if (role !== 'HR' && role !== 'ADMIN') {
          return res.status(403).json({ message: 'Only HR can route probation reviews to managers.' });
        }
      }
      if (action === 'HR_DECIDE' || action === 'SUBMIT_FOR_APPROVAL' || (action === 'SUBMIT' && role === 'HR')) {
        if (role !== 'HR' && role !== 'ADMIN') {
          return res.status(403).json({ message: 'Only HR can submit probation decisions for approval.' });
        }
      }
      const result = await submitProbationReview({
        ...req.body,
        reviewedBy: req.body.reviewedBy || currentUser?.id,
        actorUserId: currentUser?.id,
        actorRole: currentUser?.role,
      });
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Probation review failed';
      res.status(400).json({ message });
    }
  });

  router.get('/reviews/probation/pending-my-approval', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { listPendingProbationReviewsForCurrentApprover } = await import(
        './probation/probationWorkflowService.js'
      );
      const rows = await listPendingProbationReviewsForCurrentApprover(currentUser, {
        includeHistory: true,
      });
      res.json(rows);
    } catch (error) {
      console.error('Error fetching probation approvals:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.post('/reviews/probation/workflow/:reviewId', async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const action = String(req.body?.action ?? '').toLowerCase();
      if (!['approve_final', 'reject_final', 'return_final'].includes(action)) {
        return res.status(400).json({ message: 'Invalid workflow action.' });
      }
      const { executeProbationWorkflowAction } = await import('./probation/probationWorkflowService.js');
      const result = await executeProbationWorkflowAction({
        reviewId: req.params.reviewId,
        action: action as 'approve_final' | 'reject_final' | 'return_final',
        actor: {
          userId: String(currentUser?.id ?? ''),
          role: String(currentUser?.role ?? ''),
        },
        notes: req.body?.notes ?? null,
      });
      res.json(result);
    } catch (error) {
      const status = (error as { status?: number })?.status ?? 400;
      const message = error instanceof Error ? error.message : 'Workflow action failed';
      res.status(status).json({ message });
    }
  });

  router.post('/reviews', hrAccess, async (req, res) => {
    try {
      const data = req.body;
      const id = data.id || `rev-${Date.now()}`;
      const currentUser = (req as any).user;
      const { loadKpiGradeDefinitions, scoreToGrade, deriveCategoryScoresFromOverall } =
        await import('./personalAnalytics/kpiGradeSettings.js');
      const grades = await loadKpiGradeDefinitions();
      const score = data.score != null ? Number(data.score) : null;
      const grade =
        data.grade ||
        (score != null && Number.isFinite(score) ? scoreToGrade(score, grades) : null);
      const periodMonth =
        data.periodMonth ||
        (data.periodEnd ? String(data.periodEnd).slice(0, 7) : null);
      const categoryScoresJson =
        data.categoryScoresJson ??
        (score != null && Number.isFinite(score)
          ? JSON.stringify(deriveCategoryScoresFromOverall(score))
          : null);
      const reviewType = data.reviewType || 'PROBATION';
      const status = data.status || 'PENDING';

      if (
        reviewType === 'PROBATION' &&
        (status === 'PASSED' || status === 'FAILED' || data.recommendation)
      ) {
        try {
          const { submitProbationReview } = await import('./probation/probationReviewService.js');
          const recommendation =
            data.recommendation ||
            (status === 'PASSED' ? 'PASS' : status === 'FAILED' ? 'FAIL' : undefined);
          const result = await submitProbationReview({
            userId: data.userId,
            reviewId: data.id,
            action: 'SUBMIT',
            recommendation,
            ratings: data.ratings,
            strengths: data.strengths ?? data.notes,
            areasForImprovement: data.areasForImprovement,
            hrNotes: data.hrNotes,
            extensionDays: data.extensionDays,
            extensionReason: data.extensionReason,
            nextReviewDate: data.nextReviewDate,
            reviewedBy: data.reviewedBy || currentUser?.id,
            periodEnd: data.periodEnd,
          });
          return res.status(201).json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Probation review failed';
          return res.status(400).json({ message });
        }
      }

      const [review] = await EmployeeReview.upsert({
        id,
        userId: data.userId,
        reviewType,
        periodEnd: data.periodEnd,
        periodMonth,
        score: data.score,
        grade,
        categoryScoresJson,
        status,
        notes: data.notes,
        reviewedBy: data.reviewedBy || currentUser?.id,
        reviewedAt:
          data.reviewedAt ||
          (status === 'PASSED' || status === 'FAILED' ? new Date() : null),
      });
      res.status(201).json(review);
    } catch (error) {
      console.error('Error saving review:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  router.put('/reviews/:id', hrAccess, async (req, res) => {
    try {
      const review: any = await EmployeeReview.findByPk(req.params.id);
      if (!review) return res.status(404).json({ message: 'Review not found' });
      const { loadKpiGradeDefinitions, scoreToGrade, deriveCategoryScoresFromOverall } =
        await import('./personalAnalytics/kpiGradeSettings.js');
      const grades = await loadKpiGradeDefinitions();
      const score = req.body.score != null ? Number(req.body.score) : Number(review.score);
      const patch: Record<string, unknown> = { ...req.body };
      if (!patch.grade && Number.isFinite(score)) {
        patch.grade = scoreToGrade(score, grades);
      }
      if (!patch.categoryScoresJson && Number.isFinite(score)) {
        patch.categoryScoresJson = JSON.stringify(deriveCategoryScoresFromOverall(score));
      }
      if (!patch.periodMonth && patch.periodEnd) {
        patch.periodMonth = String(patch.periodEnd).slice(0, 7);
      }
      const nextStatus = String(req.body.status ?? review.status ?? '');
      if (
        review.reviewType === 'PROBATION' &&
        (nextStatus === 'PASSED' ||
          nextStatus === 'FAILED' ||
          nextStatus === 'EXTENDED' ||
          req.body.recommendation ||
          req.body.action === 'SAVE_DRAFT')
      ) {
        try {
          const { submitProbationReview } = await import('./probation/probationReviewService.js');
          const currentUser = (req as any).user;
          const action = req.body.action === 'SAVE_DRAFT' ? 'SAVE_DRAFT' : 'SUBMIT';
          const recommendation =
            req.body.recommendation ||
            (nextStatus === 'PASSED'
              ? 'PASS'
              : nextStatus === 'FAILED'
                ? 'FAIL'
                : nextStatus === 'EXTENDED'
                  ? 'EXTEND'
                  : undefined);
          const result = await submitProbationReview({
            userId: review.userId,
            reviewId: review.id,
            action,
            recommendation,
            ratings: req.body.ratings,
            strengths: req.body.strengths ?? req.body.notes ?? review.notes,
            areasForImprovement: req.body.areasForImprovement ?? review.areasForImprovement,
            hrNotes: req.body.hrNotes ?? review.hrNotes,
            extensionDays: req.body.extensionDays ?? review.extensionDays,
            extensionReason: req.body.extensionReason ?? review.extensionReason,
            nextReviewDate: req.body.nextReviewDate ?? review.nextReviewDate,
            reviewedBy: req.body.reviewedBy || currentUser?.id,
            periodEnd: req.body.periodEnd ?? review.periodEnd,
          });
          await review.reload();
          return res.json({ ...review.get({ plain: true }), ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Probation review failed';
          return res.status(400).json({ message });
        }
      }

      await review.update({
        ...patch,
        reviewedAt:
          req.body.reviewedAt ||
          (['PASSED', 'FAILED'].includes(req.body.status) ? new Date() : review.reviewedAt),
      });
      res.json(review);
    } catch (error) {
      console.error('Error updating review:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
}

export { INACTIVITY_MS };
