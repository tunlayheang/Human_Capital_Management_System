import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { loginAuthLimiter } from './authRateLimits.js';
import {
  User, Department, Position, Employee, AttendanceRecord, LeaveRequest,
  Project, Task, PayrollRun, Payslip, PayslipBreakdown,
  Notification, Message,
  SystemSetting, EmployeeSetting,
  PermissionTemplate, AuditLog,
  EmployeeAllowanceAssignment,
  EmployeeDependent, EmployeeStatusHistory, HistoryEmployee, EmployeeIssuedCard,
  SalaryStructure,
  FixedRoster, RosterAssignment, RosterException, LeaveType, LeaveBalance,
  UserDeviceSession, ProjectAssignment, TaxBracket
} from './db';
import crypto from 'crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Op, QueryTypes } from 'sequelize';
import { cacheMiddleware, cache as httpResponseCache, optimizeQuery } from './middleware/performance';
import { sequelize, isDatabaseReady, isSchemaComplete } from './db';
import { isDatabaseConnectionError, isDatabaseSchemaError } from './mysqlConfig';
import {
  terminateEmployee,
  offboardEmployee,
  restoreEmployee,
  deleteDraftEmployee,
  EmployeeLifecycleError,
} from './employeeLifecycle';
import { employeeLookupWhere, previewNextEmployeeDisplayId, toCanonicalEmployeeDisplayId, isEmployeeBadgeDisplayId } from './employeeIdFormat.js';
import {
  CHAT_ATTACHMENT_MIMES,
  attachmentTypeFromMime,
  serializeMessage,
  serializeMessagesForClient,
  listInbox,
  listColleaguesForChat,
  getDirectMessages,
  getGroupMessages,
  sendDirectMessage,
  sendGroupMessage,
  markDirectRead,
  markGroupRead,
  getUnreadCount,
  getUnreadBySender,
  createGroupChat,
  inviteToGroup,
  getGroupDetail,
  updateGroupChatName,
  leaveGroupChat,
  isChatAdmin,
  deleteMessageForUser,
  editMessageForUser,
  forwardMessage,
  getChatContactProfile,
} from './chatService.js';
import { listChatPins, setChatPin } from './chatPinService.js';
import {
  getChatMuteSettings,
  setMuteAll,
  setDirectMute,
  setGroupMute,
} from './chatMuteService.js';
import {
  findPortalUserForEmployee,
  findUserByEmployeeLoginId,
  maskEmail,
  normalizeEmployeeLoginId,
  normalizePhone,
  portalLoginIsActive,
  resolveAuthPhoneForUser,
  upsertLoginUserForEmployee,
} from './userAuth';
import { syncPortalEmailFromEmployee, syncPortalPhoneFromEmployee } from './portalUserPhone.js';
import {
  applySelfProfilePatchToEmployee,
  buildAuditActorMap,
  findEmployeeForUser,
  serializeUserForClient,
  serializeUsersForClient,
  stripUserSecrets,
  USER_ACCOUNT_ATTRIBUTES,
} from './userAccountService.js';
import { getEmployeeSummaryCounts } from './employeeSummaryCounts.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';
import { issueUserSession } from './sessionIssue.js';
import {
  buildAuthDeviceContext,
  deviceContextToAuditMetadata,
  parseAuditMetadata,
  resolveDeviceLabelFromMetadata,
} from './deviceContext.js';
import { resolveOtpEmailForUser } from './otpEmailResolve.js';
import { OTP_EXPIRY_MINUTES, OTP_EXPIRY_SECONDS, otpExpiryMs } from './otpExpiryConfig.js';
import {
  clearResetPasswordVerification,
  isResetPasswordVerified,
  markResetPasswordVerified,
  preparePasswordResetStorage,
} from './passwordResetService.js';
import { mountV40AuthRoutes, mountV40AppRoutes } from './v40FeatureRoutes.js';
import { mountPersonalAnalyticsRoutes } from './personalAnalytics/personalAnalyticsRoutes.js';
import { mountAppraisalRoutes } from './appraisal/appraisalRoutes.js';
import { ACTIVE_EMPLOYEE_STATUS, buildAttendanceHistory, buildDashboardAnalytics } from './dashboardChartStats.js';
import { countAbsentOnDate } from './attendanceSnapshotCounts.js';
import { buildOrganizationAnalytics } from './organizationAnalyticsService.js';
import { createReportCatalogRoutes } from './reports/reportRoutes.js';
import { resolveDashboardDateRange } from './dashboardDateRange.js';
import {
  explainSessionRejection,
  resolvePortalSession,
  revokeAllDeviceSessions,
  revokeOtherDeviceSessions,
} from './sessionIssue.js';
import {
  generateLocalOtp,
  getOtpDeliveryMode,
  isEmailDevFallbackEnabled,
  isSmtpAuthError,
  logLocalOtp,
  sendOtpViaEmail,
  sendOtpViaTwilio,
  verifyOtpViaTwilio,
  verifySmtpConnection,
  getOtpEmailStatus,
  isEmailConfigured,
  getGmailSetupMessage,
  isSmtpLikelyBlocked,
  OTP_EMAIL_UNAVAILABLE_MESSAGE,
  type OtpPurpose,
} from './services/OtpDeliveryService';
import {
  configureGmailAppPassword,
  getGmailAppsScriptSource,
} from './gmailRuntimeConfig.js';
import {
  checkLocationAgainstOffices,
  checkLocationAgainstWorksite,
  pickNearestOffice,
  resolveOfficeWorksite,
} from './attendanceGeo';
import {
  formatDepartmentRow,
  formatDepartmentsList,
  normalizePositionRow,
  parsePositionSalaryRange,
  validateEmployeeSalaryForPosition,
} from './departmentApi';
import { generateNextDepartmentId, generateNextPositionId } from './orgUnitIdFormat';
import {
  assignDepartmentManager,
  DepartmentManagerError,
} from './departmentManager.js';
import { enrichEmployeeWithOfficeLocation } from './employeeOfficeLocation.js';
import {
  buildBreakdownForUserId,
  calculatePayrollForPortalUser,
  serializePayslipForApi,
} from './payrollCalculation.js';
import { breakdownToRow } from './payslipBreakdownDb.js';
import { upsertBreakdownForPayslip } from './payslipBreakdownService.js';
import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';
import {
  attachCompensationToEmployeeRows,
  findEmployeeWithCompensation,
  loadSalaryStructureForEmployeeId,
  mergeCompensationIntoEmployee,
  splitSalaryPayload,
  upsertSalaryStructure,
} from './salaryStructureService.js';
import {
  getMenuForUser,
  clearRoleMenuCache,
} from './navMenuService.js';
import { requireChatSend, requireEffectivePermission } from './middleware/permissions.js';
import { createAllowanceRoutes } from './allowanceRoutes.js';
import { createUnifiedPayrollRuleRoutes } from './payroll/unifiedPayrollRuleRoutes.js';
import { createSeniorityIndemnityRoutes } from './payroll/seniorityIndemnity/seniorityIndemnityRoutes.js';
import { mountPayrollHybridRoutes } from './payroll/payrollHybridRoutes.js';
import { mountFinalSettlementRoutes } from './payroll/finalSettlementRoutes.js';
import { mountAbandonmentRoutes } from './payroll/abandonmentRoutes.js';
import { mountHistoricalRecordsRoutes } from './payroll/historicalRecordsRoutes.js';
import {
  listCatalogPermissions,
  PERMISSIONS_HARDCODED,
} from './permissionCatalog.js';
import { normalizeRoleActions } from './permissionActions.js';
import { invalidateEffectivePermissionsCache } from './effectivePermissions.js';
import {
  getPermissionMatrix,
  saveRolePermissions,
  resetPermissionStoreToCatalogDefaults,
  listFileOverrides,
  serializeOverrideForApi,
  createFileOverride,
  deleteFileOverride,
  getPermissionStorePath,
} from './permissionFileStore.js';
import {
  attendanceLateStatus,
  DEFAULT_ATTENDANCE_RULES,
  getAttendanceGeofenceConfig,
  getAttendanceSettings,
  listActiveOfficeLocations,
  getOfficeById,
  getPrimaryOfficeWorksite,
  saveAttendanceGeofenceConfig,
  saveAttendanceSettings,
} from './attendanceSettings';
import {
  attendanceLateStatusForClockIn,
  getEmployeeScheduleForUser,
} from './employeeAttendanceSchedule';
import {
  canPersistDraft,
  EMPLOYEE_STATUS_ACTIVE,
  EMPLOYEE_STATUS_DRAFT,
  EMPLOYEE_STATUS_PROFILE_INCOMPLETE,
  fillDraftCreateFields,
  isDraftRequest,
  isEmployeePayloadComplete,
  isPlaceholderDraftEmail,
  mergeEmployeeRowForStatusValidation,
  missingFieldsForActive,
  normalizeEmployeeLifecycleStatus,
  resolveEmployeeStatus,
  stripDraftMeta,
} from './employeeDraft.js';
import { OFFBOARDED_STATUSES } from './employeeArchiveService.js';
import {
  isEmployeeActiveForPortal,
  isEmployeeAllowedSystemAccess,
  isEmployeeDraftStatus,
  isEmployeeInactiveForPortal,
} from './employeePortalStatus.js';
import {
  freezePortalUserById,
  unfreezePortalUserById,
  isPortalUserFrozen,
  isPortalUserAllowedSession,
  revokePortalSessionsForUser,
  PORTAL_USER_STATUS_FROZEN,
  PORTAL_USER_STATUS_INACTIVE,
} from './portalUserAccount.js';
import {
  validatePortalPasswordIfProvidedWithPolicy,
  validatePortalPasswordWithPolicy,
} from './securityPasswordPolicy.js';

async function rejectInvalidPortalPassword(
  res: express.Response,
  password: string,
  required = true
): Promise<boolean> {
  const result = required
    ? await validatePortalPasswordWithPolicy(password)
    : await validatePortalPasswordIfProvidedWithPolicy(password);
  if (!result.valid) {
    res.status(400).json({ message: result.message });
    return true;
  }
  return false;
}

function trimOptionalKhmerText(val: unknown): string | null {
  const s = String(val ?? '').trim();
  return s.length > 0 ? s : null;
}

/** Offboarded / terminal statuses must not be rewritten to draft (placeholder emails survive offboarding). */
const TERMINAL_EMPLOYEE_STATUSES = new Set<string>([
  ...OFFBOARDED_STATUSES,
  'suspended',
]);

function withEffectiveEmployeeStatus<T extends Record<string, unknown>>(row: T): T {
  const current = String(row.status ?? '')
    .trim()
    .toLowerCase();
  if (TERMINAL_EMPLOYEE_STATUSES.has(current)) {
    return row;
  }
  if (isPlaceholderDraftEmail(row.email)) {
    return { ...row, status: EMPLOYEE_STATUS_DRAFT };
  }
  if (current === EMPLOYEE_STATUS_PROFILE_INCOMPLETE) {
    return { ...row, status: EMPLOYEE_STATUS_DRAFT };
  }
  return row;
}

export const router = express.Router();
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
});

const brandingAssetUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
});

const documentUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error('Allowed file types: PDF, JPG, PNG, WebP, DOC, DOCX'));
  },
});

const chatUpload = multer({
  dest: 'uploads/',
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (CHAT_ATTACHMENT_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only photos (JPEG/PNG/WebP/GIF) and PDF files are allowed'));
  },
});

const BACKUP_UPLOAD_DIR = path.join('uploads', 'backup-incoming');
fs.mkdirSync(BACKUP_UPLOAD_DIR, { recursive: true });

const backupUpload = multer({
  dest: BACKUP_UPLOAD_DIR,
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.sql') || file.mimetype === 'application/sql' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only .sql backup files are allowed'));
    }
  },
});

/** Legacy multipart still accepted; prefer JSON/base64 chunks (see RESTORE_UPLOAD_CHUNK_SIZE). */
const backupChunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
});

/** Parse multipart only when the client sends FormData (attachments). JSON text messages skip multer. */
const optionalChatUpload: express.RequestHandler = (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }
  return chatUpload.single('attachment')(req, res, next);
};

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}

const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-only-secret-change-me';

const isValidOtp = (otp: unknown) => /^\d{4,8}$/.test(String(otp || ''));
const hashOneTimeCode = (code: string) =>
  crypto.createHmac('sha256', JWT_SECRET).update(code).digest('hex');
const isUserActive = (user: any) => {
  if (!user || user.isActive === false) return false;
  const status = String(user.status ?? 'ACTIVE').trim().toUpperCase();
  return status !== 'INACTIVE' && status !== 'FROZEN' && status !== 'DISABLED';
};

const storeOtpOnUser = async (
  user: any,
  purpose: OtpPurpose,
  otp: string,
  twilioVerify: boolean
) => {
  if (twilioVerify) {
    if (purpose === 'login') {
      user.otp = null;
      user.otpExpiry = null;
    } else {
      user.resetToken = null;
      user.resetTokenExpiry = null;
    }
  } else if (purpose === 'login') {
    user.otp = hashOneTimeCode(otp);
    user.otpExpiry = new Date(Date.now() + otpExpiryMs('login'));
  } else {
    user.resetToken = hashOneTimeCode(otp);
    user.resetTokenExpiry = new Date(Date.now() + otpExpiryMs('passwordReset'));
  }
  const fields =
    purpose === 'login' ? (['otp', 'otpExpiry'] as const) : (['resetToken', 'resetTokenExpiry'] as const);
  await user.save({ fields: [...fields] });
};

const isEmailDeliveryFailure = (error: any): boolean =>
  error?.name === 'OtpDeliveryError' ||
  error?.code === 'EMAIL_DELIVERY_FAILED' ||
  error?.code === 'EMAIL_NOT_CONFIGURED' ||
  isSmtpAuthError(error) ||
  /App Password|Apps Script|not configured|RESEND|gmail:oauth-setup|SMTP/i.test(
    String(error?.message || '')
  );

/**
 * Email/OTP transport failures are service outages, not client errors. Operator hints name internal
 * files and setup endpoints, so they go to the log and only reach the client outside production.
 */
const respondEmailDeliveryUnavailable = (
  res: express.Response,
  error: any,
  context: string
) => {
  const detail = String(error?.message || '') || getGmailSetupMessage() || 'unknown cause';
  console.error(`[auth] ${context}: OTP email delivery unavailable — ${detail}`);
  return res.status(503).json({
    message: OTP_EMAIL_UNAVAILABLE_MESSAGE,
    code: error?.code === 'EMAIL_NOT_CONFIGURED' ? 'EMAIL_NOT_CONFIGURED' : 'EMAIL_DELIVERY_FAILED',
    ...(process.env.NODE_ENV === 'production' ? {} : { detail }),
  });
};

const shouldFallbackToLocalOtp = (error: any) => {
  if (getOtpDeliveryMode() !== 'email') {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  if (!isEmailDevFallbackEnabled()) return false;
  return (
    isSmtpAuthError(error) ||
    (error as any)?.name === 'OtpDeliveryError' ||
    /email|smtp|resend|gmail/i.test(String(error?.message || ''))
  );
};

/** Sends OTP; returns plaintext code in local mode (and dev fallback) for API hints. */
const deliverOtp = async (
  purpose: OtpPurpose,
  phone: string,
  user?: any,
  toEmail?: string
): Promise<string | undefined> => {
  const mode = getOtpDeliveryMode();

  if (mode === 'email') {
    const otp = generateLocalOtp();
    const email =
      toEmail ||
      (user ? await resolveOtpEmailForUser(user, phone) : null) ||
      String(user?.email || '').trim();
    if (!email) {
      throw new Error('No email on file for this account.');
    }
    try {
      await sendOtpViaEmail(email, purpose, otp);
      if (user) {
        await storeOtpOnUser(user, purpose, otp, false);
      }
      return undefined;
    } catch (error: any) {
      if (!shouldFallbackToLocalOtp(error)) throw error;
      console.warn('[auth] Email delivery unavailable; OTP stored locally (check server log).');
      if (user) {
        await storeOtpOnUser(user, purpose, otp, false);
      }
      logLocalOtp(purpose, phone, otp);
      return otp;
    }
  }

  if (mode === 'twilio') {
    const otp = generateLocalOtp();
    try {
      const method = await sendOtpViaTwilio(phone, purpose, otp);
      if (user) {
        await storeOtpOnUser(user, purpose, otp, method === 'verify');
      }
      return undefined;
    } catch (error: any) {
      if (!shouldFallbackToLocalOtp(error)) throw error;
      console.warn(
        '[auth] Twilio OTP unavailable in development; using local OTP (see server log / devOtp in API response).'
      );
    }
  }

  const otp = generateLocalOtp();
  if (user) {
    await storeOtpOnUser(user, purpose, otp, false);
  }
  logLocalOtp(purpose, phone, otp);
  return otp;
};

const attachDevOtp = (payload: Record<string, unknown>, devOtp?: string) => {
  // Never expose codes in production. In local/dev, surface fallback OTPs even when
  // OTP_DELIVERY=email (SMTP may be flaky; OTP_EMAIL_DEV_FALLBACK stores + returns the code).
  if (process.env.NODE_ENV === 'production') {
    return payload;
  }
  if (devOtp) {
    payload.devOtp = devOtp;
  }
  return payload;
};

const verifyDeliveredOtp = async (
  phone: string,
  otp: string,
  user: any,
  purpose: 'login' | 'password-reset'
): Promise<boolean> => {
  if (!isValidOtp(otp)) return false;

  const usesTwilioVerify =
    getOtpDeliveryMode() === 'twilio' &&
    (purpose === 'login' ? !user.otp : !user.resetToken);

  if (usesTwilioVerify) {
    return verifyOtpViaTwilio(phone, otp);
  }

  if (purpose === 'login') {
    if (user.otpExpiry && new Date(user.otpExpiry) < new Date()) {
      user.otp = null;
      user.otpExpiry = null;
      await user.save();
      return false;
    }
    return user.otp === hashOneTimeCode(otp);
  }

  if (user.resetTokenExpiry && new Date(user.resetTokenExpiry) < new Date()) {
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();
    return false;
  }
  return user.resetToken === hashOneTimeCode(otp);
};
const issueSession = async (user: any, deviceId?: string, deviceLabel?: string) =>
  issueUserSession(user, JWT_SECRET, deviceId, deviceLabel);

function respondDatabaseUnavailable(res: express.Response, error?: unknown) {
  const dbError = error instanceof Error ? error.message : error ? String(error) : 'Database not connected';
  const devHint =
    process.env.NODE_ENV !== 'production'
      ? ' Start XAMPP MySQL and unset MYSQL_URL / DB_SSL in this terminal if using local hcms_db.'
      : ' Verify MYSQL_URL and that your Aiven MySQL service is running.';
  return res.status(503).json({
    message: `Database unavailable.${devHint}`,
    code: 'DB_UNAVAILABLE',
    dbError,
  });
}

/** Re-probe core tables and heal readiness flags after a false-negative boot check. */
async function ensureDatabaseReadyForRequest(): Promise<boolean> {
  if (isDatabaseReady && isSchemaComplete) return true;
  try {
    await sequelize.authenticate();
    const { isCoreSchemaComplete, isMinimalAuthSchemaAvailable } = await import('./schemaHealth.js');
    if (await isCoreSchemaComplete(sequelize)) {
      const { markDatabaseSchemaHealthy } = await import('./db.js');
      markDatabaseSchemaHealthy();
      return true;
    }
    // Partial restore: `users` survived but HR tables were wiped — allow admin login + backup restore.
    if (await isMinimalAuthSchemaAvailable(sequelize)) {
      const { markDatabaseConnectionReady } = await import('./db.js');
      markDatabaseConnectionReady();
      return true;
    }
  } catch {
    /* still unavailable */
  }
  return false;
}

const HEALTH_CACHE_MS = 30_000;
let healthPayloadCache: { at: number; status: number; body: Record<string, unknown> } | null = null;

// Health check endpoint for Render (includes DB ping for deploy debugging)
router.get('/health', async (req, res) => {
  const verbose = String(req.query.verbose ?? '') === '1';
  if (!verbose && healthPayloadCache && Date.now() - healthPayloadCache.at < HEALTH_CACHE_MS) {
    return res.status(healthPayloadCache.status).json(healthPayloadCache.body);
  }

  let dbConnected = isDatabaseReady;
  let schemaComplete = isSchemaComplete;
  let dbError: string | undefined;
  let innodbOrphans: string[] | undefined;
  let missingCoreTables: string[] | undefined;
  let recoveryMode = false;
  if (!schemaComplete || !dbConnected) {
    try {
      await sequelize.authenticate();
      dbConnected = true;
      const {
        probeInnoDbEngineHealth,
        isCoreSchemaComplete,
        isMinimalAuthSchemaAvailable,
        listMissingCoreTables,
        INNODB_1932_RECOVERY_HINT,
      } = await import('./schemaHealth.js');
      const engine = await probeInnoDbEngineHealth(sequelize);
      if (!engine.ok) {
        dbConnected = false;
        schemaComplete = false;
        innodbOrphans = engine.orphanTables;
        dbError = INNODB_1932_RECOVERY_HINT;
      } else {
        schemaComplete = await isCoreSchemaComplete(sequelize);
        if (schemaComplete) {
          const { markDatabaseSchemaHealthy } = await import('./db.js');
          markDatabaseSchemaHealthy();
        } else {
          missingCoreTables = await listMissingCoreTables(sequelize);
          recoveryMode = await isMinimalAuthSchemaAvailable(sequelize);
          if (recoveryMode) {
            const { markDatabaseConnectionReady } = await import('./db.js');
            markDatabaseConnectionReady();
            dbError =
              missingCoreTables.length > 0
                ? `Core database tables are missing: ${missingCoreTables.join(', ')}. Sign in as admin and restore a backup to recover.`
                : 'Core database tables are missing. Sign in as admin and restore a backup to recover.';
          } else {
            dbConnected = false;
            dbError = missingCoreTables.length
              ? `Core database tables are missing: ${missingCoreTables.join(', ')}.`
              : 'Core database tables are missing. Run npm run db:setup from the project root.';
          }
        }
      }
    } catch (e) {
      dbConnected = false;
      schemaComplete = false;
      dbError = e instanceof Error ? e.message : String(e);
    }
  }
  let userCount: number | undefined;
  let employeeCount: number | undefined;
  let portalAccounts: Record<string, unknown> | undefined;
  if (schemaComplete) {
    try {
      userCount = await User.count();
      employeeCount = await Employee.count();
      const { getPortalAccountHealth } = await import('./employeeLoginAccountService.js');
      portalAccounts = await getPortalAccountHealth();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const { isOrphanEngineErrorMessage, INNODB_1932_RECOVERY_HINT } = await import('./schemaHealth.js');
      if (isOrphanEngineErrorMessage(msg)) {
        dbConnected = false;
        schemaComplete = false;
        dbError = INNODB_1932_RECOVERY_HINT;
      }
      /* counts optional otherwise */
    }
  }
  // Owners missing is a real ops problem; a few employees without portal logins is a warning only.
  const portalCritical =
    Boolean(portalAccounts) && portalAccounts.ownersPresent === false;
  const payload = {
    status: schemaComplete && dbConnected && !portalCritical ? 'ok' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    schemaComplete,
    recoveryMode,
    dbError,
    innodbOrphans,
    missingCoreTables,
    userCount,
    employeeCount,
    portalAccounts,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    // Render injects RENDER_GIT_COMMIT on deploy — use it to verify the live revision.
    gitCommit:
      process.env.RENDER_GIT_COMMIT ||
      process.env.GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      null,
    gitBranch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || null,
    deployStamp: '2026-08-07T14:15:00+07:00',
  };
  const status = dbConnected ? 200 : 503;
  // Only cache fully healthy responses — degraded must re-probe so login can recover after restore.
  if (!verbose && schemaComplete && dbConnected && !portalCritical) {
    healthPayloadCache = { at: Date.now(), status, body: payload };
  } else if (!dbConnected || !schemaComplete) {
    healthPayloadCache = null;
  }
  res.status(status).json(payload);
});

// Permission resolution is expensive - caching is critical
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
const permissionCache = new Map<string, { data: any, timestamp: number }>();
const settingsCache = new Map<string, { data: any, timestamp: number }>();

function getCache(cacheMap: Map<string, { data: any, timestamp: number }>, key: string) {
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCache(cacheMap: Map<string, { data: any, timestamp: number }>, key: string, data: any) {
  cacheMap.set(key, { data, timestamp: Date.now() });
}

// Invalidate cache when overrides change
function invalidateUserCache(userId: string) {
  // Clear user-specific caches
  permissionCache.delete(`user_permissions_${userId}`);
  permissionCache.delete(`user_effective_settings_${userId}`);
  // Clear all permission check caches for this user
  for (const key of permissionCache.keys()) {
    if (key.startsWith(`user_permission_check_${userId}_`)) {
      permissionCache.delete(key);
    }
  }
}

function invalidateGlobalCache() {
  // Clear all user caches (expensive but necessary for global changes)
  permissionCache.clear();
  settingsCache.clear();
}

// Simple in-memory cache
const cache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL_2 = 5 * 60 * 1000; // 5 minutes

function getCached(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_2) {
    return cached.data;
  }
  return null;
}

function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

function clearCachePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/** Departments list was cached in two layers; clear both after any department mutation. */
function invalidateDepartmentListCache() {
  clearCachePrefix('all_departments');
  httpResponseCache.clearMatching('/departments');
}

/** Leave list uses HTTP response cache — drop after create/status/cancel/resubmit. */
function invalidateLeaveListCache() {
  httpResponseCache.clearMatching('/leaves');
  clearCachePrefix('report_stats');
}

/** Overtime list HTTP cache. */
function invalidateOvertimeListCache() {
  httpResponseCache.clearMatching('/overtime');
}

// Auth middleware (exported for app-level routes if needed)
export const authMiddleware = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      const headerDeviceId = req.headers['x-device-id'];
      const resolved = await resolvePortalSession(
        decoded,
        typeof headerDeviceId === 'string' ? headerDeviceId : Array.isArray(headerDeviceId) ? headerDeviceId[0] : null
      );
      if (resolved) {
        (req as any).user = resolved.user;
        (req as any).deviceSession = resolved.deviceSession;
        (req as any).sessionDeviceId = resolved.deviceId;
        (req as any).sessionToken = resolved.sessionToken;
      }
    } catch {
      // Invalid or expired JWT
    }
  }
  next();
};

router.use(authMiddleware);

function maskEmployeeLoginId(id: string): string {
  const s = String(id || '').trim().toUpperCase();
  if (s.length <= 4) return s;
  return `${s.slice(0, 2)}${'*'.repeat(Math.min(6, s.length - 4))}${s.slice(-2)}`;
}

/** Resolve portal user from Employee ID body field (employeeId / loginId). */
async function resolveAuthPrincipalFromBody(body: {
  employeeId?: unknown;
  loginId?: unknown;
}): Promise<{ employeeLoginId: string; user: any | null; phone: string }> {
  const employeeLoginId = normalizeEmployeeLoginId(body.employeeId ?? body.loginId);
  if (employeeLoginId.length < 3) {
    return { employeeLoginId: '', user: null, phone: '' };
  }
  const user = await findUserByEmployeeLoginId(employeeLoginId);
  if (!user) return { employeeLoginId, user: null, phone: '' };
  const phone = await resolveAuthPhoneForUser(user);
  return { employeeLoginId, user, phone };
}

/** OTP delivery key: real phone when available, else stable Employee ID token. */
function otpDeliveryKey(phone: string, employeeLoginId: string): string {
  return phone || `id:${employeeLoginId}`;
}

// Auth - Password Login
router.post('/auth/login', loginAuthLimiter, async (req, res) => {
  const password = String(req.body.password || '');
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  const deviceCtx = buildAuthDeviceContext(req, {
    deviceId: req.body.deviceId,
    deviceLabel: req.body.deviceLabel,
    userAgent: req.body.userAgent,
  });

  if (!employeeLoginId || employeeLoginId.length < 3 || !password) {
    return res.status(400).json({ message: 'Employee ID and password are required' });
  }

  try {
    if (!(await ensureDatabaseReadyForRequest())) {
      return respondDatabaseUnavailable(res, 'Database schema is not ready');
    }
    const { user } = await resolveAuthPrincipalFromBody(req.body);
    if (!user?.password) {
      await writeAuditLog({
        entityType: 'auth_login',
        action: 'LOGIN_FAILURE',
        performedBy: 'anonymous',
        reason: 'Invalid Employee ID or password',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        }),
      });
      return res.status(401).json({ message: 'Invalid Employee ID or password' });
    }
    if (!isUserActive(user)) {
      await writeAuditLog({
        entityType: 'auth_login',
        entityId: String(user.id),
        action: 'LOGIN_FAILURE',
        performedBy: String(user.id),
        reason: 'Account inactive',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        }),
      });
      return res.status(403).json({ message: 'This account is inactive' });
    }

    const {
      ensureLoginLockoutColumns,
      getLoginLockState,
      recordFailedPasswordLogin,
      clearLoginLockout,
      formatLockoutMessage,
    } = await import('./loginLockout.js');
    await ensureLoginLockoutColumns();
    const lockState = await getLoginLockState(user);
    if (lockState.locked) {
      await writeAuditLog({
        entityType: 'auth_login',
        entityId: String(user.id),
        action: 'LOGIN_FAILURE',
        performedBy: String(user.id),
        reason: 'Account locked',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
          lockedUntil: lockState.lockedUntil?.toISOString() ?? null,
        }),
      });
      return res.status(423).json({
        message: formatLockoutMessage(lockState.remainingMs),
        code: 'ACCOUNT_LOCKED',
        lockedUntil: lockState.lockedUntil?.toISOString() ?? null,
      });
    }

    const linkedEmp = await findEmployeeForUser(user.get({ plain: true }));
    if (linkedEmp) {
      const empStatus = linkedEmp.get('status');
      if (isEmployeeInactiveForPortal(empStatus) || isEmployeeDraftStatus(empStatus)) {
        return res.status(403).json({
          message: isEmployeeDraftStatus(empStatus)
            ? 'This employee is still a draft and cannot sign in until activated'
            : 'This account is inactive',
        });
      }
      if (!isEmployeeAllowedSystemAccess(empStatus)) {
        return res.status(403).json({ message: 'This account is inactive' });
      }
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const afterFail = await recordFailedPasswordLogin(user);
      await writeAuditLog({
        entityType: 'auth_login',
        entityId: String(user.id),
        action: 'LOGIN_FAILURE',
        performedBy: String(user.id),
        reason: afterFail.locked ? 'Invalid password — account locked' : 'Invalid password',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
          failedAttempts: afterFail.failedAttempts,
          lockedUntil: afterFail.lockedUntil?.toISOString() ?? null,
        }),
      });
      if (afterFail.locked) {
        return res.status(423).json({
          message: formatLockoutMessage(afterFail.remainingMs),
          code: 'ACCOUNT_LOCKED',
          lockedUntil: afterFail.lockedUntil?.toISOString() ?? null,
        });
      }
      return res.status(401).json({ message: 'Invalid Employee ID or password' });
    }

    const { portalPasswordLength, shouldSyncPasswordLength } = await import(
      './portalPasswordLength.js'
    );
    if (shouldSyncPasswordLength(user.passwordLength, password)) {
      user.passwordLength = portalPasswordLength(password);
      try {
        await user.save({ fields: ['passwordLength'] });
      } catch {
        /* column may be pending migrate on older processes */
      }
    }

    await clearLoginLockout(user);

    const [knownDevice, existingDeviceCount] = deviceCtx.deviceId
      ? await Promise.all([
          UserDeviceSession.findOne({
            where: { userId: String(user.id), deviceId: deviceCtx.deviceId },
            attributes: ['id'],
          }),
          UserDeviceSession.count({ where: { userId: String(user.id) } }),
        ])
      : [null, 0];
    const issued = await issueSession(user, deviceCtx.deviceId, deviceCtx.deviceLabel);
    if (deviceCtx.deviceId && !knownDevice && existingDeviceCount > 0) {
      const { notifyAccountEvent } = await import('./notificationService.js');
      void notifyAccountEvent({
        userId: String(user.id),
        event: 'NEW_DEVICE',
        detail: deviceCtx.deviceLabel || 'a new device',
        eventKey: deviceCtx.deviceId,
      }).catch(() => undefined);
    }
    await writeAuditLog({
      entityType: 'auth_login',
      entityId: String(user.id),
      action: 'LOGIN_SUCCESS',
      performedBy: String(user.id),
      reason: 'Password login successful',
      metadata: deviceContextToAuditMetadata(deviceCtx, {
        employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        deviceId: issued.deviceId || deviceCtx.deviceId || null,
        devicesEvicted: issued.devicesEvicted || 0,
      }),
    });
    res.json({ ...issued, deviceLabel: deviceCtx.deviceLabel });
  } catch (error) {
    console.error('Error during login:', error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    if (!isSchemaComplete || isDatabaseSchemaError(error)) {
      return res.status(503).json({
        message:
          'Database setup is incomplete. From the project root run: npm run db:setup (XAMPP MySQL must be running), then restart the API.',
        code: 'DB_SCHEMA_MISMATCH',
      });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Auth - Resolved portal password policy (public; needed for reset / first-login UI)
router.get('/auth/password-policy', async (_req, res) => {
  try {
    const { loadPortalPasswordPolicy } = await import('./securityPasswordPolicy.js');
    const policy = await loadPortalPasswordPolicy();
    res.json({ policy });
  } catch (error) {
    console.error('[auth] password-policy error:', (error as Error)?.message || error);
    res.json({
      policy: {
        minLength: 12,
        maxLength: 128,
        requireLower: true,
        requireUpper: true,
        requireDigit: true,
        requireSpecial: true,
      },
    });
  }
});

// Auth - OTP delivery mode (for debugging / frontend hints)
router.get('/auth/otp-config', (_req, res) => {
  try {
    const mode = getOtpDeliveryMode();
    res.json({
      mode,
      smsEnabled: mode === 'twilio',
      emailEnabled: mode === 'email',
      emailConfigured: isEmailConfigured(),
      emailDevFallback: isEmailDevFallbackEnabled(),
      providers: getOtpEmailStatus(),
      expiresInSeconds: OTP_EXPIRY_SECONDS,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (error: any) {
    console.error('[auth] otp-config setup error:', error?.message || error);
    res.json({
      mode: 'email',
      smsEnabled: false,
      emailEnabled: true,
      emailConfigured: false,
      emailDevFallback: isEmailDevFallbackEnabled(),
      providers: getOtpEmailStatus(),
      expiresInSeconds: OTP_EXPIRY_SECONDS,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
      // Operator hint names internal files/endpoints — keep it out of anonymous production responses.
      ...(process.env.NODE_ENV === 'production' ? {} : { setupError: error?.message }),
    });
  }
});

// Auth - Look up masked email for an Employee ID (OTP login step before sending code)
router.post('/auth/otp-email-preview', async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  if (employeeLoginId.length < 3) {
    return res.status(400).json({ message: 'Employee ID is required' });
  }
  try {
    const { user, phone } = await resolveAuthPrincipalFromBody(req.body);
    if (!user || !isUserActive(user)) {
      return res.status(404).json({ message: 'No active account found for this Employee ID.' });
    }
    const email = await resolveOtpEmailForUser(user, phone);
    if (!email) {
      return res.status(404).json({ message: 'No email on file for this account.' });
    }
    res.json({ maskedEmail: maskEmail(email), emailDelivery: getOtpDeliveryMode() === 'email' });
  } catch (error: any) {
    console.error('Error in OTP email preview:', error?.message || error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    res.status(500).json({ message: 'Unable to look up account. Please try again later.' });
  }
});

// Auth - Request OTP
router.post('/auth/request-otp', loginAuthLimiter, async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  if (employeeLoginId.length < 3) {
    return res.status(400).json({ message: 'Employee ID is required' });
  }
  try {
    const { user, phone } = await resolveAuthPrincipalFromBody(req.body);
    if (!user || !isUserActive(user)) {
      return res.status(404).json({ message: 'No active account found for this Employee ID.' });
    }

    const email = await resolveOtpEmailForUser(user, phone);
    if (!email) {
      return res.status(404).json({ message: 'No email on file for this account.' });
    }

    const maskedEmail = maskEmail(email);
    const deliveryPhone = otpDeliveryKey(phone, employeeLoginId);
    const devOtp = await deliverOtp('login', deliveryPhone, user, email);

    res.json(
      attachDevOtp(
        {
          message:
            getOtpDeliveryMode() === 'email'
              ? 'An OTP has been sent to your registered email.'
              : 'If the account exists, an OTP has been sent.',
          maskedEmail,
          emailSent: getOtpDeliveryMode() === 'email',
          expiresInSeconds: OTP_EXPIRY_SECONDS.login,
          expiresInMinutes: OTP_EXPIRY_MINUTES.login,
        },
        devOtp
      )
    );
  } catch (error: any) {
    console.error('Error requesting OTP:', error?.message || error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    if (isEmailDeliveryFailure(error)) {
      return respondEmailDeliveryUnavailable(res, error, 'request-otp');
    }
    const hint =
      error?.code === '60203' ||
      error?.code === '21608' ||
      error?.code === '21614' ||
      String(error?.message || '').includes('unverified')
        ? 'Add this phone as a Verified Caller ID: https://console.twilio.com/us1/develop/phone-numbers/manage/verified'
        : error?.code === '60605' || String(error?.message || '').includes('Geo-Permissions')
          ? 'Enable Cambodia (KH) under Twilio Verify Geo permissions, or use direct SMS after verifying the phone.'
          : error?.code === '63038' || String(error?.message || '').includes('daily messages limit')
            ? 'Twilio trial allows 5 SMS per day. Wait until tomorrow or upgrade at twilio.com.'
            : undefined;
    res.status(500).json({
      message: error?.message || 'Unable to send OTP. Please try again later.',
      ...(hint ? { hint } : {}),
    });
  }
});

// Auth - Verify OTP
router.post('/auth/verify-otp', loginAuthLimiter, async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  const otp = String(req.body.otp || '').trim();
  const deviceCtx = buildAuthDeviceContext(req, {
    deviceId: req.body.deviceId,
    deviceLabel: req.body.deviceLabel,
    userAgent: req.body.userAgent,
  });
  if (employeeLoginId.length < 3 || !otp) {
    return res.status(400).json({ message: 'Employee ID and OTP are required' });
  }
  try {
    const { user, phone } = await resolveAuthPrincipalFromBody(req.body);
    const deliveryPhone = otpDeliveryKey(phone, employeeLoginId);
    if (!user || !isUserActive(user)) {
      await writeAuditLog({
        entityType: 'auth_login',
        action: 'OTP_FAILURE',
        performedBy: 'anonymous',
        reason: 'Invalid OTP principal',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        }),
      });
      return res.status(401).json({ message: 'Invalid OTP' });
    }

    const valid = await verifyDeliveredOtp(deliveryPhone, otp, user, 'login');
    if (!valid) {
      await writeAuditLog({
        entityType: 'auth_login',
        entityId: String(user.id),
        action: 'OTP_FAILURE',
        performedBy: String(user.id),
        reason: 'Invalid OTP code',
        metadata: deviceContextToAuditMetadata(deviceCtx, {
          employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        }),
      });
      return res.status(401).json({ message: 'Invalid OTP' });
    }

    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    const { clearLoginLockout } = await import('./loginLockout.js');
    await clearLoginLockout(user);

    const issued = await issueSession(user, deviceCtx.deviceId, deviceCtx.deviceLabel);
    await writeAuditLog({
      entityType: 'auth_login',
      entityId: String(user.id),
      action: 'OTP_SUCCESS',
      performedBy: String(user.id),
      reason: 'OTP verified and session issued',
      metadata: deviceContextToAuditMetadata(deviceCtx, {
        employeeIdMasked: maskEmployeeLoginId(employeeLoginId),
        deviceId: issued.deviceId || deviceCtx.deviceId || null,
        devicesEvicted: issued.devicesEvicted || 0,
        loginMethod: 'otp',
      }),
    });
    res.json({ ...issued, deviceLabel: deviceCtx.deviceLabel });
  } catch (error: any) {
    console.error('Error verifying OTP:', error?.message || error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Auth - Forgot Password
router.post('/auth/forgot-password', loginAuthLimiter, async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  if (employeeLoginId.length < 3) {
    return res.status(400).json({ message: 'Employee ID is required' });
  }
  try {
    await preparePasswordResetStorage();
    const { user, phone } = await resolveAuthPrincipalFromBody(req.body);
    if (!user || !isUserActive(user)) {
      return res.status(404).json({ message: 'No active account found for this Employee ID.' });
    }

    const email = await resolveOtpEmailForUser(user, phone);
    if (!email) {
      return res.status(404).json({ message: 'No email on file for this account.' });
    }

    const maskedEmail = maskEmail(email);
    clearResetPasswordVerification(user);
    const deliveryPhone = otpDeliveryKey(phone, employeeLoginId);
    const devOtp = await deliverOtp('password-reset', deliveryPhone, user, email);
    await user.save({ fields: ['resetPasswordVerifiedAt'] });

    res.json(
      attachDevOtp(
        {
          message:
            getOtpDeliveryMode() === 'email'
              ? 'A password reset code has been sent to your registered email.'
              : 'If the account exists, a password reset OTP has been sent.',
          maskedEmail,
          emailSent: getOtpDeliveryMode() === 'email',
          expiresInSeconds: OTP_EXPIRY_SECONDS.passwordReset,
          expiresInMinutes: OTP_EXPIRY_MINUTES.passwordReset,
        },
        devOtp
      )
    );
  } catch (error: any) {
    console.error('Error in forgot password:', error?.message || error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    if (isEmailDeliveryFailure(error)) {
      return respondEmailDeliveryUnavailable(res, error, 'forgot-password');
    }
    res.status(500).json({
      message: 'Unable to send OTP. Please try again later.',
    });
  }
});

// Auth - Verify reset OTP (must succeed before setting a new password)
router.post('/auth/verify-reset-otp', loginAuthLimiter, async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  const otp = String(req.body.otp || '').trim();

  if (employeeLoginId.length < 3) {
    return res.status(400).json({ message: 'Employee ID is required' });
  }
  if (!isValidOtp(otp)) {
    return res.status(400).json({ message: 'Enter the verification code from your email.' });
  }

  try {
    await preparePasswordResetStorage();
    const { user, phone } = await resolveAuthPrincipalFromBody(req.body);
    const deliveryPhone = otpDeliveryKey(phone, employeeLoginId);
    if (!user || !isUserActive(user)) {
      return res.status(401).json({ message: 'Invalid or expired verification code.' });
    }

    if (await isResetPasswordVerified(user)) {
      return res.json({
        message: 'Email verified. You can set a new password.',
        resetPasswordReady: true,
      });
    }

    const valid = await verifyDeliveredOtp(deliveryPhone, otp, user, 'password-reset');
    if (!valid) {
      return res.status(401).json({ message: 'Invalid or expired verification code.' });
    }

    user.resetToken = null;
    user.resetTokenExpiry = null;
    markResetPasswordVerified(user);
    await user.save({
      fields: ['resetToken', 'resetTokenExpiry', 'resetPasswordVerifiedAt'],
    });

    res.json({
      message: 'Email verified. You can set a new password.',
      resetPasswordReady: true,
    });
  } catch (error: any) {
    console.error('Error verifying reset OTP:', error?.message || error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Auth - Reset Password (requires prior OTP verification)
router.post('/auth/reset-password', loginAuthLimiter, async (req, res) => {
  const employeeLoginId = normalizeEmployeeLoginId(req.body.employeeId ?? req.body.loginId);
  const newPassword = String(req.body.newPassword || '');

  if (employeeLoginId.length < 3) {
    return res.status(400).json({ message: 'Employee ID is required' });
  }
  if (await rejectInvalidPortalPassword(res, newPassword)) return;

  try {
    await preparePasswordResetStorage();
    const { user } = await resolveAuthPrincipalFromBody(req.body);
    if (!user || !isUserActive(user)) {
      return res.status(403).json({
        message: 'Verify your email code before setting a new password.',
        resetPasswordReady: false,
      });
    }

    if (!(await isResetPasswordVerified(user))) {
      return res.status(403).json({
        message: 'Verify your email code before setting a new password.',
        resetPasswordReady: false,
      });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetToken = null;
    user.resetTokenExpiry = null;
    clearResetPasswordVerification(user);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.passwordLength = String(newPassword).length;
    await revokeAllDeviceSessions(user.id, user);
    await user.save({
      fields: [
        'password',
        'passwordLength',
        'resetToken',
        'resetTokenExpiry',
        'resetPasswordVerifiedAt',
        'passwordChangedAt',
        'mustChangePassword',
      ],
    });
    const { notifyAccountEvent } = await import('./notificationService.js');
    void notifyAccountEvent({
      userId: String(user.id),
      event: 'PASSWORD_RESET',
      eventKey: new Date(user.passwordChangedAt || Date.now()).getTime().toString(36),
    }).catch(() => undefined);

    res.json({ message: 'Password reset successfully' });
  } catch (error: any) {
    console.error('Error resetting password:', error?.message || error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Public payroll FX read — used by currency display before / during session bootstrap. */
router.get('/public/payroll/exchange-rate', async (_req, res) => {
  try {
    const { getPayrollExchangeRateDetails } = await import('./payrollExchangeRateService.js');
    const details = await getPayrollExchangeRateDetails();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(details);
  } catch (error) {
    console.error('Error fetching public payroll exchange rate:', error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    // Never block login/bootstrap on FX — return default rate.
    const {
      DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD,
      dependentAllowanceUsdAtRate,
    } = await import('./payrollExchangeRateService.js');
    const { GDT_DEPENDENT_DEDUCTION_KHR } = await import('./cambodiaSalaryTax.js');
    const rate = DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD;
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      exchangeRateKhrPerUsd: rate,
      latestExchangeRateKhrPerUsd: rate,
      dependentAllowanceUsd: dependentAllowanceUsdAtRate(rate),
      dependentAllowanceKhr: GDT_DEPENDENT_DEDUCTION_KHR,
      isConfigured: false,
      effectiveFrom: null,
      scheduledEffectiveFrom: null,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Public branding for login landing (no auth). */
const PORTAL_BRANDING_CACHE_KEY = 'portal_branding_public';
router.get('/public/portal-branding', async (_req, res) => {
  try {
    const cached = getCached(PORTAL_BRANDING_CACHE_KEY);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }
    const { loadPortalBrandingPublic } = await import('./organizationSettingsService.js');
    const branding = await loadPortalBrandingPublic();
    setCached(PORTAL_BRANDING_CACHE_KEY, branding);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(branding);
  } catch (error) {
    console.error('Error loading portal branding:', error);
    // Never block the login page — fall back to empty branding.
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      logo: '',
      frontCover: '',
      companyName: 'ROC',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Public staff verification for ID-card QR scans.
 * Returns workplace identity only (no phone/email/salary).
 */
router.get('/public/employees/:employeeId/verify', async (req, res) => {
  try {
    const { loadStaffVerifyPublic } = await import('./staffVerifyPublicService.js');
    const payload = await loadStaffVerifyPublic(String(req.params.employeeId ?? ''));
    if (!payload) {
      return res.status(404).json({
        message: 'Staff member not found',
        verified: false,
      });
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json(payload);
  } catch (error) {
    console.error('Error loading public staff verify:', error);
    if (!isDatabaseReady || isDatabaseConnectionError(error)) {
      return respondDatabaseUnavailable(res, error);
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Auth - Change Password
router.post('/auth/change-password', async (req, res) => {
  const currentUser = (req as any).user;
  if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });

  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || !String(newPassword).trim()) {
    return res.status(400).json({ message: 'New password is required' });
  }
  if (await rejectInvalidPortalPassword(res, String(newPassword))) return;

  try {
    const user: any = await User.findByPk(currentUser.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.password) {
      return res.status(400).json({ message: 'Password login is not enabled for this user' });
    }

    // Prefer live DB flag (JWT/session can lag after admin reset).
    const forceChange = Boolean(user.mustChangePassword);
    const current = currentPassword != null ? String(currentPassword) : '';
    if (!forceChange) {
      if (!current) {
        return res.status(400).json({
          message: req.body?.forceChange
            ? 'Your password was already updated. Sign in again if you still see the password prompt.'
            : 'Current password and new password are required',
        });
      }
      const isMatch = await bcrypt.compare(current, user.password);
      if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
    } else if (current) {
      const isMatch = await bcrypt.compare(current, user.password);
      if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const sameAsCurrent = await bcrypt.compare(String(newPassword), user.password);
    if (sameAsCurrent) {
      return res.status(400).json({
        message: forceChange
          ? 'Choose a new password that is different from the temporary default password'
          : 'New password must be different from your current password',
      });
    }

    // Keep this browser signed in; only kick other devices.
    const keepSessionToken = String(
      (req as any).sessionToken ??
        (req as any).deviceSession?.sessionToken ??
        (req as any).deviceSession?.get?.('sessionToken') ??
        user.sessionToken ??
        ''
    ).trim();

    user.password = await bcrypt.hash(String(newPassword), 12);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.passwordLength = String(newPassword).length;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    if (keepSessionToken) {
      // Destroys other device rows; keeps keepSessionToken and sets user.sessionToken.
      await revokeOtherDeviceSessions(user.id, keepSessionToken, null);
      user.sessionToken = keepSessionToken;
    }
    await user.save();

    res.json({
      message: 'Password changed successfully',
      sessionKept: Boolean(keepSessionToken),
      mustChangePassword: false,
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Auth - Get current user (enriched with linked Employee for avatar / department display)
router.get('/user', async (req, res) => {
  const currentUser = (req as any).user;
  if (!currentUser) {
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    let code: string = hasBearer ? 'SESSION_EXPIRED' : 'NOT_AUTHENTICATED';
    let message = hasBearer
      ? 'Your session has expired after 7 days of inactivity. Please sign in again.'
      : 'Not authenticated';
    if (hasBearer) {
      try {
        const token = req.headers.authorization!.substring(7);
        const decoded: any = jwt.verify(token, JWT_SECRET);
        const reason = await explainSessionRejection(decoded);
        if (reason === 'ACCOUNT_DISABLED') {
          code = 'ACCOUNT_DISABLED';
          message = 'This account is inactive or frozen. Please contact an administrator.';
        } else if (reason === 'DEVICE_LIMIT') {
          code = 'DEVICE_LIMIT';
          message =
            'This device was signed out because your account is already active on other devices. Only 2 devices can be signed in at once.';
        } else if (reason === 'SESSION_EXPIRED') {
          code = 'SESSION_EXPIRED';
          message =
            'Your session has expired after 7 days of inactivity. Please sign in again.';
        }
      } catch {
        /* invalid JWT */
      }
    }
    return res.status(401).json({ message, code });
  }
  try {
    const fresh: any = await User.findByPk(currentUser.id);
    if (!fresh) return res.status(404).json({ message: 'User not found' });
    const plain = fresh.get({ plain: true });
    const linkedEmployee = await findEmployeeForUser(plain);
    if (linkedEmployee) {
      const empPlain = linkedEmployee.toJSON ? linkedEmployee.toJSON() : linkedEmployee;
      const empEmail = String(empPlain.email ?? '').trim();
      const userEmail = String(plain.email ?? '').trim();
      if (
        empEmail &&
        !isPlaceholderDraftEmail(empEmail) &&
        empEmail.toLowerCase() !== userEmail.toLowerCase()
      ) {
        await syncPortalEmailFromEmployee(String(empPlain.id), empEmail);
        await fresh.reload();
        clearCachePrefix('all_users');
      }
    }
    const safe = stripUserSecrets(fresh);
    res.json(await serializeUserForClient(safe));
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/user/preferences', async (req, res) => {
  const currentUser = (req as any).user;
  if (!currentUser) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const raw = String(req.body?.preferredCurrency ?? req.body?.preferred_currency ?? '')
      .trim()
      .toUpperCase();
    if (raw !== 'KHR' && raw !== 'USD') {
      return res.status(400).json({ message: 'preferredCurrency must be KHR or USD' });
    }
    await User.update({ preferred_currency: raw }, { where: { id: String(currentUser.id) } });
    const fresh: any = await User.findByPk(currentUser.id);
    if (!fresh) return res.status(404).json({ message: 'User not found' });
    res.json(await serializeUserForClient(stripUserSecrets(fresh)));
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Role catalog for filters & HR UI — requires Bearer session (same rule as GET /user). */
router.get('/roles', cacheMiddleware(10 * 60 * 1000), async (_req, res) => {
  const currentUser = (_req as any).user;
  if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const { listFixedSystemRoles } = await import('./fixedSystemRoles.js');
    res.json(listFixedSystemRoles());
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

mountV40AuthRoutes(router, {
  jwtSecret: JWT_SECRET,
  adminOnly: ((_req, _res, next) => next()) as express.RequestHandler,
  hrAccess: ((_req, _res, next) => next()) as express.RequestHandler,
  adminOrHr: ((_req, _res, next) => next()) as express.RequestHandler,
  hrManagerAccess: ((_req, _res, next) => next()) as express.RequestHandler,
});

function respondSchemaIncomplete(res: express.Response) {
  return res.status(503).json({
    message:
      'Core HR tables are missing or empty after a failed restore. Open Settings → Backup and restore backup_2026_08_07_032231.repaired.sql to recover your data.',
    code: 'SCHEMA_INCOMPLETE',
    recoveryMode: true,
  });
}

function isSchemaRecoveryExemptPath(apiPath: string): boolean {
  const p = String(apiPath || '').split('?')[0];
  return (
    p.startsWith('/auth') ||
    p === '/user' ||
    p === '/user/preferences' ||
    p === '/roles' ||
    p.startsWith('/settings/backup') ||
    p.startsWith('/health')
  );
}

/** When schema is still incomplete, stop HR APIs from throwing 500 on missing tables. */
router.use((req, res, next) => {
  if (isSchemaComplete) return next();
  if (!isDatabaseReady) return next();
  if (isSchemaRecoveryExemptPath(req.path)) return next();
  return respondSchemaIncomplete(res);
});

// Auth - Require Authentication Middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!(req as any).user) {
    return res.status(401).json({ message: 'Unauthorized access: Please login' });
  }
  next();
};

const requireRole = (roles: string | string[]) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const currentUser = (req as any).user;
    if (!currentUser) {
      return res.status(401).json({ message: 'Unauthorized access: Please login' });
    }
    const role = String(currentUser.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || allowedRoles.includes(role)) {
      return next();
    }
    return res.status(403).json({ message: 'Forbidden: insufficient role permissions' });
  };
};

/**
 * Traditional role gate, with matrix/override fallthrough.
 * Non-matching roles may still pass when they hold any of the listed effective permissions —
 * so Grant/override never dead-ends behind a hard role check (previous Forbidden cases).
 */
const requireRoleOrPermission =
  (roles: string | string[], ...permKeys: string[]) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const currentUser = (req as any).user;
    if (!currentUser?.id) {
      return res.status(401).json({ message: 'Unauthorized access: Please login' });
    }
    const role = String(currentUser.role || '').toUpperCase();
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || allowedRoles.includes(role)) {
      return next();
    }
    if (permKeys.length === 0) {
      return res.status(403).json({ message: 'Forbidden: insufficient role permissions' });
    }
    return requireEffectivePermission(...permKeys)(req, res, next);
  };

/** Keys historically reachable via HR-only route gates. */
const HR_FEATURE_PERMISSION_KEYS = [
  'hr.employee.view',
  'hr.employee.create',
  'hr.employee.edit.personal',
  'hr.employee.edit.financial',
  'hr.employee.edit.work',
  'hr.employee.terminate',
  'hr.employee.restore',
  'hr.employee.offboard',
  'hr.employee.movements',
  'hr.payroll.view',
  'hr.payroll.process',
  'hr.payroll.approve',
  'hr.payroll.edit',
  'payroll.rules.view',
  'payroll.rules.edit',
  'payroll.calendar.view',
  'payroll.calendar.edit',
  'leave.view',
  'leave.edit',
  'leave.approve',
  'overtime.view',
  'overtime.manage',
  'overtime.config',
  'attendance.view',
  'attendance.manage',
  'reports.view',
  'performance.view',
  'performance.manage',
  'performance.appraisal.view',
  'performance.appraisal.manage',
  'departments.view',
  'departments.manage',
  'company.structure.view',
  'company.structure.manage',
] as const;

/** Keys historically reachable via HR/Manager route gates. */
const HR_MANAGER_FEATURE_PERMISSION_KEYS = [
  ...HR_FEATURE_PERMISSION_KEYS,
  'projects.view',
  'projects.create',
  'tasks.create',
  'tasks.assign',
] as const;

const adminOnly = requireRoleOrPermission(
  'ADMIN',
  'users.manage',
  'settings.edit',
  'permissions.manage',
  'audit.manage'
);
const adminOrHr = requireRoleOrPermission(
  ['ADMIN', 'HR'],
  'hr.payroll.view',
  'hr.payroll.process',
  'attendance.manage',
  'users.manage',
  ...HR_FEATURE_PERMISSION_KEYS
);
const hrManagerAccess = requireRoleOrPermission(
  ['HR', 'MANAGER'],
  ...HR_MANAGER_FEATURE_PERMISSION_KEYS
);
const hrAccess = requireRoleOrPermission('HR', ...HR_FEATURE_PERMISSION_KEYS);
const managerAccess = requireRoleOrPermission(
  'MANAGER',
  'projects.view',
  'tasks.create',
  'leave.approve',
  'overtime.manage',
  'performance.manage',
  'hr.employee.view'
);

/** GET/HEAD → viewKey; mutating methods → manageKey (matrix Grant/Deny). */
const requireViewOrManagePermission =
  (viewKey: string, manageKey: string) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
    return requireEffectivePermission(mutating ? manageKey : viewKey)(req, res, next);
  };

const AUDIT_SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
  'pin',
  'oldPin',
  'newPin',
  'resetToken',
]);

function redactAuditValue(input: unknown, depth = 0): unknown {
  if (input == null) return input;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(input)) return input.slice(0, 50).map((entry) => redactAuditValue(entry, depth + 1));
  if (typeof input !== 'object') {
    if (typeof input === 'string' && input.length > 400) return `${input.slice(0, 400)}...`;
    return input;
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (AUDIT_SENSITIVE_KEYS.has(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactAuditValue(value, depth + 1);
    }
  }
  return out;
}

function inferAuditAction(req: express.Request): string {
  const method = req.method.toUpperCase();
  if (method === 'POST') return 'CREATE';
  if (method === 'DELETE') return 'DELETE';
  if (method === 'PUT' || method === 'PATCH') {
    const pathLower = req.path.toLowerCase();
    const body = (req.body || {}) as Record<string, unknown>;
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const hasProgress = Object.prototype.hasOwnProperty.call(body, 'progress');
    const hasAssignee = Object.prototype.hasOwnProperty.call(body, 'assigneeId');
    const resource = inferEntityType(req.path);
    if (resource === 'tasks') {
      // Prefer the most specific task activity track when the client sends a full task body.
      // Only treat as handover when the client explicitly provided the prior assignee.
      const hasPreviousAssignee = Object.prototype.hasOwnProperty.call(body, 'previousAssigneeId');
      if (
        hasAssignee &&
        hasPreviousAssignee &&
        String(body.assigneeId ?? '') !== String(body.previousAssigneeId ?? '')
      ) {
        return 'HANDED_OVER';
      }
      const hasPreviousProgress = Object.prototype.hasOwnProperty.call(body, 'previousProgress');
      const progressChanged =
        hasProgress &&
        hasPreviousProgress &&
        Number(body.progress) !== Number(body.previousProgress);
      const hasPreviousStatus = Object.prototype.hasOwnProperty.call(body, 'previousStatus');
      const statusChanged =
        hasStatus &&
        (!hasPreviousStatus || String(body.status ?? '') !== String(body.previousStatus ?? ''));
      if (progressChanged && !statusChanged) return 'PROGRESS_UPDATED';
      if (pathLower.includes('/status') || statusChanged) return 'STATUS_CHANGE';
      if (hasProgress) return 'PROGRESS_UPDATED';
      return 'UPDATE';
    }
    if (pathLower.includes('/status') || hasStatus) return 'STATUS_CHANGE';
    return 'UPDATE';
  }
  return method;
}

function inferEntityType(pathname: string): string {
  const clean = pathname.replace(/^\/+/, '');
  const first = clean.split('/')[0] || 'unknown';
  return first.toLowerCase();
}

/**
 * Skip high-volume / dual-logged routes:
 * - /chat: noisy operational traffic
 * - /tasks: domain audits in taskActivityService already write accurate
 *   CREATED / STATUS_CHANGED / PROGRESS_UPDATED / HANDED_OVER / DELETED rows
 *   (HTTP middleware only sees the full task body and mis-tags tracks).
 */
const MUTATION_AUDIT_SKIP_PATH_PREFIXES = ['/chat', '/tasks'];

function shouldSkipMutationAudit(req: express.Request): boolean {
  const path = String(req.path || '').toLowerCase();
  return MUTATION_AUDIT_SKIP_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

async function writeAuditLog(payload: {
  entityType: string;
  entityId?: string | null;
  action: string;
  performedBy: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  metadata?: unknown;
}) {
  await AuditLog.create({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entityType: payload.entityType,
    entityId: payload.entityId ?? null,
    action: payload.action,
    oldValue: payload.oldValue,
    newValue: payload.newValue,
    performedBy: payload.performedBy,
    reason: payload.reason,
    metadata: payload.metadata,
  } as any);
}

const mutationAuditMiddleware: express.RequestHandler = (req, res, next) => {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  if (req.path.startsWith('/audit')) return next();
  if (shouldSkipMutationAudit(req)) return next();

  const currentUser = (req as any).user;
  if (!currentUser?.id) return next();

  const startedAt = Date.now();
  let responsePayload: unknown;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = ((body: unknown) => {
    responsePayload = body;
    return originalJson(body);
  }) as typeof res.json;

  res.send = ((body: unknown) => {
    responsePayload = body;
    return originalSend(body as any);
  }) as typeof res.send;

  res.on('finish', () => {
    const statusCode = res.statusCode;
    if (statusCode < 200 || statusCode >= 400) return;

    const body = (req.body || {}) as Record<string, unknown>;
    const entityId =
      String(req.params?.id || '') ||
      (typeof body.id === 'string' ? body.id : '') ||
      (responsePayload && typeof responsePayload === 'object' && (responsePayload as any).id
        ? String((responsePayload as any).id)
        : '');

    const action = inferAuditAction(req);
    const resource = inferEntityType(req.path);
    const statusBefore = body.previousStatus ?? body.fromStatus ?? null;
    const statusAfter = body.status ?? body.nextStatus ?? null;
    const statusChanged = statusBefore != null || statusAfter != null;

    const metadata = {
      method,
      route: req.path,
      originalUrl: req.originalUrl,
      query: redactAuditValue(req.query),
      params: redactAuditValue(req.params),
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
      statusCode,
      durationMs: Date.now() - startedAt,
      statusChange: statusChanged
        ? {
            before: statusBefore,
            after: statusAfter,
          }
        : undefined,
      // Lets project Activity resolve HTTP rows even when domain audit is missing.
      projectId:
        resource === 'tasks'
          ? String(
              body.projectId ||
                (responsePayload && typeof responsePayload === 'object'
                  ? (responsePayload as any).projectId
                  : '') ||
                ''
            ).trim() || undefined
          : undefined,
      taskTitle:
        resource === 'tasks'
          ? String(
              body.title ||
                (responsePayload && typeof responsePayload === 'object'
                  ? (responsePayload as any).title
                  : '') ||
                ''
            ).trim() || undefined
          : undefined,
    };

    const oldValue = statusChanged ? { status: statusBefore } : undefined;
    const newValue = {
      request: redactAuditValue(body),
      response:
        responsePayload && typeof responsePayload === 'object'
          ? redactAuditValue(responsePayload)
          : responsePayload,
    };

    void AuditLog.create({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityType: resource,
      entityId: entityId || null,
      action,
      oldValue,
      newValue,
      performedBy: String(currentUser.id),
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined,
      metadata: { ...metadata, source: 'http_mutation' },
    } as any).catch((error) => {
      console.warn('[audit] Failed to store mutation log:', (error as Error)?.message || error);
    });
  });

  return next();
};

/** Leaves → Planning roster save (matches frontend LEAVE_EDIT planning access). */
const planningRosterWriteAccess: express.RequestHandler = async (req, res, next) => {
  const currentUser = (req as any).user;
  if (!currentUser) {
    return res.status(401).json({ message: 'Unauthorized access: Please login' });
  }
  const role = String(currentUser.role || '').toUpperCase();
  if (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'HR' || role === 'MANAGER') {
    return next();
  }
  try {
    const { getEffectivePermissionsForUser, hasEffectivePermission } = await import(
      './effectivePermissions.js'
    );
    const perms = await getEffectivePermissionsForUser(String(currentUser.id));
    if (hasEffectivePermission(perms, 'leave.edit')) return next();
  } catch {
    /* fall through */
  }
  return res.status(403).json({ message: 'Forbidden: insufficient permissions for roster management' });
};

// Must stay before router.use(requireAuth): after a DB wipe the JWT is invalid, so the UI
// polls with the one-time pollToken from the restore 202 response.
router.get('/settings/backup/restore-status/:jobId', async (req, res) => {
  try {
    const { getRestoreJob, isValidRestorePollToken } = await import('./backupRestoreJobs.js');
    const jobId = String(req.params.jobId || '');
    const job = getRestoreJob(jobId);
    if (!job) {
      return res.status(404).json({ message: 'Restore job not found or expired' });
    }

    const pollToken = String(
      req.query.token || req.headers['x-restore-poll-token'] || ''
    ).trim();
    const tokenOk = isValidRestorePollToken(jobId, pollToken);
    const currentUser = (req as any).user;
    const role = String(currentUser?.role || '').toUpperCase();
    const adminOk =
      !!currentUser && (role === 'ADMIN' || role === 'SUPER_ADMIN');
    if (!tokenOk && !adminOk) {
      return res.status(401).json({
        message: 'Invalid or missing restore poll token',
        code: 'RESTORE_POLL_UNAUTHORIZED',
      });
    }

    res.json({
      jobId: job.id,
      status: job.status,
      source: job.source,
      fileName: job.fileName,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? null,
      error: job.error ?? null,
      result: job.result ?? null,
      success: job.status === 'success',
    });
  } catch (error) {
    console.error('Error reading restore status:', error);
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to read restore status',
    });
  }
});

router.use(requireAuth);
router.use(mutationAuditMiddleware);

mountV40AppRoutes(router, {
  jwtSecret: JWT_SECRET,
  adminOnly,
  hrAccess,
  adminOrHr,
  hrManagerAccess,
  requireEffectivePermission,
  clearCachePrefix,
});

mountPersonalAnalyticsRoutes(router, hrAccess);
mountAppraisalRoutes(router, hrManagerAccess);

// ============ ROLE MENU (navigation visibility) ============
router.get('/menu/me', cacheMiddleware(3 * 60 * 1000), async (req, res) => {
  const currentUser = (req as any).user;
  if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
  try {
    res.set('Cache-Control', 'private, max-age=180');
    const menu = await getMenuForUser(String(currentUser.role || '').toUpperCase());
    res.json(menu);
  } catch (error) {
    console.error('Error loading menu for user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ PERMISSIONS API ============
// Role grants + overrides are editable and persisted to a JSON file store
// (not MySQL). Catalog keys/defaults seed from PERMISSION_CATALOG.
// Access follows matrix Grant/Deny (permissions.view / permissions.manage).
router.use('/permissions', requireViewOrManagePermission('permissions.view', 'permissions.manage'));
router.use('/users/:id/overrides', requireEffectivePermission('permissions.manage'));

router.get('/permissions', async (_req, res) => {
  try {
    const permissions = listCatalogPermissions().sort((a, b) =>
      a.module === b.module ? a.name.localeCompare(b.name) : a.module.localeCompare(b.module)
    );
    const matrix = await getPermissionMatrix();
    res.json({
      permissions,
      matrix,
      hardcoded: PERMISSIONS_HARDCODED,
      storage: 'file',
      storePath: getPermissionStorePath(),
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/permissions/sync', async (req, res) => {
  try {
    clearCachePrefix('permissions_matrix');
    clearCachePrefix('permission_modules');
    permissionCache.clear();
    invalidateEffectivePermissionsCache();

    const reapplyDefaults =
      req.query.reapplyDefaults === '1' ||
      req.query.reapplyDefaults === 'true' ||
      req.body?.reapplyDefaults === true;
    const backfillProjects =
      req.query.backfillProjects !== '0' &&
      req.query.backfillProjects !== 'false' &&
      req.body?.backfillProjects !== false;

    let sync = {
      added: 0,
      roleLinks: 0,
      repaired: 0,
      reapplied: 0,
      roleIdRepaired: 0,
    };

    if (reapplyDefaults) {
      // Sync System should rollback to the exact default role matrix state,
      // including removing any per-user permission overrides.
      await resetPermissionStoreToCatalogDefaults({ clearOverrides: true });
      sync.reapplied = listCatalogPermissions().length;
    }

    let projectBackfill: { projects: number; leadsEnsured: number; assigneesEnsured: number } | null =
      null;
    if (backfillProjects) {
      try {
        const { backfillProjectMemberships } = await import('./projectAccessService.js');
        projectBackfill = await backfillProjectMemberships();
      } catch (projectErr) {
        console.warn(
          '[permissions] Project membership backfill skipped:',
          (projectErr as Error)?.message || projectErr
        );
      }
    }

    const permissions = listCatalogPermissions().sort((a, b) =>
      a.module === b.module ? a.name.localeCompare(b.name) : a.module.localeCompare(b.module)
    );
    const matrix = await getPermissionMatrix();

    res.json({
      permissions,
      matrix,
      sync,
      projectBackfill,
      reapplyDefaults,
      hardcoded: PERMISSIONS_HARDCODED,
      storage: 'file',
      message:
        reapplyDefaults
          ? 'Role grants reset to PERMISSION_CATALOG defaults in the file store (MySQL not required).'
          : 'Permission catalog refreshed from file store.',
    });
  } catch (error) {
    console.error('Error syncing permissions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put(
  '/permissions/roles/:roleName',
  requireEffectivePermission('permissions.manage'),
  async (req, res) => {
  const roleName = String(req.params.roleName || '').toUpperCase();
  const rolePermissions = req.body.permissions || {};

  try {
    const { resolveFixedRoleByName } = await import('./fixedSystemRoles.js');
    const { expandRolePermissionPayload } = await import('./permissionKeyAliases.js');
    const role = resolveFixedRoleByName(roleName);
    if (!role) return res.status(404).json({ message: 'Role not found' });

    const expandedPermissions = expandRolePermissionPayload(rolePermissions);

    if (roleName === 'ADMIN') {
      const grantCount = Object.values(expandedPermissions).filter(
        (actionsValue) => normalizeRoleActions(actionsValue).length > 0
      ).length;
      if (grantCount === 0) {
        return res.status(400).json({ message: 'Administrator role cannot be saved with zero grants.' });
      }
    }

    await saveRolePermissions(roleName, expandedPermissions);
    const { notifyRolePermissionsChanged } = await import('./notificationService.js');
    const revision = crypto
      .createHash('sha1')
      .update(JSON.stringify(expandedPermissions))
      .digest('hex')
      .slice(0, 12);
    void notifyRolePermissionsChanged({
      role: roleName,
      actorUserId: String((req as any).user?.id || ''),
      revision,
    }).catch(() => undefined);

    clearCachePrefix('permissions_matrix');
    permissionCache.clear();
    clearRoleMenuCache();
    invalidateEffectivePermissionsCache();

    res.json({
      success: true,
      storage: 'file',
      hardcoded: PERMISSIONS_HARDCODED,
      message: 'Role permissions saved to the file store (not MySQL).',
    });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ message: error?.message || 'Bad request' });
    }
    console.error('Error updating role permissions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/permissions/user-overrides', async (_req, res) => {
  try {
    const overrides = await listFileOverrides();
    res.json(overrides.map(serializeOverrideForApi));
  } catch (error) {
    console.error('Error fetching all user overrides:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/permissions/modules', async (_req, res) => {
  const cacheKey = 'permission_modules';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const modules = [...new Set(listCatalogPermissions().map((p) => p.module))];
  setCached(cacheKey, modules);
  res.json(modules);
});

router.get('/users/:id/permissions', async (req, res) => {
  const userId = req.params.id;
  const viewer = (req as any).user as any;
  if (!viewer) return res.status(401).json({ message: 'Not authenticated' });

  try {
    const { getEffectivePermissionsForUser, hasEffectivePermission } = await import(
      './effectivePermissions.js'
    );
    const isSelf = String(viewer.id) === String(userId);
    if (!isSelf) {
      const roleUpper = String(viewer.role || '').toUpperCase();
      const viewerPerms = await getEffectivePermissionsForUser(String(viewer.id));
      const canView =
        hasEffectivePermission(viewerPerms, 'permissions.view', roleUpper) ||
        hasEffectivePermission(viewerPerms, 'permissions.manage', roleUpper) ||
        hasEffectivePermission(viewerPerms, 'users.view', roleUpper) ||
        hasEffectivePermission(viewerPerms, 'users.manage', roleUpper);
      if (!canView) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }

    const effectivePerms = await getEffectivePermissionsForUser(userId);
    res.json(effectivePerms ?? {});
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/users/:id/overrides', async (req, res) => {
  try {
    const overrides = await listFileOverrides(req.params.id);
    res.json(overrides.map(serializeOverrideForApi));
  } catch (error) {
    console.error('Error fetching user overrides:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/users/:id/overrides', async (req, res) => {
  const { permissionId, overrideType, reason, expiresAt } = req.body;
  const currentUser = (req as any).user;

  try {
    const targetUserId = String(req.params.id).trim();
    const existingUser = await User.findByPk(targetUserId, { attributes: ['id'] });
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const type = String(overrideType || '').toUpperCase();
    if (type !== 'GRANT' && type !== 'REVOKE') {
      return res.status(400).json({ message: 'overrideType must be GRANT or REVOKE' });
    }

    const override = await createFileOverride({
      userId: targetUserId,
      permissionId: String(permissionId || '').trim(),
      overrideType: type as 'GRANT' | 'REVOKE',
      reason: String(reason || ''),
      expiresAt: expiresAt || null,
      grantedBy: currentUser?.id,
      grantedByName: String(currentUser?.name || currentUser?.email || currentUser?.id || ''),
    });

    invalidateEffectivePermissionsCache(targetUserId);
    invalidateUserCache(targetUserId);

    const perm = listCatalogPermissions().find((p) => p.id === override.permissionId);
    try {
      const { notifyPermissionOverrideApplied } = await import('./notificationService.js');
      void notifyPermissionOverrideApplied({
        userId: targetUserId,
        permissionName: String(perm?.name ?? perm?.key ?? ''),
        overrideType: type,
        eventKey: String(override.id),
      });
    } catch {
      /* optional */
    }

    res.status(201).json(serializeOverrideForApi(override));
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ message: error?.message || 'Bad request' });
    }
    console.error('Error creating override:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/users/:id/overrides/:overrideId', async (req, res) => {
  try {
    const removed = await deleteFileOverride(req.params.overrideId);
    if (!removed) {
      return res.status(404).json({ message: 'Override not found' });
    }
    invalidateEffectivePermissionsCache(req.params.id);
    invalidateUserCache(req.params.id);
    const { notifyPermissionOverrideApplied } = await import('./notificationService.js');
    void notifyPermissionOverrideApplied({
      userId: req.params.id,
      permissionName: String((removed as any).permissionId || ''),
      overrideType: (removed as any).overrideType === 'GRANT' ? 'REVOKE' : 'GRANT',
      eventKey: `removed-${req.params.overrideId}`,
    }).catch(() => undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing override:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/permissions/requests/pending', async (_req, res) => {
  // Approval workflow unused with file-store overrides (admin applies immediately).
  res.json([]);
});

router.put('/permissions/requests/:id/approve', async (_req, res) => {
  return res.status(400).json({
    message: 'Override approval requests are not used; admins apply exceptions immediately.',
  });
});

router.put('/permissions/requests/:id/reject', async (_req, res) => {
  return res.status(400).json({
    message: 'Override approval requests are not used; admins apply exceptions immediately.',
  });
});

// ============ SETTINGS API ============
router.get('/catalog/position-levels', requireAuth, async (_req, res) => {
  try {
    const { loadPositionLevelsFromDb } = await import('./positionLevelSettingsService.js');
    const levels = await loadPositionLevelsFromDb();
    res.json({ levels });
  } catch (error) {
    console.error('Error fetching position levels:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/settings/position-levels', async (_req, res) => {
  try {
    const { loadPositionLevelsFromDb } = await import('./positionLevelSettingsService.js');
    const levels = await loadPositionLevelsFromDb();
    res.json({ levels });
  } catch (error) {
    console.error('Error fetching position levels:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Company profile/locale/timezone is needed by every signed-in role (calendar,
 * branding, date formatting). Keep this read outside Administration settings.view.
 */
router.get('/settings/company', async (_req, res) => {
  try {
    const { loadCompanySettingsFlat } = await import('./organizationSettingsService.js');
    const settings = await loadCompanySettingsFlat();
    res.json({ settings });
  } catch (error) {
    console.error('Error fetching company settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Settings → Security (dedicated matrix permissions). */
router.get(
  '/settings/security-policy',
  requireEffectivePermission('settings.security.view'),
  async (_req, res) => {
    try {
      const { loadSecuritySettingsFlat } = await import('./organizationSettingsService.js');
      const settings = await loadSecuritySettingsFlat();
      res.json({ settings });
    } catch (error) {
      console.error('Error fetching security settings:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.put(
  '/settings/security-policy',
  requireEffectivePermission('settings.security.edit'),
  async (req, res) => {
    const currentUser = (req as any).user;
    const { key, value, settings: bulk } = req.body || {};
    try {
      const { updateOrganizationSetting, bulkUpdateOrganizationSettings, MAPPING_BY_KEY } =
        await import('./organizationSettingsService.js');
      if (bulk && typeof bulk === 'object') {
        const securityOnly: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(bulk)) {
          if (String(k).startsWith('security.') && MAPPING_BY_KEY.has(k)) {
            securityOnly[k] = v;
          }
        }
        await bulkUpdateOrganizationSettings(securityOnly, { userId: currentUser?.id });
      } else if (key && String(key).startsWith('security.')) {
        await updateOrganizationSetting(String(key), value, { userId: currentUser?.id });
      } else {
        return res.status(400).json({ message: 'Invalid security setting key' });
      }
      invalidateGlobalCache();
      res.json({ success: true });
    } catch (error: any) {
      const msg = error?.message || 'Unable to save security settings';
      console.error('Error updating security settings:', error);
      res.status(500).json({ message: msg });
    }
  }
);

router.get(
  '/settings/default-password',
  requireEffectivePermission('settings.security.view'),
  async (_req, res) => {
    try {
      const { getDefaultPortalPasswordStatus } = await import('./defaultPortalPassword.js');
      const status = await getDefaultPortalPasswordStatus();
      res.json(status);
    } catch (error: any) {
      console.error('Error fetching default password status:', error?.message || error);
      res.status(500).json({ message: 'Unable to load default password settings.' });
    }
  }
);

router.put(
  '/settings/default-password',
  requireEffectivePermission('settings.security.edit'),
  async (req, res) => {
    try {
      const {
        saveDefaultPortalPasswordSettings,
        coerceDefaultPasswordEnabled,
      } = await import('./defaultPortalPassword.js');
      const enabledRaw = req.body?.enabled;
      const hasEnabled = enabledRaw !== undefined && enabledRaw !== null && enabledRaw !== '';
      const result = await saveDefaultPortalPasswordSettings({
        ...(hasEnabled ? { enabled: coerceDefaultPasswordEnabled(enabledRaw) } : {}),
        password: req.body?.password,
        confirmPassword: req.body?.confirmPassword,
      });
      invalidateGlobalCache();
      res.json({
        success: true,
        ...result,
        existingUsersUnaffected: true,
      });
    } catch (error: any) {
      const msg = error?.message || 'Unable to save default password';
      console.error('Error updating default password:', error);
      res.status(400).json({ message: msg });
    }
  }
);

router.use('/settings', requireViewOrManagePermission('settings.view', 'settings.edit'));

router.put('/settings/position-levels', async (req, res) => {
  const currentUser = (req as any).user;
  try {
    const {
      loadPositionLevelsFromDb,
      savePositionLevelsToDb,
      validatePositionLevelsForSave,
      codesRemovedFromCatalog,
      assertPositionLevelsCanBeRemoved,
    } = await import('./positionLevelSettingsService.js');

    const previous = await loadPositionLevelsFromDb();
    const next = validatePositionLevelsForSave(req.body?.levels ?? req.body);
    const removed = codesRemovedFromCatalog(previous, next);
    await assertPositionLevelsCanBeRemoved(removed);

    const saved = await savePositionLevelsToDb(next, { userId: currentUser?.id, previous });
    invalidateGlobalCache();
    res.json({ success: true, levels: saved });
  } catch (error: any) {
    const msg = error?.message || 'Unable to save position levels';
    const status = /cannot remove|duplicate|required/i.test(msg) ? 400 : 500;
    if (status === 500) console.error('Error saving position levels:', error);
    res.status(status).json({ message: msg });
  }
});

router.put('/settings/company', async (req, res) => {
  const currentUser = (req as any).user;
  const { key, value, settings: bulk } = req.body || {};
  try {
    const { updateOrganizationSetting, bulkUpdateOrganizationSettings, MAPPING_BY_KEY } =
      await import('./organizationSettingsService.js');
    if (bulk && typeof bulk === 'object') {
      await bulkUpdateOrganizationSettings(bulk, { userId: currentUser?.id });
    } else if (key && MAPPING_BY_KEY.has(String(key))) {
      await updateOrganizationSetting(String(key), value, { userId: currentUser?.id });
    } else {
      return res.status(400).json({ message: 'Invalid company setting key' });
    }
    invalidateGlobalCache();
    cache.delete(PORTAL_BRANDING_CACHE_KEY);
    try {
      const { invalidateCompanyTimezoneCache } = await import('./companyTimeZone.js');
      invalidateCompanyTimezoneCache();
    } catch {
      /* ignore */
    }
    res.json({ success: true });
  } catch (error: any) {
    const msg = error?.message || 'Unable to save company settings';
    console.error('Error updating company settings:', error);
    res.status(500).json({ message: msg });
  }
});

/** Upload portal logo or login front cover; returns a short `/uploads/...` URL for company_profile. */
router.post('/settings/company/branding-asset', (req, res) => {
  brandingAssetUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: 'Image is larger than 5 MB. Please choose a smaller file.' });
        }
        console.error('Branding asset multer error:', err);
        return res.status(400).json({ message: err.message || 'Upload failed' });
      }

      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ message: 'No file received. Please select an image.' });
      }

      const kind = String((req.body as { kind?: string })?.kind || 'logo').toLowerCase();
      const isCover = kind === 'front_cover' || kind === 'cover';
      const logoTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'];
      const coverTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      const allowed = isCover ? coverTypes : logoTypes;
      const maxBytes = isCover ? 5 * 1024 * 1024 : 2 * 1024 * 1024;

      const fs = await import('node:fs');
      const path = await import('node:path');
      const { extensionForMime } = await import('./uploadMime.js');
      const cleanup = () => {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* best-effort */
        }
      };

      if (!allowed.includes(file.mimetype)) {
        cleanup();
        return res.status(400).json({
          message: isCover
            ? 'Only JPG, PNG, or WEBP images are allowed for the front cover.'
            : 'Only PNG, JPG, or SVG images are allowed for the portal logo.',
        });
      }
      if (file.size > maxBytes) {
        cleanup();
        return res.status(413).json({
          message: isCover
            ? 'Front cover must be under 5 MB.'
            : 'Portal logo must be under 2 MB.',
        });
      }
      // Raster covers should not be tiny stubs; SVG logos may legitimately be small.
      const minBytes = file.mimetype === 'image/svg+xml' ? 32 : isCover ? 512 : 64;
      if (file.size < minBytes) {
        cleanup();
        return res.status(400).json({ message: 'Image looks too small to be valid. Please choose another file.' });
      }

      const ext = extensionForMime(file.mimetype);
      const prefix = isCover ? 'portal-cover' : 'portal-logo';
      const storedName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
      const destPath = path.join(process.cwd(), 'uploads', storedName);
      fs.renameSync(file.path, destPath);

      const url = `/uploads/${storedName}`;
      res.json({ url, filename: storedName, size: file.size, mime: file.mimetype });
    } catch (e: any) {
      console.error('Branding asset upload failed:', e);
      res.status(500).json({ message: 'Branding upload failed' });
    }
  });
});

/** Admin: OTP email delivery status (Gmail SMTP locally / Apps Script on Render). */
router.get('/settings/otp-email', async (_req, res) => {
  try {
    let mode: string = 'email';
    try {
      mode = getOtpDeliveryMode();
    } catch {
      mode = 'email';
    }
    res.json({
      mode,
      emailConfigured: isEmailConfigured(),
      emailDevFallback: isEmailDevFallbackEnabled(),
      smtpLikelyBlocked: isSmtpLikelyBlocked(),
      setupHint: getGmailSetupMessage(),
      providers: getOtpEmailStatus(),
      gmailUser: process.env.GMAIL_USER || process.env.SMTP_USER || null,
      appsScriptUrlSet: Boolean(process.env.GMAIL_APPS_SCRIPT_URL?.trim()),
      appsScriptSecretSet: Boolean(process.env.GMAIL_APPS_SCRIPT_SECRET?.trim()),
      expiresInSeconds: OTP_EXPIRY_SECONDS,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (error: any) {
    console.error('Error fetching OTP email settings:', error?.message || error);
    res.status(500).json({ message: 'Unable to load OTP email settings.' });
  }
});

/** Admin: Apps Script source to paste into script.google.com (optional ?secret= to embed). */
router.get('/settings/otp-email/apps-script', (req, res) => {
  const source = getGmailAppsScriptSource();
  if (!source) {
    return res.status(404).json({ message: 'Apps Script template not found on server.' });
  }
  const secret = String((req.query.secret as string) || '').trim();
  const body =
    secret.length >= 16
      ? source.replace(/CHANGE_ME_TO_A_LONG_RANDOM_SECRET/g, secret)
      : source;
  res.json({ source: body });
});

/**
 * Admin: save Gmail OTP delivery (Apps Script HTTPS relay and/or App Password).
 * On Render free, appsScriptUrl + appsScriptSecret are required — SMTP ports are blocked.
 */
router.post('/settings/otp-email', async (req, res) => {
  try {
    const appsScriptUrl = String(req.body?.appsScriptUrl || '').trim();
    const appsScriptSecret = String(req.body?.appsScriptSecret || '').trim();
    const appPassword = String(req.body?.appPassword || '').replace(/\s+/g, '');
    const user = String(req.body?.user || process.env.GMAIL_USER || 'iroc.hcms@gmail.com')
      .trim()
      .toLowerCase();
    const from = String(req.body?.from || process.env.GMAIL_FROM || user)
      .trim()
      .toLowerCase();

    if (isSmtpLikelyBlocked() && !(appsScriptUrl && appsScriptSecret)) {
      return res.status(400).json({
        message:
          'Render blocks Gmail SMTP. Deploy the Apps Script relay, then paste the Web App URL and secret here.',
        smtpLikelyBlocked: true,
      });
    }

    if (!appsScriptUrl && !appPassword && !(process.env.GMAIL_APP_PASSWORD || '').trim()) {
      return res.status(400).json({
        message: 'Provide appsScriptUrl + appsScriptSecret, and/or a Gmail app password.',
      });
    }

    if (appsScriptUrl && appsScriptSecret.length < 16) {
      return res.status(400).json({
        message: 'appsScriptSecret must be at least 16 characters (match OTP_RELAY_SECRET in the script).',
      });
    }

    const result = await configureGmailAppPassword({
      user,
      from,
      appPassword: appPassword || undefined,
      appsScriptUrl: appsScriptUrl || undefined,
      appsScriptSecret: appsScriptSecret || undefined,
    });

    const verified = await verifySmtpConnection();
    return res.status(result.ok || verified ? 200 : 502).json({
      ...result,
      ok: result.ok || verified,
      emailConfigured: isEmailConfigured(),
      providers: getOtpEmailStatus(),
      smtpLikelyBlocked: isSmtpLikelyBlocked(),
    });
  } catch (error: any) {
    console.error('Error saving OTP email settings:', error?.message || error);
    res.status(500).json({ message: error?.message || 'Failed to save OTP email settings.' });
  }
});

/** Admin: send a test OTP email to confirm delivery works. */
router.post('/settings/otp-email/test', async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({
        message: getGmailSetupMessage() || OTP_EMAIL_UNAVAILABLE_MESSAGE,
        emailConfigured: false,
      });
    }
    const currentUser = (req as any).user;
    const to =
      String(req.body?.to || '').trim() ||
      (await resolveOtpEmailForUser(currentUser)) ||
      String(currentUser?.email || '').trim();
    if (!to) {
      return res.status(400).json({ message: 'Provide a destination email (to).' });
    }
    const otp = generateLocalOtp();
    await sendOtpViaEmail(to, 'login', otp);
    res.json({
      message: `Test OTP sent to ${maskEmail(to)}.`,
      maskedEmail: maskEmail(to),
      ...(process.env.NODE_ENV === 'production' ? {} : { devOtp: otp }),
    });
  } catch (error: any) {
    console.error('OTP email test failed:', error?.message || error);
    res.status(502).json({
      message: error?.message || 'Failed to send test OTP email.',
      emailConfigured: isEmailConfigured(),
      providers: getOtpEmailStatus(),
    });
  }
});

router.get('/settings/global', async (req, res) => {
  const cacheKey = 'global_settings';
  const cached = getCache(settingsCache, cacheKey);
  if (cached) return res.json(cached);

  try {
    const settings = await SystemSetting.findAll({ order: [['category', 'ASC'], ['key', 'ASC']] });
    setCache(settingsCache, cacheKey, settings);
    res.json(settings);
  } catch (error) {
    console.error('Error fetching global settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/settings/global', async (req, res) => {
  const { key, value, description } = req.body;
  const currentUser = (req as any).user;

  try {
    const { MAPPING_BY_KEY, updateOrganizationSetting } = await import('./organizationSettingsService.js');
    if (key && MAPPING_BY_KEY.has(String(key))) {
      await updateOrganizationSetting(String(key), value, { userId: currentUser?.id });
      invalidateGlobalCache();
      return res.json({ success: true });
    }

    const existing = await SystemSetting.findOne({ where: { key } });
    const oldValue = existing?.value;

    if (existing) {
      existing.value = value;
      if (description) existing.description = description;
      await existing.save();
    } else {
      await SystemSetting.create({
        id: `ss-${Date.now()}`,
        key,
        value,
        category: key.split('.')[0],
        description,
      });
    }

    await AuditLog.create({
      id: `audit-${Date.now()}`,
      entityType: 'system_setting',
      entityId: key,
      action: 'UPDATE',
      oldValue,
      newValue: value,
      performedBy: currentUser.id,
    });

    invalidateGlobalCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating global setting:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

function formatBackupActorLabel(actor: {
  name?: string | null;
  email?: string | null;
  employeeCode?: string | null;
} | null | undefined): string {
  const name = String(actor?.name || actor?.email || '').trim() || 'Admin';
  const code = String(actor?.employeeCode || '').trim();
  return code ? `${name} (${code})` : name;
}

router.get('/settings/backup', requireRole('ADMIN'), async (_req, res) => {
  try {
    const {
      listBackups,
      summarizeBackups,
      getBackupSettings,
      getBackupStatus,
      formatBackupSize,
      listBackupCreatorUserIds,
      applyBackupCreatorLabels,
    } = await import('./backupService.js');
    let backups = await listBackups();
    const creatorIds = listBackupCreatorUserIds();
    const labels = new Map<string, string>();
    if (creatorIds.length) {
      const actors = await buildAuditActorMap(creatorIds);
      for (const [id, actor] of actors) {
        labels.set(id, formatBackupActorLabel(actor));
      }
      backups = applyBackupCreatorLabels(backups, labels);
    }

    // Legacy rows stored email/name only — resolve to "Name (ID)" when possible.
    const emails = Array.from(
      new Set(
        backups
          .map((b) => String(b.createdBy || '').trim().toLowerCase())
          .filter((v) => v.includes('@'))
      )
    );
    if (emails.length) {
      const users = (await User.findAll({
        where: { email: { [Op.in]: emails } },
        attributes: ['id', 'email'],
      })) as Array<{ get: (opts: { plain: true }) => { id?: string; email?: string } }>;
      const ids = users.map((u) => String(u.get({ plain: true }).id || '')).filter(Boolean);
      if (ids.length) {
        const actors = await buildAuditActorMap(ids);
        const byEmail = new Map<string, string>();
        for (const u of users) {
          const plain = u.get({ plain: true });
          const email = String(plain.email || '').trim().toLowerCase();
          const actor = actors.get(String(plain.id || ''));
          if (email && actor) byEmail.set(email, formatBackupActorLabel(actor));
        }
        backups = backups.map((b) => {
          const key = String(b.createdBy || '').trim().toLowerCase();
          return byEmail.has(key) ? { ...b, createdBy: byEmail.get(key)! } : b;
        });
      }
    }

    const summary = summarizeBackups(backups);
    const settings = await getBackupSettings();
    const status = await getBackupStatus(settings);
    res.json({
      backups: backups.map((b) => ({
        ...b,
        sizeLabel: formatBackupSize(b.sizeBytes),
      })),
      summary: {
        ...summary,
        totalSizeLabel: formatBackupSize(summary.totalSizeBytes),
      },
      settings,
      status,
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to list backups' });
  }
});

router.put('/settings/backup/settings', requireRole('ADMIN'), async (req, res) => {
  const currentUser = (req as any).user;
  try {
    const { saveBackupSettings } = await import('./backupService.js');
    const settings = await saveBackupSettings(req.body ?? {});
    await writeAuditLog({
      entityType: 'database_backup',
      entityId: 'settings',
      action: 'UPDATE',
      performedBy: currentUser.id,
      newValue: settings,
      reason: 'Updated backup settings',
      metadata: { page: 'Settings', tab: 'Backup', section: 'Backup Settings' },
    });
    res.json({ settings, success: true });
  } catch (error) {
    console.error('Error saving backup settings:', error);
    const message = error instanceof Error ? error.message : 'Failed to save backup settings';
    const status = /between|select|must be/i.test(message) ? 400 : 500;
    res.status(status).json({ message });
  }
});

router.post('/settings/backup', requireRole('ADMIN'), async (req, res) => {
  const currentUser = (req as any).user;
  const effectiveFrom = String(req.body?.effectiveFrom ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ message: 'Effective date is required (YYYY-MM-DD)' });
  }
  try {
    const { createManualBackup, formatBackupSize } = await import('./backupService.js');
    const actors = await buildAuditActorMap([String(currentUser.id)]);
    const actor = actors.get(String(currentUser.id));
    const createdByLabel = formatBackupActorLabel(
      actor || {
        name: currentUser?.name || currentUser?.displayName,
        email: currentUser?.email,
      }
    );
    const backup = await createManualBackup(createdByLabel, String(currentUser.id));
    await writeAuditLog({
      entityType: 'database_backup',
      entityId: backup.id,
      action: 'CREATE',
      performedBy: currentUser.id,
      newValue: {
        fileName: backup.fileName,
        type: backup.type,
        sizeBytes: backup.sizeBytes,
        effectiveFrom,
        createdBy: createdByLabel,
      },
      reason: `Manual database backup by ${createdByLabel} (effective ${effectiveFrom})`,
      metadata: { page: 'Settings', tab: 'Backup', section: 'Backup list' },
    });
    res.status(201).json({
      backup: { ...backup, sizeLabel: formatBackupSize(backup.sizeBytes), effectiveFrom },
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Backup failed' });
  }
});

router.post(
  '/settings/backup/restore-upload',
  requireRole('ADMIN'),
  (req, res, next) => {
    backupUpload.single('file')(req, res, (err) => {
      if (err) {
        const multerErr = err as { code?: string; message?: string };
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: 'Backup file exceeds the 512 MB upload limit' });
        }
        return res.status(400).json({ message: multerErr.message || 'Invalid backup upload' });
      }
      next();
    });
  },
  async (req, res) => {
    const currentUser = (req as any).user;
    if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
      return res.status(400).json({ message: 'Restore requires confirm: true' });
    }
    const uploaded = req.file;
    if (!uploaded?.path) {
      return res.status(400).json({ message: 'No backup file uploaded' });
    }

    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const originalName = String(uploaded.originalname || 'upload.sql').trim() || 'upload.sql';
    const safeBase = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const withExt = /\.sql$/i.test(safeBase) ? safeBase : `${safeBase}.sql`;
    const uploadPath = pathMod.resolve(
      BACKUP_UPLOAD_DIR,
      `restore-${Date.now()}-${withExt}`
    );

    try {
      fs.renameSync(uploaded.path, uploadPath);
    } catch {
      try {
        fs.copyFileSync(uploaded.path, uploadPath);
        fs.unlinkSync(uploaded.path);
      } catch {
        return res.status(500).json({ message: 'Could not store the uploaded backup file' });
      }
    }

    try {
      const { assertValidBackupSqlFile } = await import('./mysqlImportService.js');
      assertValidBackupSqlFile(uploadPath);
    } catch (err) {
      try {
        if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
      } catch {
        /* ignore */
      }
      return res.status(400).json({
        message: err instanceof Error ? err.message : 'Invalid SQL backup file',
      });
    }

    try {
      const { getBackupOperationInProgress } = await import('./backupService.js');
      if (getBackupOperationInProgress()) {
        try {
          if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
        } catch {
          /* ignore */
        }
        return res.status(409).json({
          message: 'A database backup/restore is already in progress. Please wait and try again.',
        });
      }

      const { createRestoreJob, runRestoreJob } = await import('./backupRestoreJobs.js');
      const job = createRestoreJob({
        source: 'upload',
        fileName: originalName,
        performedBy: String(currentUser.id),
      });

      // Return immediately — Render HTTP timeouts kill long sync restores.
      res.status(202).json({
        accepted: true,
        jobId: job.id,
        pollToken: job.pollToken,
        status: job.status,
        message: 'Restore started. Poll restore-status until success or failed.',
      });

      void runRestoreJob(job.id, async () => {
        const { restoreUploadedBackup } = await import('./backupService.js');
        const result = await restoreUploadedBackup(uploadPath, true);
        try {
          const actors = await buildAuditActorMap([String(currentUser.id)]);
          const actorLabel = formatBackupActorLabel(actors.get(String(currentUser.id)));
          await writeAuditLog({
            entityType: 'database_backup',
            entityId: originalName,
            action: 'RESTORE',
            performedBy: currentUser.id,
            newValue: {
              fileName: originalName,
              statementsExecuted: result.statementsExecuted,
              safetyBackupFileName: result.safetyBackupFileName ?? null,
              source: 'upload',
              restoredBy: actorLabel,
              jobId: job.id,
            },
            reason: `Restored database from uploaded backup by ${actorLabel}`,
            metadata: { page: 'Settings', tab: 'Backup', section: 'Restore backup' },
          });
        } catch (auditErr) {
          console.warn('[restore-upload] audit log failed:', auditErr);
        }
        return result;
      }).finally(() => {
        try {
          if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
        } catch {
          /* ignore */
        }
      });
    } catch (error) {
      console.error('Error starting uploaded backup restore:', error);
      try {
        if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
      } catch {
        /* ignore */
      }
      if (!res.headersSent) {
        const status =
          error && typeof error === 'object' && 'status' in error && Number((error as { status?: number }).status) === 409
            ? 409
            : 500;
        res.status(status).json({ message: error instanceof Error ? error.message : 'Restore failed' });
      }
    }
  }
);

/**
 * Chunked restore upload (preferred on Render).
 * Large single-request multipart uploads often fail with net::ERR_HTTP2_PROTOCOL_ERROR /
 * opaque 403 (no CORS) at the edge proxy before Express can respond.
 */
router.post('/settings/backup/restore-upload/session', requireRole('ADMIN'), async (req, res) => {
  try {
    if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
      return res.status(400).json({ message: 'Restore requires confirm: true' });
    }
    const currentUser = (req as any).user;
    const { createRestoreUploadSession, RESTORE_UPLOAD_CHUNK_SIZE } = await import(
      './backupRestoreUploadSessions.js'
    );
    const session = createRestoreUploadSession({
      fileName: String(req.body?.fileName || 'upload.sql'),
      totalChunks: Number(req.body?.totalChunks),
      totalBytes: Number(req.body?.totalBytes),
      createdBy: String(currentUser.id),
    });
    res.status(201).json({
      uploadId: session.id,
      uploadToken: session.token,
      totalChunks: session.totalChunks,
      /** Clients should send JSON { uploadToken, chunkBase64 } at this size (not multipart). */
      chunkSizeHint: RESTORE_UPLOAD_CHUNK_SIZE,
      transport: 'json-base64',
    });
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: number }).status) || 400
        : 400;
    res.status(status).json({
      message: error instanceof Error ? error.message : 'Could not start chunked upload',
    });
  }
});

router.post(
  '/settings/backup/restore-upload/session/:uploadId/chunk/:chunkIndex',
  requireRole('ADMIN'),
  (req, res, next) => {
    // Multipart is optional/legacy — JSON/base64 is the reliable path on Render HTTP/2.
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('multipart/form-data')) {
      return next();
    }
    backupChunkUpload.single('chunk')(req, res, (err) => {
      if (err) {
        const multerErr = err as { code?: string; message?: string };
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: 'Chunk exceeds the 1 MB limit' });
        }
        return res.status(400).json({ message: multerErr.message || 'Invalid chunk upload' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const {
        getRestoreUploadSession,
        isValidRestoreUploadToken,
        saveRestoreUploadChunk,
        decodeRestoreUploadChunkBody,
      } = await import('./backupRestoreUploadSessions.js');
      const uploadId = String(req.params.uploadId || '');
      const session = getRestoreUploadSession(uploadId);
      if (!session) {
        return res.status(404).json({ message: 'Upload session not found or expired' });
      }
      const token = String(
        req.body?.uploadToken || req.headers['x-restore-upload-token'] || ''
      ).trim();
      if (!isValidRestoreUploadToken(uploadId, token)) {
        return res.status(401).json({ message: 'Invalid upload token' });
      }
      if (String(session.createdBy) !== String((req as any).user?.id)) {
        return res.status(403).json({ message: 'Upload session belongs to another user' });
      }
      const chunkIndex = Number(req.params.chunkIndex);
      const buffer = decodeRestoreUploadChunkBody({
        body: req.body,
        fileBuffer: req.file?.buffer,
      });
      const progress = saveRestoreUploadChunk(session, chunkIndex, buffer);
      res.json({ ok: true, ...progress });
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? Number((error as { status?: number }).status) || 400
          : 400;
      res.status(status).json({
        message: error instanceof Error ? error.message : 'Chunk upload failed',
      });
    }
  }
);

router.post(
  '/settings/backup/restore-upload/session/:uploadId/complete',
  requireRole('ADMIN'),
  async (req, res) => {
    const currentUser = (req as any).user;
    if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
      return res.status(400).json({ message: 'Restore requires confirm: true' });
    }

    const fs = await import('node:fs');
    let uploadPath = '';
    let uploadId = '';
    try {
      const {
        getRestoreUploadSession,
        isValidRestoreUploadToken,
        assembleRestoreUploadSession,
        destroyRestoreUploadSession,
      } = await import('./backupRestoreUploadSessions.js');
      uploadId = String(req.params.uploadId || '');
      const session = getRestoreUploadSession(uploadId);
      if (!session) {
        return res.status(404).json({ message: 'Upload session not found or expired' });
      }
      const token = String(
        req.body?.uploadToken || req.headers['x-restore-upload-token'] || ''
      ).trim();
      if (!isValidRestoreUploadToken(uploadId, token)) {
        return res.status(401).json({ message: 'Invalid upload token' });
      }
      if (String(session.createdBy) !== String(currentUser.id)) {
        return res.status(403).json({ message: 'Upload session belongs to another user' });
      }

      uploadPath = assembleRestoreUploadSession(session);
      destroyRestoreUploadSession(uploadId);

      const { assertValidBackupSqlFile } = await import('./mysqlImportService.js');
      assertValidBackupSqlFile(uploadPath);

      const { getBackupOperationInProgress } = await import('./backupService.js');
      if (getBackupOperationInProgress()) {
        try {
          if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
        } catch {
          /* ignore */
        }
        return res.status(409).json({
          message: 'A database backup/restore is already in progress. Please wait and try again.',
        });
      }

      const { createRestoreJob, runRestoreJob } = await import('./backupRestoreJobs.js');
      const originalName = session.fileName;
      const job = createRestoreJob({
        source: 'upload',
        fileName: originalName,
        performedBy: String(currentUser.id),
      });

      res.status(202).json({
        accepted: true,
        jobId: job.id,
        pollToken: job.pollToken,
        status: job.status,
        message: 'Restore started. Poll restore-status until success or failed.',
      });

      void runRestoreJob(job.id, async () => {
        const { restoreUploadedBackup } = await import('./backupService.js');
        const result = await restoreUploadedBackup(uploadPath, true);
        try {
          const actors = await buildAuditActorMap([String(currentUser.id)]);
          const actorLabel = formatBackupActorLabel(actors.get(String(currentUser.id)));
          await writeAuditLog({
            entityType: 'database_backup',
            entityId: originalName,
            action: 'RESTORE',
            performedBy: currentUser.id,
            newValue: {
              fileName: originalName,
              statementsExecuted: result.statementsExecuted,
              safetyBackupFileName: result.safetyBackupFileName ?? null,
              source: 'upload-chunked',
              restoredBy: actorLabel,
              jobId: job.id,
            },
            reason: `Restored database from uploaded backup by ${actorLabel}`,
            metadata: { page: 'Settings', tab: 'Backup', section: 'Restore backup' },
          });
        } catch (auditErr) {
          console.warn('[restore-upload-chunked] audit log failed:', auditErr);
        }
        return result;
      }).finally(() => {
        try {
          if (fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
        } catch {
          /* ignore */
        }
      });
    } catch (error) {
      console.error('Error completing chunked backup restore:', error);
      try {
        if (uploadPath && fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
      } catch {
        /* ignore */
      }
      if (uploadId) {
        try {
          const { destroyRestoreUploadSession } = await import('./backupRestoreUploadSessions.js');
          destroyRestoreUploadSession(uploadId);
        } catch {
          /* ignore */
        }
      }
      if (!res.headersSent) {
        const status =
          error && typeof error === 'object' && 'status' in error
            ? Number((error as { status?: number }).status) || 500
            : 500;
        res.status(status).json({
          message: error instanceof Error ? error.message : 'Restore failed',
        });
      }
    }
  }
);

router.get('/settings/backup/:id/download', requireRole('ADMIN'), async (req, res) => {
  const currentUser = (req as any).user;
  try {
    const { resolveBackupFilePath, getBackupDownloadName } = await import('./backupService.js');
    const filePath = resolveBackupFilePath(req.params.id);
    const fileName = getBackupDownloadName(req.params.id);
    const actors = await buildAuditActorMap([String(currentUser.id)]);
    const actorLabel = formatBackupActorLabel(actors.get(String(currentUser.id)));
    await writeAuditLog({
      entityType: 'database_backup',
      entityId: req.params.id,
      action: 'DOWNLOAD',
      performedBy: currentUser.id,
      newValue: { fileName, downloadedBy: actorLabel },
      reason: `Downloaded database backup by ${actorLabel}`,
      metadata: { page: 'Settings', tab: 'Backup', section: 'Backup list' },
    });
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(404).json({ message: error instanceof Error ? error.message : 'Backup not found' });
  }
});

router.delete('/settings/backup/:id', requireRole('ADMIN'), async (req, res) => {
  const currentUser = (req as any).user;
  try {
    const { deleteBackup, getBackupDownloadName } = await import('./backupService.js');
    const fileName = getBackupDownloadName(req.params.id);
    await deleteBackup(req.params.id);
    const actors = await buildAuditActorMap([String(currentUser.id)]);
    const actorLabel = formatBackupActorLabel(actors.get(String(currentUser.id)));
    await writeAuditLog({
      entityType: 'database_backup',
      entityId: req.params.id,
      action: 'DELETE',
      performedBy: currentUser.id,
      oldValue: { fileName },
      reason: `Deleted database backup by ${actorLabel}`,
      metadata: { page: 'Settings', tab: 'Backup', section: 'Backup list' },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({ message: error instanceof Error ? error.message : 'Delete failed' });
  }
});

router.post('/settings/backup/:id/restore', requireRole('ADMIN'), async (req, res) => {
  const currentUser = (req as any).user;
  if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
    return res.status(400).json({ message: 'Restore requires confirm: true' });
  }
  try {
    const { restoreBackup, getBackupDownloadName, getBackupOperationInProgress } = await import(
      './backupService.js'
    );
    if (getBackupOperationInProgress()) {
      return res.status(409).json({
        message: 'A database backup/restore is already in progress. Please wait and try again.',
      });
    }
    const { createRestoreJob, runRestoreJob } = await import('./backupRestoreJobs.js');
    const backupId = String(req.params.id);
    const fileName = getBackupDownloadName(backupId);
    const job = createRestoreJob({
      source: 'existing',
      fileName,
      performedBy: String(currentUser.id),
    });

    res.status(202).json({
      accepted: true,
      jobId: job.id,
      pollToken: job.pollToken,
      status: job.status,
      message: 'Restore started. Poll restore-status until success or failed.',
    });

    void runRestoreJob(job.id, async () => {
      const result = await restoreBackup(backupId, true);
      try {
        const actors = await buildAuditActorMap([String(currentUser.id)]);
        const actorLabel = formatBackupActorLabel(actors.get(String(currentUser.id)));
        await writeAuditLog({
          entityType: 'database_backup',
          entityId: backupId,
          action: 'RESTORE',
          performedBy: currentUser.id,
          newValue: {
            fileName,
            statementsExecuted: result.statementsExecuted,
            safetyBackupFileName: result.safetyBackupFileName ?? null,
            source: 'existing',
            restoredBy: actorLabel,
            jobId: job.id,
          },
          reason: `Restored database from backup by ${actorLabel}`,
          metadata: { page: 'Settings', tab: 'Backup', section: 'Backup list' },
        });
      } catch (auditErr) {
        console.warn('[restore] audit log failed:', auditErr);
      }
      return result;
    });
  } catch (error) {
    console.error('Error starting backup restore:', error);
    if (!res.headersSent) {
      const status =
        error && typeof error === 'object' && 'status' in error && Number((error as { status?: number }).status) === 409
          ? 409
          : 500;
      res.status(status).json({ message: error instanceof Error ? error.message : 'Restore failed' });
    }
  }
});

router.get('/settings/effective/:employeeId/:key', async (req, res) => {
  const { employeeId, key } = req.params;

  try {
    let value = null;
    let level = 'none';
    let levelId = null;

    // Check employee-specific override
    const empSetting = await EmployeeSetting.findOne({
      where: { employeeId, settingKey: key }
    });
    if (empSetting) {
      value = empSetting.value;
      level = 'employee';
      levelId = employeeId;
    } else {
      const globalSetting = await SystemSetting.findOne({ where: { key } });
      if (globalSetting) {
        value = globalSetting.value;
        level = 'global';
      } else {
        const { getOrganizationSettingValue } = await import('./organizationSettingsService.js');
        const orgValue = await getOrganizationSettingValue(String(key));
        if (orgValue != null && orgValue !== '') {
          value = orgValue;
          level = 'global';
        }
      }
    }

    res.json({ value, level, levelId });
  } catch (error) {
    console.error('Error getting effective setting:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ AUDIT API ============
router.use('/audit', requireViewOrManagePermission('audit.view', 'audit.manage'));

router.get('/audit/all', async (req, res) => {
  const { entityType, performedBy, startDate, endDate, limit = 100 } = req.query;

  try {
    const where: any = {};

    if (entityType) where.entityType = entityType;
    if (performedBy) where.performedBy = performedBy;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate as string);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate as string);
    }

    const logs = await AuditLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit as string)
    });

    res.json(logs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/audit/compliance-report', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Start and end dates required' });
  }

  try {
    const logs = await AuditLog.findAll({
      where: {
        createdAt: {
          [Op.between]: [new Date(startDate as string), new Date(endDate as string)]
        }
      },
      order: [['createdAt', 'ASC']]
    });

    const summary = {
      totalChanges: logs.length,
      settingChanges: logs.filter(l => l.entityType.includes('setting')).length,
      permissionChanges: logs.filter(l => l.entityType === 'permission_override' || l.entityType === 'permission_request').length,
      usersAffected: new Set(logs.map(l => l.entityId)).size,
      byUser: {} as Record<string, number>
    };

    for (const log of logs) {
      summary.byUser[log.performedBy] = (summary.byUser[log.performedBy] || 0) + 1;
    }

    res.json({ logs, summary });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/audit/login-behavior', async (req, res) => {
  const { userId, action, startDate, endDate, limit = 200 } = req.query as Record<string, string>;
  try {
    const where: any = { entityType: 'auth_login' };
    if (userId) where.entityId = userId;
    if (action) where.action = action;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const rows = await AuditLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    });
    const performedByIds = Array.from(
      new Set(rows.map((row: any) => String(row.performedBy || '')).filter(Boolean))
    );
    const actorById = await buildAuditActorMap(performedByIds);
    const sessionByKey = new Map<string, string>();
    const pairs = rows
      .map((row: any) => {
        const plain = row.get({ plain: true });
        const meta = parseAuditMetadata(plain.metadata);
        const userId = String(plain.entityId || plain.performedBy || '');
        const deviceId = String(meta.deviceId || '');
        return userId && deviceId ? { userId, deviceId } : null;
      })
      .filter(Boolean) as Array<{ userId: string; deviceId: string }>;

    if (pairs.length > 0) {
      const sessions = (await UserDeviceSession.findAll({
        where: {
          [Op.or]: pairs.map((p) => ({ userId: p.userId, deviceId: p.deviceId })),
        },
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
      const userId = String(plain.entityId || plain.performedBy || '');
      const deviceId = String(meta.deviceId || '');
      const sessionLabel = deviceId ? sessionByKey.get(`${userId}:${deviceId}`) : undefined;
      const deviceLabel = resolveDeviceLabelFromMetadata(meta, sessionLabel);
      return {
        ...plain,
        metadata: { ...meta, deviceLabel },
        changedBy: actorById.get(String(plain.performedBy || '')) || null,
      };
    });
    res.json(payload);
  } catch (error) {
    console.error('Error fetching login behavior logs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/audit/trail', async (req, res) => {
  const {
    entityType,
    entityId,
    action,
    performedBy,
    startDate,
    endDate,
    limit = 200,
  } = req.query as Record<string, string>;

  try {
    const { listUnifiedAuditTrail } = await import('./auditTrailService.js');
    const payload = await listUnifiedAuditTrail({
      entityType,
      entityId,
      action,
      performedBy,
      startDate,
      endDate,
      limit: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    });
    res.json(payload);
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ EXISTING API ENDPOINTS ============

// Users — account rows in `users`; profile fields come from linked `employees`.
// Note: no long-lived cache wrapper. The /users feed is used by User Management for live
// admin ops. Pass ?view=directory to skip salary structures (Attendance / Leaves joins).
router.get('/users', async (req, res) => {
  const users: any[] = await User.findAll({ attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  const safe = users.map((u) => stripUserSecrets(u.get ? u.get({ plain: true }) : u));
  const view = String((req.query as { view?: string }).view ?? '')
    .trim()
    .toLowerCase();
  const profiles = await serializeUsersForClient(safe, {
    skipStatusSync: true,
    skipSalary: view === 'directory' || view === 'lite',
  });
  res.json(profiles);
});

// Generate next user ID
// Suggested next User.id for admin flows (matches seeded `u-1`, `u-2`, … — not employee display IDs).
router.get('/users/next-id', hrManagerAccess, async (req, res) => {
  try {
    const users = await User.findAll({ attributes: ['id'] });
    let maxSeq = 0;
    for (const u of users as any[]) {
      const m = String(u.id || '').match(/^u-(\d+)$/i);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    res.json(`u-${maxSeq + 1}`);
  } catch (error) {
    console.error('Error generating next ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Next portal-only admin EmpID (ADM00001) — not an employees.employee_id badge. */
router.get('/users/next-admin-login-id', requireEffectivePermission('users.manage'), async (_req, res) => {
  try {
    const { nextAdminLoginId } = await import('./systemAdminAccount.js');
    res.json({ loginId: await nextAdminLoginId() });
  } catch (error) {
    console.error('Error generating next admin login id:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Portal-only system administrators (Settings → Create Admin). */
router.get('/users/system-admins', requireEffectivePermission('users.view'), async (_req, res) => {
  try {
    const { listSystemAdminAccounts } = await import('./systemAdminAccount.js');
    const rows = await listSystemAdminAccounts();
    const safe = rows.map((u) => stripUserSecrets(u));
    res.json(await serializeUsersForClient(safe, { skipStatusSync: true }));
  } catch (error) {
    console.error('Error listing system admins:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/users/:id', async (req, res) => {
  const user: any = await User.findByPk(req.params.id, {
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(await serializeUserForClient(stripUserSecrets(user)));
});

router.post('/users/system-admin', requireEffectivePermission('users.manage'), async (req, res) => {
  const data = req.body || {};
  try {
    if (!data.password || (await rejectInvalidPortalPassword(res, String(data.password)))) return;
    const { createSystemAdminAccount } = await import('./systemAdminAccount.js');
    const user = await createSystemAdminAccount({
      email: data.email,
      phone: data.phone,
      password: data.password,
      displayName: data.displayName ?? data.display_name ?? data.name,
      isActive: data.isActive,
      id: data.id,
      loginId: data.loginId ?? data.login_id,
      nextUserId,
    });
    const { notifyPortalAccountReady } = await import('./notificationService.js');
    void notifyPortalAccountReady({ userId: String(user.get('id')) }).catch(() => undefined);
    clearCachePrefix('all_users');
    res.status(201).json(await serializeUserForClient(stripUserSecrets(user.get({ plain: true }))));
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : 'Failed to create system administrator';
    const code = /valid email|password|already exists|login id|conflicts/i.test(msg) ? 400 : 500;
    console.error('Error creating system admin:', error);
    res.status(code).json({ message: msg });
  }
});

router.post('/users', requireEffectivePermission('users.manage'), async (req, res) => {
  const data = req.body || {};
  try {
    const { resolveDefaultPortalPasswordForNewAccount } = await import('./defaultPortalPassword.js');
    const explicitPassword = String(data.password || '').trim();
    let plainPassword = explicitPassword;
    if (!plainPassword) {
      try {
        plainPassword = await resolveDefaultPortalPasswordForNewAccount();
      } catch (err: any) {
        return res.status(400).json({
          message: err?.message || 'A password is required when default portal password is disabled.',
        });
      }
    }
    if (await rejectInvalidPortalPassword(res, plainPassword)) return;

    const allowedRoles = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
    const roleValue = String(data.role || 'EMPLOYEE').toUpperCase();
    if (!allowedRoles.includes(roleValue)) {
      return res.status(400).json({ message: `Role must be one of ${allowedRoles.join(', ')}` });
    }

    if (roleValue === 'ADMIN' || data.systemAccount === true || data.accountType === 'system') {
      return res.status(400).json({
        message:
          'System Admin accounts are created under Settings → Create Admin or POST /users/system-admin. They are not linked to employee records.',
      });
    }

    // Portal users for staff MUST be linked to an existing Employee record. The frontend
    // forces the admin to pick an Employee in the Create User modal - we then locate
    // that Employee by id, employee_id (IROCxxxxx), email, or phone and copy the
    // canonical profile fields so User and Employee never diverge.
    const lookupClauses: any[] = [];
    if (data.employeeId) lookupClauses.push({ id: String(data.employeeId) });
    if (data.employee_id) lookupClauses.push({ employee_id: String(data.employee_id) });
    const emailInput = String(data.email || '').trim().toLowerCase();
    if (emailInput) lookupClauses.push({ email: emailInput });
    const phoneInput = data.phone ? normalizePhone(data.phone) : '';
    if (phoneInput) lookupClauses.push({ phone: phoneInput });

    if (lookupClauses.length === 0) {
      return res.status(400).json({
        message: 'A user account must be linked to an existing employee. Provide employeeId, email, or phone.',
      });
    }

    const employee: any = await Employee.findOne({
      where: { [Op.or]: lookupClauses },
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Position, as: 'position', attributes: ['id', 'title'] },
      ],
    });

    if (!employee) {
      return res.status(400).json({
        message:
          'No employee matches the provided employeeId/email/phone. Onboard the employee first, then create their user account.',
      });
    }

    const empPlain = employee.toJSON ? employee.toJSON() : employee;
    if (empPlain.status && String(empPlain.status).toUpperCase() !== 'ACTIVE') {
      return res.status(400).json({
        message: `Employee ${empPlain.employee_id || empPlain.id} is ${empPlain.status}. Only ACTIVE employees can have a user account.`,
      });
    }

    const empEmail = String(empPlain.email || '').trim();
    if (!empEmail) {
      return res.status(400).json({
        message: `Employee ${empPlain.employee_id || empPlain.id} has no email on file. Update the employee record before creating a user account.`,
      });
    }

    const existingUser: any = await User.findOne({
      where: {
        [Op.or]: [{ employeeId: empPlain.id }, { email: empEmail }],
      },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (existingUser) {
      return res.status(409).json({
        message: `A user account already exists for ${empPlain.employee_id || empPlain.id} (${existingUser.email}).`,
        field: 'employee',
      });
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 12);
    const loginPhone = normalizePhone(empPlain.phone);

    const user = await User.create({
      id: data.id || (await nextUserId()),
      email: empEmail,
      employeeId: empPlain.id,
      phone: loginPhone.length >= 8 ? loginPhone : null,
      password: hashedPassword,
      passwordLength: plainPassword.length,
      role: roleValue,
      isActive: data.isActive ?? true,
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
      mustChangePassword: true,
    } as any);
    const { notifyPortalAccountReady } = await import('./notificationService.js');
    void notifyPortalAccountReady({
      userId: String(user.get('id')),
      employeeDisplayId: String(empPlain.employee_id || ''),
    }).catch(() => undefined);

    clearCachePrefix('all_users');
    clearCachePrefix('report_stats');
    res.status(201).json(await serializeUserForClient(stripUserSecrets(user)));
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const field = error?.errors?.[0]?.path === 'phone' ? 'phone' : 'email';
      return res.status(409).json({
        message: `A user with this ${field} already exists.`,
        field,
      });
    }
    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        message: error?.errors?.[0]?.message || 'Validation failed',
      });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Account management (role / active / password) for admins and users.manage holders; photo/bio for self. */
router.put('/users/:id', requireAuth, async (req, res) => {
  try {
    const viewer = (req as any).user as { id: string; role: string };
    const isSelf = viewer.id === req.params.id;
    const roleUpper = String(viewer.role || '').toUpperCase();

    const { getEffectivePermissionsForUser, hasEffectivePermission } = await import(
      './effectivePermissions.js'
    );
    const permMap = await getEffectivePermissionsForUser(String(viewer.id));
    const canManageUsers = hasEffectivePermission(permMap, 'users.manage', roleUpper);

    if (!canManageUsers && !isSelf) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const user: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accountPatch: Record<string, unknown> = {};
    const userPlain = user.get({ plain: true });
    const previousRole = String(userPlain.role || '');
    const previousActive = Boolean(userPlain.isActive);

    const accountFrozen = isPortalUserFrozen(userPlain);
    const wantsReactivate = body.isActive === true;

    if (canManageUsers && accountFrozen && !wantsReactivate) {
      return res.status(403).json({
        message:
          'This account is frozen. Turn on Account active and save to restore sign-in, or restore the employee first if they were terminated.',
      });
    }

    if (canManageUsers) {
      if (body.role !== undefined) {
        const allowed = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
        const r = String(body.role || '').toUpperCase();
        if (!allowed.includes(r)) {
          return res.status(400).json({
            message: `Role must be one of ${allowed.join(', ')}`,
          });
        }
        const { isSystemAdminAccount } = await import('./systemAdminAccount.js');
        const plain = user.get({ plain: true }) as { role?: string; employeeId?: string };
        if (isSystemAdminAccount(plain) && r !== 'ADMIN') {
          return res.status(400).json({
            message: 'System administrator accounts must keep the Admin access role.',
          });
        }
        const linkedEmployeeId = String(plain.employeeId ?? '').trim();
        if (r === 'ADMIN' && linkedEmployeeId) {
          return res.status(400).json({
            message:
              'Admin access is for system accounts only (Settings → Create Admin), not employee records.',
          });
        }
        // Non-admin managers of user accounts cannot promote anyone to Admin.
        if (r === 'ADMIN' && roleUpper !== 'ADMIN' && roleUpper !== 'SUPER_ADMIN') {
          return res.status(403).json({
            message: 'Only administrators can assign the Admin access role.',
          });
        }
        accountPatch.role = r;
      }
      if (body.isActive !== undefined) {
        const wantsActive = !!body.isActive;
        if (wantsActive) {
          const linkedEmp = await findEmployeeForUser(user.get({ plain: true }));
          const empStatus = linkedEmp
            ? String((linkedEmp.get ? linkedEmp.get('status') : linkedEmp.status) ?? '')
            : '';
          if (
            isEmployeeInactiveForPortal(empStatus) ||
            isEmployeeDraftStatus(empStatus) ||
            (empStatus && !isEmployeeAllowedSystemAccess(empStatus))
          ) {
            return res.status(400).json({
              message: isEmployeeDraftStatus(empStatus)
                ? 'Cannot activate this user while the employee is still a draft. Activate the employee in the Employees module first.'
                : 'Cannot activate this user while the employee is inactive. Set the employee to Active in the Employees module first.',
            });
          }
          if (isPortalUserFrozen(userPlain)) {
            await unfreezePortalUserById(String(user.id));
            delete accountPatch.isActive;
            delete accountPatch.status;
          } else {
            accountPatch.isActive = wantsActive;
            accountPatch.status = 'ACTIVE';
          }
        } else {
          accountPatch.isActive = wantsActive;
          accountPatch.status = 'INACTIVE';
        }
      } else if (body.status !== undefined) {
        accountPatch.status = String(body.status);
      }

      if (body.password !== undefined) {
        const raw = String(body.password || '');
        if (raw) {
          if (await rejectInvalidPortalPassword(res, raw)) return;
          accountPatch.password = await bcrypt.hash(raw, 12);
          accountPatch.passwordLength = raw.length;
          accountPatch.passwordChangedAt = new Date();
          // Admin-assigned passwords are temporary — user must choose their own on next sign-in.
          accountPatch.mustChangePassword = true;
          accountPatch.sessionToken = null;
        }
      }

      if (accountPatch.isActive === false) {
        accountPatch.sessionToken = null;
      }
    }

    // Self-service profile — photo + bio; HR updates other fields via employee management.
    if (isSelf) {
      const selfPatch: Record<string, unknown> = {};
      if (body.avatarUrl !== undefined) selfPatch.avatarUrl = body.avatarUrl;
      if (body.bio !== undefined) {
        selfPatch.bio = String(body.bio ?? '')
          .replace(/\0/g, '')
          .trim()
          .slice(0, 2000);
      }
      if (Object.keys(selfPatch).length) {
        await applySelfProfilePatchToEmployee(user.id, selfPatch);
      }
    }

    if (Object.keys(accountPatch).length) {
      await user.update(accountPatch);
      const { notifyAccountEvent } = await import('./notificationService.js');
      const revision = new Date(user.updatedAt || Date.now()).getTime().toString(36);
      if (accountPatch.role && String(accountPatch.role) !== previousRole) {
        void notifyAccountEvent({
          userId: String(user.id),
          event: 'ROLE_CHANGED',
          actorUserId: viewer.id,
          detail: `Your access role changed from ${previousRole} to ${String(accountPatch.role)}.`,
          eventKey: revision,
        }).catch(() => undefined);
      }
      if (typeof accountPatch.isActive === 'boolean' && accountPatch.isActive !== previousActive) {
        void notifyAccountEvent({
          userId: String(user.id),
          event: accountPatch.isActive ? 'ACTIVATED' : 'DEACTIVATED',
          actorUserId: viewer.id,
          eventKey: revision,
        }).catch(() => undefined);
        if (!accountPatch.isActive) {
          // End every device session so a still-open browser is signed out immediately.
          await revokePortalSessionsForUser(String(user.id));
        }
      }
      if (accountPatch.password) {
        void notifyAccountEvent({
          userId: String(user.id),
          event: 'PASSWORD_CHANGED',
          actorUserId: viewer.id,
          eventKey: revision,
        }).catch(() => undefined);
        await revokePortalSessionsForUser(String(user.id));
      }
    }

    clearCachePrefix('all_users');
    const fresh: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    res.json(await serializeUserForClient(stripUserSecrets(fresh)));
  } catch (error: any) {
    console.error('Error updating user:', error);
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const field = error?.errors?.[0]?.path === 'phone' ? 'phone' : 'email';
      return res.status(409).json({
        message: `Another user already uses this ${field}.`,
        field,
      });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/users/:id/freeze', requireEffectivePermission('users.manage'), async (req, res) => {
  try {
    const viewer = (req as any).user as { id: string };
    // Admins may freeze other portal admins; never their own session account.
    if (String(viewer?.id ?? '') === String(req.params.id ?? '')) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }

    const user: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const plain = user.get({ plain: true });

    if (!isPortalUserAllowedSession(plain)) {
      return res.status(400).json({ message: 'Account is already inactive.' });
    }

    await freezePortalUserById(req.params.id);
    const { notifyAccountEvent } = await import('./notificationService.js');
    void notifyAccountEvent({
      userId: req.params.id,
      event: 'DEACTIVATED',
      actorUserId: viewer.id,
      eventKey: Date.now().toString(36),
    }).catch(() => undefined);
    clearCachePrefix('all_users');

    const fresh: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    res.json(await serializeUserForClient(stripUserSecrets(fresh)));
  } catch (error) {
    console.error('Error freezing user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/users/:id/unfreeze', requireEffectivePermission('users.manage'), async (req, res) => {
  try {
    const user: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const plain = user.get({ plain: true });
    if (isPortalUserAllowedSession(plain)) {
      return res.status(400).json({ message: 'Account is already active.' });
    }

    const linkedEmp = await findEmployeeForUser(plain);
    const empStatus = linkedEmp
      ? String((linkedEmp.get ? linkedEmp.get('status') : linkedEmp.status) ?? '')
      : '';
    if (
      isEmployeeInactiveForPortal(empStatus) ||
      isEmployeeDraftStatus(empStatus) ||
      (empStatus && !isEmployeeAllowedSystemAccess(empStatus))
    ) {
      return res.status(400).json({
        message: isEmployeeDraftStatus(empStatus)
          ? 'Cannot reactivate this user while the employee is still a draft. Activate the employee in the Employees module first.'
          : 'Cannot reactivate this user while the employee is inactive or terminated. Restore the employee in the Employees module first.',
      });
    }

    await unfreezePortalUserById(req.params.id);
    const { notifyAccountEvent } = await import('./notificationService.js');
    void notifyAccountEvent({
      userId: req.params.id,
      event: 'ACTIVATED',
      actorUserId: String((req as any).user?.id || ''),
      eventKey: Date.now().toString(36),
    }).catch(() => undefined);
    clearCachePrefix('all_users');

    const fresh: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    res.json(await serializeUserForClient(stripUserSecrets(fresh)));
  } catch (error) {
    console.error('Error unfreezing user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/users/:id', requireEffectivePermission('users.manage'), async (req, res) => {
  try {
    const user: any = await User.findByPk(req.params.id, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (isPortalUserFrozen(user.get({ plain: true }))) {
      return res.status(403).json({
        message: 'Frozen accounts cannot be deleted. They are kept for audit as view-only records.',
      });
    }
    await user.destroy();
    clearCachePrefix('all_users');
    clearCachePrefix('report_stats');
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Departments — short server cache; invalidated on department mutations
router.get('/departments', cacheMiddleware(90 * 1000), async (req, res) => {
  try {
    const activeOnly =
      String(req.query.activeOnly ?? req.query.active_only ?? '').trim() === '1' ||
      String(req.query.activeOnly ?? req.query.active_only ?? '').toLowerCase() === 'true';
    const departments = await Department.findAll({
      where: activeOnly ? { isActive: true } : {},
      order: [['name', 'ASC']],
    });
    const payload = await formatDepartmentsList(departments);
    res.set('Cache-Control', 'private, max-age=90');
    res.json(payload);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/departments/:id', async (req, res) => {
  try {
    const dept: any = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ message: 'Department not found' });
    res.set('Cache-Control', 'no-store');
    res.json(await formatDepartmentRow(dept));
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/departments', requireEffectivePermission('departments.manage'), async (req, res) => {
  const data = req.body || {};
  try {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return res.status(400).json({ message: 'Department name is required.' });
    const { parseRequiredKhmerText } = await import('./departmentApi.js');
    const nameKh = parseRequiredKhmerText(data, 'nameKh', 'name_kh', 'Department name');
    if (!nameKh) {
      return res.status(400).json({ message: 'Department name (Khmer) is required.' });
    }
    const { parseOptionalDepartmentCode } = await import('./departmentApi.js');
    const code = parseOptionalDepartmentCode(data);
    const department = await Department.create({
      id: await generateNextDepartmentId(),
      name,
      name_kh: nameKh,
      ...(code !== undefined ? { code } : {}),
      office_location_id: null,
      isActive: true,
    });
    if (data.managerId) {
      await assignDepartmentManager(String(department.get('id')), data.managerId);
    }
    await department.reload();
    invalidateDepartmentListCache();
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    const formatted = await formatDepartmentRow(department);
    await writeDomainAudit({
      entityType: 'department',
      entityId: String(department.get('id')),
      action: 'CREATE',
      performedBy: String((req as any).user?.id ?? 'system'),
      newValue: pickAuditFields(formatted),
      reason: 'Department created',
    });
    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: String(department.get('id')),
      entityType: 'DEPARTMENT',
      name,
      action: 'CREATED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'created',
    }).catch(() => undefined);
    res.status(201).json(formatted);
  } catch (error) {
    if (error instanceof DepartmentManagerError) {
      return res.status(error.status).json({ message: error.message });
    }
    const errName = String((error as { name?: string })?.name ?? '');
    if (errName === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'Unit code is already in use by another department.' });
    }
    console.error('Error creating department:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/departments/:id', requireEffectivePermission('departments.manage'), async (req, res) => {
  try {
    const dept: any = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ message: 'Department not found' });

    const beforePlain = dept.get({ plain: true }) as Record<string, unknown>;
    const { name, nameKh, name_kh } = req.body || {};
    const patch: Record<string, unknown> = {};
    if (name != null) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ message: 'Department name is required.' });
      patch.name = trimmed;
    }
    if (nameKh != null || name_kh != null) {
      const { parseRequiredKhmerText } = await import('./departmentApi.js');
      const kh = parseRequiredKhmerText(req.body, 'nameKh', 'name_kh', 'Department name');
      if (!kh) {
        return res.status(400).json({ message: 'Department name (Khmer) is required.' });
      }
      patch.name_kh = kh;
    }
    {
      const { parseOptionalDepartmentCode } = await import('./departmentApi.js');
      const code = parseOptionalDepartmentCode(req.body || {});
      if (code !== undefined) patch.code = code;
    }
    patch.office_location_id = null;
    if (Object.keys(patch).length) await dept.update(patch);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'managerId')) {
      const rawManager = req.body.managerId;
      const portalUserId =
        rawManager == null || String(rawManager).trim() === '' ? null : String(rawManager).trim();
      await assignDepartmentManager(req.params.id, portalUserId);
    }
    await dept.reload();
    invalidateDepartmentListCache();
    const { writeDomainAudit, diffAuditSnapshots } = await import('./domainAuditService.js');
    const afterFormatted = await formatDepartmentRow(dept);
    const diff = diffAuditSnapshots(beforePlain, afterFormatted as Record<string, unknown>);
    if (diff) {
      await writeDomainAudit({
        entityType: 'department',
        entityId: String(req.params.id),
        action: 'UPDATE',
        performedBy: String((req as any).user?.id ?? 'system'),
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        reason: 'Department updated',
      });
      const employees = await Employee.findAll({
        where: { department_id: req.params.id },
        attributes: ['id'],
      });
      const { notifyOrganizationChanged, resolvePortalUserIdsForRefs } = await import(
        './notificationService.js'
      );
      const affectedUserIds = await resolvePortalUserIdsForRefs(
        employees.map((employee) => employee.get('id'))
      );
      void notifyOrganizationChanged({
        entityId: req.params.id,
        entityType: 'DEPARTMENT',
        name: String(afterFormatted.name || dept.name || 'Department'),
        action: 'UPDATED',
        actorUserId: String((req as any).user?.id || ''),
        affectedUserIds,
        revision: Date.now().toString(36),
      }).catch(() => undefined);
    }
    res.json(afterFormatted);
  } catch (error) {
    if (error instanceof DepartmentManagerError) {
      return res.status(error.status).json({ message: error.message });
    }
    const errName = String((error as { name?: string })?.name ?? '');
    if (errName === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ message: 'Unit code is already in use by another department.' });
    }
    console.error('Error updating department:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/departments/:id', requireEffectivePermission('departments.manage'), async (req, res) => {
  try {
    const deptId = String(req.params.id);
    const dept: any = await Department.findByPk(deptId);
    if (!dept) return res.status(404).json({ message: 'Department not found' });

    const { countEmployeesReferencingDepartment } = await import('./departmentApi.js');
    const assignedStaff = await countEmployeesReferencingDepartment(deptId);
    if (assignedStaff > 0) {
      return res.status(409).json({
        message:
          `Cannot delete this department while ${assignedStaff} employee(s) are still assigned. ` +
          `Move or offboard them first, or deactivate the department instead to keep history.`,
        assignedStaff,
      });
    }

    const positionCount = await Position.count({ where: { department_id: deptId } });
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    const actorUserId = String((req as any).user?.id ?? 'system');
    const deptName = String(dept.name || 'Department');
    const oldValue = pickAuditFields(dept.get({ plain: true }) as Record<string, unknown>);

    const result = await sequelize.transaction(async (transaction) => {
      await assignDepartmentManager(deptId, null, { transaction });

      const deletedPositions = await Position.destroy({
        where: { department_id: deptId },
        transaction,
      });

      await writeDomainAudit({
        entityType: 'department',
        entityId: deptId,
        action: 'DELETE',
        performedBy: actorUserId,
        oldValue,
        reason: 'Department permanently deleted (no assigned staff)',
      });

      await dept.destroy({ transaction });

      return {
        deletedPositions: Number(deletedPositions) || positionCount,
      };
    });

    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: deptId,
      entityType: 'DEPARTMENT',
      name: deptName,
      action: 'DELETED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'deleted',
    }).catch(() => undefined);
    invalidateDepartmentListCache();
    res.json({
      success: true,
      deleted: true,
      deletedPositions: result.deletedPositions,
    });
  } catch (error) {
    if (error instanceof DepartmentManagerError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error deleting department:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post(
  '/departments/:id/deactivate',
  requireEffectivePermission('departments.manage'),
  async (req, res) => {
    try {
      const deptId = String(req.params.id);
      const dept: any = await Department.findByPk(deptId);
      if (!dept) return res.status(404).json({ message: 'Department not found' });

      const { departmentIsActiveFromRow } = await import('./departmentApi.js');
      if (!departmentIsActiveFromRow(dept.get({ plain: true }) as Record<string, unknown>)) {
        return res.status(409).json({
          message: 'Department is already inactive.',
          isActive: false,
          department: await formatDepartmentRow(dept),
        });
      }

      const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
      const actorUserId = String((req as any).user?.id ?? 'system');
      const deptName = String(dept.name || 'Department');
      const oldValue = pickAuditFields(dept.get({ plain: true }) as Record<string, unknown>);

      await dept.update({ isActive: false });
      await writeDomainAudit({
        entityType: 'department',
        entityId: deptId,
        action: 'UPDATE',
        performedBy: actorUserId,
        oldValue,
        newValue: { isActive: false },
        reason: 'Department deactivated (closed for new assignments; staff kept)',
      });

      const { notifyOrganizationChanged } = await import('./notificationService.js');
      void notifyOrganizationChanged({
        entityId: deptId,
        entityType: 'DEPARTMENT',
        name: deptName,
        action: 'UPDATED',
        actorUserId: String((req as any).user?.id || ''),
        revision: 'deactivated',
      }).catch(() => undefined);
      invalidateDepartmentListCache();
      const formatted = await formatDepartmentRow(dept);
      res.json({
        success: true,
        deactivated: true,
        department: formatted,
      });
    } catch (error) {
      console.error('Error deactivating department:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.post(
  '/departments/:id/reactivate',
  requireEffectivePermission('departments.manage'),
  async (req, res) => {
    try {
      const deptId = String(req.params.id);
      const dept: any = await Department.findByPk(deptId);
      if (!dept) return res.status(404).json({ message: 'Department not found' });

      const { departmentIsActiveFromRow } = await import('./departmentApi.js');
      if (departmentIsActiveFromRow(dept.get({ plain: true }) as Record<string, unknown>)) {
        return res.json(await formatDepartmentRow(dept));
      }

      const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
      const oldValue = pickAuditFields(dept.get({ plain: true }) as Record<string, unknown>);
      await dept.update({ isActive: true });
      await writeDomainAudit({
        entityType: 'department',
        entityId: deptId,
        action: 'UPDATE',
        performedBy: String((req as any).user?.id ?? 'system'),
        oldValue,
        newValue: { isActive: true },
        reason: 'Department reactivated',
      });
      invalidateDepartmentListCache();
      const formatted = await formatDepartmentRow(dept);
      const { notifyOrganizationChanged } = await import('./notificationService.js');
      void notifyOrganizationChanged({
        entityId: deptId,
        entityType: 'DEPARTMENT',
        name: String(formatted.name || dept.name || 'Department'),
        action: 'UPDATED',
        actorUserId: String((req as any).user?.id || ''),
        revision: 'reactivated',
      }).catch(() => undefined);
      res.json(formatted);
    } catch (error) {
      console.error('Error reactivating department:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Positions
router.get('/positions', async (req, res) => {
  try {
    const { departmentId } = req.query;
    const activeOnly =
      String(req.query.activeOnly ?? req.query.active_only ?? '').trim() === '1' ||
      String(req.query.activeOnly ?? req.query.active_only ?? '').toLowerCase() === 'true';
    const where: Record<string, unknown> = {};
    if (departmentId) where.department_id = String(departmentId);
    if (activeOnly) where.isActive = true;
    const positions = await Position.findAll({
      where,
      order: [['title', 'ASC']],
    });
    const ids = positions.map((p) => String(p.get('id')));
    const assignedById = new Map<string, number>();
    if (ids.length) {
      const rows = (await Employee.findAll({
        attributes: ['position_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        where: { position_id: { [Op.in]: ids } },
        group: ['position_id'],
        raw: true,
      })) as unknown as Array<{ position_id: string; cnt: number | string }>;
      for (const row of rows) {
        assignedById.set(String(row.position_id), Number(row.cnt) || 0);
      }
    }
    res.json(
      positions.map((p) => ({
        ...normalizePositionRow(p),
        assignedStaff: assignedById.get(String(p.get('id'))) ?? 0,
      }))
    );
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/positions', hrManagerAccess, async (req, res) => {
  const { title, titleKh, title_kh, departmentId, description, level, accessRole, access_role } =
    req.body || {};
  try {
    const titleTrimmed = typeof title === 'string' ? title.trim() : '';
    if (!titleTrimmed || !departmentId) {
      return res.status(400).json({ message: 'title and departmentId are required' });
    }
    const { parseRequiredKhmerText } = await import('./departmentApi.js');
    const titleKhTrimmed = parseRequiredKhmerText(req.body, 'titleKh', 'title_kh', 'Position title');
    if (!titleKhTrimmed) {
      return res.status(400).json({ message: 'Position title (Khmer) is required.' });
    }
    const { normalizePositionLevel } = await import('./positionCatalog.js');
    const { normalizeAccessRole, EMPLOYEE_FORM_ACCESS_ROLES } = await import('./accessRole.js');
    const levelCode = normalizePositionLevel(level);
    if (!levelCode) {
      return res.status(400).json({ message: 'A valid position level is required.' });
    }
    const access = normalizeAccessRole(accessRole ?? access_role);
    if (!(EMPLOYEE_FORM_ACCESS_ROLES as readonly string[]).includes(access)) {
      return res.status(400).json({
        message: 'Access role must be Manager, Employee, or HR.',
      });
    }
    const range = parsePositionSalaryRange(req.body || {});
    const parentDept: any = await Department.findByPk(String(departmentId), {
      attributes: ['id', 'isActive'],
    });
    if (!parentDept) {
      return res.status(400).json({ message: 'Department not found.' });
    }
    const parentActive = parentDept.get('isActive');
    if (parentActive === false || parentActive === 0 || parentActive === '0') {
      return res.status(400).json({
        message: 'Cannot add positions to an inactive department. Reactivate it first.',
      });
    }
    const position = await Position.create({
      id: await generateNextPositionId(),
      title: titleTrimmed,
      title_kh: titleKhTrimmed,
      department_id: departmentId,
      level: levelCode,
      access_role: access,
      salary_min: range.salaryMin,
      salary_max: range.salaryMax,
      description: description ?? '',
      isActive: true,
    });
    const normalized = normalizePositionRow(position);
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    await writeDomainAudit({
      entityType: 'position',
      entityId: String(position.get('id')),
      action: 'CREATE',
      performedBy: String((req as any).user?.id ?? 'system'),
      newValue: pickAuditFields(normalized),
      reason: 'Position created',
    });
    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: String(position.get('id')),
      entityType: 'POSITION',
      name: titleTrimmed,
      action: 'CREATED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'created',
    }).catch(() => undefined);
    res.status(201).json(normalized);
  } catch (error) {
    console.error('Error creating position:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/positions/:id', hrManagerAccess, async (req, res) => {
  try {
    const position: any = await Position.findByPk(req.params.id);
    if (!position) return res.status(404).json({ message: 'Position not found' });

    const beforeNormalized = normalizePositionRow(position);
    const { title, titleKh, title_kh, departmentId, description, level, accessRole, access_role } =
      req.body || {};
    const patch: Record<string, unknown> = {};
    if (title != null) {
      const trimmed = String(title).trim();
      if (!trimmed) return res.status(400).json({ message: 'Position title is required.' });
      patch.title = trimmed;
    }
    if (titleKh != null || title_kh != null) {
      const { parseRequiredKhmerText } = await import('./departmentApi.js');
      const kh = parseRequiredKhmerText(req.body, 'titleKh', 'title_kh', 'Position title');
      if (!kh) {
        return res.status(400).json({ message: 'Position title (Khmer) is required.' });
      }
      patch.title_kh = kh;
    }
    if (description != null) patch.description = description;
    if (level != null) {
      const { normalizePositionLevel } = await import('./positionCatalog.js');
      const levelCode = normalizePositionLevel(level);
      if (!levelCode) {
        return res.status(400).json({ message: 'A valid position level is required.' });
      }
      patch.level = levelCode;
    }
    if (accessRole != null || access_role != null) {
      const { normalizeAccessRole, EMPLOYEE_FORM_ACCESS_ROLES } = await import('./accessRole.js');
      const access = normalizeAccessRole(accessRole ?? access_role);
      if (!(EMPLOYEE_FORM_ACCESS_ROLES as readonly string[]).includes(access)) {
        return res.status(400).json({
          message: 'Access role must be Manager, Employee, or HR.',
        });
      }
      patch.access_role = access;
    }
    if (
      req.body?.salaryMin != null ||
      req.body?.salaryMax != null ||
      req.body?.salary != null
    ) {
      const range = parsePositionSalaryRange(req.body || {});
      patch.salary_min = range.salaryMin;
      patch.salary_max = range.salaryMax;
    }
    if (departmentId != null) {
      patch.department_id = departmentId;
    }
    await position.update(patch);
    const afterNormalized = normalizePositionRow(position);
    const { writeDomainAudit, diffAuditSnapshots } = await import('./domainAuditService.js');
    const diff = diffAuditSnapshots(
      beforeNormalized as Record<string, unknown>,
      afterNormalized as Record<string, unknown>
    );
    if (diff) {
      await writeDomainAudit({
        entityType: 'position',
        entityId: String(req.params.id),
        action: 'UPDATE',
        performedBy: String((req as any).user?.id ?? 'system'),
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        reason: 'Position updated',
      });
      const employees = await Employee.findAll({
        where: { position_id: req.params.id },
        attributes: ['id'],
      });
      const { notifyOrganizationChanged, resolvePortalUserIdsForRefs } = await import(
        './notificationService.js'
      );
      const affectedUserIds = await resolvePortalUserIdsForRefs(
        employees.map((employee) => employee.get('id'))
      );
      void notifyOrganizationChanged({
        entityId: req.params.id,
        entityType: 'POSITION',
        name: String((afterNormalized as any).title || position.title || 'Position'),
        action: 'UPDATED',
        actorUserId: String((req as any).user?.id || ''),
        affectedUserIds,
        revision: Date.now().toString(36),
      }).catch(() => undefined);
    }
    res.json(afterNormalized);
  } catch (error) {
    console.error('Error updating position:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/company-structure', async (_req, res) => {
  try {
    const { buildCompanyStructure } = await import('./companyStructureService.js');
    res.json(await buildCompanyStructure());
  } catch (error) {
    console.error('Error building company structure:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/positions/:id', hrManagerAccess, async (req, res) => {
  try {
    const position: any = await Position.findByPk(req.params.id);
    if (!position) return res.status(404).json({ message: 'Position not found' });

    const { countEmployeesReferencingPosition } = await import('./departmentApi.js');
    const assignedStaff = await countEmployeesReferencingPosition(String(position.id));
    if (assignedStaff > 0) {
      return res.status(409).json({
        message:
          `Cannot delete this position while ${assignedStaff} employee(s) are still assigned. ` +
          `Move or offboard them first, or deactivate the position instead to keep history.`,
        assignedStaff,
      });
    }

    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    await writeDomainAudit({
      entityType: 'position',
      entityId: String(position.id),
      action: 'DELETE',
      performedBy: String((req as any).user?.id ?? 'system'),
      oldValue: pickAuditFields(normalizePositionRow(position) as Record<string, unknown>),
      reason: 'Position permanently deleted (no assigned staff)',
    });
    try {
      await position.destroy();
    } catch (destroyErr: any) {
      const isFk =
        destroyErr?.name === 'SequelizeForeignKeyConstraintError' ||
        destroyErr?.parent?.code === 'ER_ROW_IS_REFERENCED_2';
      if (isFk) {
        return res.status(409).json({
          message:
            'Cannot delete this position while employees still reference it. ' +
            'Move or offboard them first, or deactivate the position instead to keep history.',
        });
      }
      throw destroyErr;
    }
    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: req.params.id,
      entityType: 'POSITION',
      name: String(position.title || 'Position'),
      action: 'DELETED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'deleted',
    }).catch(() => undefined);
    res.json({ success: true, deleted: true, message: 'Position deleted' });
  } catch (error) {
    console.error('Error deleting position:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/positions/:id/deactivate', hrManagerAccess, async (req, res) => {
  try {
    const position: any = await Position.findByPk(req.params.id);
    if (!position) return res.status(404).json({ message: 'Position not found' });

    const { positionIsActiveFromRow } = await import('./departmentApi.js');
    if (!positionIsActiveFromRow(position.get({ plain: true }) as Record<string, unknown>)) {
      return res.status(409).json({
        message: 'Position is already inactive.',
        isActive: false,
        position: normalizePositionRow(position),
      });
    }

    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    const oldValue = pickAuditFields(normalizePositionRow(position) as Record<string, unknown>);
    await position.update({ isActive: false });
    await writeDomainAudit({
      entityType: 'position',
      entityId: String(position.id),
      action: 'UPDATE',
      performedBy: String((req as any).user?.id ?? 'system'),
      oldValue,
      newValue: { isActive: false },
      reason: 'Position deactivated (closed for new assignments; staff kept)',
    });
    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: req.params.id,
      entityType: 'POSITION',
      name: String(position.title || 'Position'),
      action: 'UPDATED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'deactivated',
    }).catch(() => undefined);
    res.json({
      success: true,
      deactivated: true,
      position: normalizePositionRow(position),
      message: 'Position deactivated',
    });
  } catch (error) {
    console.error('Error deactivating position:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/positions/:id/reactivate', hrManagerAccess, async (req, res) => {
  try {
    const position: any = await Position.findByPk(req.params.id);
    if (!position) return res.status(404).json({ message: 'Position not found' });

    const { positionIsActiveFromRow, departmentIsActiveFromRow } = await import('./departmentApi.js');
    if (positionIsActiveFromRow(position.get({ plain: true }) as Record<string, unknown>)) {
      return res.json(normalizePositionRow(position));
    }

    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    const oldValue = pickAuditFields(normalizePositionRow(position) as Record<string, unknown>);
    await position.update({ isActive: true });
    await writeDomainAudit({
      entityType: 'position',
      entityId: String(position.id),
      action: 'UPDATE',
      performedBy: String((req as any).user?.id ?? 'system'),
      oldValue,
      newValue: { isActive: true },
      reason: 'Position reactivated',
    });
    const { notifyOrganizationChanged } = await import('./notificationService.js');
    void notifyOrganizationChanged({
      entityId: req.params.id,
      entityType: 'POSITION',
      name: String(position.title || 'Position'),
      action: 'UPDATED',
      actorUserId: String((req as any).user?.id || ''),
      revision: 'reactivated',
    }).catch(() => undefined);

    const normalized = normalizePositionRow(position);
    const parentDeptId = String(position.get('department_id') ?? '').trim();
    let parentDeptActive = true;
    if (parentDeptId) {
      const parentDept: any = await Department.findByPk(parentDeptId, {
        attributes: ['id', 'isActive', 'name'],
      });
      if (parentDept) {
        parentDeptActive = departmentIsActiveFromRow(
          parentDept.get({ plain: true }) as Record<string, unknown>
        );
      }
    }
    res.json({
      ...normalized,
      // Hint for UI when the parent unit is still closed for new placements.
      parentDepartmentActive: parentDeptActive,
    });
  } catch (error) {
    console.error('Error reactivating position:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Keep only real department/position FKs so employee writes never violate constraints.
 * Explicit empty/null clears placement (allowed after cascade department delete). */
async function sanitizeEmployeePlacementIds(
  payload: Record<string, unknown>,
  _existing?: { department_id?: unknown; position_id?: unknown } | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (Object.prototype.hasOwnProperty.call(payload, 'department_id')) {
    const next = String(payload.department_id ?? '').trim();
    if (!next) {
      payload.department_id = null;
    } else {
      const dept = await Department.findByPk(next, { attributes: ['id', 'isActive'] });
      if (!dept) {
        return {
          ok: false,
          message: 'Selected department is invalid or no longer exists.',
        };
      }
      const activeRaw = dept.get('isActive');
      const existingDeptId = String(_existing?.department_id ?? '').trim();
      // Allow keeping an already-assigned inactive department; block new assignments to it.
      if (
        (activeRaw === false || activeRaw === 0 || activeRaw === '0') &&
        existingDeptId !== next
      ) {
        return {
          ok: false,
          message: 'Selected department is inactive and cannot be assigned to employees.',
        };
      }
      payload.department_id = next;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'position_id')) {
    const next = String(payload.position_id ?? '').trim();
    if (!next) {
      payload.position_id = null;
    } else {
      const pos = await Position.findByPk(next, { attributes: ['id', 'isActive'] });
      if (!pos) {
        return {
          ok: false,
          message: 'Selected position is invalid or no longer exists. Choose a position from the list.',
        };
      }
      const activeRaw = pos.get('isActive');
      const existingPosId = String(_existing?.position_id ?? '').trim();
      if (
        (activeRaw === false || activeRaw === 0 || activeRaw === '0') &&
        existingPosId !== next
      ) {
        return {
          ok: false,
          message: 'Selected position is inactive and cannot be assigned to employees.',
        };
      }
      payload.position_id = next;
    }
  }

  return { ok: true };
}

router.post(
  '/employees',
  hrManagerAccess,
  requireEffectivePermission('hr.employee.create'),
  async (req, res) => {
  try {
    const rawBody = req.body || {};
    const isDraft = isDraftRequest(rawBody);
    const body = stripDraftMeta(rawBody);
    const allowLogin = !!body.allow_login && !isDraft;
    const { resolveAccessRoleFromBody, canAssignAccessRole } = await import('./accessRole.js');
    const actor = (req as any).user;
    const roleName = resolveAccessRoleFromBody(body);
    if (roleName === 'ADMIN') {
      return res.status(403).json({
        message: 'Admin access is managed in User Management, not employee setup.',
      });
    }
    if (!canAssignAccessRole(actor?.role, roleName)) {
      return res.status(403).json({
        message: 'You cannot assign this access role.',
      });
    }
    const {
      employee_id,
      first_name,
      last_name,
      email,
      phone,
      department_id,
      position_id,
      join_date,
      base_salary,
      gender,
      birth_date,
      nationality,
      ethnicity,
      religion,
      national_id,
      passport_number,
      birth_certificate_number,
      employment_type,
      street_address,
      city,
      currency,
      bank_name,
      bank_account_number,
      emergency_contact_name,
      emergency_contact_relationship,
      emergency_contact_phone,
      avatar_url,
      work_phone,
      telegram_number,
      probation_period_months,
      worker_type,
      marital_status,
      spouse_name,
      spouse_occupation,
      spouse_phone,
      salary_type,
      tax_id,
      created_by,
      country,
      work_days,
      time_in,
      time_out,
      work_hours,
      break_duration_minutes,
      grace_period_minutes,
      payroll_basis_days,
      payment_method,
      allowance_template_id,
    } = body;

    let createSource = body as Record<string, unknown>;
    let resolvedStatus = 'active';
    let markOnboardingComplete = true;

    if (isDraft) {
      if (!canPersistDraft(body)) {
        return res.status(400).json({
          message: 'Provide at least a first name, last name, or employee ID to save a draft.',
        });
      }
      if (!employee_id) {
        return res.status(400).json({ message: 'Employee ID is required to save a draft.' });
      }
      createSource = fillDraftCreateFields(body);
      resolvedStatus = EMPLOYEE_STATUS_DRAFT;
      markOnboardingComplete = false;
    } else if (!isEmployeePayloadComplete(body)) {
      // Draft status is only created via explicit Save Draft (is_draft / status=draft).
      return res.status(400).json({
        message:
          'Required fields are incomplete. Click Draft to save progress, or complete all required fields to create the profile.',
        code: 'INCOMPLETE_PROFILE_USE_DRAFT',
        missingFields: missingFieldsForActive(body),
      });
    } else {
      const resolved = resolveEmployeeStatus({ body, previousStatus: null });
      resolvedStatus = resolved.status;
      markOnboardingComplete = resolved.markOnboardingComplete;
    }

    const src = createSource as typeof body;
    const posIdForSalary = String(src.position_id ?? position_id ?? '');
    const baseForSalary = Number(
      (src as Record<string, unknown>).base_salary ?? base_salary ?? 0
    );
    if (
      resolvedStatus !== EMPLOYEE_STATUS_DRAFT &&
      baseForSalary > 0
    ) {
      const salaryErr = await validateEmployeeSalaryForPosition(posIdForSalary, baseForSalary);
      if (salaryErr) return res.status(400).json({ message: salaryErr });
    }

    const { validateProbationFields } = await import('./probationService.js');
    const probationValidation = validateProbationFields({
      employment_type: (src as Record<string, unknown>).employment_type ?? employment_type,
      worker_type: (body as Record<string, unknown>).worker_type ?? worker_type,
      probation_period_months:
        (body as Record<string, unknown>).probation_period_months ?? probation_period_months,
      join_date: src.join_date ?? join_date,
    });
    if (!probationValidation.ok && !isDraft) {
      return res.status(400).json({ message: probationValidation.error });
    }

    const birthDateRaw = src.birth_date ?? birth_date;
    if (birthDateRaw != null && String(birthDateRaw).trim() !== '') {
      const { validateBirthDateNotFuture } = await import('./companyTimeZone.js');
      const birthErr = await validateBirthDateNotFuture(birthDateRaw);
      if (birthErr) return res.status(400).json({ message: birthErr });
    }

    const createPlacement = {
      department_id: src.department_id ?? department_id,
      position_id: src.position_id ?? position_id,
    } as Record<string, unknown>;
    const placementCheck = await sanitizeEmployeePlacementIds(createPlacement);
    if (!placementCheck.ok) {
      return res.status(400).json({ message: placementCheck.message });
    }
    // Active creates require placement; drafts may leave department/position unset.
    if (!isDraft && !createPlacement.position_id) {
      return res.status(400).json({
        message: 'A valid position is required before saving this employee.',
      });
    }

    const empRowId = await nextEmployeeRowId();
    const srcRec = src as Record<string, unknown>;
    const textOrNull = (val: unknown): string | null => {
      const s = String(val ?? '').trim();
      return s.length > 0 ? s : null;
    };
    const rawBadge = String(src.employee_id ?? employee_id ?? '').trim();
    const canonicalBadge = rawBadge ? toCanonicalEmployeeDisplayId(rawBadge) : '';
    if (rawBadge) {
      if (!isEmployeeBadgeDisplayId(rawBadge) || !/^ROC\d{5}$/.test(canonicalBadge)) {
        return res.status(400).json({
          message: 'Employee ID must be ROC##### (legacy IROC/EMP badges are accepted and converted).',
        });
      }
    } else if (!isDraft) {
      return res.status(400).json({ message: 'Employee ID is required.' });
    }
    const employee = await Employee.create({
      id: empRowId,
      employee_id: canonicalBadge || (await previewNextEmployeeDisplayId()),
      first_name: src.first_name ?? first_name,
      last_name: src.last_name ?? last_name,
      first_name_kh: trimOptionalKhmerText(srcRec.first_name_kh),
      last_name_kh: trimOptionalKhmerText(srcRec.last_name_kh),
      email: src.email ?? email,
      phone: normalizePhone(String(src.phone ?? phone ?? '')),
      work_phone: textOrNull(srcRec.work_phone ?? work_phone),
      telegram_number: (() => {
        const raw = String(srcRec.telegram_number ?? telegram_number ?? '').trim();
        return raw ? normalizePhone(raw) || raw : null;
      })(),
      avatar_url: textOrNull(srcRec.avatar_url ?? avatar_url),
      gender: src.gender ?? gender,
      birth_date: src.birth_date ?? birth_date,
      nationality: (src.nationality ?? nationality) || 'Cambodia',
      ethnicity: textOrNull(srcRec.ethnicity ?? ethnicity),
      religion: textOrNull(srcRec.religion ?? religion),
      national_id: textOrNull(srcRec.national_id ?? national_id),
      passport_number: textOrNull(srcRec.passport_number ?? passport_number),
      birth_certificate_number: textOrNull(
        srcRec.birth_certificate_number ?? birth_certificate_number
      ),
      marital_status: (src.marital_status ?? marital_status) || 'single',
      spouse_name: textOrNull(srcRec.spouse_name ?? spouse_name),
      spouse_name_kh: trimOptionalKhmerText(srcRec.spouse_name_kh),
      spouse_occupation: textOrNull(srcRec.spouse_occupation ?? spouse_occupation),
      spouse_phone: textOrNull(srcRec.spouse_phone ?? spouse_phone),
      department_id: createPlacement.department_id,
      position_id: createPlacement.position_id,
      employment_type: (src.employment_type ?? employment_type) || 'Full-Time',
      join_date: src.join_date ?? join_date,
      probation_period_months: probationValidation.probationPeriodMonths,
      worker_type: probationValidation.workerType,
      work_days: (() => {
        const n = Number(srcRec.work_days ?? work_days ?? 5);
        return Number.isFinite(n) ? Math.min(7, Math.max(1, Math.round(n))) : 5;
      })(),
      time_in: String(srcRec.time_in ?? time_in ?? '08:00').slice(0, 5) || '08:00',
      time_out: String(srcRec.time_out ?? time_out ?? '17:00').slice(0, 5) || '17:00',
      work_hours: srcRec.work_hours ?? work_hours ?? 8,
      break_duration_minutes: srcRec.break_duration_minutes ?? break_duration_minutes ?? 60,
      grace_period_minutes:
        srcRec.grace_period_minutes != null && srcRec.grace_period_minutes !== ''
          ? Number(srcRec.grace_period_minutes)
          : grace_period_minutes ?? null,
      payroll_basis_days: await (async () => {
        try {
          const {
            getPayrollWorkDayPolicy,
            resolveEmployeePayrollBasisDays,
          } = await import('./payroll/payrollBasisDaysService.js');
          const policy = await getPayrollWorkDayPolicy();
          return resolveEmployeePayrollBasisDays({
            policy,
            employeeBasisDays: srcRec.payroll_basis_days ?? payroll_basis_days,
          });
        } catch {
          const n = Number(srcRec.payroll_basis_days ?? payroll_basis_days ?? 26);
          return Number.isFinite(n) && n > 0 ? Math.round(n) : 26;
        }
      })(),
      allowance_template_id:
        srcRec.allowance_template_id ??
        allowance_template_id ??
        body.allowanceTemplateId ??
        null,
      street_address: textOrNull(srcRec.street_address ?? street_address),
      street_address_kh: trimOptionalKhmerText(srcRec.street_address_kh),
      city: textOrNull(srcRec.city ?? city),
      city_kh: trimOptionalKhmerText(srcRec.city_kh),
      country: String(srcRec.country ?? country ?? 'Cambodia') || 'Cambodia',
      emergency_contact_name: textOrNull(
        srcRec.emergency_contact_name ?? emergency_contact_name
      ),
      emergency_contact_name_kh: trimOptionalKhmerText(srcRec.emergency_contact_name_kh),
      emergency_contact_relationship: textOrNull(
        srcRec.emergency_contact_relationship ?? emergency_contact_relationship
      ),
      emergency_contact_relationship_kh: trimOptionalKhmerText(
        srcRec.emergency_contact_relationship_kh
      ),
      emergency_contact_phone: textOrNull(
        srcRec.emergency_contact_phone ?? emergency_contact_phone
      ),
      status: resolvedStatus,
      ...(markOnboardingComplete ? { onboarding_completed_at: new Date() } : { onboarding_completed_at: null }),
      created_by,
    } as any);

    try {
      const { syncEmployeeJobPosition } = await import('./employeeJobPosition.js');
      await syncEmployeeJobPosition(
        empRowId,
        String(src.position_id ?? position_id ?? ''),
        body.job_position != null ? String(body.job_position) : null
      );
    } catch {
      /* non-fatal */
    }

    const childrenCreate = Object.prototype.hasOwnProperty.call(body, 'children')
      ? body.children
      : undefined;
    const {
      syncEmployeeChildren,
      computeTaxDependentsForFamily,
      normalizeChildrenInput,
    } = await import('./employeeChildrenService.js');
    let savedChildren: Awaited<ReturnType<typeof syncEmployeeChildren>> = [];
    if (childrenCreate !== undefined) {
      savedChildren = await syncEmployeeChildren(
        empRowId,
        normalizeChildrenInput(childrenCreate)
      );
    }
    const taxDependents = computeTaxDependentsForFamily(
      src.marital_status ?? marital_status,
      src.spouse_occupation ?? spouse_occupation,
      savedChildren
    );
    const salaryBase =
      (src as Record<string, unknown>).base_salary ?? base_salary ?? 0;
    const createEffectiveFrom = String(
      src.join_date ?? join_date ?? new Date().toISOString()
    ).slice(0, 10);
    await upsertSalaryStructure(
      empRowId,
      {
        salary_type: String((src as Record<string, unknown>).salary_type ?? salary_type ?? 'monthly'),
        base_salary: salaryBase,
        currency: String((src as Record<string, unknown>).currency ?? currency ?? 'USD'),
        bank_name: (() => {
          const v = String((src as Record<string, unknown>).bank_name ?? bank_name ?? '').trim();
          return v || null;
        })(),
        bank_account_number: (() => {
          const v = String(
            (src as Record<string, unknown>).bank_account_number ?? bank_account_number ?? ''
          ).trim();
          return v || null;
        })(),
        payment_method:
          (src as Record<string, unknown>).payment_method ?? payment_method ?? 'bank',
        tax_id: (() => {
          const v = String((src as Record<string, unknown>).tax_id ?? tax_id ?? '').trim();
          return v || null;
        })(),
        tax_dependents: Number.isFinite(taxDependents) ? taxDependents : 0,
        nssf_enrolled:
          (src as Record<string, unknown>).nssf_enrolled !== false && body.nssf_enrolled !== false,
      },
      {
        // Initial hire/draft bootstrap — not a mid-cycle compensation change.
        skipEffectiveDateGuard: true,
        effectiveFrom: createEffectiveFrom,
        changeReason: isDraft ? 'Employee draft created' : 'Employee created',
        changedBy: String(actor?.id ?? created_by ?? ''),
      }
    );

    const structure = await loadSalaryStructureForEmployeeId(empRowId);
    const employeePayload = mergeCompensationIntoEmployee(
      employee.get({ plain: true }),
      structure
    );

    const leaveAssignmentsCreate = body.leave_assignments;
    try {
      const {
        syncLeaveAssignments,
        applyDefaultLeaveAssignmentsToEmployee,
        syncDraftLeaveAssignmentPreferences,
        buildDefaultLeaveAssignments,
      } = await import('./leaveBalanceService.js');
      const leaveYear = new Date().getFullYear();
      const genderForLeave = String(src.gender ?? gender ?? '');
      if (resolvedStatus === EMPLOYEE_STATUS_DRAFT) {
        const draftAssignments =
          leaveAssignmentsCreate &&
          typeof leaveAssignmentsCreate === 'object' &&
          !Array.isArray(leaveAssignmentsCreate)
            ? (leaveAssignmentsCreate as Record<string, boolean>)
            : await buildDefaultLeaveAssignments(genderForLeave);
        await syncDraftLeaveAssignmentPreferences(empRowId, draftAssignments, leaveYear);
      } else if (
        leaveAssignmentsCreate &&
        typeof leaveAssignmentsCreate === 'object' &&
        !Array.isArray(leaveAssignmentsCreate)
      ) {
        await syncLeaveAssignments(
          empRowId,
          leaveAssignmentsCreate as Record<string, boolean>,
          leaveYear
        );
      } else {
        await applyDefaultLeaveAssignmentsToEmployee(empRowId, genderForLeave, leaveYear);
      }
    } catch (syncErr) {
      console.warn('Leave assignment sync on create failed:', (syncErr as Error)?.message || syncErr);
    }

    const allowanceTemplateCreate =
      body.allowance_template_id ?? body.allowanceTemplateId;
    if (allowanceTemplateCreate !== undefined) {
      try {
        const { assignAllowancePackage } = await import('./allowanceRuleService.js');
        await assignAllowancePackage(
          String(src.employee_id ?? employee_id),
          allowanceTemplateCreate ? String(allowanceTemplateCreate) : null,
          created_by
        );
      } catch (pkgErr) {
        console.warn('Allowance package assign on create failed:', (pkgErr as Error)?.message || pkgErr);
      }
    }

    if (allowLogin && !isDraft) {
      const portalPassword = String(body.portal_password || body.password || '').trim();
      if (portalPassword && (await rejectInvalidPortalPassword(res, portalPassword))) return;
      try {
        const portalUser = await upsertLoginUserForEmployee({
          employee: employeePayload,
          role: roleName,
          ...(portalPassword ? { password: portalPassword } : {}),
          nextUserId,
        });
        const { notifyPortalAccountReady } = await import('./notificationService.js');
        void notifyPortalAccountReady({
          userId: String(portalUser.id),
          employeeDisplayId: String(employeePayload.employee_id || ''),
        }).catch(() => undefined);
        clearCachePrefix('all_users');
      } catch (userErr: any) {
        console.warn('Employee saved but login user was not created:', userErr?.message || userErr);
        return res.status(400).json({
          message: userErr?.message || 'Could not create portal login for this employee.',
        });
      }
    }

    let leave_assignments: Record<string, boolean> = {};
    try {
      const { resolveLeaveAssignmentsMap } = await import('./leaveBalanceService.js');
      leave_assignments = await resolveLeaveAssignmentsMap(
        empRowId,
        String(src.gender ?? gender ?? employeePayload?.gender ?? ''),
        resolvedStatus
      );
    } catch {
      /* non-fatal */
    }

    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    await writeDomainAudit({
      entityType: 'employee',
      entityId: String(src.employee_id ?? employee_id),
      action: isDraft ? 'CREATE_DRAFT' : 'CREATE',
      performedBy: String(actor?.id ?? created_by ?? 'system'),
      newValue: pickAuditFields({
        employee_id: src.employee_id ?? employee_id,
        first_name: src.first_name ?? first_name,
        last_name: src.last_name ?? last_name,
        status: resolvedStatus,
        department_id: src.department_id ?? department_id,
        position_id: src.position_id ?? position_id,
      }),
      reason: isDraft ? 'Employee draft created' : 'Employee created',
    });

    res.status(201).json({
      message: isDraft ? 'Employee draft saved' : 'Employee created successfully',
      employee: { ...employeePayload, leave_assignments },
      ...(probationValidation.warning ? { probationWarning: probationValidation.warning } : {}),
    });
  } catch (error: any) {
    console.error('Error creating employee:', error);
    const { MasterDataEffectiveDateRequiredError, PayrollMasterDataConflictError } = await import(
      './payroll/payrollMasterDataGuard.js'
    );
    if (
      error instanceof MasterDataEffectiveDateRequiredError ||
      error instanceof PayrollMasterDataConflictError
    ) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    if (error?.name === 'SequelizeUniqueConstraintError') {
      let existingEmployeeId: string | undefined;
      try {
        const triedId = String(req.body?.employee_id ?? '').trim();
        const triedEmail = String(req.body?.email ?? '')
          .trim()
          .toLowerCase();
        const byId = triedId
          ? await Employee.findOne({
              where: employeeLookupWhere(triedId) as any,
              attributes: ['employee_id'],
            })
          : null;
        const byEmail =
          !byId && triedEmail
            ? await Employee.findOne({
                where: sequelize.where(
                  sequelize.fn('LOWER', sequelize.col('email')),
                  triedEmail
                ),
                attributes: ['employee_id'],
              })
            : null;
        existingEmployeeId = String(
          (byId || byEmail)?.get?.('employee_id') ??
            (byId || byEmail)?.employee_id ??
            ''
        ).trim() || undefined;
      } catch {
        /* non-fatal */
      }
      return res.status(409).json({
        message: 'Duplicate employee id, email, or phone already exists in the system.',
        ...(existingEmployeeId ? { existingEmployeeId } : {}),
      });
    }
    res.status(500).json({ message: error?.message || 'Internal server error' });
  }
});

async function resolveWorksiteForUser(userId: string): Promise<ReturnType<typeof resolveOfficeWorksite>> {
  const { getRequiredWorksiteForUser } = await import('./departmentAttendanceWorksite.js');
  return getRequiredWorksiteForUser(userId);
}

function parseClockLocation(body: { location?: { lat?: number; lng?: number; latitude?: number; longitude?: number } }) {
  const loc = body?.location;
  if (!loc) return null;
  const lat = Number(loc.lat ?? loc.latitude);
  const lng = Number(loc.lng ?? loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// Attendance
router.get('/attendance', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const {
      reconcileAttendanceAbsences,
      shouldReconcileOnRead,
    } = await import('./attendanceReconcileService.js');
    const reconcileOnRead = shouldReconcileOnRead(req.query as Record<string, unknown>);
    const { dateKeyIct } = await import('./attendanceTimeZone.js');
    const {
      buildAttendanceGridForDate,
      buildAttendanceGridForRange,
      buildAttendanceHistoryForRange,
      resolveGridRangeFromDayCount,
    } = await import('./attendanceListGridService.js');
    const {
      resolveAttendanceRosterUserIdsForActor,
    } = await import('./attendanceManagerScope.js');
    const scopeUserIds = await resolveAttendanceRosterUserIdsForActor({
      id: currentUser?.id,
      role: currentUser?.role,
    });
    const q = req.query as Record<string, unknown>;

    const historyDaysRaw = Number(q.history_days);
    const historyDays =
      Number.isFinite(historyDaysRaw) && historyDaysRaw > 0
        ? Math.min(Math.floor(historyDaysRaw), 365)
        : 0;
    const historyFrom = q.history_from ? String(q.history_from).slice(0, 10) : '';
    const historyTo = q.history_to ? String(q.history_to).slice(0, 10) : '';
    const wantsHistory =
      historyDays > 0 || (historyFrom.length === 10 && historyTo.length === 10);

    if (wantsHistory) {
      const today = dateKeyIct();
      const span =
        historyDays > 0
          ? resolveGridRangeFromDayCount(historyDays, 365)
          : {
              from: historyFrom,
              to: historyTo > today ? today : historyTo,
            };
      if (span.from && span.to && span.to >= span.from) {
        if (reconcileOnRead) {
          await reconcileAttendanceAbsences({ from: span.from, to: span.to });
        }
        return res.json(await buildAttendanceHistoryForRange(span.from, span.to, scopeUserIds));
      }
    }

    const gridRangeDaysRaw = Number(q.grid_range_days);
    const gridRangeDays =
      Number.isFinite(gridRangeDaysRaw) && gridRangeDaysRaw > 0
        ? Math.min(Math.floor(gridRangeDaysRaw), 14)
        : 0;
    const gridFrom = q.from ? String(q.from).slice(0, 10) : '';
    const gridTo = q.to ? String(q.to).slice(0, 10) : '';
    const wantsRangeGrid =
      gridRangeDays > 0 ||
      q.grid === 'range' ||
      (q.grid === '1' && gridFrom && gridTo);

    if (wantsRangeGrid) {
      const today = dateKeyIct();
      const span =
        gridRangeDays > 0
          ? resolveGridRangeFromDayCount(gridRangeDays)
          : {
              from: gridFrom,
              to: gridTo > today ? today : gridTo,
            };
      if (span.from && span.to && span.to >= span.from) {
        if (reconcileOnRead) {
          await reconcileAttendanceAbsences({ from: span.from, to: span.to });
        }
        return res.json(await buildAttendanceGridForRange(span.from, span.to, scopeUserIds));
      }
    }

    const gridDay =
      q.date === 'today'
        ? dateKeyIct()
        : q.grid === '1' || q.grid === 'true'
          ? String(q.date ?? dateKeyIct()).slice(0, 10)
          : null;

    if (gridDay) {
      const today = dateKeyIct();
      const settings = await getAttendanceGeofenceConfig();
      const rules = settings?.rules ?? DEFAULT_ATTENDANCE_RULES;
      const officeEndHm = settings?.workingHoursEnd ?? null;
      const { shouldReconcileAttendanceDate } = await import('./attendanceReconcileService.js');
      const shouldReconcileToday =
        gridDay === today &&
        shouldReconcileAttendanceDate(today, rules, new Date(), officeEndHm);
      if (reconcileOnRead && (gridDay < today || shouldReconcileToday)) {
        await reconcileAttendanceAbsences({ from: gridDay, to: gridDay });
      }
      return res.json(await buildAttendanceGridForDate(gridDay, scopeUserIds));
    }

    const defaultSpan = resolveGridRangeFromDayCount(30, 365);
    return res.json(
      await buildAttendanceHistoryForRange(defaultSpan.from, defaultSpan.to, scopeUserIds)
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Error fetching attendance:', detail, error);
    res.status(500).json({
      message: 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' ? { detail } : {}),
    });
  }
});

// Get attendance for specific user
router.get('/users/:id/attendance', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const userId = String(req.params.id).trim();
    const {
      resolveAttendanceRosterUserIdsForActor,
      actorMayAccessAttendanceUser,
    } = await import('./attendanceManagerScope.js');
    const scopeUserIds = await resolveAttendanceRosterUserIdsForActor({
      id: currentUser?.id,
      role: currentUser?.role,
    });
    if (!actorMayAccessAttendanceUser(scopeUserIds, userId)) {
      return res.status(403).json({ message: 'You can only view attendance for staff in your department.' });
    }
    const date = req.query.date ? String(req.query.date).slice(0, 10) : null;
    const q = req.query as Record<string, unknown>;
    const {
      reconcileAttendanceAbsences,
      shouldReconcileOnRead,
    } = await import('./attendanceReconcileService.js');
    const { dateKeyIct } = await import('./attendanceTimeZone.js');
    const {
      resolveGridRangeFromDayCount,
      buildAttendanceGridForUserRange,
      buildAttendanceGridForUserDate,
    } = await import('./attendanceListGridService.js');

    const historyDaysRaw = Number(q.history_days);
    const historyDays =
      Number.isFinite(historyDaysRaw) && historyDaysRaw > 0
        ? Math.min(Math.floor(historyDaysRaw), 365)
        : 0;
    const historyFrom = q.history_from ? String(q.history_from).slice(0, 10) : '';
    const historyTo = q.history_to ? String(q.history_to).slice(0, 10) : '';

    if (date) {
      if (shouldReconcileOnRead(q)) {
        await reconcileAttendanceAbsences({ from: date, to: date, userIds: [userId] });
      }
      const row = await buildAttendanceGridForUserDate(userId, date);
      return res.json(row);
    }

    let from: string;
    let to: string;

    if (historyDays > 0) {
      const span = resolveGridRangeFromDayCount(historyDays, 365);
      from = span.from;
      to = span.to;
    } else if (historyFrom.length === 10 && historyTo.length === 10) {
      const today = dateKeyIct();
      from = historyFrom;
      to = historyTo > today ? today : historyTo;
    } else {
      const span = resolveGridRangeFromDayCount(90, 365);
      from = span.from;
      to = span.to;
    }

    if (shouldReconcileOnRead(q)) {
      await reconcileAttendanceAbsences({ from, to, userIds: [userId] });
    }

    const rows = await buildAttendanceGridForUserRange(userId, from, to);
    res.json(rows);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Error fetching user attendance:', detail, error);
    res.status(500).json({
      message: 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' ? { detail } : {}),
    });
  }
});

router.get('/attendance/worksite/:userId', async (req, res) => {
  try {
    const worksite = await resolveWorksiteForUser(req.params.userId);
    const settings = await getAttendanceGeofenceConfig();
    const offices = await listActiveOfficeLocations();
    const schedule = await getEmployeeScheduleForUser(req.params.userId);
    res.json({
      worksite,
      offices,
      rules: settings?.rules ?? null,
      schedule,
    });
  } catch (error) {
    console.error('Error resolving attendance worksite:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/attendance/settings', async (_req, res) => {
  try {
    const settings = await getAttendanceSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error fetching attendance settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/attendance/freeze-policy', async (req, res) => {
  try {
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const payrollGroupId = String(req.query.payrollGroupId ?? 'default');
    const { resolveAttendanceFreezePolicy } = await import('./payroll/attendanceFreezeGuard.js');
    res.json(await resolveAttendanceFreezePolicy(date, payrollGroupId));
  } catch (error) {
    console.error('Error resolving attendance freeze policy:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/attendance/settings', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const body = req.body || {};
    const actorId = String((req as any).user?.id ?? '').trim() || null;
    if (Array.isArray(body.offices)) {
      const saved = await saveAttendanceSettings(body, actorId);
      return res.json(saved);
    }
    const legacy = await saveAttendanceGeofenceConfig(body);
    const settings = await getAttendanceSettings();
    res.json({ ...settings, legacy });
  } catch (error) {
    console.error('Error saving attendance settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/attendance/clock-in', async (req, res) => {
  const { userId } = req.body;
  const coords = parseClockLocation(req.body);
  try {
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const { assertEligibleForAttendanceOnDate, EmployeePayrollBoundaryError } =
      await import('./payroll/employeePayrollEligibility.js');
    const today = new Date().toISOString().split('T')[0];
    try {
      await assertEligibleForAttendanceOnDate(userId, today);
    } catch (boundaryErr) {
      if (boundaryErr instanceof EmployeePayrollBoundaryError) {
        return res.status(409).json({ message: boundaryErr.message, code: 'PAYROLL_BOUNDARY' });
      }
      throw boundaryErr;
    }

    // Live employee clock-in must work during/after payroll cutoff freeze.
    // Freeze only blocks HR corrections / import of existing rows (see times + patch routes).

    const settings = await getAttendanceGeofenceConfig();
    const rules = settings?.rules;

    if (rules?.requireGps !== false && !coords) {
      return res.status(400).json({ message: 'Location is required to clock in' });
    }

    if (coords && rules?.requireInZoneToClockIn !== false) {
      const { checkUserRequiredZone } = await import('./departmentAttendanceWorksite.js');
      const zoneCheck = await checkUserRequiredZone(userId, coords.lat, coords.lng);
      if (zoneCheck.worksite && !zoneCheck.inZone) {
        const w = zoneCheck.worksite;
        return res.status(403).json({
          message: `You are ${zoneCheck.distanceMeters}m from ${w.name}. You must be within ${w.radius}m of your assigned office to clock in.`,
          distanceMeters: zoneCheck.distanceMeters,
          radiusMeters: w.radius,
          worksite: w,
        });
      }
    }

    const { performClockIn, AttendanceClockError } = await import('./attendanceClockService.js');
    const attendance = await performClockIn({
      userId,
      dateKey: today,
      location: coords ? { lat: coords.lat, lng: coords.lng } : null,
      rules: rules ?? DEFAULT_ATTENDANCE_RULES,
    });
    const attendancePlain: any =
      attendance && typeof (attendance as any).get === 'function'
        ? (attendance as any).get({ plain: true })
        : attendance;
    if (Number(attendancePlain?.lateMinutes || 0) > 0) {
      const { notifyLateCheckIn } = await import('./notificationService.js');
      void notifyLateCheckIn({
        attendanceId: String(attendancePlain.id),
        userId: String(attendancePlain.userId || userId),
        date: String(attendancePlain.date || today),
        lateMinutes: Number(attendancePlain.lateMinutes),
      }).catch(() => undefined);
    }
    clearCachePrefix('report_stats');
    res.status(201).json(attendance);
  } catch (error) {
    const { AttendanceClockError } = await import('./attendanceClockService.js');
    if (error instanceof AttendanceClockError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error('Error clocking in:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/attendance/import', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });

    const { rows, reason } = req.body ?? {};
    const { importAttendanceRows } = await import('./attendanceImportService.js');
    const result = await importAttendanceRows(rows, String(currentUser.id), String(reason ?? ''));
    clearCachePrefix('report_stats');
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed';
    const status =
      message.includes('limited to') || message.includes('No rows') || message.includes('reason')
        ? 400
        : 500;
    console.error('Error importing attendance:', error);
    res.status(status).json({ message });
  }
});

router.patch('/attendance/:id', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const attendance: any = await AttendanceRecord.findByPk(req.params.id);
    if (!attendance) return res.status(404).json({ message: 'Attendance record not found' });

    const { assertAttendanceRecordUpdatable, AttendanceFrozenError } = await import(
      './payroll/attendanceFreezeGuard.js'
    );
    const { assertEligibleForAttendanceOnDate, EmployeePayrollBoundaryError } =
      await import('./payroll/employeePayrollEligibility.js');
    try {
      await assertAttendanceRecordUpdatable(String(attendance.date ?? ''), attendance);
      await assertEligibleForAttendanceOnDate(String(attendance.userId), String(attendance.date ?? ''));
    } catch (boundaryErr) {
      if (boundaryErr instanceof AttendanceFrozenError) {
        return res.status(409).json({ message: boundaryErr.message, code: boundaryErr.code });
      }
      if (boundaryErr instanceof EmployeePayrollBoundaryError) {
        return res.status(409).json({ message: boundaryErr.message, code: 'PAYROLL_BOUNDARY' });
      }
      throw boundaryErr;
    }

    const { status } = req.body || {};
    const previousStatus = String(attendance.status || '');
    const allowed = new Set([
      'PRESENT',
      'LATE',
      'ABSENT',
      'ON_LEAVE',
      'PAID_LEAVE',
      'UNPAID_LEAVE',
      'DAY_OFF',
      'PH',
    ]);
    if (status != null) {
      const normalized = String(status).toUpperCase();
      if (!allowed.has(normalized)) {
        return res.status(400).json({ message: 'Invalid attendance status' });
      }
      attendance.status = normalized;
    }

    await attendance.save();
    if (status != null && previousStatus !== String(attendance.status || '')) {
      const { notifyAttendanceCorrected } = await import('./notificationService.js');
      void notifyAttendanceCorrected({
        attendanceId: String(attendance.id),
        userId: String(attendance.userId),
        date: String(attendance.date),
        actorUserId: String((req as any).user?.id || ''),
        summary: `status changed to ${String(attendance.status).replace(/_/g, ' ').toLowerCase()}.`,
        revision: Date.now().toString(36),
      }).catch(() => undefined);
    }
    clearCachePrefix('report_stats');
    res.json(attendance);
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** HR/Manager: correct missing or wrong clock-in/out (audit: correctionAt, correctionBy, correctionReason). */
router.put('/attendance/:id/times', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });

    const { ensureAttendanceRecordCorrectionColumns } = await import('./attendanceRecordSchema.js');
    const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
    await ensureAttendanceRecordCorrectionColumns();
    await ensureAttendanceLateColumns();

    const recordId = String(req.params.id || '').trim();
    const bodyUserId = String(req.body?.userId ?? '').trim();
    const bodyDate = String(req.body?.date ?? '').slice(0, 10);
    const isGridPlaceholder = recordId.startsWith('grid-');

    let attendance: any = !isGridPlaceholder ? await AttendanceRecord.findByPk(recordId) : null;

    // Grid roster rows are not in MySQL — resolve or create the real attendancerecords row.
    if (!attendance && bodyUserId && bodyDate) {
      attendance = await AttendanceRecord.findOne({
        where: { userId: bodyUserId, date: bodyDate },
        order: [['updatedAt', 'DESC']],
      });
    }

    const {
      assertAttendanceRecordCreatable,
      assertAttendanceRecordUpdatable,
      AttendanceFrozenError,
    } = await import('./payroll/attendanceFreezeGuard.js');

    if (!attendance) {
      const userId = bodyUserId;
      const date = bodyDate;
      if (!userId || !date) {
        return res.status(404).json({
          message: isGridPlaceholder
            ? 'Cannot save times for this roster row without employee and date'
            : 'Attendance record not found',
        });
      }
      try {
        await assertAttendanceRecordCreatable(date, null);
      } catch (freezeErr) {
        if (freezeErr instanceof AttendanceFrozenError) {
          return res.status(409).json({ message: freezeErr.message, code: freezeErr.code });
        }
        throw freezeErr;
      }
      attendance = await AttendanceRecord.create({
        id: `att-${userId}-${date}-${Date.now()}`,
        userId,
        date,
        status: 'ABSENT',
        clockIn: null,
        clockOut: null,
        workHours: null,
        locationIn: null,
        locationOut: null,
        lateMinutes: 0,
        lateExcused: false,
      });
    } else {
      try {
        await assertAttendanceRecordUpdatable(String(attendance.date ?? ''), attendance);
      } catch (freezeErr) {
        if (freezeErr instanceof AttendanceFrozenError) {
          return res.status(409).json({ message: freezeErr.message, code: freezeErr.code });
        }
        throw freezeErr;
      }
    }

    const { updateAttendanceTimes } = await import('./attendanceTimesService.js');
    const row = await updateAttendanceTimes(String(attendance.id), String(currentUser.id), {
      changeClockIn: req.body?.changeClockIn === true,
      changeClockOut: req.body?.changeClockOut === true,
      clockInTime: req.body?.clockInTime,
      clockOutTime: req.body?.clockOutTime,
      clearClockIn: req.body?.clearClockIn === true,
      clearClockOut: req.body?.clearClockOut === true,
      reason: req.body?.reason ?? req.body?.correctionReason ?? '',
    });
    const plain: any =
      row && typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
    const { notifyAttendanceCorrected } = await import('./notificationService.js');
    void notifyAttendanceCorrected({
      attendanceId: String(plain?.id || attendance.id),
      userId: String(plain?.userId || attendance.userId),
      date: String(plain?.date || attendance.date),
      actorUserId: String(currentUser.id),
      summary: 'clock-in or clock-out time was corrected.',
      revision: new Date(plain?.correctionAt || Date.now()).getTime().toString(36),
    }).catch(() => undefined);
    clearCachePrefix('report_stats');
    res.json(row);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Update failed';
    const code =
      msg.includes('not found')
        ? 404
        : msg.includes('must be') ||
            msg.includes('Invalid') ||
            msg.includes('No time') ||
            msg.includes('reason') ||
            msg.includes('same as') ||
            msg.includes('HH:mm')
          ? 400
          : 500;
    console.error('Error updating attendance times:', error);
    res.status(code).json({ message: msg });
  }
});

router.post('/attendance/:id/clock-out', async (req, res) => {
  try {
    const coords = parseClockLocation(req.body);
    const attendance: any = await AttendanceRecord.findByPk(req.params.id);
    if (!attendance) return res.status(404).json({ message: 'Attendance record not found' });
    // Live employee clock-out must work during/after payroll cutoff freeze
    // (e.g. finish a shift started before freeze). HR time edits stay locked.
    if (attendance.clockOut) {
      return res.status(409).json({ message: 'Already clocked out' });
    }
    const settings = await getAttendanceGeofenceConfig();
    const rules = settings?.rules;
    const needsGps = rules?.requireGpsOnClockOut !== false;

    if (needsGps && !coords) {
      return res.status(400).json({ message: 'Location is required to clock out' });
    }

    if (coords && rules?.requireInZoneToClockOut) {
      const userId = String(attendance.userId ?? '');
      const { checkUserRequiredZone } = await import('./departmentAttendanceWorksite.js');
      const zoneCheck = await checkUserRequiredZone(userId, coords.lat, coords.lng);
      if (zoneCheck.worksite && !zoneCheck.inZone) {
        const w = zoneCheck.worksite;
        return res.status(403).json({
          message: `You are ${zoneCheck.distanceMeters}m from ${w.name}. You must be within ${w.radius}m of your assigned office to clock out.`,
          distanceMeters: zoneCheck.distanceMeters,
          radiusMeters: w.radius,
          worksite: w,
        });
      }
    }

    const { performClockOut, AttendanceClockError } = await import('./attendanceClockService.js');
    const row = await performClockOut({
      recordId: String(req.params.id),
      location: coords ? { lat: coords.lat, lng: coords.lng } : null,
    });
    clearCachePrefix('report_stats');
    res.json(row);
  } catch (error) {
    const { AttendanceClockError } = await import('./attendanceClockService.js');
    if (error instanceof AttendanceClockError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error('Error clocking out:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Legacy clock-out endpoint
router.post('/attendance/clock-out', async (req, res) => {
  const { employeeId, timestamp } = req.body;
  try {
    const date = new Date(timestamp || Date.now()).toISOString().split('T')[0];
    const attendance: any = await AttendanceRecord.findOne({
      where: { userId: employeeId, date },
      order: [['createdAt', 'DESC']]
    });
    if (attendance) {
      attendance.clockOut = timestamp || new Date().toISOString();
      await attendance.save();
      res.json(attendance);
    } else {
      res.status(404).json({ message: 'No attendance record found for today' });
    }
  } catch (error) {
    console.error('Error clocking out:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Leaves
router.get('/leaves', cacheMiddleware(30_000), async (req, res) => {
  try {
    const {
      ensureLeaveWorkflowColumns,
      serializeLeavesWithApprovers,
      normalizeLeaveRequestTypeIdsToNames,
    } = await import('./leaveWorkflowService.js');
    await ensureLeaveWorkflowColumns();
    // One-time-ish: rewrite lt-* ids stored in leave.request.type to catalog names.
    await normalizeLeaveRequestTypeIdsToNames();
    const leaves = await LeaveRequest.findAll({ order: [['createdAt', 'DESC']] });
    res.json(await serializeLeavesWithApprovers(leaves));
  } catch (error) {
    console.error('Error fetching leaves:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Leave types
router.get('/leaves/types', async (req, res) => {
  try {
    const { leaveTypeToApiShape } = await import('./leaveTypeCategory.js');
    // Config screens pass includeInactive=true so deactivate keeps the row visible.
    // Employee request / balance flows omit it and only see active types.
    const includeInactive = String(req.query.includeInactive ?? '') === 'true';
    const types = await LeaveType.findAll({
      where: includeInactive ? {} : { isActive: true },
      order: [
        ['isActive', 'DESC'],
        ['name', 'ASC'],
      ],
    });
    res.json(
      types.map((row) =>
        leaveTypeToApiShape((row.get ? row.get({ plain: true }) : row) as Record<string, unknown>)
      )
    );
  } catch (error) {
    console.error('Error fetching leave types:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/leaves/balances', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });

    const year = Number.parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
    const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();

    let userId = String(currentUser.id);
    const requestedUserId = req.query.userId ? String(req.query.userId) : null;
    if (requestedUserId && requestedUserId !== userId) {
      const role = String(currentUser.role ?? '').toUpperCase();
      const canViewOthers = ['ADMIN', 'HR', 'MANAGER', 'SUPER_ADMIN'].includes(role);
      if (!canViewOthers) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      userId = requestedUserId;
    }

    const { getLeaveBalancesForUser } = await import('./leaveBalanceService.js');
    const balances = await getLeaveBalancesForUser(userId, safeYear);
    res.json({ year: safeYear, balances });
  } catch (error) {
    console.error('Error fetching leave balances:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/types', requireEffectivePermission('leave.edit'), async (req, res) => {
  try {
    const {
      normalizeLeaveTypeBody,
      validateLeaveTypePayload,
      payloadToDbFields,
      leaveTypeToApiShape,
    } = await import('./leaveTypeCategory.js');
    const payload = normalizeLeaveTypeBody(req.body ?? {});
    const validation = validateLeaveTypePayload(payload);
    if (!validation.ok) return res.status(400).json({ message: validation.message });

    const name = payload.name;
    const code =
      req.body?.code ||
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '') ||
      `LT_${Date.now()}`;

    const type = await LeaveType.create({
      id: `lt-${Date.now()}`,
      code,
      ...payloadToDbFields(payload),
    });
    const { invalidateLeaveTypeLookupCache } = await import('./approvedLeaveDayMap.js');
    invalidateLeaveTypeLookupCache();
    const apiShape = leaveTypeToApiShape(type.get({ plain: true }) as Record<string, unknown>);
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    await writeDomainAudit({
      entityType: 'leave_type',
      entityId: String(type.get('id')),
      action: 'CREATE',
      performedBy: String((req as any).user?.id ?? 'system'),
      newValue: pickAuditFields(apiShape),
      reason: 'Leave type created',
    });
    res.status(201).json(apiShape);
  } catch (error) {
    console.error('Error creating leave type:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/leaves/types/:id', requireEffectivePermission('leave.edit'), async (req, res) => {
  try {
    const {
      normalizeLeaveTypeBody,
      validateLeaveTypePayload,
      payloadToDbFields,
      leaveTypeToApiShape,
    } = await import('./leaveTypeCategory.js');
    const row: any = await LeaveType.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Leave type not found' });

    const beforePlain = row.get({ plain: true }) as Record<string, unknown>;
    const merged = {
      ...(row.get ? row.get({ plain: true }) : row),
      ...(req.body ?? {}),
    };
    const payload = normalizeLeaveTypeBody(merged);
    const validation = validateLeaveTypePayload(payload);
    if (!validation.ok) return res.status(400).json({ message: validation.message });

    Object.assign(row, payloadToDbFields(payload));
    await row.save();
    const { invalidateLeaveTypeLookupCache } = await import('./approvedLeaveDayMap.js');
    invalidateLeaveTypeLookupCache();
    const apiShape = leaveTypeToApiShape(row.get({ plain: true }) as Record<string, unknown>);
    const { writeDomainAudit, diffAuditSnapshots } = await import('./domainAuditService.js');
    const diff = diffAuditSnapshots(beforePlain, apiShape as Record<string, unknown>);
    if (diff) {
      await writeDomainAudit({
        entityType: 'leave_type',
        entityId: String(req.params.id),
        action: 'UPDATE',
        performedBy: String((req as any).user?.id ?? 'system'),
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        reason: 'Leave type updated',
      });
    }
    res.json(apiShape);
  } catch (error) {
    console.error('Error updating leave type:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/leaves/types/:id', requireEffectivePermission('leave.edit'), async (req, res) => {
  try {
    const row: any = await LeaveType.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Leave type not found' });
    const beforePlain = row.get({ plain: true }) as Record<string, unknown>;
    const typeId = String(req.params.id);
    const effectiveFrom = String(
      req.query.effectiveFrom ?? req.body?.effectiveFrom ?? req.query.effective_from ?? ''
    )
      .trim()
      .slice(0, 10);

    const { LeaveBalance, EmployeeLeaveTypeAssignment } = await import('./db.js');
    await EmployeeLeaveTypeAssignment.destroy({ where: { leaveTypeId: typeId } });
    await LeaveBalance.destroy({ where: { leaveTypeId: typeId } });
    await row.destroy();

    const { invalidateLeaveTypeLookupCache } = await import('./approvedLeaveDayMap.js');
    invalidateLeaveTypeLookupCache();
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    await writeDomainAudit({
      entityType: 'leave_type',
      entityId: typeId,
      action: 'DELETE',
      performedBy: String((req as any).user?.id ?? 'system'),
      oldValue: pickAuditFields(beforePlain),
      reason: effectiveFrom
        ? `Leave type deleted (effective ${effectiveFrom})`
        : 'Leave type deleted',
    });
    res.json({ message: 'Leave type deleted', effectiveFrom: effectiveFrom || undefined });
  } catch (error) {
    console.error('Error deleting leave type:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/jobs/monthly-accrual', hrAccess, async (req, res) => {
  try {
    const { runMonthlyAccrual } = await import('./leaveAccrualService.js');
    const month = req.body?.month ? String(req.body.month) : undefined;
    res.json(await runMonthlyAccrual(month));
  } catch (error) {
    console.error('Error running monthly leave accrual:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/jobs/recalculate-accrual', hrAccess, async (req, res) => {
  try {
    const { recalculateEmployeeAccrualBalances } = await import('./leaveAccrualService.js');
    const employeeId = req.body?.employeeId ? String(req.body.employeeId) : null;
    const throughMonth = req.body?.throughMonth ? String(req.body.throughMonth).slice(0, 7) : undefined;

    if (employeeId) {
      const { Employee } = await import('./db.js');
      const byDisplay = await Employee.findOne({ where: employeeLookupWhere(employeeId) as any });
      const internalId = byDisplay
        ? String(byDisplay.get ? byDisplay.get('id') : (byDisplay as { id: string }).id)
        : employeeId;
      res.json(await recalculateEmployeeAccrualBalances(internalId, throughMonth));
      return;
    }

    const { Employee, LeaveBalance } = await import('./db.js');
    const year = throughMonth
      ? Number.parseInt(throughMonth.slice(0, 4), 10)
      : new Date().getFullYear();
    const balanceRows = await LeaveBalance.findAll({
      where: { year },
      attributes: ['employeeId'],
    });
    const ids = [...new Set(balanceRows.map((r) => String((r as any).employeeId)))];
    let updated = 0;
    for (const id of ids) {
      const r = await recalculateEmployeeAccrualBalances(id, throughMonth);
      updated += r.updated;
    }
    res.json({ employees: ids.length, balancesUpdated: updated });
  } catch (error) {
    console.error('Error recalculating leave accrual:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/leaves/ledger/:employeeId', hrAccess, async (req, res) => {
  try {
    const { listLeaveLedgerEntries } = await import('./leaveLedgerService.js');
    const { Employee } = await import('./db.js');
    const param = String(req.params.employeeId ?? '').trim();
    const year = req.query.year ? Number.parseInt(String(req.query.year), 10) : undefined;
    const leaveTypeId = req.query.leaveTypeId ? String(req.query.leaveTypeId) : undefined;

    const byDisplay = await Employee.findOne({ where: employeeLookupWhere(param) as any });
    const internalId = byDisplay
      ? String(byDisplay.get ? byDisplay.get('id') : (byDisplay as { id: string }).id)
      : param;

    const entries = await listLeaveLedgerEntries(internalId, year, leaveTypeId);
    res.json({ employeeId: internalId, entries });
  } catch (error) {
    console.error('Error loading leave ledger:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/jobs/year-end-renewal', hrAccess, async (req, res) => {
  try {
    const { runYearEndRenewal, provisionYearlyFixedAllocations } = await import(
      './leaveRenewalService.js'
    );
    const newYear = req.body?.year ? Number(req.body.year) : undefined;
    const renewal = await runYearEndRenewal(
      Number.isFinite(newYear) ? newYear : undefined
    );
    const fixed = await provisionYearlyFixedAllocations(renewal.newYear);
    res.json({ renewal, fixed });
  } catch (error) {
    console.error('Error running year-end leave renewal:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/leaves/approver-managers', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const {
      listLeaveApproverManagers,
      listLeaveApproverDepartmentGroups,
      resolveDefaultLeaveManagerContext,
      ensureLeaveWorkflowColumns,
    } = await import('./leaveWorkflowService.js');
    await ensureLeaveWorkflowColumns();
    const excludeId = currentUser?.id ? String(currentUser.id) : undefined;
    const [departments, managers] = await Promise.all([
      listLeaveApproverDepartmentGroups(excludeId),
      listLeaveApproverManagers(excludeId),
    ]);
    const suggested = currentUser?.id
      ? await resolveDefaultLeaveManagerContext(String(currentUser.id))
      : { managerId: null, departmentId: null };
    res.json({
      departments,
      managers,
      suggestedManagerId: suggested.managerId,
      suggestedDepartmentId: suggested.departmentId,
    });
  } catch (error) {
    console.error('Error listing leave approver managers:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves', async (req, res) => {
  const { normalizeLeaveCreateBody } = await import('./leaveDuration.js');
  const parsed = normalizeLeaveCreateBody(req.body ?? {});
  if (!parsed.ok) return res.status(400).json({ message: parsed.message });
  const { body } = parsed;
  const {
    ensureLeaveWorkflowColumns,
    validateAssignedManagerId,
  } = await import('./leaveWorkflowService.js');
  await ensureLeaveWorkflowColumns();

  // Resolve the requester-selected approver chain (preferred) or fall back to
  // the legacy single assigned-manager model for older clients.
  const { resolveAssignedChainApprovers } = await import('./workflowChainApproverService.js');
  let approverChain: string[] = [];
  try {
    approverChain = await resolveAssignedChainApprovers({
      assignedApproverUserIds: (req.body ?? {}).assignedApproverUserIds,
      requesterUserId: body.userId,
    });
  } catch (chainErr) {
    return res.status(400).json({ message: (chainErr as Error).message });
  }

  if (approverChain.length === 0) {
    const managerCheck = await validateAssignedManagerId(
      body.assignedManagerId,
      body.userId,
      body.assignedDepartmentId
    );
    if (!managerCheck.ok) return res.status(400).json({ message: managerCheck.message });
  }
  const effectiveManagerId = approverChain[0] ?? body.assignedManagerId;

  const { validateLeaveRequest } = await import('./leaveValidationService.js');
  const validation = await validateLeaveRequest({
    userId: body.userId,
    type: body.type,
    startDate: body.startDate,
    endDate: body.endDate,
    isHalfDay: body.isHalfDay,
    halfDayPeriod: body.halfDayPeriod,
  });
  if (!validation.ok) return res.status(400).json({ message: validation.message });
  try {
    const { assertEligibleForLeaveRequest, EmployeePayrollBoundaryError } = await import(
      './payroll/employeePayrollEligibility.js'
    );
    await assertEligibleForLeaveRequest(String(body.userId));
  } catch (boundaryErr) {
    if (
      boundaryErr instanceof
      (await import('./payroll/employeePayrollEligibility.js')).EmployeePayrollBoundaryError
    ) {
      return res.status(409).json({ message: (boundaryErr as Error).message });
    }
    throw boundaryErr;
  }
  try {
    const leave = await LeaveRequest.create({
      id: `leave-${Date.now()}`,
      userId: body.userId,
      type: body.type,
      startDate: body.startDate,
      endDate: body.endDate,
      isHalfDay: body.isHalfDay,
      halfDayPeriod: body.halfDayPeriod,
      reason: body.reason,
      status: 'PENDING',
      appliedOn: new Date().toISOString().split('T')[0],
      assignedManagerId: effectiveManagerId,
    });
    const plain = leave.get({ plain: true }) as Record<string, unknown>;
    const { serializeLeaveWithApprovers, assignLeaveApproverChain, buildLeaveSummary } =
      await import('./leaveWorkflowService.js');
    if (approverChain.length) {
      await assignLeaveApproverChain(String(plain.id), approverChain, buildLeaveSummary(plain));
    } else {
      const { notifyLeaveSubmitted } = await import('./notificationService.js');
      void notifyLeaveSubmitted(plain as any).catch(() => undefined);
    }
    invalidateLeaveListCache();
    const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
    const serialized = await serializeLeaveWithApprovers(leave);
    await writeDomainAudit({
      entityType: 'leave_request',
      entityId: String(plain.id),
      action: 'CREATE',
      performedBy: String(body.userId),
      newValue: pickAuditFields(serialized as Record<string, unknown>),
      reason: 'Leave request submitted',
    });
    res.status(201).json(serialized);
  } catch (error) {
    console.error('Error submitting leave request:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/:id/cancel', async (req, res) => {
  try {
    const currentUser = (req as any).user as { id: string };
    const { cancelLeaveByRequester } = await import('./leaveWorkflowService.js');
    const result = await cancelLeaveByRequester(req.params.id, String(currentUser?.id ?? ''));
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    invalidateLeaveListCache();
    const plain = result.leave.get({ plain: true });
    res.json(plain);
  } catch (error) {
    console.error('Error cancelling leave:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Edit + resubmit a RETURNED leave request. */
router.put('/leaves/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const actorPlain = currentUser?.get ? currentUser.get({ plain: true }) : currentUser;
    const { resubmitReturnedLeave, serializeLeaveWithApprovers } = await import(
      './leaveWorkflowService.js'
    );
    const result = await resubmitReturnedLeave(
      req.params.id,
      {
        id: String(actorPlain?.id ?? currentUser?.id ?? '').trim(),
        role: String(actorPlain?.role ?? currentUser?.role ?? '').trim(),
      },
      {
        type: req.body?.type,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
        isHalfDay: req.body?.isHalfDay,
        halfDayPeriod: req.body?.halfDayPeriod,
        reason: req.body?.reason,
        assignedManagerId: req.body?.assignedManagerId,
        assignedApproverUserIds: req.body?.assignedApproverUserIds,
      }
    );
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    invalidateLeaveListCache();
    res.json(await serializeLeaveWithApprovers(result.leave));
  } catch (error) {
    console.error('Error resubmitting leave:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/leaves/:id/status', async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const currentUser = (req as any).user;
    const { transitionLeaveStatus } = await import('./leaveWorkflowService.js');
    const actorPlain = currentUser?.get
      ? currentUser.get({ plain: true })
      : currentUser;
    const result = await transitionLeaveStatus(
      req.params.id,
      String(status ?? ''),
      {
        id: String(actorPlain?.id ?? currentUser?.id ?? '').trim(),
        role: String(actorPlain?.role ?? currentUser?.role ?? '').trim(),
      },
      rejectionReason
    );
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    const leave = result.leave;
    const plain = leave.get({ plain: true }) as Record<string, unknown>;
    // The chain service already notified approvers + the requester for chain-based
    // transitions; only fire the legacy notifications when no chain handled it.
    if (!result.chainHandled) {
      const {
        notifyLeaveStatusChange,
        notifyLeaveManagerApproved,
      } = await import('./notificationService.js');
      if (result.nextStatus === 'MANAGER_APPROVED') {
        void notifyLeaveManagerApproved(plain as any).catch(() => undefined);
      } else {
        void notifyLeaveStatusChange({
          id: String(leave.id),
          userId: String(leave.userId),
          type: String(leave.type),
          startDate: String(leave.startDate),
          endDate: String(leave.endDate),
          isHalfDay: Boolean(leave.isHalfDay),
          halfDayPeriod: leave.halfDayPeriod,
          status: String(leave.status),
          rejectionReason: leave.rejectionReason,
        }).catch(() => undefined);
      }
    }
    invalidateLeaveListCache();
    const { serializeLeaveWithApprovers } = await import('./leaveWorkflowService.js');
    res.json(await serializeLeaveWithApprovers(leave));
  } catch (error) {
    console.error('Error updating leave status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Overtime requests (approve before payroll)
router.get('/overtime/config', async (req, res) => {
  try {
    const { getOvertimeRequestConfig } = await import('./overtimeConfigService.js');
    res.json(await getOvertimeRequestConfig());
  } catch (error) {
    console.error('Error fetching overtime config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/overtime/config', requireEffectivePermission('overtime.config'), async (req, res) => {
  try {
    const { saveOvertimeRequestConfig } = await import('./overtimeConfigService.js');
    const saved = await saveOvertimeRequestConfig(req.body);
    res.json(saved);
  } catch (error) {
    console.error('Error saving overtime config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/overtime/types', async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? '') === 'true';
    if (includeInactive) {
      const { listAllOvertimeTypes } = await import('./overtimeConfigService.js');
      res.json(await listAllOvertimeTypes());
      return;
    }
    const { listActiveOvertimeTypes } = await import('./overtimeConfigService.js');
    res.json(await listActiveOvertimeTypes());
  } catch (error) {
    console.error('Error fetching overtime types:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/overtime/types', requireEffectivePermission('overtime.config'), async (req, res) => {
  try {
    const { createOvertimeType } = await import('./overtimeConfigService.js');
    const row = await createOvertimeType(req.body);
    res.status(201).json(row);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error creating overtime type:', error);
    res.status(400).json({ message: msg });
  }
});

router.put('/overtime/types/:id', requireEffectivePermission('overtime.config'), async (req, res) => {
  try {
    const { updateOvertimeType } = await import('./overtimeConfigService.js');
    const row = await updateOvertimeType(req.params.id, req.body);
    if (!row) return res.status(404).json({ message: 'Overtime type not found' });
    res.json(row);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error updating overtime type:', error);
    res.status(400).json({ message: msg });
  }
});

router.delete('/overtime/types/:id', requireEffectivePermission('overtime.config'), async (req, res) => {
  try {
    const { deleteOvertimeType } = await import('./overtimeConfigService.js');
    const effectiveFrom = String(
      req.query.effectiveFrom ?? req.body?.effectiveFrom ?? req.query.effective_from ?? ''
    )
      .trim()
      .slice(0, 10);
    const ok = await deleteOvertimeType(req.params.id, {
      effectiveFrom,
      performedBy: String((req as any).user?.id ?? 'system'),
    });
    if (!ok) return res.status(404).json({ message: 'Overtime type not found' });
    res.json({ message: 'Overtime type deleted', effectiveFrom: effectiveFrom || undefined });
  } catch (error) {
    console.error('Error deleting overtime type:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/overtime/settings', requireEffectivePermission('overtime.config'), async (req, res) => {
  try {
    const { updateOvertimeGlobalSettings } = await import('./overtimeConfigService.js');
    res.json(await updateOvertimeGlobalSettings(req.body));
  } catch (error) {
    console.error('Error updating overtime settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/overtime', cacheMiddleware(30_000), async (req, res) => {
  try {
    const { listOvertimeRequests } = await import('./overtimeRequestService.js');
    res.json(await listOvertimeRequests());
  } catch (error) {
    console.error('Error fetching overtime requests:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/overtime/approved-hours', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const month = String(req.query.month || '').slice(0, 7);
    if (!userId || !month) {
      return res.status(400).json({ message: 'userId and month (YYYY-MM) required' });
    }
    const { getApprovedOvertimeHoursForMonth } = await import('./overtimeRequestService.js');
    const hours = await getApprovedOvertimeHoursForMonth(userId, month);
    res.json({ userId, month, ...hours });
  } catch (error) {
    console.error('Error fetching approved OT hours:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/overtime', async (req, res) => {
  try {
    const { createOvertimeRequest } = await import('./overtimeRequestService.js');
    const { findEmployeeByUserId } = await import('./employeeAttendanceSchedule.js');
    const { assertEligibleForOvertime, EmployeePayrollBoundaryError } = await import(
      './payroll/employeePayrollEligibility.js'
    );
    const userId = String(req.body?.userId || req.user?.id || '');
    if (!userId) return res.status(400).json({ message: 'userId required' });
    try {
      await assertEligibleForOvertime(userId);
    } catch (e) {
      if (e instanceof EmployeePayrollBoundaryError) {
        return res.status(409).json({ message: e.message });
      }
      throw e;
    }
    const employee = await findEmployeeByUserId(userId);
    const row = await createOvertimeRequest({
      userId,
      employeeId: employee?.id ? String(employee.get('id')) : req.body?.employeeId,
      workDate: req.body.workDate,
      hours: req.body.hours,
      rateTier: req.body.rateTier,
      reason: req.body.reason,
      otTypeId: req.body.otTypeId,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      clockIn: req.body.clockIn,
      clockOut: req.body.clockOut,
      assignedApproverUserIds: req.body?.assignedApproverUserIds,
    });
    // When an approver chain was selected, the chain service already notified the
    // first approver; otherwise broadcast to all eligible approvers (legacy).
    if (!row.assignedApprovers?.length) {
      const { notifyOvertimeSubmitted } = await import('./notificationService.js');
      void notifyOvertimeSubmitted({
        id: String(row.id),
        userId: String(row.userId ?? userId),
        workDate: String(row.workDate),
        hours: Number(row.hours) || 0,
      }).catch(() => undefined);
    }
    invalidateOvertimeListCache();
    res.status(201).json(row);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error creating overtime request:', error);
    res.status(400).json({ message: msg });
  }
});

router.put('/overtime/:id', async (req, res) => {
  try {
    const { updatePendingOvertimeRequest } = await import('./overtimeRequestService.js');
    const actor = (req as { user?: { id?: string; role?: string } }).user;
    if (!actor?.id) return res.status(401).json({ message: 'Not authenticated' });
    const row = await updatePendingOvertimeRequest(
      req.params.id,
      {
        workDate: req.body.workDate,
        hours: req.body.hours,
        rateTier: req.body.rateTier,
        reason: req.body.reason,
        otTypeId: req.body.otTypeId,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        clockIn: req.body.clockIn,
        clockOut: req.body.clockOut,
        assignedApproverUserIds: req.body?.assignedApproverUserIds,
      },
      { actorUserId: String(actor.id), actorRole: String(actor.role || '') }
    );
    invalidateOvertimeListCache();
    res.json(row);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    const code =
      msg.includes('not found')
        ? 404
        : msg.includes('Only pending') || msg.includes('Only pending or returned') || msg.includes('your own')
          ? 403
          : 400;
    console.error('Error updating overtime request:', error);
    res.status(code).json({ message: msg });
  }
});

router.post('/overtime/:id/cancel', async (req, res) => {
  try {
    const currentUser = (req as { user?: { id?: string } }).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
    const { cancelOvertimeByRequester } = await import('./overtimeRequestService.js');
    const result = await cancelOvertimeByRequester(req.params.id, String(currentUser.id));
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    invalidateOvertimeListCache();
    res.json(result.request);
  } catch (error) {
    console.error('Error cancelling overtime:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/overtime/:id/status', async (req, res) => {
  try {
    const { updateOvertimeRequestStatus } = await import('./overtimeRequestService.js');
    const status = req.body?.status;
    if (!['APPROVED', 'REJECTED', 'PENDING', 'RETURNED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const row = await updateOvertimeRequestStatus(req.params.id, status, {
      approvedBy: req.user?.id,
      actorRole: (req.user as { role?: string } | undefined)?.role,
      rejectionReason: req.body?.rejectionReason,
    });
    if (!row) return res.status(404).json({ message: 'Overtime request not found' });
    // Chain-based transitions and RETURNED notify internally; only fire the
    // legacy status-change notification when no chain handled it.
    if (status !== 'RETURNED' && !row.assignedApprovers?.length) {
      const { notifyOvertimeStatusChange } = await import('./notificationService.js');
      void notifyOvertimeStatusChange({
        id: String(row.id),
        userId: String(row.userId),
        workDate: String(row.workDate),
        hours: Number(row.hours) || 0,
        status: String(row.status),
        rejectionReason: row.rejectionReason,
      }).catch(() => undefined);
    }
    invalidateOvertimeListCache();
    res.json(row);
  } catch (error) {
    const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
    if (error instanceof PayrollPeriodFrozenError) {
      return res.status(409).json({ message: error.message, code: error.code });
    }
    const { OvertimeApprovalError } = await import('./overtimeRequestService.js');
    if (error instanceof OvertimeApprovalError) {
      return res.status(error.status).json({ message: error.message });
    }
    const msg = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error updating overtime status:', error);
    if (msg.includes('not found')) return res.status(404).json({ message: msg });
    if (msg.includes('Only pending')) return res.status(403).json({ message: msg });
    if (msg.toLowerCase().includes('frozen')) {
      return res.status(409).json({ message: msg, code: 'PAYROLL_PERIOD_FROZEN' });
    }
    res.status(msg === 'Internal server error' ? 500 : 400).json({ message: msg });
  }
});

// Projects
router.get('/projects', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const tasksOnly = req.query.scope === 'self';
    const deleted = String(req.query.deleted ?? 'exclude');
    const { listProjectsForUser } = await import('./projectAccessService.js');
    const projects = await listProjectsForUser(
      String(currentUser?.id ?? ''),
      currentUser?.role,
      { tasksOnly, deleted }
    );
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const tasksOnly = req.query.scope === 'self';
    const deleted = String(req.query.deleted ?? 'include');
    const { userCanAccessProject } = await import('./projectAccessService.js');
    const allowed = await userCanAccessProject(
      String(currentUser?.id ?? ''),
      currentUser?.role,
      req.params.id,
      { tasksOnly }
    );
    if (!allowed) return res.status(404).json({ message: 'Project not found' });

    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const { listProjectsForUser } = await import('./projectAccessService.js');
    const visible = await listProjectsForUser(
      String(currentUser?.id ?? ''),
      currentUser?.role,
      { tasksOnly, deleted }
    );
    const row = visible.find((p) => String(p.id) === req.params.id);
    res.json(row ?? project.get({ plain: true }));
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/projects', requireEffectivePermission('projects.create'), async (req, res) => {
  try {
    const data = req.body || {};
    const title = String(data.title ?? '').trim();
    const description = String(data.description ?? '').trim();
    const departmentId = String(data.departmentId ?? '').trim();
    const leadId = String(data.leadId ?? '').trim();
    const deadline = String(data.deadline ?? '').trim();
    const startDate = String(data.startDate ?? '').trim();

    if (!title) return res.status(400).json({ message: 'Project title is required' });
    if (!description) return res.status(400).json({ message: 'Project description is required' });
    if (!departmentId) return res.status(400).json({ message: 'Department is required' });
    if (!leadId) return res.status(400).json({ message: 'Project lead is required' });
    if (!deadline) return res.status(400).json({ message: 'Project deadline is required' });
    if (startDate && deadline < startDate) {
      return res.status(400).json({ message: 'Deadline must be on or after the start date' });
    }

    const currentUser = (req as any).user;
    const { generateNextProjectId, isCanonicalProjectId } = await import('./projectTaskIdService.js');
    const project = await Project.create({
      id: isCanonicalProjectId(String(data.id ?? '').trim())
        ? String(data.id).trim()
        : await generateNextProjectId(),
      title,
      description,
      departmentId,
      leadId,
      createdBy: currentUser?.id ? String(currentUser.id) : null,
      deadline,
      startDate: startDate || null,
      status: data.status || 'PLANNING',
      priority: data.priority || 'MEDIUM',
      progress: Number(data.progress) || 0,
    });
    const memberIds = Array.isArray(data.members)
      ? data.members.map((m: unknown) => String(m))
      : [];
    // Keep creator on the project membership list for notifications / collaboration.
    if (currentUser?.id) memberIds.push(String(currentUser.id));
    const { syncProjectAssignments } = await import('./projectAccessService.js');
    await syncProjectAssignments(String(project.get('id')), memberIds, leadId);
    const {
      notifyProjectMembership,
      resolvePortalUserIdsForRefs,
    } = await import('./notificationService.js');
    const recipients = await resolvePortalUserIdsForRefs([...memberIds, leadId]);
    void notifyProjectMembership({
      projectId: String(project.get('id')),
      projectTitle: title,
      addedUserIds: recipients,
      actorUserId: currentUser?.id,
      eventKey: 'created',
    }).catch(() => undefined);
    const { listProjectsForUser } = await import('./projectAccessService.js');
    const enriched = await listProjectsForUser(String(currentUser?.id ?? ''), currentUser?.role);
    const row = enriched.find((p) => String(p.id) === String(project.get('id')));
    res.status(201).json(row ?? project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put(
  '/projects/:id',
  requireEffectivePermission(
    'projects.edit.info',
    'projects.edit.lead',
    'projects.edit.status'
  ),
  async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { userCanAccessProject, syncProjectAssignments, listProjectsForUser } = await import(
        './projectAccessService.js'
      );
      const allowed = await userCanAccessProject(
        String(currentUser?.id ?? ''),
        currentUser?.role,
        req.params.id
      );
      if (!allowed) return res.status(404).json({ message: 'Project not found' });

      const project: any = await Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      const { isSoftDeleted } = await import('./softDelete.js');
      if (isSoftDeleted(project.get({ plain: true }) as { deletedAt?: unknown })) {
        return res.status(409).json({ message: 'Project is deleted and cannot be edited' });
      }
      const before = project.get({ plain: true }) as Record<string, unknown>;
      const beforeAssignments = await ProjectAssignment.findAll({
        where: { projectId: req.params.id, isActive: true },
        attributes: ['employeeId'],
      });
      const beforeRefs = [
        ...beforeAssignments.map((row) => String(row.get('employeeId'))),
        String(before.leadId || ''),
      ];
      await project.update(req.body);
      if (Array.isArray(req.body?.members)) {
        const memberIds = req.body.members.map((m: unknown) => String(m));
        const leadId = req.body?.leadId ?? project.leadId;
        await syncProjectAssignments(
          req.params.id,
          memberIds,
          leadId ? String(leadId) : undefined
        );
      } else if (req.body?.leadId && req.body.leadId !== before.leadId) {
        await syncProjectAssignments(
          req.params.id,
          beforeRefs,
          String(req.body.leadId)
        );
      }
      const after = project.get({ plain: true }) as Record<string, unknown>;
      const changedFields = [
        'title',
        'description',
        'startDate',
        'deadline',
        'status',
        'priority',
        'leadId',
      ].filter((field) => field in (req.body || {}) && before[field] !== after[field]);
      const afterRefs = Array.isArray(req.body?.members)
        ? [...req.body.members.map((m: unknown) => String(m)), String(after.leadId || '')]
        : req.body?.leadId
          ? [...beforeRefs, String(after.leadId || '')]
          : beforeRefs;
      const {
        notifyProjectMembership,
        notifyProjectUpdated,
        resolvePortalUserIdsForRefs,
      } = await import('./notificationService.js');
      const [beforeUserIds, afterUserIds] = await Promise.all([
        resolvePortalUserIdsForRefs(beforeRefs),
        resolvePortalUserIdsForRefs(afterRefs),
      ]);
      const revision = new Date(project.updatedAt || Date.now()).getTime().toString(36);
      const added = afterUserIds.filter((id) => !beforeUserIds.includes(id));
      const removed = beforeUserIds.filter((id) => !afterUserIds.includes(id));
      if (added.length || removed.length) {
        void notifyProjectMembership({
          projectId: req.params.id,
          projectTitle: String(after.title || 'Project'),
          addedUserIds: added,
          removedUserIds: removed,
          actorUserId: currentUser?.id,
          eventKey: revision,
        }).catch(() => undefined);
      }
      if (changedFields.length) {
        void notifyProjectUpdated({
          projectId: req.params.id,
          projectTitle: String(after.title || 'Project'),
          userIds: afterUserIds,
          actorUserId: currentUser?.id,
          eventKey: revision,
          summary: `${changedFields.map((field) => field.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ')} changed.`,
        }).catch(() => undefined);
      }
      const enriched = await listProjectsForUser(String(currentUser?.id ?? ''), currentUser?.role);
      const row = enriched.find((p) => String(p.id) === req.params.id);
      res.json(row ?? project);
    } catch (error) {
      console.error('Error updating project:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.delete('/projects/:id', requireEffectivePermission('projects.delete'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { userCanAccessProject } = await import('./projectAccessService.js');
    const allowed = await userCanAccessProject(
      String(currentUser?.id ?? ''),
      currentUser?.role,
      req.params.id
    );
    if (!allowed) return res.status(404).json({ message: 'Project not found' });

    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const { isSoftDeleted, softDeleteTimestamp } = await import('./softDelete.js');
    if (isSoftDeleted(project.get({ plain: true }) as { deletedAt?: unknown })) {
      return res.json({ success: true, alreadyDeleted: true });
    }
    const assignments = await ProjectAssignment.findAll({
      where: { projectId: req.params.id, isActive: true },
      attributes: ['employeeId'],
    });
    const {
      notifyProjectMembership,
      resolvePortalUserIdsForRefs,
    } = await import('./notificationService.js');
    const recipients = await resolvePortalUserIdsForRefs([
      ...assignments.map((row) => String(row.get('employeeId'))),
      String(project.get('leadId') || ''),
    ]);
    const title = String(project.get('title') || 'Project');
    const snapshot = project.get({ plain: true });
    await project.update({ deletedAt: softDeleteTimestamp() });
    try {
      const { logProjectDeleted } = await import('./taskActivityService.js');
      await logProjectDeleted({ project: snapshot, performedBy: currentUser?.id });
    } catch (auditErr) {
      console.warn('[projects] delete activity log failed:', (auditErr as Error)?.message || auditErr);
    }
    void notifyProjectMembership({
      projectId: req.params.id,
      projectTitle: title,
      removedUserIds: recipients,
      actorUserId: currentUser?.id,
      eventKey: 'deleted',
    }).catch(() => undefined);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ TASKS ============

const TASK_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const TASK_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED']);

/** Fields a task editor may write. Keeps id/createdAt/creatorId out of mass assignment. */
const TASK_EDITABLE_FIELDS = [
  'title',
  'description',
  'projectId',
  'assigneeId',
  'status',
  'progress',
  'priority',
  'startDate',
  'dueDate',
  'estimatedHours',
  'loggedHours',
] as const;

function normalizeTaskField(field: string, raw: unknown): unknown {
  if (field === 'progress') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  if (field === 'priority') {
    const p = String(raw ?? '').trim().toUpperCase();
    return TASK_PRIORITIES.has(p) ? p : undefined;
  }
  if (field === 'status') {
    const s = String(raw ?? '').trim().toUpperCase();
    return TASK_STATUSES.has(s) ? s : undefined;
  }
  if (field === 'estimatedHours' || field === 'loggedHours') {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (field === 'startDate' || field === 'dueDate') {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  return raw;
}

/**
 * Builds a validated task payload limited to `allowed` fields. Progress and status
 * are reconciled so the project/team rollups (which treat 100% and DONE as
 * equivalent) never disagree with each other.
 */
function buildTaskPayload(
  body: unknown,
  allowed: readonly string[] = TASK_EDITABLE_FIELDS
): Record<string, unknown> {
  const src = (body ?? {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!(field in src)) continue;
    const value = normalizeTaskField(field, src[field]);
    if (value !== undefined) payload[field] = value;
  }

  const canWriteProgress = allowed.includes('progress');
  const canWriteStatus = allowed.includes('status');
  if (canWriteProgress && payload.progress === 100 && !('status' in payload) && canWriteStatus) {
    payload.status = 'DONE';
  }
  if (canWriteStatus && payload.status === 'DONE' && !('progress' in payload) && canWriteProgress) {
    payload.progress = 100;
  }
  return payload;
}

router.get('/tasks', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { listTasksForUser } = await import('./taskAccessService.js');
    const tasks = await listTasksForUser(
      String(currentUser?.id ?? ''),
      currentUser?.role,
      {
        deleted: req.query.deleted as string | undefined,
        projectId: req.query.projectId ? String(req.query.projectId) : null,
      }
    );
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/tasks', requireEffectivePermission('tasks.create'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const role = String(currentUser?.role || '').toUpperCase();
    const projectId = req.body?.projectId ? String(req.body.projectId).trim() : '';
    if (projectId) {
      const { userCanAccessProject } = await import('./projectAccessService.js');
      const allowed = await userCanAccessProject(
        String(currentUser?.id ?? ''),
        currentUser?.role,
        projectId,
        // Staff self-service: must be assigned to the project.
        role === 'EMPLOYEE' ? { tasksOnly: true } : undefined
      );
      if (!allowed) {
        return res
          .status(403)
          .json({ message: 'You can only add tasks on projects assigned to you.' });
      }
    }

    let body = { ...(req.body || {}) };
    // Staff may only create tasks assigned to themselves.
    if (role === 'EMPLOYEE') {
      body = { ...body, assigneeId: String(currentUser?.id ?? '') };
    }

    const { generateNextTaskId, isCanonicalTaskId } = await import('./projectTaskIdService.js');
    const task = await Task.create({
      ...buildTaskPayload(body),
      id: isCanonicalTaskId(String(body?.id ?? '').trim())
        ? String(body.id).trim()
        : await generateNextTaskId(),
      creatorId: String(body?.creatorId ?? currentUser?.id ?? ''),
      createdAt: new Date().toISOString(),
    });
    const assigneeId = body?.assigneeId ?? task.get('assigneeId');
    if (projectId && assigneeId) {
      const { ensureAssigneeOnProject } = await import('./projectAccessService.js');
      await ensureAssigneeOnProject(String(projectId), String(assigneeId));
    }
    const { notifyTaskAssigned } = await import('./notificationService.js');
    void notifyTaskAssigned({
      id: String(task.get('id')),
      title: String(task.get('title') ?? body?.title ?? ''),
      assigneeId: task.get('assigneeId') ?? assigneeId,
      createdByUserId: currentUser?.id,
      projectId: task.get('projectId') ?? projectId,
      eventKey: 'created',
    }).catch(() => undefined);
    try {
      const { logTaskCreated } = await import('./taskActivityService.js');
      await logTaskCreated({ task, performedBy: currentUser?.id });
    } catch (auditErr) {
      console.warn('[tasks] create activity log failed:', (auditErr as Error)?.message || auditErr);
    }
    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/tasks/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const task: any = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const { isSoftDeleted } = await import('./softDelete.js');
    if (isSoftDeleted(task.get ? task.get({ plain: true }) : task)) {
      return res.status(409).json({ message: 'Task is deleted and cannot be edited' });
    }
    const beforeSnapshot = JSON.parse(
      JSON.stringify(task.get ? task.get({ plain: true }) : task)
    ) as Record<string, unknown>;

    const { resolveTaskUpdateAccess } = await import('./taskAccessService.js');
    const access = await resolveTaskUpdateAccess({
      userId: String(currentUser?.id ?? ''),
      role: currentUser?.role,
      task: {
        assigneeId: task.assigneeId,
        projectId: task.projectId,
      },
    });

    if (access.mode === 'deny') {
      return res.status(403).json({ message: access.message });
    }

    if (access.mode === 'assignee') {
      const selfPayload = buildTaskPayload(req.body, [...access.fields]);
      if (Object.keys(selfPayload).length === 0) {
        return res.status(403).json({
          message: 'Forbidden: only assigned task progress can be updated',
        });
      }
      await task.update(selfPayload);
      const afterSnapshot = JSON.parse(
        JSON.stringify(task.get ? task.get({ plain: true }) : task)
      ) as Record<string, unknown>;
      const { notifyTaskChanged } = await import('./notificationService.js');
      void notifyTaskChanged({
        taskId: String(task.id),
        projectId: task.projectId,
        title: String(task.title ?? ''),
        actorUserId: currentUser?.id,
        creatorId: task.creatorId,
        previousAssigneeId: beforeSnapshot.assigneeId as string | undefined,
        assigneeId: task.assigneeId,
        previousDueDate: beforeSnapshot.dueDate as string | undefined,
        dueDate: task.dueDate,
        previousStatus: beforeSnapshot.status as string | undefined,
        status: task.status,
        updatedAt: task.updatedAt,
      }).catch(() => undefined);
      try {
        const { logTaskUpdated } = await import('./taskActivityService.js');
        const logged = await logTaskUpdated({
          before: beforeSnapshot,
          after: afterSnapshot,
          performedBy: currentUser?.id,
        });
        if (!logged) {
          console.warn('[tasks] update activity log skipped (no field diff)', {
            taskId: String(task.id),
            payloadKeys: Object.keys(selfPayload),
          });
        }
      } catch (auditErr) {
        console.warn('[tasks] update activity log failed:', (auditErr as Error)?.message || auditErr);
      }
      return res.json(task);
    }

    const prevAssignee = String(task.assigneeId ?? '');
    const updatePayload = buildTaskPayload(req.body);
    await task.update(updatePayload);
    const afterSnapshot = JSON.parse(
      JSON.stringify(task.get ? task.get({ plain: true }) : task)
    ) as Record<string, unknown>;
    const nextAssignee = String(task.assigneeId ?? '');
    const projectId = task.projectId ?? req.body?.projectId;
    if (projectId && nextAssignee) {
      const { ensureAssigneeOnProject } = await import('./projectAccessService.js');
      await ensureAssigneeOnProject(String(projectId), nextAssignee);
    }
    const { notifyTaskChanged } = await import('./notificationService.js');
    void notifyTaskChanged({
      taskId: String(task.id),
      projectId: task.projectId,
      title: String(task.title ?? ''),
      actorUserId: currentUser?.id,
      creatorId: task.creatorId,
      previousAssigneeId: prevAssignee,
      assigneeId: nextAssignee,
      previousDueDate: beforeSnapshot.dueDate as string | undefined,
      dueDate: task.dueDate,
      previousStatus: beforeSnapshot.status as string | undefined,
      status: task.status,
      updatedAt: task.updatedAt,
    }).catch(() => undefined);
    try {
      const { logTaskUpdated } = await import('./taskActivityService.js');
      const logged = await logTaskUpdated({
        before: beforeSnapshot,
        after: afterSnapshot,
        performedBy: currentUser?.id,
      });
      if (!logged) {
        console.warn('[tasks] update activity log skipped (no field diff)', {
          taskId: String(task.id),
          payloadKeys: Object.keys(updatePayload),
        });
      }
    } catch (auditErr) {
      console.warn('[tasks] update activity log failed:', (auditErr as Error)?.message || auditErr);
    }
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/tasks/:id', requireEffectivePermission('tasks.delete'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    const snapshot = task.get ? task.get({ plain: true }) : task;
    const role = String(currentUser?.role || '').toUpperCase();
    if (role === 'EMPLOYEE') {
      return res.status(403).json({ message: 'Staff cannot delete tasks.' });
    }
    if (role === 'MANAGER') {
      const { getCreatedProjectIdSet } = await import('./projectAccessService.js');
      const created = await getCreatedProjectIdSet(String(currentUser?.id ?? ''));
      const projectId = String((snapshot as any).projectId ?? '').trim();
      if (!projectId || !created.has(projectId)) {
        return res.status(403).json({ message: 'You can only delete tasks on projects you created.' });
      }
    }
    const { isSoftDeleted, softDeleteTimestamp } = await import('./softDelete.js');
    if (isSoftDeleted(snapshot as { deletedAt?: unknown })) {
      return res.json({ success: true, alreadyDeleted: true });
    }
    await task.update({ deletedAt: softDeleteTimestamp() });
    const { notifyTaskDeleted } = await import('./notificationService.js');
    void notifyTaskDeleted({
      taskId: String((snapshot as any).id ?? req.params.id),
      projectId: (snapshot as any).projectId,
      title: String((snapshot as any).title ?? ''),
      assigneeId: (snapshot as any).assigneeId,
      actorUserId: currentUser?.id,
    }).catch(() => undefined);
    try {
      const { logTaskDeleted } = await import('./taskActivityService.js');
      await logTaskDeleted({ task: snapshot, performedBy: currentUser?.id });
    } catch (auditErr) {
      console.warn('[tasks] delete activity log failed:', (auditErr as Error)?.message || auditErr);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/projects/:id/task-activity', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const projectId = String(req.params.id ?? '').trim();
    const tasksOnly = req.query.scope === 'self';
    const actorId = String(currentUser?.id ?? '').trim();
    const { userCanAccessProject } = await import('./projectAccessService.js');
    const allowed = await userCanAccessProject(actorId, currentUser?.role, projectId, {
      tasksOnly,
    });
    if (!allowed) return res.status(404).json({ message: 'Project not found' });

    const { listTaskActivityForProject } = await import('./taskActivityService.js');
    const limit = Number(req.query.limit);
    let entries = await listTaskActivityForProject(projectId, {
      limit: Number.isFinite(limit) ? limit : 100,
    });

    // Staff self-service: only show activity for tasks they own or acted on.
    if (tasksOnly && actorId) {
      const myTaskIds = new Set(
        (
          (await Task.findAll({
            where: { projectId, assigneeId: actorId },
            attributes: ['id'],
            raw: true,
          })) as Array<{ id?: string }>
        ).map((t) => String(t.id ?? '').trim())
      );
      entries = entries.filter(
        (e) =>
          myTaskIds.has(String(e.taskId)) ||
          String(e.performedBy ?? '') === actorId ||
          String(e.newAssigneeId ?? '') === actorId ||
          String(e.oldAssigneeId ?? '') === actorId
      );
    }

    res.json(entries);
  } catch (error) {
    console.error('Error fetching task activity:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Payroll
router.get('/payroll/runs', requireEffectivePermission('hr.payroll.view'), async (req, res) => {
  try {
    try {
      const { ensurePayrollHybridSchema } = await import('./payroll/payrollHybridSchema.js');
      await ensurePayrollHybridSchema();
    } catch (schemaErr) {
      console.warn(
        '[payroll] Schema ensure before runs list failed:',
        (schemaErr as Error)?.message || schemaErr
      );
    }

    let runs: any[];
    try {
      runs = await PayrollRun.findAll({ order: [['createdAt', 'DESC']] });
    } catch (findErr) {
      const msg = String((findErr as Error)?.message || findErr);
      console.warn('[payroll] PayrollRun.findAll failed; using raw SELECT *:', msg);
      runs = (await sequelize.query(`SELECT * FROM payrollruns ORDER BY createdAt DESC`, {
        type: QueryTypes.SELECT,
      })) as Array<Record<string, unknown>>;
    }

    const { enrichPayrollRunsList } = await import('./payroll/payrollRunDisplayService.js');
    try {
      res.json(await enrichPayrollRunsList(runs));
    } catch (enrichErr) {
      console.warn(
        '[payroll] Runs list enrichment failed; returning raw runs:',
        (enrichErr as Error)?.message || enrichErr
      );
      res.json(
        runs.map((r) => (r && typeof r.get === 'function' ? r.get({ plain: true }) : r))
      );
    }
  } catch (error) {
    console.error('Error fetching payroll runs:', error);
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ message: 'Internal server error', detail });
  }
});

router.get('/payroll/runs/pending-my-approval', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { listPayrollApprovalsInboxForCurrentApprover } = await import(
      './payroll/payrollRunApprovalService.js'
    );
    res.json(
      await listPayrollApprovalsInboxForCurrentApprover({
        id: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      })
    );
  } catch (error: unknown) {
    console.error('Error listing payroll approvals:', error);
    const e = error as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.get('/payroll/runs/approval-board', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { listPayrollRunsForApprovalBoard } = await import('./payroll/payrollRunApprovalService.js');
    res.json(
      await listPayrollRunsForApprovalBoard({
        id: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      })
    );
  } catch (error: unknown) {
    console.error('Error listing payroll approval board:', error);
    const e = error as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.get('/payroll/work-day-policy', requireEffectivePermission('hr.payroll.view'), async (req, res) => {
  try {
    const { getPayrollWorkDayPolicyDetails } = await import(
      './payroll/payrollWorkDayPolicyVersionService.js'
    );
    const { getProrationConfig } = await import('./payroll/prorationConfigService.js');
    const month = String(req.query.month ?? '').slice(0, 7) || undefined;
    const [policy, proration] = await Promise.all([
      getPayrollWorkDayPolicyDetails(month),
      getProrationConfig(),
    ]);
    res.json({ ...policy, prorationMethod: proration.method });
  } catch (error) {
    console.error('Error fetching payroll work-day policy:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/work-day-policy', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const { normalizePayrollBasisDays, normalizePayrollWorkDayMethod } = await import(
      './payroll/payrollBasisDaysService.js'
    );
    const { savePayrollWorkDayPolicyVersion } = await import(
      './payroll/payrollWorkDayPolicyVersionService.js'
    );
    const method = normalizePayrollWorkDayMethod(req.body?.method);
    const companyBasisDays = normalizePayrollBasisDays(req.body?.companyBasisDays);
    const effectiveFrom = req.body?.effectiveFrom ?? req.body?.effective_from;
    const actor = req.user as { id?: string } | undefined;

    const saved = await savePayrollWorkDayPolicyVersion(
      { method, companyBasisDays },
      effectiveFrom,
      actor?.id ?? null
    );

    const { getProrationConfig } = await import('./payroll/prorationConfigService.js');
    const proration = await getProrationConfig();
    res.json({ ...saved, prorationMethod: proration.method });
  } catch (error) {
    const err = error as Error & { statusCode?: number; code?: string };
    if (err.code === 'POLICY_EFFECTIVE_DATE_REQUIRED' || err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.error('Error updating payroll work-day policy:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/monthly-sales', requireEffectivePermission('hr.payroll.view'), async (req, res) => {
  try {
    const month = String(req.query.month ?? '').slice(0, 7);
    const { listMonthlySalesForMonth } = await import('./payroll/employeeMonthlySalesService.js');
    const items = await listMonthlySalesForMonth(month);
    res.json({ month, items });
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('Error listing monthly sales:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/monthly-sales', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const body = req.body ?? {};
    const month = String(body.month ?? '').slice(0, 7);
    const items = Array.isArray(body.items) ? body.items : [];
    const { upsertMonthlySales } = await import('./payroll/employeeMonthlySalesService.js');
    const updated = await upsertMonthlySales({
      month,
      items: items.map((it: { employeeId?: string; salesAmount?: number; notes?: string | null }) => ({
        employeeId: String(it.employeeId ?? ''),
        salesAmount: Number(it.salesAmount ?? 0),
        notes: it.notes ?? null,
      })),
    });
    res.json({ month, items: updated });
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    console.error('Error upserting monthly sales:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/preview', requireEffectivePermission('hr.payroll.view'), async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year);
    const monthNum = Number(req.query.month);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ message: 'Valid year query parameter required (2000–2100).' });
    }
    if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: 'Valid month query parameter required (1–12).' });
    }
    const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`;
    const payrollGroupId = String(req.query.payrollGroupId ?? 'default');
    const includeAttendance = String(req.query.includeAttendance ?? 'false').toLowerCase() === 'true';
    const { buildPayrollRunItemsForMonth, summarizePayrollRunItemsResult } = await import(
      './payroll/payrollRunItemsService.js'
    );
    const result = await buildPayrollRunItemsForMonth(monthStr, {
      skipFinalizationCheck: true,
      payrollGroupId,
      skipAnomalyDetection: true,
      persistRuleLogs: false,
      includeAttendance,
    });
    const totals = summarizePayrollRunItemsResult(result);
    const items = result.items.map((row) => ({
      id: `preview-${row.userId}-${result.month}`,
      userId: row.userId,
      employeeId: row.employeeId,
      month: result.month,
      status: row.employeeStatus,
      breakdown: row.breakdown,
      warnings: row.warnings,
      anomalies: row.anomalies ?? [],
    }));
    res.json({
      month: result.month,
      calculationEngine: result.calculationEngine,
      prorationMethod: result.prorationMethod,
      engineRulesSummary: result.engineRulesSummary,
      anomalyEngine: result.anomalySummary?.engineVersion,
      anomalySummary: result.anomalySummary,
      generatedAt: result.generatedAt,
      period: result.period,
      attendancePeriodStatus: result.attendancePeriodStatus,
      attendanceFinalized: result.attendanceFinalized,
      includeAttendance,
      globalWarnings: result.globalWarnings,
      errors: result.errors,
      items,
      ...totals,
      disclaimer:
        'Pre-run estimate only. Work days are per employee from Planning roster. Official payroll is recorded when a run is calculated and approved; amounts are snapshotted at that time.',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Error building payroll preview:', detail, error);
    res.status(500).json({
      message: 'Internal server error',
      detail,
    });
  }
});

async function buildRunResponse(
  runId: string,
  viewer?: { userId: string; role?: string }
) {
  const run = await PayrollRun.findByPk(runId);
  if (!run) return null;
  const plain = run.get({ plain: true }) as any;
  const { isPayrollRunLocked } = await import('./payroll/payrollWorkflowService.js');
  const finalized = isPayrollRunLocked(String(plain.status ?? ''));

  const payslips = await Payslip.findAll({ where: { payrollRunId: runId } });
  let totalGross = 0;
  let totalNetPay = 0;
  for (const ps of payslips) {
    const row = await serializePayslipForApi(ps, plain.month);
    totalGross += row.breakdown?.grossSalary ?? 0;
    totalNetPay += row.breakdown?.netSalary ?? 0;
  }

  if (finalized && Number(plain.totalNetPay) > 0) {
    totalNetPay = Number(plain.totalNetPay);
  }

  const { enrichPayrollRunPlain } = await import('./payroll/payrollRunDisplayService.js');
  const { enrichPayrollRunApprovalFields } = await import('./payroll/payrollRunApprovalService.js');
  const enriched = await enrichPayrollRunPlain({
    ...plain,
    totalGross: Math.round(totalGross * 100) / 100,
    totalNetPay: Math.round(totalNetPay * 100) / 100,
    totalEmployees: payslips.length,
  });
  return enrichPayrollRunApprovalFields(enriched, viewer);
}

router.get('/payroll/runs/:id/details', async (req, res) => {
  try {
    const viewer = {
      userId: String((req as any).user?.id || ''),
      role: String((req as any).user?.role || ''),
    };
    const { assertPayrollRunReadAccess } = await import('./payroll/payrollRunApprovalService.js');
    await assertPayrollRunReadAccess(req.params.id, {
      id: viewer.userId,
      role: viewer.role,
    });
    const payload = await buildRunResponse(req.params.id, viewer);
    if (!payload) return res.status(404).json({ message: 'Payroll run not found' });
    res.json(payload);
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    if (e.statusCode === 403) {
      return res.status(403).json({ message: e.message || 'Forbidden: insufficient role permissions' });
    }
    console.error('Error fetching run details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/runs/:id/items', async (req, res) => {
  try {
    const viewer = {
      userId: String((req as any).user?.id || ''),
      role: String((req as any).user?.role || ''),
    };
    const { assertPayrollRunReadAccess } = await import('./payroll/payrollRunApprovalService.js');
    await assertPayrollRunReadAccess(req.params.id, {
      id: viewer.userId,
      role: viewer.role,
    });
    const run = await PayrollRun.findByPk(req.params.id);
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    const payslips = await Payslip.findAll({
      where: { payrollRunId: req.params.id },
      order: [['generatedAt', 'DESC']],
    });
    const month = (run as any).month as string;
    const runStatus = String((run as any).status ?? '');
    const { resolveRunPaymentStatus } = await import('./payroll/payrollPaymentStatusService.js');
    const paymentStatus = await resolveRunPaymentStatus(req.params.id, runStatus);

    const payload = await Promise.all(
      payslips.map((ps) =>
        serializePayslipForApi(ps, month, {
          paymentStatus,
          skipReviewHydration: true,
          runStatus,
          payrollGroupId: String((run as any).payrollGroupId ?? 'default'),
        })
      )
    );

    const { ensureReviewContextForPayslips, persistReviewContextSnapshots } = await import(
      './payroll/payrollReviewHydrationService.js'
    );
    const payrollGroupId = String((run as any).payrollGroupId ?? 'default');
    await ensureReviewContextForPayslips(
      payload.map((row) => ({ userId: row.userId, breakdown: row.breakdown ?? null })),
      month,
      payrollGroupId
    );

    const draftLike = ['DRAFT', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'PROCESSING'].includes(runStatus);
    if (draftLike) {
      await persistReviewContextSnapshots(
        payload.map((row) => ({ payslipId: row.id, breakdown: row.breakdown ?? null }))
      );
    }

    res.json(payload);
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    if (e.statusCode === 403) {
      return res.status(403).json({ message: e.message || 'Forbidden: insufficient role permissions' });
    }
    console.error('Error fetching run items:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/runs/:id', async (req, res) => {
  try {
    const viewer = {
      userId: String((req as any).user?.id || ''),
      role: String((req as any).user?.role || ''),
    };
    const { assertPayrollRunReadAccess } = await import('./payroll/payrollRunApprovalService.js');
    await assertPayrollRunReadAccess(req.params.id, {
      id: viewer.userId,
      role: viewer.role,
    });
    const payload = await buildRunResponse(req.params.id, viewer);
    if (!payload) return res.status(404).json({ message: 'Payroll run not found' });
    res.json(payload);
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    if (e.statusCode === 403) {
      return res.status(403).json({ message: e.message || 'Forbidden: insufficient role permissions' });
    }
    console.error('Error fetching payroll run:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/payroll/runs', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.body?.year) || now.getFullYear();
    const monthNum = Number(req.body?.month) || now.getMonth() + 1;
    const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`;
    const runDate = req.body?.runDate || now.toISOString().slice(0, 10);
    const payDate =
      req.body?.payDate ||
      new Date(year, monthNum, 0).toISOString().slice(0, 10);
    const actorUserId = String(req.body?.userId || (req as any).user?.id || 'system');
    const autoFinalizeAttendance = Boolean(req.body?.autoFinalizeAttendance);

    const { resolvePayrollApproverUserIdsForSubmit } = await import(
      './payroll/payrollRunApprovalService.js'
    );
    try {
      await resolvePayrollApproverUserIdsForSubmit({
        assignedApproverUserIds: req.body?.assignedApproverUserIds,
        calculatedByUserId: actorUserId,
      });
    } catch (approverErr: unknown) {
      const e = approverErr as Error & { statusCode?: number; code?: string };
      return res.status(e.statusCode ?? 400).json({
        message: e.message || 'Select at least one approver before running payroll.',
        code: e.code ?? 'APPROVER_REQUIRED',
      });
    }

    const { resolvePayrollPeriod } = await import('./payroll/payrollPeriodService.js');
    const { assertAttendanceFinalizedForPayroll, finalizeAttendancePeriod } =
      await import('./payroll/attendanceFinalizationService.js');
    const payrollGroupId = String(req.body?.payrollGroupId ?? 'default');
    const period = await resolvePayrollPeriod(monthStr, payrollGroupId);
    const cycle = period.cycle;

    if (autoFinalizeAttendance) {
      await finalizeAttendancePeriod(
        monthStr,
        actorUserId,
        'Auto-finalized for payroll run',
        payrollGroupId
      );
    } else {
      await assertAttendanceFinalizedForPayroll(monthStr, payrollGroupId);
    }

    const { isPayrollRunLocked, normalizeLegacyRunStatus } = await import(
      './payroll/payrollWorkflowService.js'
    );

    const TERMINAL_INACTIVE_STATUSES = ['REJECTED', 'REVERSED', 'CANCELLED'] as const;
    const monthWhere = {
      [Op.or]: [{ month: monthStr }, { month: { [Op.like]: `${monthStr}-%` } }],
    };

    const activeRun = await PayrollRun.findOne({
      where: {
        ...monthWhere,
        status: { [Op.notIn]: [...TERMINAL_INACTIVE_STATUSES] },
      },
      order: [
        ['calculatedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    // After cancel/reject/reverse, reuse that run instead of inserting a second
    // month row (avoids unique clashes on payslips userId+month and keeps one run).
    const inactiveRun = !activeRun
      ? await PayrollRun.findOne({
          where: {
            ...monthWhere,
            status: { [Op.in]: [...TERMINAL_INACTIVE_STATUSES] },
          },
          order: [
            ['calculatedAt', 'DESC'],
            ['createdAt', 'DESC'],
          ],
        })
      : null;

    let payrollRun: any;
    let recalculated = false;

    const resetRunPayslipsForRecalc = async (run: any) => {
      await sequelize.transaction(async (transaction) => {
        const oldPayslips = await Payslip.findAll({
          where: { payrollRunId: run.id },
          attributes: ['id', 'userId'],
          transaction,
        });
        const previousRunNetByUserId = new Map<string, number>();
        for (const ps of oldPayslips) {
          const plainPs = ps.get({ plain: true }) as { id?: string; userId?: string };
          const uid = String(plainPs.userId ?? '');
          if (!uid || !plainPs.id) continue;
          const { loadBreakdownForPayslipId } = await import('./payslipBreakdownService.js');
          const prevBreakdown = await loadBreakdownForPayslipId(String(plainPs.id));
          if (prevBreakdown?.netSalary != null) {
            previousRunNetByUserId.set(uid, Math.round(Number(prevBreakdown.netSalary) * 100) / 100);
          }
        }
        (run as any)._previousRunNetByUserId = previousRunNetByUserId;
        const payslipIds = oldPayslips.map((p) => String((p as any).id));
        if (payslipIds.length > 0) {
          await PayslipBreakdown.destroy({
            where: { payslipId: payslipIds },
            transaction,
          });
        }
        await Payslip.destroy({ where: { payrollRunId: run.id }, transaction });
      });

      await run.update({
        month: monthStr,
        payPeriodStart: period.payPeriodStart,
        payPeriodEnd: period.payPeriodEnd,
        attendanceCutoffDate: period.attendanceCutoffDate,
        payrollCalendarId: cycle.calendarId,
        payrollCycleId: cycle.cycleId,
        payrollGroupId: cycle.payrollGroupId,
        calculatedBy: actorUserId,
        processedBy: actorUserId,
        calculatedAt: new Date().toISOString(),
        totalEmployees: 0,
        totalNetPay: 0,
        status: 'DRAFT',
        approvedBy: null,
        reviewedBy: null,
        lockedAt: null,
        lockedBy: null,
      });
    };

    if (activeRun) {
      const runStatus = normalizeLegacyRunStatus(String((activeRun as any).status ?? 'DRAFT'));
      if (isPayrollRunLocked(runStatus)) {
        return res.status(409).json({
          message: `A payroll run already exists for ${monthStr} (${runStatus}). Open the existing run or reverse it before calculating again.`,
          code: 'PAYROLL_RUN_EXISTS',
          runId: String(activeRun.id),
          status: runStatus,
        });
      }

      recalculated = true;
      payrollRun = activeRun;
      await resetRunPayslipsForRecalc(payrollRun);
    } else if (inactiveRun) {
      recalculated = true;
      payrollRun = inactiveRun;
      await resetRunPayslipsForRecalc(payrollRun);
      // Clear prior approval chain so the new calculation can be routed fresh.
      try {
        const { replacePayrollApprovers } = await import('./workflowPayrollApproverService.js');
        await replacePayrollApprovers(String(payrollRun.id), []);
      } catch (clearErr) {
        console.warn(
          '[payroll] Could not clear approvers on reactivated run:',
          (clearErr as Error)?.message || clearErr
        );
      }
    } else {
      const createdAtIso = new Date().toISOString();
      const { allocateNextPayrollRunId } = await import('./payroll/payrollRunIdFormat.js');
      const payrollRunId = await allocateNextPayrollRunId();
      payrollRun = await PayrollRun.create({
        id: payrollRunId,
        month: monthStr,
        status: 'DRAFT',
        totalEmployees: 0,
        totalNetPay: 0,
        createdAt: createdAtIso,
        calculatedAt: createdAtIso,
        processedBy: actorUserId,
        calculatedBy: actorUserId,
        payPeriodStart: period.payPeriodStart,
        payPeriodEnd: period.payPeriodEnd,
        attendanceCutoffDate: period.attendanceCutoffDate,
        payrollCalendarId: cycle.calendarId,
        payrollCycleId: cycle.cycleId,
        payrollGroupId: cycle.payrollGroupId,
      });
    }

    const payslipHeaders: Array<Record<string, unknown>> = [];
    const breakdownRows: ReturnType<typeof breakdownToRow>[] = [];
    const { buildPayrollRunItemsForMonth, sumPayrollRunItems } = await import(
      './payroll/payrollRunItemsService.js'
    );
    const { writePayrollAuditLog } = await import('./payroll/payrollAuditService.js');

    const payrollItems = await buildPayrollRunItemsForMonth(monthStr, {
      skipFinalizationCheck: false,
      payrollGroupId,
      previousRunNetByUserId: recalculated
        ? ((payrollRun as any)._previousRunNetByUserId as Map<string, number> | undefined)
        : undefined,
    });

    if (payrollItems.errors.length > 0) {
      if (!recalculated) {
        await payrollRun.destroy();
      }
      return res.status(422).json({
        message:
          'Payroll run aborted: one or more employees failed calculation. Fix data and try again.',
        errors: payrollItems.errors,
        globalWarnings: payrollItems.globalWarnings,
      });
    }

    const { totalGross, totalNetPay } = sumPayrollRunItems(payrollItems.items);

    const { allocateNextPayslipIds } = await import('./payroll/payslipIdFormat.js');
    const payslipIds = await allocateNextPayslipIds(payrollItems.items.length);

    for (let i = 0; i < payrollItems.items.length; i += 1) {
      const row = payrollItems.items[i]!;
      const payslipId = payslipIds[i]!;
      payslipHeaders.push({
        id: payslipId,
        payrollRunId: payrollRun.id,
        userId: row.userId,
        employeeId: row.employeeId,
        month: monthStr,
        status: 'DRAFT',
        generatedAt: new Date().toISOString(),
      });
      breakdownRows.push(breakdownToRow(payslipId, row.breakdown));
    }

    await sequelize.transaction(async (transaction) => {
      await Payslip.bulkCreate(payslipHeaders, { transaction });
      await PayslipBreakdown.bulkCreate(breakdownRows, { transaction });
    });
    payrollRun.totalEmployees = payslipHeaders.length;
    payrollRun.totalNetPay = Math.round(totalNetPay * 100) / 100;
    payrollRun.status = 'PENDING_APPROVAL';
    await payrollRun.save();

    const { assignPayrollRunApproversOnSubmit } = await import(
      './payroll/payrollRunApprovalService.js'
    );
    await assignPayrollRunApproversOnSubmit(String(payrollRun.id), {
      month: monthStr,
      assignedApproverUserIds: req.body?.assignedApproverUserIds,
      calculatedByUserId: actorUserId,
    });

    await writePayrollAuditLog({
      entityType: 'payroll_run',
      entityId: String(payrollRun.id),
      actionType: recalculated ? 'PAYROLL_RECALCULATED' : 'PAYROLL_CALCULATED',
      userId: actorUserId,
      newValue: {
        month: monthStr,
        employees: payslipHeaders.length,
        totalNetPay: payrollRun.totalNetPay,
        model: 'hybrid_enterprise_v1',
        recalculated,
      },
    });

    clearCachePrefix('report_stats');
    res.status(recalculated ? 200 : 201).json({
      ...payrollRun.get({ plain: true }),
      year,
      runDate,
      payDate,
      totalGross: Math.round(totalGross * 100) / 100,
      recalculated,
    });
  } catch (error: unknown) {
    console.error('Error creating payroll run:', error);
    const statusCode = (error as { statusCode?: number })?.statusCode;
    const sequelizeName = String((error as { name?: string })?.name ?? '');
    const rawMessage = error instanceof Error ? error.message : 'Internal server error';
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({
        message: rawMessage,
        code: (error as { code?: string }).code,
      });
    }
    if (
      sequelizeName === 'SequelizeUniqueConstraintError' ||
      /Duplicate entry/i.test(rawMessage)
    ) {
      return res.status(409).json({
        message:
          'A payroll record for this period already exists. Open the existing run, or cancel it and try Run again.',
        code: 'PAYROLL_DUPLICATE',
        detail: rawMessage,
      });
    }
    res.status(500).json({
      message: rawMessage || 'Internal server error',
      code: 'PAYROLL_CREATE_FAILED',
    });
  }
});

router.get('/payroll/schedule', hrAccess, async (_req, res) => {
  try {
    const paymentDay = await SystemSetting.findOne({ where: { key: 'payroll.paymentDay' } });
    const raw = paymentDay?.get('value');
    const runDay =
      typeof raw === 'number'
        ? raw
        : parseInt(String(raw ?? '28').replace(/"/g, ''), 10) || 28;
    res.json({ runDayOfMonth: runDay, payDayOfMonth: runDay, timezone: 'ICT' });
  } catch (error) {
    console.error('Error fetching payroll schedule:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/holidays', hrAccess, async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getFullYear()), 10);
    const { getCambodiaPublicHolidays } = await import('./data/cambodiaPublicHolidays');
    res.json(getCambodiaPublicHolidays(year));
  } catch (error) {
    console.error('Error fetching payroll holidays:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/calendar', hrAccess, async (req, res) => {
  try {
    const year = parseInt(String(req.query.year || new Date().getFullYear()), 10);
    const { getPayrollCalendar } = await import('./payrollCalendarService.js');
    const { attachCycleConfigToCalendar } = await import('./payroll/payrollCalendarCycleService.js');
    const {
      buildPayrollCalendarStatus,
      buildPayrollCalendarMonthLocks,
    } = await import('./payroll/payrollCalendarCycleService.js');
    const { getPayrollComplianceEngineConfig } = await import('./payrollComplianceRuleService.js');
    const [rawCalendar, compliance, status, monthLocks] = await Promise.all([
      getPayrollCalendar(year),
      getPayrollComplianceEngineConfig(),
      buildPayrollCalendarStatus(year),
      buildPayrollCalendarMonthLocks(year),
    ]);
    const calendar = attachCycleConfigToCalendar(year, rawCalendar);
    res.json({
      ...calendar,
      status,
      monthLocks,
      otRates: {
        daytimeMultiplier: compliance.otMultiplierNormal,
        premiumMultiplier: compliance.otMultiplierPremium,
      },
    });
  } catch (error) {
    console.error('Error fetching payroll calendar:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/calendar/status', hrAccess, async (req, res) => {
  try {
    const year = req.query.year
      ? parseInt(String(req.query.year), 10)
      : undefined;
    const { buildPayrollCalendarStatus } = await import('./payroll/payrollCalendarCycleService.js');
    res.json(await buildPayrollCalendarStatus(year));
  } catch (error) {
    console.error('Error fetching payroll calendar status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/calendar', requireEffectivePermission('payroll.calendar.edit'), async (req, res) => {
  try {
    const year = parseInt(String(req.body?.year || new Date().getFullYear()), 10);
    const { savePayrollCalendar } = await import('./payrollCalendarService.js');
    const { getPayrollComplianceEngineConfig } = await import('./payrollComplianceRuleService.js');
    const { buildPayrollCalendarMonthLocks } = await import('./payroll/payrollCalendarCycleService.js');
    const saved = await savePayrollCalendar(year, {
      runDates: req.body?.runDates,
      attendanceCutoffDates: req.body?.attendanceCutoffDates,
      defaultAttendanceCutoffDayOfMonth: req.body?.defaultAttendanceCutoffDayOfMonth,
      otDayTiers: req.body?.otDayTiers,
      defaultRunDayOfMonth: req.body?.defaultRunDayOfMonth,
      employerOtNote: req.body?.employerOtNote,
      cycleConfig: req.body?.cycleConfig,
      autoFreezeAttendanceOnCutoff: req.body?.autoFreezeAttendanceOnCutoff,
    });
    const [compliance, monthLocks] = await Promise.all([
      getPayrollComplianceEngineConfig(),
      buildPayrollCalendarMonthLocks(year),
    ]);
    res.json({
      ...saved,
      monthLocks,
      otRates: {
        daytimeMultiplier: compliance.otMultiplierNormal,
        premiumMultiplier: compliance.otMultiplierPremium,
      },
    });
  } catch (error: any) {
    if (error?.code === 'PAYROLL_PERIOD_FROZEN' || error?.name === 'PayrollPeriodFrozenError') {
      return res.status(error.statusCode || 409).json({
        message: error.message || 'Payroll period is frozen',
        code: 'PAYROLL_PERIOD_FROZEN',
      });
    }
    console.error('Error saving payroll calendar:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/payslips/:id', hrAccess, async (req, res) => {
  try {
    const payslip: any = await Payslip.findByPk(req.params.id);
    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });
    const run: any = payslip.payrollRunId
      ? await PayrollRun.findByPk(payslip.payrollRunId)
      : null;
    const { isPayrollRunLocked } = await import('./payroll/payrollWorkflowService.js');
    if (run && isPayrollRunLocked(String(run.status))) {
      return res.status(409).json({ message: 'Cannot edit payslip on a locked payroll run.' });
    }
    const payload = req.body ?? {};
    const { breakdown, reviewerNote, ...header } = payload;
    if (reviewerNote !== undefined) {
      await payslip.update({ reviewerNote: String(reviewerNote ?? '').slice(0, 4000) || null });
    }
    if (Object.keys(header).length) {
      await payslip.update(header);
    }
    if (breakdown) {
      const { normalizePayrollBreakdown } = await import('./payrollCalculation.js');
      const normalized = normalizePayrollBreakdown(breakdown);
      if (normalized) {
        await upsertBreakdownForPayslip(payslip.id, normalized);
      }
    }
    res.json(await serializePayslipForApi(payslip));
  } catch (error) {
    console.error('Error updating payslip:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/runs/:id/approvers', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { updatePayrollRunApprovers } = await import('./payroll/payrollRunApprovalService.js');
    const result = await updatePayrollRunApprovers({
      runId: req.params.id,
      assignedApproverUserIds: req.body?.assignedApproverUserIds,
      actor: {
        userId: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      },
    });
    res.json(result);
  } catch (error: unknown) {
    const e = error as Error & { statusCode?: number };
    console.error('Error routing payroll approvers:', error);
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.post(
  '/payroll/runs/:id/cancel',
  hrAccess,
  requireEffectivePermission('hr.payroll.process'),
  async (req, res) => {
    try {
      const currentUser = (req as any).user;
      const { cancelPayrollRunByPreparer } = await import('./payroll/payrollRunApprovalService.js');
      const result = await cancelPayrollRunByPreparer({
        runId: req.params.id,
        actor: {
          userId: String(currentUser?.id ?? ''),
          role: String(currentUser?.role ?? ''),
        },
        reason: req.body?.reason ?? req.body?.notes,
      });
      res.json(result);
    } catch (error: unknown) {
      const e = error as Error & { statusCode?: number };
      console.error('Error cancelling payroll run:', error);
      res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
    }
  }
);

router.post('/payroll/runs/:id/workflow', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const action = String(req.body?.action ?? '').trim().toLowerCase();
    if (!['approve', 'reject', 'return'].includes(action)) {
      return res.status(400).json({ message: 'Invalid workflow action.' });
    }
    const { executePayrollWorkflowAction } = await import('./payroll/payrollRunApprovalService.js');
    const result = await executePayrollWorkflowAction({
      runId: req.params.id,
      action: action as 'approve' | 'reject' | 'return',
      actor: {
        userId: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      },
      notes: req.body?.notes,
      reason: req.body?.reason,
    });
    res.json(result);
  } catch (error: unknown) {
    const e = error as Error & { statusCode?: number };
    console.error('Error executing payroll workflow:', error);
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.post('/payroll/runs/:id/approve', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { executePayrollWorkflowAction } = await import('./payroll/payrollRunApprovalService.js');
    const result = await executePayrollWorkflowAction({
      runId: req.params.id,
      action: 'approve',
      actor: {
        userId: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      },
      notes: req.body?.reason,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    console.error('Error approving payroll run:', error);
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.post('/payroll/runs/:id/reject', requireEffectivePermission('hr.payroll.process'), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const reason = String(req.body?.reason ?? '').trim();
    const { executePayrollWorkflowAction } = await import('./payroll/payrollRunApprovalService.js');
    const result = await executePayrollWorkflowAction({
      runId: req.params.id,
      action: 'reject',
      actor: {
        userId: String(currentUser?.id ?? ''),
        role: String(currentUser?.role ?? ''),
      },
      reason,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    console.error('Error rejecting payroll run:', error);
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

router.post('/payroll/calculate', hrAccess, async (req, res) => {
  try {
    const employee = await findEmployeeWithCompensation(req.body?.employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    const period = String(req.body?.period ?? '').slice(0, 7);
    const userId = String(
      employee.user_id ?? employee.userId ?? req.body?.employeeId ?? ''
    );
    if (!userId) return res.status(400).json({ message: 'Employee has no portal user' });

    const { buildBreakdownForUserId } = await import('./payrollCalculation.js');
    const breakdown = await buildBreakdownForUserId(userId, period, {
      skipFinalizationCheck: req.body?.skipAttendanceFinalization === true,
    });
    res.json({
      employeeId: toCanonicalEmployeeDisplayId(employee.employee_id) || employee.employee_id,
      period,
      breakdown,
      hybrid: breakdown.hybrid,
    });
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    console.error('Error calculating payroll:', error);
    res.status(e.statusCode ?? 500).json({ message: e.message || 'Internal server error' });
  }
});

// ============ NOTIFICATIONS ============

router.get('/notifications', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    try {
      const { syncRequiredActionNotificationsForUser } = await import(
        './requiredActionNotificationSync.js'
      );
      await syncRequiredActionNotificationsForUser({
        id: String(currentUser.id),
        role: String(currentUser.role ?? ''),
        displayName: String(currentUser.name ?? currentUser.displayName ?? ''),
      });
    } catch (syncErr) {
      console.error('[notifications] required-action sync failed:', syncErr);
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1), 100);
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const category = String(req.query.category || '').trim().toUpperCase();
    const readFilter = String(req.query.read || '').trim().toLowerCase();
    const where: Record<string, unknown> = { userId: currentUser.id };
    if (category && category !== 'ALL') where.category = category;
    if (readFilter === 'true' || readFilter === 'read') where.isRead = true;
    if (readFilter === 'false' || readFilter === 'unread') where.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      Notification.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: limit + 1,
        offset: (page - 1) * limit,
      }),
      Notification.count({
        where: { userId: currentUser.id, isRead: false },
      }),
    ]);
    const { serializeNotification } = await import('./notificationService.js');
    const hasMore = notifications.length > limit;
    res.json({
      notifications: notifications.slice(0, limit).map((n) => serializeNotification(n)),
      unreadCount,
      pagination: {
        page,
        limit,
        hasMore,
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    const notification: any = await Notification.findByPk(req.params.id);
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    if (String(notification.userId) !== String(currentUser.id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    notification.isRead = true;
    await notification.save();
    const { serializeNotification } = await import('./notificationService.js');
    res.json(serializeNotification(notification));
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/notifications/mark-all-read', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    await Notification.update({ isRead: true }, { where: { userId: currentUser.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/notifications/:id', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Unauthorized' });

    const deleted = await Notification.destroy({
      where: { id: req.params.id, userId: currentUser.id },
    });
    if (!deleted) return res.status(404).json({ message: 'Notification not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ CHAT / MESSAGING ============

router.get('/chat/colleagues', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const colleagues = await listColleaguesForChat(currentUser.id);
    res.json(colleagues);
  } catch (error) {
    console.error('Error fetching chat colleagues:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/inbox', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const inbox = await listInbox(currentUser.id);
    res.json(inbox);
  } catch (error) {
    console.error('Error fetching chat inbox:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/announcements', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const {
      listAnnouncementsForUser,
      listAnnouncementsForDashboard,
    } = await import('./chatAnnouncementService.js');
    const scope = String(req.query.scope || '').toLowerCase();
    const rows =
      scope === 'dashboard'
        ? await listAnnouncementsForDashboard(currentUser.id)
        : await listAnnouncementsForUser(currentUser.id);
    res.json(rows);
  } catch (error) {
    console.error('Error listing chat announcements:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/chat/announcements/:id/dashboard-expiry', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const {
      actorCanPostChatAnnouncement,
      normalizeDashboardExpiresAt,
      updateAnnouncementDashboardExpiry,
    } = await import('./chatAnnouncementService.js');
    if (!(await actorCanPostChatAnnouncement(currentUser))) {
      return res.status(403).json({
        message: 'Only Admin and HR can change dashboard display settings.',
      });
    }
    const { dashboardExpiresAt } = req.body || {};
    const normalized =
      dashboardExpiresAt === null || dashboardExpiresAt === undefined || dashboardExpiresAt === ''
        ? null
        : normalizeDashboardExpiresAt(dashboardExpiresAt);
    const row = await updateAnnouncementDashboardExpiry(
      req.params.id,
      normalized,
      currentUser.id
    );
    res.json(row);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/chat/announcements', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const { actorCanPostChatAnnouncement, createChatAnnouncement } = await import(
      './chatAnnouncementService.js'
    );
    if (!(await actorCanPostChatAnnouncement(currentUser))) {
      return res.status(403).json({
        message: 'Only Admin and HR can post company announcements.',
      });
    }
    const { title, content, dashboardExpiresAt } = req.body || {};
    const { normalizeDashboardExpiresAt } = await import('./chatAnnouncementService.js');
    const expiry =
      dashboardExpiresAt === undefined || dashboardExpiresAt === null || dashboardExpiresAt === ''
        ? null
        : normalizeDashboardExpiresAt(dashboardExpiresAt);
    const row = await createChatAnnouncement({
      senderId: currentUser.id,
      title,
      content,
      dashboardExpiresAt: expiry,
    });
    res.status(201).json(row);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.put('/chat/announcements/read', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const { markAnnouncementsRead } = await import('./chatAnnouncementService.js');
    await markAnnouncementsRead(currentUser.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking announcements read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employee-movements/history-flags', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const raw = req.query.employee_ids ?? req.query.employeeIds ?? '';
    const employeeIds = String(raw)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const { getEmployeeIdsWithMovementHistory } = await import('./employeeMovementService.js');
    const withHistory = await getEmployeeIdsWithMovementHistory(currentUser, employeeIds);
    res.json({ employeeIds: withHistory });
  } catch (error: any) {
    const status = error?.status || 500;
    if (status >= 500) console.error('Error loading movement history flags:', error);
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/employee-movements/pending-my-approval', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { listPendingMovementsForCurrentApprover } = await import('./employeeMovementService.js');
    const rows = await listPendingMovementsForCurrentApprover(currentUser, {
      includeHistory: true,
    });
    res.json(rows);
  } catch (error: any) {
    const status = error?.status || 500;
    if (status >= 500) console.error('Error listing movement approvals inbox:', error);
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/approvals/summary', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
    const { getApprovalInboxSummary } = await import('./approvalInboxService.js');
    res.json(
      await getApprovalInboxSummary({
        id: String(currentUser.id),
        role: String(currentUser.role ?? ''),
      })
    );
  } catch (error: any) {
    console.error('Error fetching approval inbox summary:', error);
    // Never 500 the shell — missing tables after a bad restore should show empty inbox.
    res.json({
      actionRequired: 0,
      totalAssigned: 0,
      breakdown: {
        appraisalsAction: 0,
        appraisalsTracking: 0,
        movements: 0,
        probationAction: 0,
        probationTracking: 0,
        payrollAction: 0,
        payrollTracking: 0,
        leaveRequests: 0,
        overtimeRequests: 0,
      },
    });
  }
});

router.get('/actions/required', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser?.id) return res.status(401).json({ message: 'Not authenticated' });
    const { getRequiredActionsForViewer } = await import('./requiredActionsService.js');
    res.json(
      await getRequiredActionsForViewer({
        id: String(currentUser.id),
        role: String(currentUser.role ?? ''),
        displayName: String(currentUser.displayName ?? currentUser.name ?? ''),
      })
    );
  } catch (error: any) {
    console.error('Error fetching required actions:', error);
    res.json({ totalCount: 0, groups: [], items: [] });
  }
});

router.get('/employee-movements', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const { listEmployeeMovementsForViewer } = await import('./employeeMovementService.js');
    const rows = await listEmployeeMovementsForViewer(currentUser, {
      departmentId: req.query.department_id
        ? String(req.query.department_id)
        : req.query.departmentId
          ? String(req.query.departmentId)
          : undefined,
      employeeId: req.query.employee_id
        ? String(req.query.employee_id)
        : req.query.employeeId
          ? String(req.query.employeeId)
          : undefined,
      movementType: req.query.type ? String(req.query.type) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
    });
    res.json(rows);
  } catch (error: any) {
    const status = error?.status || 500;
    if (status >= 500) console.error('Error listing employee movements:', error);
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employee-movements', hrManagerAccess, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { createEmployeeMovement } = await import('./employeeMovementService.js');
    const row = await createEmployeeMovement({
      employeeId: req.body?.employeeId ?? req.body?.employee_id,
      movementType: req.body?.movementType ?? req.body?.movement_type,
      effectiveDate: req.body?.effectiveDate ?? req.body?.effective_date,
      toDepartmentId: req.body?.toDepartmentId ?? req.body?.to_department_id,
      toPositionId: req.body?.toPositionId ?? req.body?.to_position_id,
      toBaseSalary: req.body?.toBaseSalary ?? req.body?.to_base_salary,
      toCurrency: req.body?.toCurrency ?? req.body?.to_currency,
      newContractType: req.body?.newContractType ?? req.body?.new_contract_type,
      newEmploymentStatus: req.body?.newEmploymentStatus ?? req.body?.new_employment_status,
      newValue: req.body?.newValue ?? req.body?.new_value,
      notes: req.body?.notes,
      changeReason: req.body?.changeReason ?? req.body?.change_reason ?? req.body?.notes,
      sourceAppraisalId: req.body?.sourceAppraisalId ?? req.body?.source_appraisal_id ?? null,
      assignedApproverUserId:
        req.body?.assignedApproverUserId ?? req.body?.assigned_approver_user_id ?? null,
      assignedApproverUserIds:
        req.body?.assignedApproverUserIds ?? req.body?.assigned_approver_user_ids ?? null,
      saveAsDraft: Boolean(req.body?.saveAsDraft ?? req.body?.save_as_draft),
      createdBy: currentUser?.id,
      submitterRole: currentUser?.role,
    });
    const pendingApproval =
      String(row.status) === 'pending_approval' || row.canonicalStatus === 'pending';
    res.status(pendingApproval ? 202 : 201).json({
      ...row,
      ...(pendingApproval
        ? { pendingApproval: true, message: 'Movement submitted for HR Manager approval.' }
        : {}),
    });
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employee-movements/:id/cancel', hrManagerAccess, async (req, res) => {
  try {
    const { cancelEmployeeMovement } = await import('./employeeMovementService.js');
    res.json(await cancelEmployeeMovement(req.params.id));
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employee-movements/:id/approve', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const notes = req.body?.notes ?? req.body?.comment ?? null;
    const { approvePendingEmployeeMovement } = await import('./employeeMovementService.js');
    res.json(
      await approvePendingEmployeeMovement(
        req.params.id,
        String(currentUser?.id),
        currentUser,
        notes != null && String(notes).trim() ? String(notes).trim() : null
      )
    );
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employee-movements/:id/reject', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const reason = req.body?.reason ?? req.body?.notes ?? null;
    const { rejectPendingEmployeeMovement } = await import('./employeeMovementService.js');
    res.json(
      await rejectPendingEmployeeMovement(req.params.id, String(currentUser?.id), reason, currentUser)
    );
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employee-movements/:id/return', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const notes = req.body?.notes ?? req.body?.reason ?? null;
    const { returnPendingEmployeeMovement } = await import('./employeeMovementService.js');
    res.json(
      await returnPendingEmployeeMovement(req.params.id, String(currentUser?.id), notes, currentUser)
    );
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

/** Edit + resubmit a returned employee movement. */
router.put('/employee-movements/:id', requireAuth, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const actorPlain = currentUser?.get ? currentUser.get({ plain: true }) : currentUser;
    const { resubmitReturnedEmployeeMovement } = await import('./employeeMovementService.js');
    res.json(
      await resubmitReturnedEmployeeMovement(
        req.params.id,
        {
          effectiveDate: req.body?.effectiveDate,
          toDepartmentId: req.body?.toDepartmentId,
          toPositionId: req.body?.toPositionId,
          toBaseSalary: req.body?.toBaseSalary,
          toCurrency: req.body?.toCurrency,
          newContractType: req.body?.newContractType,
          newEmploymentStatus: req.body?.newEmploymentStatus,
          notes: req.body?.notes,
          changeReason: req.body?.changeReason,
          assignedApproverUserId: req.body?.assignedApproverUserId,
          assignedApproverUserIds: req.body?.assignedApproverUserIds,
        },
        {
          id: String(actorPlain?.id ?? currentUser?.id ?? '').trim(),
          role: String(actorPlain?.role ?? currentUser?.role ?? '').trim(),
        }
      )
    );
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/workflow/approvers', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Not authenticated' });
    const { listWorkflowApproverGroups } = await import('./workflowApproverService.js');
    const excludeId = currentUser?.id ? String(currentUser.id) : undefined;
    const departments = await listWorkflowApproverGroups(excludeId);
    res.json({ departments });
  } catch (error: any) {
    console.error('Error listing workflow approvers:', error);
    res.status(500).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/employees/:id/metadata-correction', hrManagerAccess, async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { applyEmployeeMetadataCorrection, canUseEmployeeCorrectionMode } = await import(
      './employeeProfileMetadataService.js'
    );
    if (!canUseEmployeeCorrectionMode(currentUser?.role)) {
      return res.status(403).json({ message: 'Correction mode requires HR Administrator access.' });
    }
    const fieldName = String(req.body?.fieldName ?? req.body?.field_name ?? '').trim();
    if (fieldName !== 'contract_type' && fieldName !== 'employment_status') {
      return res.status(400).json({ message: 'fieldName must be contract_type or employment_status' });
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ message: 'Correction reason is required (min 3 characters).' });
    }
    await applyEmployeeMetadataCorrection({
      employeeId: req.params.id,
      fieldName,
      correctedValue: String(req.body?.correctedValue ?? req.body?.corrected_value ?? ''),
      reason,
      correctedBy: currentUser?.id ?? null,
    });
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/chat/messages/:userId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const messages = await getDirectMessages(currentUser.id, req.params.userId);
    try {
      res.json(await serializeMessagesForClient(messages));
    } catch (serializeErr) {
      console.warn('Chat serialize fallback:', (serializeErr as Error)?.message);
      res.json(messages.map((m) => serializeMessage(m)));
    }
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/groups/:groupId/messages', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const messages = await getGroupMessages(currentUser.id, req.params.groupId);
    try {
      res.json(await serializeMessagesForClient(messages));
    } catch (serializeErr) {
      console.warn('Chat serialize fallback:', (serializeErr as Error)?.message);
      res.json(messages.map((m) => serializeMessage(m)));
    }
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/chat/groups/:groupId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const detail = await getGroupDetail(req.params.groupId, currentUser.id);
    if (!detail) return res.status(404).json({ message: 'Group not found' });
    res.json(detail);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/chat/groups', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    if (!isChatAdmin(currentUser.role)) {
      return res.status(403).json({ message: 'Only administrators can create group chats' });
    }
    const { name, memberIds } = req.body;
    const group = await createGroupChat({
      name,
      createdBy: currentUser.id,
      memberIds: Array.isArray(memberIds) ? memberIds : [],
    });
    res.status(201).json(group);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.patch('/chat/groups/:groupId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const { name } = req.body;
    const result = await updateGroupChatName({
      groupId: req.params.groupId,
      userId: currentUser.id,
      name: String(name ?? ''),
    });
    res.json(result);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/chat/groups/:groupId/leave', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const result = await leaveGroupChat({
      groupId: req.params.groupId,
      userId: currentUser.id,
    });
    res.json(result);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/chat/groups/:groupId/invite', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    if (!isChatAdmin(currentUser.role)) {
      return res.status(403).json({ message: 'Only administrators can invite members' });
    }
    const { memberIds } = req.body;
    const result = await inviteToGroup({
      groupId: req.params.groupId,
      invitedBy: currentUser.id,
      memberIds: Array.isArray(memberIds) ? memberIds : [],
    });
    res.json(result);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post(
  '/chat/messages',
  requireChatSend,
  optionalChatUpload,
  async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });

    const { receiverId, content, replyToId } = req.body;
    if (!receiverId || !String(receiverId).trim()) {
      return res.status(400).json({ message: 'receiverId is required' });
    }
    const file = (req as any).file;
    let attachmentUrl: string | null = null;
    let attachmentType: string | null = null;
    if (file) {
      const kind = attachmentTypeFromMime(file.mimetype);
      if (!kind) return res.status(400).json({ message: 'Only photos and PDF files are allowed' });
      attachmentUrl = `/uploads/${file.filename}`;
      attachmentType = kind;
    }

    const message = await sendDirectMessage({
      senderId: currentUser.id,
      receiverId,
      content,
      attachmentUrl,
      attachmentType,
      replyToId: replyToId || null,
    });
    const [serialized] = await serializeMessagesForClient([message]);
    res.status(201).json(serialized);
  } catch (error: any) {
    console.error('Error sending message:', error);
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post(
  '/chat/groups/:groupId/messages',
  requireChatSend,
  optionalChatUpload,
  async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });

    const { content, replyToId } = req.body;
    const file = (req as any).file;
    let attachmentUrl: string | null = null;
    let attachmentType: string | null = null;
    if (file) {
      const kind = attachmentTypeFromMime(file.mimetype);
      if (!kind) return res.status(400).json({ message: 'Only photos and PDF files are allowed' });
      attachmentUrl = `/uploads/${file.filename}`;
      attachmentType = kind;
    }

    const message = await sendGroupMessage({
      senderId: currentUser.id,
      groupId: req.params.groupId,
      content,
      attachmentUrl,
      attachmentType,
      replyToId: replyToId || null,
    });
    const [serialized] = await serializeMessagesForClient([message]);
    res.status(201).json(serialized);
  } catch (error: any) {
    console.error('Error sending group message:', error);
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/chat/unread-count', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.json(0);
    const count = await getUnreadCount(currentUser.id);
    res.json(count);
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/unread-by-sender', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.json({});
    res.json(await getUnreadBySender(currentUser.id));
  } catch (error) {
    console.error('Error getting unread by sender:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/chat/conversations/:userId/read', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    await markDirectRead(currentUser.id, req.params.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking conversation read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/chat/groups/:groupId/read', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    await markGroupRead(currentUser.id, req.params.groupId);
    res.json({ success: true });
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.delete('/chat/messages/:messageId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const row = await deleteMessageForUser(currentUser.id, req.params.messageId);
    const [serialized] = await serializeMessagesForClient([row]);
    res.json(serialized);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.patch('/chat/messages/:messageId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const row = await editMessageForUser(
      currentUser.id,
      req.params.messageId,
      String(req.body?.content ?? '')
    );
    const [serialized] = await serializeMessagesForClient([row]);
    res.json(serialized);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.post('/chat/messages/:messageId/forward', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const { receiverId, groupId } = req.body;
    const message = await forwardMessage({
      userId: currentUser.id,
      messageId: req.params.messageId,
      receiverId,
      groupId,
    });
    const [serialized] = await serializeMessagesForClient([message]);
    res.status(201).json(serialized);
  } catch (error: any) {
    const status = error?.status || 500;
    res.status(status).json({ message: error?.message || 'Internal server error' });
  }
});

router.get('/chat/mute-settings', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    res.json(await getChatMuteSettings(currentUser.id));
  } catch (error) {
    console.error('Error fetching chat mute settings:', error);
    res.json({ muteAll: false, mutedDirect: [], mutedGroups: [] });
  }
});

router.put('/chat/mute-all', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    await setMuteAll(currentUser.id, Boolean(req.body?.muted));
    res.json(await getChatMuteSettings(currentUser.id));
  } catch (error) {
    console.error('Error updating mute all:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/chat/mute/direct/:partnerId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    await setDirectMute(currentUser.id, req.params.partnerId, Boolean(req.body?.muted));
    res.json(await getChatMuteSettings(currentUser.id));
  } catch (error) {
    console.error('Error updating direct mute:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/chat/mute/group/:groupId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    await setGroupMute(currentUser.id, req.params.groupId, Boolean(req.body?.muted));
    res.json(await getChatMuteSettings(currentUser.id));
  } catch (error) {
    console.error('Error updating group mute:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/recent-contacts', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.json([]);
    const inbox = await listInbox(currentUser.id);
    const partners = inbox.direct.map((d: any) => d.partner);
    res.json(partners);
  } catch (error) {
    console.error('Error getting recent contacts:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/chat/presence/heartbeat', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const now = new Date();
    await User.update({ lastActivity: now }, { where: { id: currentUser.id } });
    res.json({ ok: true, lastSeenAt: now.toISOString() });
  } catch (error) {
    console.error('Chat presence heartbeat:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/users/:userId/contact', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const profile = await getChatContactProfile(currentUser.id, req.params.userId);
    if (!profile) return res.status(404).json({ message: 'User not found' });
    res.json(profile);
  } catch (error) {
    console.error('Chat contact profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/chat/pins', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    res.json(await listChatPins(currentUser.id));
  } catch (error) {
    console.error('Chat pins list:', error);
    res.json([]);
  }
});

router.put('/chat/pin/direct/:partnerId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const pins = await setChatPin(
      currentUser.id,
      'direct',
      req.params.partnerId,
      Boolean(req.body?.pinned)
    );
    res.json(pins);
  } catch (error) {
    console.error('Chat pin direct:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/chat/pin/group/:groupId', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    const pins = await setChatPin(
      currentUser.id,
      'group',
      req.params.groupId,
      Boolean(req.body?.pinned)
    );
    res.json(pins);
  } catch (error) {
    console.error('Chat pin group:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ AVATAR UPLOAD ============

/**
 * Uploads a single avatar/profile image. Returns the public URL the caller can
 * stash on the Employee/User record. Enforced limits (server-side):
 *   - max 5 MB (multer `upload.limits.fileSize`, see top of file)
 *   - JPG, PNG, or WebP only (mime-type check below)
 *   - min 2 KB - rejects accidental empty/broken files
 * Multer rejects oversized uploads with `LIMIT_FILE_SIZE`; that error is mapped
 * to a clean 413 JSON below so the client can show a single user-friendly toast.
 */
router.post('/uploads/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, async (err: any) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(413)
            .json({ message: 'Image is larger than 5 MB. Please choose a smaller file.' });
        }
        console.error('Avatar upload multer error:', err);
        return res.status(400).json({ message: err.message || 'Upload failed' });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ message: 'No file received. Please select an image.' });
      }

      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        try {
          const fs = await import('node:fs');
          fs.unlinkSync(file.path);
        } catch {
          /* best-effort cleanup */
        }
        return res
          .status(400)
          .json({ message: 'Only JPG, PNG, or WebP images are allowed.' });
      }
      if (file.size < 2048) {
        try {
          const fs = await import('node:fs');
          fs.unlinkSync(file.path);
        } catch {
          /* best-effort cleanup */
        }
        return res
          .status(400)
          .json({ message: 'Image looks too small to be a valid photo. Please choose a clearer picture.' });
      }

      const url = `/uploads/${file.filename}`;
      res.json({ url, filename: file.filename, size: file.size, mime: file.mimetype });
    } catch (e: any) {
      console.error('Avatar upload failed:', e);
      res.status(500).json({ message: 'Avatar upload failed' });
    }
  });
});

// Employee documents (stored on employees.documents_json)
router.get('/employees/:id/documents', hrManagerAccess, async (req, res) => {
  try {
    const { listEmployeeDocuments, findEmployeeByDisplayId } = await import(
      './employeeDocumentService.js'
    );
    // Draft / preview EmpIDs may not be persisted yet — return empty list, not 404.
    const employee = await findEmployeeByDisplayId(req.params.id);
    if (!employee) return res.json([]);
    const documents = await listEmployeeDocuments(req.params.id);
    res.json(documents);
  } catch (error) {
    console.error('Error fetching employee documents:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/:id/documents', hrManagerAccess, (req, res) => {
  documentUpload.single('document')(req, res, async (err: unknown) => {
    try {
      if (err) {
        const multerErr = err as { code?: string; message?: string };
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ message: 'File is larger than 10 MB.' });
        }
        return res.status(400).json({ message: multerErr.message || 'Upload failed' });
      }
      const file = (req as { file?: multer.File }).file;
      if (!file) return res.status(400).json({ message: 'No file uploaded' });

      const { createEmployeeDocument } = await import('./employeeDocumentService.js');
      const actor = (req as { user?: { id?: string; name?: string } }).user;
      const document = await createEmployeeDocument({
        displayId: req.params.id,
        file,
        documentType: String(req.body?.documentType ?? req.body?.document_type ?? 'Other'),
        documentName: String(req.body?.documentName ?? req.body?.document_name ?? ''),
        uploadedBy: actor?.id || actor?.name || 'system',
      });
      res.status(201).json({ message: 'Document uploaded successfully', document });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      const msg = error instanceof Error ? error.message : 'Upload failed';
      if (status === 404) return res.status(404).json({ message: msg });
      if (status === 409) return res.status(409).json({ message: msg });
      console.error('Error uploading employee document:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
});

router.get('/employees/:id/documents/:docId/file', hrManagerAccess, async (req, res) => {
  try {
    const docId = Number(req.params.docId);
    if (!Number.isFinite(docId)) {
      return res.status(400).json({ message: 'Invalid document id' });
    }
    const { getEmployeeDocumentForDownload } = await import('./employeeDocumentService.js');
    const file = await getEmployeeDocumentForDownload(req.params.id, docId);
    if (!file) {
      return res.status(404).json({ message: 'Document file not found' });
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.documentName)}"`
    );
    return res.sendFile(path.resolve(file.diskPath));
  } catch (error) {
    console.error('Error serving employee document:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/employees/:id/documents/:docId', hrManagerAccess, async (req, res) => {
  try {
    const { deleteEmployeeDocument } = await import('./employeeDocumentService.js');
    const docId = Number(req.params.docId);
    if (!Number.isFinite(docId)) {
      return res.status(400).json({ message: 'Invalid document id' });
    }
    const ok = await deleteEmployeeDocument(req.params.id, docId);
    if (!ok) return res.status(404).json({ message: 'Document not found' });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('Error deleting employee document:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============ DASHBOARD STATS ============

/** Org-wide HR/Admin dashboard — role OR workforce/report grants (not Administration). */
const orgDashboardAccess = requireRoleOrPermission(
  ['HR'],
  'hr.employee.view',
  'employees.view',
  'reports.view',
  'attendance.view',
  'hr.payroll.view'
);

/** Manager team dashboard — managers, HR, or equivalent grants. */
const teamDashboardAccess = requireRoleOrPermission(
  ['MANAGER', 'HR'],
  'hr.employee.view',
  'employees.view',
  'attendance.view'
);

router.get('/dashboard/analytics', orgDashboardAccess, cacheMiddleware(90_000), async (req, res) => {
  try {
    const range = resolveDashboardDateRange(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined
    );
    res.json(await buildDashboardAnalytics(range));
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/dashboard/stats', orgDashboardAccess, cacheMiddleware(90_000), async (req, res) => {
  try {
    const range = resolveDashboardDateRange(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined
    );
    const { stats } = await buildDashboardAnalytics(range);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/dashboard/team-stats', teamDashboardAccess, cacheMiddleware(90_000), async (req, res) => {
  try {
    const currentUser = (req as any).user;
    const { resolveManagerTeam } = await import('./managerTeamService.js');
    const {
      countActiveAssignedProjects,
      listAssignedProjectProgress,
    } = await import('./projectAccessService.js');

    const team = await resolveManagerTeam(String(currentUser.id));
    const range = resolveDashboardDateRange(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined
    );
    const snapshotDate = range.endDate;

    // No managed department → empty team (never fall back to org-wide employees).
    if (!team.employeeIds.length) {
      const [activeProjects, projectProgress] = await Promise.all([
        countActiveAssignedProjects(String(currentUser.id), currentUser.role),
        listAssignedProjectProgress(String(currentUser.id), 5, currentUser.role),
      ]);
      return res.json({
        teamSize: 0,
        presentToday: 0,
        absentToday: 0,
        pendingLeaveRequests: 0,
        activeProjects,
        projectProgress,
        teamPerformance: [],
        attendanceHistory: [],
        departmentIds: team.departmentIds,
        period: { startDate: range.startDate, endDate: range.endDate },
        teamMembers: [],
        celebrationUsers: [],
      });
    }

    const teamEmployees = await Employee.findAll({
      where: { id: { [Op.in]: team.employeeIds }, status: ACTIVE_EMPLOYEE_STATUS },
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Position, as: 'position', attributes: ['id', 'title'] },
      ],
      order: [
        ['first_name', 'ASC'],
        ['last_name', 'ASC'],
      ],
    });

    const empPlainList = teamEmployees.map((emp) =>
      emp.toJSON ? emp.toJSON() : (emp.get({ plain: true }) as Record<string, unknown>)
    );
    const portalUsers = team.employeeIds.length
      ? await User.findAll({
          where: { employeeId: { [Op.in]: team.employeeIds } },
          attributes: [...USER_ACCOUNT_ATTRIBUTES],
        })
      : [];

    const presentRows = team.userIds.length
      ? ((await AttendanceRecord.findAll({
          where: {
            userId: { [Op.in]: team.userIds },
            date: snapshotDate,
            status: { [Op.in]: ['PRESENT', 'LATE'] },
          },
          attributes: ['userId', 'status'],
          raw: true,
        })) as Array<{ userId?: string; status?: string }>)
      : [];
    const presentByUser = new Map<string, string>();
    for (const row of presentRows) {
      const uid = String(row.userId ?? '').trim();
      if (uid) presentByUser.set(uid, String(row.status ?? 'PRESENT').toLowerCase());
    }

    const teamMembers = await (async () => {
      const portalPlains = portalUsers.map((u) =>
        stripUserSecrets(u.get({ plain: true }) as Record<string, unknown>)
      );
      const profiles = portalPlains.length
        ? await serializeUsersForClient(portalPlains, {
            skipStatusSync: true,
            skipSalary: true,
          })
        : [];
      const profileByEmployeeId = new Map<string, (typeof profiles)[number]>();
      for (const profile of profiles) {
        const eid = String(profile.employeeId ?? '').trim();
        if (eid) profileByEmployeeId.set(eid, profile);
      }

      return empPlainList.map((plain) => {
        const profile = profileByEmployeeId.get(String(plain.id ?? '')) ?? null;
        const userId = String(profile?.id || '');
        const attStatus = userId ? presentByUser.get(userId) : undefined;
        const memberStatus = attStatus === 'late' ? 'late' : attStatus ? 'present' : 'absent';
        return {
          id: userId || plain.id,
          employeeId: plain.id,
          name: joinEmployeeNameParts(plain.first_name, plain.last_name),
          first_name: plain.first_name,
          last_name: plain.last_name,
          first_name_kh: plain.first_name_kh,
          last_name_kh: plain.last_name_kh,
          email: plain.email,
          role: profile?.role || 'EMPLOYEE',
          avatarUrl: plain.avatar_url || profile?.avatarUrl || '',
          position: (plain.position as { title?: string } | undefined)?.title || '',
          departmentId: plain.department_id,
          birthDate: profile?.birthDate,
          joinDate: profile?.joinDate,
          status: memberStatus,
        };
      });
    })();

    const teamUserIds = team.userIds;
    const weekdaysInRange = (() => {
      let count = 0;
      const cursor = new Date(range.start);
      while (cursor.getTime() <= range.end.getTime()) {
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 5) count += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      return Math.max(1, count);
    })();
    const [
      pendingLeaves,
      presentOnSnapshot,
      absentOnSnapshot,
      attendanceHistory,
      activeProjects,
      projectProgress,
      teamAttendanceTotals,
    ] = await Promise.all([
      teamUserIds.length
        ? LeaveRequest.count({
            where: { userId: { [Op.in]: teamUserIds }, status: 'PENDING' },
          })
        : Promise.resolve(0),
      teamUserIds.length
        ? AttendanceRecord.count({
            where: {
              userId: { [Op.in]: teamUserIds },
              date: snapshotDate,
              status: { [Op.in]: ['PRESENT', 'LATE'] },
            },
          })
        : Promise.resolve(0),
      teamUserIds.length
        ? countAbsentOnDate(snapshotDate, teamUserIds)
        : Promise.resolve(0),
      buildAttendanceHistory(range, teamUserIds.length ? teamUserIds : undefined),
      countActiveAssignedProjects(String(currentUser.id), currentUser.role),
      listAssignedProjectProgress(String(currentUser.id), 5, currentUser.role),
      teamUserIds.length
        ? AttendanceRecord.findAll({
            where: {
              userId: { [Op.in]: teamUserIds },
              date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate },
              status: { [Op.in]: ['PRESENT', 'LATE'] },
            },
            attributes: ['userId', [sequelize.fn('COUNT', sequelize.col('id')), 'presentCount']],
            group: ['userId'],
            raw: true,
          })
        : Promise.resolve([]),
    ]);

    const presentCountByUserId = new Map<string, number>();
    for (const row of teamAttendanceTotals as Array<{ userId?: string; presentCount?: string | number }>) {
      const uid = String(row.userId ?? '').trim();
      if (!uid) continue;
      presentCountByUserId.set(uid, Number(row.presentCount) || 0);
    }

    const teamPerformance = teamMembers
      .map((member) => {
        const uid = String(member.id ?? '').trim();
        const presentCount = presentCountByUserId.get(uid) ?? 0;
        const performance = Math.max(
          0,
          Math.min(100, Math.round((presentCount / weekdaysInRange) * 100))
        );
        return {
          name: String(member.name ?? 'Unknown').trim() || 'Unknown',
          performance,
        };
      })
      .filter((row) => row.name)
      .sort((a, b) => b.performance - a.performance || a.name.localeCompare(b.name))
      .slice(0, 8);

    res.json({
      teamSize: teamMembers.length,
      presentToday: presentOnSnapshot,
      absentToday: absentOnSnapshot,
      pendingLeaveRequests: pendingLeaves,
      activeProjects,
      projectProgress,
      teamPerformance,
      attendanceHistory,
      departmentIds: team.departmentIds,
      period: {
        startDate: range.startDate,
        endDate: range.endDate,
      },
      teamMembers,
      celebrationUsers: teamMembers.map((m) => ({
        id: m.id,
        name: m.name,
        avatarUrl: m.avatarUrl,
        position: m.position,
        birthDate: m.birthDate,
        joinDate: m.joinDate,
      })),
    });
  } catch (error) {
    console.error('Error fetching team stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

type MyActivityEntry = { type: 'clock_in' | 'leave' | 'payslip'; title: string; at: string };

/** Latest self-service events (attendance, leave, payslips) for the staff dashboard. */
async function buildMyRecentActivity(userId: string): Promise<MyActivityEntry[]> {
  try {
    const [attendanceRows, leaveRows, payslipRows] = await Promise.all([
      AttendanceRecord.findAll({
        where: { userId, clockIn: { [Op.ne]: null } },
        order: [['date', 'DESC']],
        limit: 3,
      }),
      LeaveRequest.findAll({
        where: { userId },
        order: [['appliedOn', 'DESC']],
        limit: 3,
      }),
      Payslip.findAll({
        where: { userId },
        order: [['month', 'DESC']],
        limit: 2,
      }),
    ]);

    const entries: MyActivityEntry[] = [];

    for (const row of attendanceRows as any[]) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const clockIn = String(plain.clockIn ?? '').trim();
      if (!clockIn) continue;
      const clockOut = String(plain.clockOut ?? '').trim();
      const hours = Number(plain.workHours) || 0;
      entries.push({
        type: 'clock_in',
        title: clockOut
          ? `Clocked in and out — ${hours.toFixed(1)} hrs worked`
          : 'Clocked in',
        at: clockIn,
      });
    }

    for (const row of leaveRows as any[]) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const type = String(plain.type ?? 'Leave').trim() || 'Leave';
      const status = String(plain.status ?? 'PENDING').trim().toUpperCase();
      const start = String(plain.startDate ?? '').slice(0, 10);
      const end = String(plain.endDate ?? '').slice(0, 10);
      const range = start && end && start !== end ? `${start} → ${end}` : start;
      entries.push({
        type: 'leave',
        title: `${type} leave ${status.toLowerCase()}${range ? ` (${range})` : ''}`,
        at: String(plain.appliedOn ?? plain.startDate ?? '').trim(),
      });
    }

    for (const row of payslipRows as any[]) {
      const plain = row.get ? row.get({ plain: true }) : row;
      const month = String(plain.month ?? '').slice(0, 7);
      const status = String(plain.status ?? '').trim().toUpperCase();
      entries.push({
        type: 'payslip',
        title: `Payslip for ${month || 'latest period'}${status ? ` — ${status.toLowerCase()}` : ''}`,
        at: String(plain.generatedAt ?? '').trim() || (month ? `${month}-01` : ''),
      });
    }

    return entries
      .filter((e) => Boolean(e.at))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5);
  } catch (activityErr) {
    console.warn(
      '[dashboard] my-stats recent activity failed:',
      activityErr instanceof Error ? activityErr.message : activityErr
    );
    return [];
  }
}

router.get('/dashboard/my-stats', async (req, res) => {
  try {
    const currentUser = (req as any).user;
    if (!currentUser) return res.status(401).json({ message: 'Unauthorized' });
    
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance: any = await AttendanceRecord.findOne({
      where: { userId: currentUser.id, date: today }
    });

    const pendingRequests = await LeaveRequest.count({
      where: { userId: currentUser.id, status: 'PENDING' }
    });

    let leaveRemaining = 0;
    let leaveUsed = 0;
    let leaveTotal = 0;
    try {
      const { getLeaveBalancesForUser } = await import('./leaveBalanceService.js');
      const balances = await getLeaveBalancesForUser(String(currentUser.id));
      if (balances.length) {
        leaveUsed = balances.reduce((sum, b) => sum + Number(b.used ?? 0), 0);
        leaveRemaining = balances.reduce((sum, b) => sum + Number(b.remaining ?? 0), 0);
        leaveTotal = balances.reduce(
          (sum, b) => sum + Number(b.entitlement ?? 0) + Number(b.carriedOver ?? 0),
          0
        );
      }
    } catch (leaveErr) {
      console.warn(
        '[dashboard] my-stats leave balance failed:',
        leaveErr instanceof Error ? leaveErr.message : leaveErr
      );
    }

    // Staff cannot reach the hrAccess-guarded /payroll/holidays route, so serve the
    // upcoming public holidays from the same source the payroll calendar uses.
    let upcomingHolidays: Array<{ name: string; date: string }> = [];
    try {
      const { getCambodiaPublicHolidays } = await import('./data/cambodiaPublicHolidays');
      const year = Number(today.slice(0, 4));
      upcomingHolidays = [
        ...getCambodiaPublicHolidays(year),
        ...getCambodiaPublicHolidays(year + 1),
      ]
        .filter((h) => h.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 3)
        .map((h) => ({ name: h.nameEn, date: h.date }));
    } catch (holidayErr) {
      console.warn(
        '[dashboard] my-stats holidays failed:',
        holidayErr instanceof Error ? holidayErr.message : holidayErr
      );
    }

    const recentActivity = await buildMyRecentActivity(String(currentUser.id));

    res.json({
      clockInStatus: todayAttendance?.clockIn ? 'Clocked In' : 'Not Clocked In',
      clockedIn: !!todayAttendance?.clockIn,
      leaveBalance: { remaining: leaveRemaining, used: leaveUsed, total: leaveTotal },
      workHoursToday: todayAttendance?.workHours?.toString() || '0',
      pendingRequests,
      upcomingHolidays,
      recentActivity,
    });
  } catch (error) {
    console.error('Error fetching my stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reports — organization trend analytics (not dashboard summary charts)
router.get('/reports/analytics', requireEffectivePermission('reports.view'), async (req, res) => {
  try {
    const range = resolveDashboardDateRange(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined
    );
    res.json(await buildOrganizationAnalytics(range));
  } catch (error) {
    console.error('Error fetching report analytics:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reports (dashboard summary payload — used by legacy callers)
router.get('/reports/stats', requireEffectivePermission('reports.view'), async (req, res) => {
  try {
    const range = resolveDashboardDateRange(
      req.query.startDate as string | undefined,
      req.query.endDate as string | undefined
    );
    res.json(await buildDashboardAnalytics(range));
  } catch (error) {
    console.error('Error fetching report stats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/reports/attendance', requireEffectivePermission('reports.view'), async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const attendance = await AttendanceRecord.findAll({
      where: {
        date: {
          [Op.between]: [startDate, endDate]
        }
      }
    });
    res.json(attendance);
  } catch (error) {
    console.error('Error generating attendance report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/reports/payroll', requireEffectivePermission('reports.view'), async (req, res) => {
  const { period } = req.query;
  try {
    // Mock payroll report - in real app would query payroll runs
    const payrollData = [
      { employeeId: '1', period, grossSalary: 50000, netSalary: 45000 },
      { employeeId: '2', period, grossSalary: 60000, netSalary: 54000 }
    ];
    res.json(payrollData);
  } catch (error) {
    console.error('Error generating payroll report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.use('/reports', createReportCatalogRoutes());

// ============================================
// EMPLOYEE MODULE API ENDPOINTS
// ============================================

router.get('/employees/summary-counts', hrManagerAccess, async (req, res) => {
  try {
    res.json(await getEmployeeSummaryCounts(req.query as Record<string, unknown>));
  } catch (error) {
    console.error('Error fetching employee summary counts:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Employee CRUD Endpoints
router.get('/employees', async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    department_id,
    position_id,
    status,
    in_probation,
    role,
    gender,
    office_location_id,
    sort_by,
    sort_order,
    join_date_from,
    join_date_to,
    has_movement,
    with_movement,
    assigned_id_only,
    include_compensation,
  } = req.query;

  try {
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const SORT_COL_MAP: Record<string, string> = {
      employee_id: 'employee_id',
      first_name: 'first_name',
      last_name: 'last_name',
      email: 'email',
      join_date: 'join_date',
      status: 'status',
      created_at: 'created_at',
      department_id: 'department_id',
    };
    const sortCol = SORT_COL_MAP[String(sort_by || '').trim()] || 'created_at';
    const dir = String(sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const where: any = {};
    if (search) {
      const { applyEmployeeTextSearch } = await import('./employeeSearch.js');
      applyEmployeeTextSearch(where, search);
    }
    if (department_id) {
      where.department_id = department_id;
    }
    if (office_location_id) {
      const { applyOfficeLocationFilter } = await import('./employeeListFilters.js');
      const officeResult = await applyOfficeLocationFilter(where, office_location_id);
      if (officeResult === 'empty') {
        return res.json({
          employees: [],
          total: 0,
          page: parseInt(page as string),
          total_pages: 0,
        });
      }
    }
    if (position_id) where.position_id = position_id;
    const inProbationFilter =
      in_probation === '1' ||
      in_probation === 'true' ||
      String(in_probation ?? '').trim().toLowerCase() === 'yes';

    if (inProbationFilter) {
      const { probationInFilterSqlLiterals } = await import('./probationService.js');
      const probationClauses: Record<string, unknown>[] = [
        ...probationInFilterSqlLiterals().map((clause) => sequelize.literal(clause)),
        sequelize.literal("email IS NOT NULL AND TRIM(email) != ''"),
        sequelize.literal("LOWER(email) NOT LIKE '%@pending.iroc'"),
      ];
      const priorAnd = where[Op.and] ? [...where[Op.and]] : [];
      where[Op.and] = [...priorAnd, ...probationClauses];
    } else {
      const { applyEffectiveEmployeeStatusFilter } = await import('./employeeListFilters.js');
      applyEffectiveEmployeeStatusFilter(where, status);
    }

    const joinFrom = String(join_date_from || '').trim().slice(0, 10);
    const joinTo = String(join_date_to || '').trim().slice(0, 10);
    if (joinFrom || joinTo) {
      const joinDateCond: Record<string, unknown> = {};
      if (joinFrom) joinDateCond[Op.gte] = joinFrom;
      if (joinTo) joinDateCond[Op.lte] = joinTo;
      where.join_date = joinDateCond;
    }

    const hasMovementFilter =
      has_movement === '1' ||
      has_movement === 'true' ||
      with_movement === '1' ||
      with_movement === 'true' ||
      String(has_movement ?? '').trim().toLowerCase() === 'yes' ||
      String(with_movement ?? '').trim().toLowerCase() === 'yes';

    if (hasMovementFilter) {
      const priorAnd = where[Op.and] ? [...where[Op.and]] : [];
      priorAnd.push(
        sequelize.literal(
          'EXISTS (SELECT 1 FROM `employee_movements` em WHERE em.`employee_id` = `Employee`.`employee_id` LIMIT 1)'
        )
      );
      where[Op.and] = priorAnd;
    }

    const assignedIdOnly =
      assigned_id_only === '1' ||
      assigned_id_only === 'true' ||
      String(assigned_id_only ?? '').trim().toLowerCase() === 'yes';
    if (assignedIdOnly) {
      const { appendAssignedEmployeeDisplayIdClauses } = await import(
        './employeeDirectoryEligibility.js'
      );
      appendAssignedEmployeeDisplayIdClauses(where);
    }

    if (role) {
      const { applyPortalRoleFilter } = await import('./employeeListFilters.js');
      const roleResult = await applyPortalRoleFilter(where, role);
      if (roleResult === 'empty') {
        return res.json({
          employees: [],
          total: 0,
          page: parseInt(page as string),
          total_pages: 0,
        });
      }
    }

    if (gender) {
      where.gender = String(gender).trim();
    }

    const { listSystemAdminEmployeeExclusions } = await import('./systemAdminAccount.js');
    const adminExclusions = await listSystemAdminEmployeeExclusions();
    const exclusionClauses: Record<string, unknown>[] = [];
    if (adminExclusions.employeeIds.length) {
      exclusionClauses.push({ id: { [Op.notIn]: adminExclusions.employeeIds } });
    }
    if (adminExclusions.emails.length) {
      exclusionClauses.push({
        [Op.or]: [
          { email: { [Op.notIn]: adminExclusions.emails } },
          { email: { [Op.is]: null } },
          { email: '' },
        ],
      });
    }
    if (exclusionClauses.length) {
      const priorAnd = where[Op.and] ? [...where[Op.and]] : [];
      where[Op.and] = [...priorAnd, ...exclusionClauses];
    }

    // List payloads must stay lean — never SELECT documents_json / address blobs.
    const EMPLOYEE_LIST_ATTRIBUTES = [
      'id',
      'employee_id',
      'first_name',
      'last_name',
      'first_name_kh',
      'last_name_kh',
      'email',
      'phone',
      'avatar_url',
      'gender',
      'birth_date',
      'department_id',
      'position_id',
      'job_position',
      'employment_type',
      'contract_type',
      'employment_status',
      'join_date',
      'probation_period_months',
      'worker_type',
      'probation_confirmed_at',
      'probation_next_review_date',
      'work_location',
      'status',
      'offboard_pending_settlement_id',
      'created_at',
      'updated_at',
    ] as const;

    const queryOpts = {
      where,
      attributes: [...EMPLOYEE_LIST_ATTRIBUTES],
      limit: parseInt(limit as string),
      offset,
      order: [[sortCol, dir]] as [string, string][],
      include: [
        {
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'name_kh', 'office_location_id'],
        },
        { model: Position, as: 'position', attributes: ['title', 'title_kh', 'level'] },
      ],
    };

    let employees: { rows: unknown[]; count: number };
    try {
      employees = await Employee.findAndCountAll(queryOpts);
    } catch (includeErr) {
      console.warn(
        'Employee list include failed, retrying without joins:',
        (includeErr as Error)?.message || includeErr
      );
      employees = await Employee.findAndCountAll({
        where,
        attributes: [...EMPLOYEE_LIST_ATTRIBUTES],
        limit: parseInt(limit as string),
        offset,
        order: [[sortCol, dir]],
      });
    }

    const rows: any[] = employees.rows.map((r: any) => (r.toJSON ? r.toJSON() : r));
    const employeeIds = rows.map((r) => String(r.id)).filter(Boolean);
    const emailKeys = Array.from(
      new Set(rows.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean))
    );

    let usersByEmployeeId: Record<string, { role: string }> = {};
    let usersByEmail: Record<string, { role: string }> = {};
    if (employeeIds.length || emailKeys.length) {
      try {
        const orClauses: any[] = [];
        if (employeeIds.length) orClauses.push({ employeeId: { [Op.in]: employeeIds } });
        if (emailKeys.length) orClauses.push({ email: { [Op.in]: emailKeys } });
        const linkedUsers = (await User.findAll({
          where: { [Op.or]: orClauses },
          attributes: ['employeeId', 'email', 'role'],
          raw: true,
        })) as { employeeId?: string; email?: string; role?: string }[];
        for (const u of linkedUsers) {
          const roleVal = String(u.role || 'EMPLOYEE').toUpperCase();
          if (u.employeeId) usersByEmployeeId[u.employeeId] = { role: roleVal };
          if (u.email) usersByEmail[u.email.trim().toLowerCase()] = { role: roleVal };
        }
      } catch (lookupErr) {
        console.warn('Employee list role enrichment failed:', (lookupErr as Error)?.message || lookupErr);
      }
    }

    const wantCompensation =
      include_compensation === '1' ||
      include_compensation === 'true' ||
      String(include_compensation ?? '')
        .trim()
        .toLowerCase() === 'yes';

    const { attachPlacementFromMovements } = await import('./employeeMovementService.js');
    const { attachOffboardingWorkflowToEmployeeRows } = await import(
      './offboardingWorkflowEnrichment.js'
    );

    const [baseRows, officeZones] = await Promise.all([
      wantCompensation ? attachCompensationToEmployeeRows(rows) : Promise.resolve(rows),
      listActiveOfficeLocations(),
    ]);

    const listAvatar = (raw: unknown): string | null => {
      const s = String(raw ?? '').trim();
      if (!s || s.startsWith('data:image') || s.length > 600) return null;
      return s;
    };

    const enriched = baseRows.map((r) => {
      const email = String(r.email || '').trim().toLowerCase();
      const match =
        usersByEmployeeId[String(r.id)] || (email && usersByEmail[email]) || null;
      const portalRole = match ? match.role : null;
      return enrichEmployeeWithOfficeLocation(
        withEffectiveEmployeeStatus({
          ...r,
          avatar_url: listAvatar(r.avatar_url),
          role: portalRole && portalRole !== 'ADMIN' ? portalRole : null,
          accessRole: portalRole,
          allow_login: !!match && portalRole !== 'ADMIN',
        }),
        officeZones
      );
    });

    const withPlacement = await attachPlacementFromMovements(enriched, { applyDue: false });
    const withOffboarding = await attachOffboardingWorkflowToEmployeeRows(withPlacement);

    res.json({
      employees: withOffboarding,
      total: employees.count,
      page: parseInt(page as string),
      total_pages: Math.ceil(employees.count / parseInt(limit as string))
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Pick the next sequential primary-key id of the form `u-N` for a new User row.
 * Existing `u-{Date.now()}-{random}` rows (legacy bug) and named ids like
 * `user-admin` / `user-hr` are ignored when counting; the startup migration in
 * `initDb` compacts the timestamp ones back into the same sequence.
 */
export async function nextUserId(): Promise<string> {
  try {
    const rows = (await User.findAll({ attributes: ['id'], raw: true })) as {
      id?: string;
    }[];
    let max = 0;
    for (const r of rows) {
      const m = String(r.id || '').match(/^u-(\d+)$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 1_000_000_000) {
        max = Math.max(max, n);
      }
    }
    return `u-${max + 1}`;
  } catch (e) {
    console.warn('nextUserId failed, falling back to timestamp:', (e as Error)?.message || e);
    return `u-${Date.now()}`;
  }
}

/**
 * Pick the next sequential primary-key id of the form `emp-N` for a new Employee row.
 * Existing `emp-{Date.now()}` rows (legacy bug) are ignored when counting; the
 * startup migration in `initDb` compacts them back into the same sequence.
 */
async function nextEmployeeRowId(): Promise<string> {
  try {
    const rows = (await Employee.findAll({ attributes: ['id'], raw: true })) as {
      id?: string;
    }[];
    let max = 0;
    for (const r of rows) {
      const m = String(r.id || '').match(/^emp-(\d+)$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 1_000_000_000) {
        max = Math.max(max, n);
      }
    }
    return `emp-${max + 1}`;
  } catch (e) {
    console.warn('nextEmployeeRowId failed, falling back to timestamp:', (e as Error)?.message || e);
    return `emp-${Date.now()}`;
  }
}

// Employee ID Generation — preview only (next id derived from existing employees.employee_id rows).
router.get('/employees/generate-id', hrManagerAccess, async (req, res) => {
  try {
    const nextId = await previewNextEmployeeDisplayId();
    res.json({ next_id: nextId });
  } catch (error) {
    console.error('Error generating employee ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/check-contact', hrManagerAccess, async (req, res) => {
  try {
    const { findEmployeeContactConflicts } = await import('./employeeContactCheck.js');
    const conflicts = await findEmployeeContactConflicts({
      email: String(req.query.email ?? ''),
      phone: String(req.query.phone ?? ''),
      excludeEmployeeDisplayId: String(
        req.query.exclude_employee_id ?? req.query.excludeEmployeeId ?? ''
      ),
    });
    res.json({ ok: conflicts.length === 0, conflicts });
  } catch (error) {
    console.error('Error checking employee contact:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Active employees who do NOT yet have a Users record (matched by email/phone).
// Used by the User Management module to offer "Create User from existing Employee".
router.get('/employees/without-user', hrManagerAccess, async (_req, res) => {
  try {
    const employees: any[] = await Employee.findAll({
      where: { status: 'active' },
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name', 'name_kh'] },
        { model: Position, as: 'position', attributes: ['id', 'title', 'title_kh'] },
      ],
      order: [['created_at', 'DESC']],
    });

    const users: any[] = await User.findAll({
      attributes: ['id', 'email', 'employeeId'],
    });
    const takenEmails = new Set(
      users.map((u) => String(u.email || '').toLowerCase()).filter(Boolean)
    );
    const takenEmployeeIds = new Set(
      users.map((u) => String(u.employeeId || '')).filter(Boolean)
    );

    const result = employees
      .filter((e) => {
        const plain = e.toJSON ? e.toJSON() : e;
        const email = String(plain.email || '').toLowerCase();
        if (plain.id && takenEmployeeIds.has(String(plain.id))) return false;
        if (email && takenEmails.has(email)) return false;
        return true;
      })
      .map((e) => {
        const plain = e.toJSON ? e.toJSON() : e;
        const firstKh = String(plain.first_name_kh || '').trim();
        const lastKh = String(plain.last_name_kh || '').trim();
        return {
          id: plain.id,
          employee_id: plain.employee_id,
          first_name: plain.first_name,
          last_name: plain.last_name,
          first_name_kh: firstKh || null,
          last_name_kh: lastKh || null,
          full_name: joinEmployeeNameParts(plain.first_name, plain.last_name),
          full_name_kh: joinEmployeeNameParts(firstKh, lastKh) || null,
          email: plain.email,
          phone: plain.phone,
          avatar_url: plain.avatar_url || null,
          department_id: plain.department_id,
          department_name: plain.department?.name || null,
          department_name_kh: plain.department?.name_kh || null,
          position_id: plain.position_id,
          position_title: plain.position?.title || null,
          position_title_kh: plain.position?.title_kh || null,
          employment_type: plain.employment_type,
          work_location: plain.work_location,
          join_date: plain.join_date,
          status: plain.status,
        };
      });

    res.json(result);
  } catch (error) {
    console.error('Error listing employees without user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- Date helpers (issued ID cards + statistics)
function parseDateOnlyInput(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function todayDateOnlyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normalize Sequelize/MySQL DATE / ISO strings to YYYY-MM-DD without timezone skew on DATEONLY. */
function coerceToDateOnlyString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})[T\s]/.exec(s);
  if (isoPrefix) return isoPrefix[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add one calendar year to a date-only string (UTC calendar components). */
function addOneCalendarYearToDateOnly(yyyyMmDd: string): string {
  const parts = yyyyMmDd.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return yyyyMmDd;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

router.get('/employees/statistics', hrManagerAccess, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalEmployees, newHires, terminated] = await Promise.all([
      Employee.count({ where: { status: 'active' } }),
      Employee.count({
        where: {
          status: 'active',
          join_date: { [Op.gte]: since },
        },
      }),
      Employee.count({
        where: {
          status: 'terminated',
          terminated_at: { [Op.gte]: since },
        },
      }),
    ]);

    res.json({
      total_employees: totalEmployees,
      new_hires: newHires,
      terminated: terminated,
      net_change: newHires - terminated
    });
  } catch (error) {
    console.error('Error fetching employee statistics:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// --- Employee issued ID cards (multiple per employee; snapshots + expire_date) ---
router.get('/employees/:id/cards', async (req, res) => {
  const displayId = req.params.id;
  try {
    const emp: any = await Employee.findOne({ where: employeeLookupWhere(displayId) as any });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const rows = await EmployeeIssuedCard.findAll({
      where: { employee_id: emp.id },
      order: [
        ['issue_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });
    res.json(rows.map((r) => (r.toJSON ? r.toJSON() : r)));
  } catch (error) {
    console.error('Error listing employee cards:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/:id/cards', hrManagerAccess, async (req, res) => {
  const displayId = req.params.id;
  const body = req.body || {};
  try {
    const emp: any = await Employee.findOne({
      where: employeeLookupWhere(displayId) as any,
      include: [{ model: Position, as: 'position' }],
    });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const issue_date = parseDateOnlyInput(body.issue_date) || todayDateOnlyUtc();
    const expire_date =
      parseDateOnlyInput(body.expire_date) || addOneCalendarYearToDateOnly(issue_date);

    if (expire_date < issue_date) {
      return res.status(400).json({
        message: 'expire_date must be on or after issue_date (card cannot expire before it is issued).',
      });
    }

    const first = String(emp.first_name ?? '').trim();
    const last = String(emp.last_name ?? '').trim();
    const nameEnDefault = joinEmployeeNameParts(first, last).toUpperCase() || '—';

    let positionTitle = String(emp.position_id ?? '');
    try {
      const pos = emp.position || (await Position.findByPk(emp.position_id));
      if (pos?.title) positionTitle = String(pos.title);
    } catch {
      /* ignore */
    }

    const phone = String(emp.phone ?? '').trim() || '—';
    const telegramFromProfile = String(
      emp.telegram_number ?? emp.telegramNumber ?? ''
    ).trim();
    const telegramDefault =
      String(body.contact_telegram ?? '').trim() || telegramFromProfile || '';

    const actor = (req as any).user;
    const issued_by = actor
      ? String(actor.email || actor.name || actor.id || '').trim() || null
      : null;

    const rowId = crypto.randomUUID();
    const card = await EmployeeIssuedCard.create({
      id: rowId,
      employee_id: emp.id,
      display_employee_id: String(emp.employee_id ?? displayId),
      issue_date,
      expire_date,
      status: String(body.status ?? 'active').trim().toLowerCase() || 'active',
      name_en: String(body.name_en ?? nameEnDefault).trim() || nameEnDefault,
      name_kh: body.name_kh != null ? String(body.name_kh).trim() : '',
      position_title: String(body.position_title ?? positionTitle).trim() || positionTitle || '—',
      avatar_url: body.avatar_url != null ? String(body.avatar_url).trim() : emp.avatar_url || null,
      contact_phone: String(body.contact_phone ?? phone).trim() || phone,
      contact_telegram: telegramDefault || null, // do not copy phone — kept distinct on the card
      join_date_snapshot: coerceToDateOnlyString(emp.join_date),
      notes: body.notes != null ? String(body.notes).trim() : null,
      issued_by,
    } as any);

    if (body.replace_previous_active === true) {
      await EmployeeIssuedCard.update(
        { status: 'replaced' },
        {
          where: {
            employee_id: emp.id,
            status: 'active',
            id: { [Op.ne]: rowId },
          },
        }
      );
    }

    const refreshed = await EmployeeIssuedCard.findByPk(rowId);
    res.status(201).json(refreshed ? refreshed.toJSON() : card.toJSON());
  } catch (error) {
    console.error('Error issuing employee card:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/:id/cards/:cardId', async (req, res) => {
  const displayId = req.params.id;
  const { cardId } = req.params;
  try {
    const emp: any = await Employee.findOne({ where: employeeLookupWhere(displayId) as any });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const card: any = await EmployeeIssuedCard.findOne({
      where: { id: cardId, employee_id: emp.id },
    });
    if (!card) return res.status(404).json({ message: 'Card not found' });

    res.json(card.toJSON ? card.toJSON() : card);
  } catch (error) {
    console.error('Error fetching employee card:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/employees/:id/cards/:cardId', hrManagerAccess, async (req, res) => {
  const displayId = req.params.id;
  const { cardId } = req.params;
  const patch = req.body || {};
  try {
    const emp: any = await Employee.findOne({ where: employeeLookupWhere(displayId) as any });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const card: any = await EmployeeIssuedCard.findOne({
      where: { id: cardId, employee_id: emp.id },
    });
    if (!card) return res.status(404).json({ message: 'Card not found' });

    const updates: Record<string, unknown> = {};
    if (patch.status != null) {
      const s = String(patch.status).trim().toLowerCase();
      const allowed = new Set(['active', 'expired', 'replaced', 'revoked']);
      if (!allowed.has(s)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      updates.status = s;
    }
    if (patch.notes !== undefined) updates.notes = patch.notes != null ? String(patch.notes).trim() : null;
    if (patch.expire_date !== undefined) {
      const ed = parseDateOnlyInput(patch.expire_date);
      if (!ed) return res.status(400).json({ message: 'expire_date must be YYYY-MM-DD' });
      const issueStr =
        coerceToDateOnlyString(card.issue_date) ||
        String(card.issue_date ?? '')
          .trim()
          .slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(issueStr)) {
        return res.status(400).json({ message: 'Card issue_date is invalid; cannot validate expiry.' });
      }
      if (ed < issueStr) {
        return res.status(400).json({
          message: 'expire_date must be on or after issue_date.',
        });
      }
      updates.expire_date = ed;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    await card.update(updates);
    const refreshed = await EmployeeIssuedCard.findByPk(cardId);
    res.json(refreshed ? refreshed.toJSON() : card.toJSON());
  } catch (error) {
    console.error('Error updating employee card:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/sensitive-changes', hrAccess, async (req, res) => {
  try {
    const { listSensitiveChangeRequests } = await import('./employeeSensitiveChangeService.js');
    const rows = await listSensitiveChangeRequests({
      status: req.query.status ? String(req.query.status) : undefined,
      employeeId: req.query.employeeId
        ? String(req.query.employeeId)
        : req.query.employee_id
          ? String(req.query.employee_id)
          : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
    });
    res.json({ changes: rows, total: rows.length });
  } catch (error) {
    console.error('Error listing sensitive employee changes:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/sensitive-changes/:id/approve', hrAccess, async (req, res) => {
  try {
    const actor = (req as any).user;
    const { approveSensitiveChangeRequest } = await import('./employeeSensitiveChangeService.js');
    const row = await approveSensitiveChangeRequest({
      id: req.params.id,
      reviewedBy: String(actor?.id ?? ''),
      reviewNotes: req.body?.reviewNotes ?? req.body?.review_notes ?? null,
    });
    res.json({ message: 'Sensitive change approved and applied.', change: row });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const msg = error instanceof Error ? error.message : 'Failed to approve change';
    if (status) return res.status(status).json({ message: msg });
    console.error('Error approving sensitive change:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/sensitive-changes/:id/reject', hrAccess, async (req, res) => {
  try {
    const actor = (req as any).user;
    const { rejectSensitiveChangeRequest } = await import('./employeeSensitiveChangeService.js');
    const row = await rejectSensitiveChangeRequest({
      id: req.params.id,
      reviewedBy: String(actor?.id ?? ''),
      reviewNotes: req.body?.reviewNotes ?? req.body?.review_notes ?? null,
    });
    res.json({ message: 'Sensitive change rejected.', change: row });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const msg = error instanceof Error ? error.message : 'Failed to reject change';
    if (status) return res.status(status).json({ message: msg });
    console.error('Error rejecting sensitive change:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/archive', hrManagerAccess, async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? '100'), 10);
    const { listArchivedEmployees } = await import('./employeeArchiveService.js');
    const rows = await listArchivedEmployees(limit);
    res.json({ archives: rows, total: rows.length });
  } catch (error) {
    console.error('Error listing employee archive:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Offboarded employees with termination history in one round trip. */
router.get('/employees/offboarded-hub', hrManagerAccess, async (_req, res) => {
  try {
    const { FinalSettlementRun } = await import('./payroll/finalSettlementSchema.js');

    const inProgressSettlements: any[] = await FinalSettlementRun.findAll({
      where: {
        status: {
          [Op.notIn]: ['PAID', 'REJECTED', 'LOCKED'],
        },
      },
      attributes: ['id', 'employee_id', 'status', 'lastWorkingDate', 'netUsd'],
      order: [['updatedAt', 'DESC']],
      limit: 500,
    });

    for (const settlement of inProgressSettlements) {
      const empPk = String(settlement.get('employee_id') ?? '').trim();
      const settlementId = String(settlement.get('id') ?? '').trim();
      if (!empPk || !settlementId) continue;
      const emp = await Employee.findByPk(empPk, {
        attributes: ['id', 'offboard_pending_settlement_id', 'offboard_source', 'status'],
      });
      if (!emp) continue;
      const status = String(emp.get('status') ?? '').toLowerCase();
      if (['terminated', 'resigned', 'absconded', 'retired', 'inactive'].includes(status)) continue;
      const pending = String(emp.get('offboard_pending_settlement_id') ?? '').trim();
      if (!pending) {
        await emp.update({
          offboard_pending_settlement_id: settlementId,
          offboard_source: emp.get('offboard_source') ?? 'wizard',
          updated_at: new Date(),
        });
      }
    }

    const inProgressEmployeePks = [
      ...new Set(
        inProgressSettlements
          .map((r) => String(r.get('employee_id') ?? '').trim())
          .filter(Boolean)
      ),
    ];

    const { OFFBOARDING_IN_PROGRESS_EMPLOYEE_STATUSES, attachOffboardingWorkflowToEmployeeRows } =
      await import('./offboardingWorkflowEnrichment.js');

    const pendingOffboardEmployees = await Employee.findAll({
      where: {
        offboard_pending_settlement_id: { [Op.ne]: null },
        status: { [Op.notIn]: ['terminated', 'resigned', 'absconded', 'retired', 'inactive'] },
      },
      attributes: ['id'],
      limit: 500,
    });
    const pendingPks = pendingOffboardEmployees
      .map((r) => String(r.get('id') ?? '').trim())
      .filter(Boolean);
    const allInProgressPks = [
      ...new Set([...inProgressEmployeePks, ...pendingPks]),
    ];

    const inProgressEmployees = allInProgressPks.length
      ? await Employee.findAll({
          where: {
            id: { [Op.in]: allInProgressPks },
            status: { [Op.in]: OFFBOARDING_IN_PROGRESS_EMPLOYEE_STATUSES },
          },
          include: [
            { model: Department, as: 'department', attributes: ['id', 'name'] },
            { model: Position, as: 'position', attributes: ['id', 'title'] },
          ],
          order: [['updated_at', 'DESC']],
        })
      : [];

    const employees = await Employee.findAll({
      where: {
        status: { [Op.in]: ['terminated', 'resigned', 'absconded', 'retired', 'inactive'] },
      },
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Position, as: 'position', attributes: ['id', 'title'] },
      ],
      order: [['terminated_at', 'DESC']],
      limit: 500,
    });
    const rows = employees.map((r) => (r.toJSON ? r.toJSON() : r));
    const inProgressRows = inProgressEmployees.map((r) => (r.toJSON ? r.toJSON() : r));
    const withOffboardingFlags = await attachOffboardingWorkflowToEmployeeRows([
      ...rows,
      ...inProgressRows,
    ]);
    const offboardingByPk = new Map(
      withOffboardingFlags.map((row) => [String(row.id ?? ''), row])
    );
    const applyOffboardingFlags = (row: Record<string, unknown>) => {
      const enriched = offboardingByPk.get(String(row.id ?? ''));
      if (!enriched) return row;
      return {
        ...row,
        offboarding_in_progress: enriched.offboarding_in_progress,
        offboarding_settlement_status: enriched.offboarding_settlement_status,
      };
    };
    const employeeIds = rows
      .map((r: { employee_id?: string }) => String(r.employee_id || '').trim())
      .filter(Boolean);
    const inProgressIds = inProgressRows
      .map((r: { employee_id?: string }) => String(r.employee_id || '').trim())
      .filter(Boolean);
    const { mapProbationFailSourcesByDisplayId, attachOffboardSource } = await import(
      './offboardSourceHub.js'
    );
    const probationSources = await mapProbationFailSourcesByDisplayId([
      ...employeeIds,
      ...inProgressIds,
    ]);
    const enrichedRows = rows.map((row: Record<string, unknown>) =>
      attachOffboardSource(applyOffboardingFlags(row), probationSources)
    );
    const enrichedInProgress = inProgressRows.map((row: Record<string, unknown>) =>
      attachOffboardSource(applyOffboardingFlags(row), probationSources, { defaultInProgress: 'wizard' })
    );
    const historyRows = employeeIds.length
      ? await HistoryEmployee.findAll({
          where: { employee_id: { [Op.in]: employeeIds } },
          order: [['terminated_at', 'DESC']],
        })
      : [];
    const historyByEmployee: Record<string, unknown[]> = {};
    for (const row of historyRows) {
      const p = row.get({ plain: true }) as Record<string, unknown>;
      const eid = String(p.employee_id || '');
      if (!eid) continue;
      if (!historyByEmployee[eid]) historyByEmployee[eid] = [];
      if (historyByEmployee[eid].length >= 20) continue;
      historyByEmployee[eid].push({
        id: p.id,
        employee_id: p.employee_id,
        terminated_at: p.terminated_at,
        termination_reason: p.termination_reason,
        terminated_by: p.terminated_by,
        restored_at: p.restored_at,
        restored_by: p.restored_by,
        is_currently_terminated: p.is_currently_terminated,
      });
    }
    res.json({
      employees: enrichedRows,
      inProgress: enrichedInProgress,
      historyByEmployee,
    });
  } catch (error) {
    console.error('Error fetching offboarded hub:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const employee: any = await Employee.findOne({
      where: employeeLookupWhere(id) as any,
      include: [
        {
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'name_kh', 'office_location_id'],
        },
        { model: Position, as: 'position' },
        { model: EmployeeAllowanceAssignment, as: 'allowanceAssignments' },
        { model: EmployeeDependent, as: 'dependents' },
        { model: SalaryStructure, as: 'salaryStructure', required: false },
      ]
    });

    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    // Role/allow_login live on the User row, not on Employee.
    let role: string | null = null;
    let allow_login = false;
    let portalUserId: string | null = null;
    try {
      const plain = employee.toJSON ? employee.toJSON() : employee;
      const linkedUser: any = await findPortalUserForEmployee({
        id: plain.id,
        email: plain.email,
        phone: plain.phone,
      });
      if (linkedUser && portalLoginIsActive(linkedUser)) {
        role = String(linkedUser.role || 'EMPLOYEE').toUpperCase();
        allow_login = true;
        portalUserId = String(linkedUser.id ?? '').trim() || null;
      }
    } catch (lookupErr) {
      console.warn('Employee access role lookup failed:', (lookupErr as Error)?.message || lookupErr);
    }

    const payload = employee.toJSON ? employee.toJSON() : employee;
    const jobPosition =
      String(payload.job_position ?? '').trim() ||
      (payload.position?.title ? String(payload.position.title) : null);
    const structure = payload.salaryStructure ?? null;
    delete payload.salaryStructure;
    const merged = mergeCompensationIntoEmployee(payload, structure);
    let leave_assignments: Record<string, boolean> = {};
    try {
      const { resolveLeaveAssignmentsMap } = await import('./leaveBalanceService.js');
      leave_assignments = await resolveLeaveAssignmentsMap(
        String(merged.id),
        merged.gender != null ? String(merged.gender) : null,
        merged.status != null ? String(merged.status) : null
      );
    } catch (assignErr) {
      console.warn('Leave assignments load failed:', (assignErr as Error)?.message || assignErr);
    }
    let children: Awaited<ReturnType<typeof import('./employeeChildrenService.js').listEmployeeChildren>> =
      [];
    try {
      const { listEmployeeChildren } = await import('./employeeChildrenService.js');
      children = await listEmployeeChildren(String(merged.id));
    } catch (childErr) {
      console.warn('Employee children load failed:', (childErr as Error)?.message || childErr);
    }

    let tax_dependents = Number(merged.tax_dependents ?? 0) || 0;
    try {
      const {
        computeTaxDependentsForFamily,
        persistTaxDependentsForEmployee,
      } = await import('./employeeChildrenService.js');
      const computed = computeTaxDependentsForFamily(
        merged.marital_status,
        merged.spouse_occupation,
        children
      );
      if (computed !== tax_dependents) {
        tax_dependents = await persistTaxDependentsForEmployee(
          String(merged.id),
          merged.marital_status,
          merged.spouse_occupation,
          children
        );
      } else {
        tax_dependents = computed;
      }
    } catch (taxDepErr) {
      console.warn('Tax dependents sync failed:', (taxDepErr as Error)?.message || taxDepErr);
    }

    const {
      listOnboardingDeductions,
      mapAssignmentsToLegacyAllowances,
      mapOnboardingDeductionsToLegacy,
    } = await import('./databaseConsolidation.js');
    const legacyAllowances = mapAssignmentsToLegacyAllowances(
      (payload.allowanceAssignments as Array<Record<string, unknown>>) ?? []
    );
    const legacyDeductions = mapOnboardingDeductionsToLegacy(
      await listOnboardingDeductions(String(merged.id)),
      String(merged.id)
    );

    const officeZones = await listActiveOfficeLocations();
    const payloadRow = enrichEmployeeWithOfficeLocation(
      withEffectiveEmployeeStatus({
        ...merged,
        tax_dependents,
        role,
        accessRole: role,
        jobPosition,
        job_position: jobPosition,
        allow_login,
        portalUserId,
        leave_assignments,
        children,
        allowances: legacyAllowances,
        deductions: legacyDeductions,
      }),
      officeZones
    );

    const { attachPlacementFromMovements } = await import('./employeeMovementService.js');
    const [withPlacement] = await attachPlacementFromMovements([payloadRow as Record<string, unknown>], {
      applyDue: true,
    });

    res.json(withPlacement ?? payloadRow);
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/employees/:id', hrManagerAccess, async (req, res) => {
  const { id } = req.params;
  const raw = stripDraftMeta(req.body || {});
  const {
    updated_by,
    role: bodyRole,
    accessRole: bodyAccessRole,
    access_role: bodyAccessRoleSnake,
    allow_login,
    leave_assignments: leaveAssignmentsBody,
    children: childrenBody,
    ...updateData
  } = raw;

  try {
    const { resolveAccessRoleFromBody, canAssignAccessRole } = await import('./accessRole.js');
    const requestedAccessRole = resolveAccessRoleFromBody({
      accessRole: bodyAccessRole ?? bodyAccessRoleSnake,
      role: bodyRole,
    });
    const actor = (req as any).user;
    if (
      (bodyRole != null || bodyAccessRole != null || bodyAccessRoleSnake != null) &&
      requestedAccessRole === 'ADMIN'
    ) {
      return res.status(403).json({
        message: 'Admin access is managed in User Management, not employee setup.',
      });
    }
    if (
      (bodyRole != null || bodyAccessRole != null || bodyAccessRoleSnake != null) &&
      !canAssignAccessRole(actor?.role, requestedAccessRole)
    ) {
      return res.status(403).json({
        message: 'You cannot assign this access role.',
      });
    }

    const employee = await Employee.findOne({ where: employeeLookupWhere(id) as any });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    if (Object.prototype.hasOwnProperty.call(updateData, 'employee_id')) {
      const canonicalBadge = toCanonicalEmployeeDisplayId(updateData.employee_id);
      if (!canonicalBadge || !isEmployeeBadgeDisplayId(canonicalBadge)) {
        return res.status(400).json({
          message: 'Employee ID must be a valid badge (ROC#####).',
        });
      }
      updateData.employee_id = canonicalBadge;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'birth_date')) {
      const rawBirth = updateData.birth_date;
      if (rawBirth == null || String(rawBirth).trim() === '') {
        // Allow clearing / omitting DOB on drafts; don't wipe with invalid empty.
        delete updateData.birth_date;
      } else {
        const { validateBirthDateNotFuture } = await import('./companyTimeZone.js');
        const birthErr = await validateBirthDateNotFuture(rawBirth);
        if (birthErr) return res.status(400).json({ message: birthErr });
      }
    }

    if (updateData.phone != null) {
      updateData.phone = normalizePhone(updateData.phone);
    }
    if (updateData.telegram_number != null) {
      const rawTg = String(updateData.telegram_number).trim();
      updateData.telegram_number = rawTg ? normalizePhone(rawTg) || rawTg : null;
    }
    for (const khKey of [
      'first_name_kh',
      'last_name_kh',
      'street_address_kh',
      'city_kh',
      'spouse_name_kh',
      'emergency_contact_name_kh',
      'emergency_contact_relationship_kh',
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(updateData, khKey)) {
        updateData[khKey] = trimOptionalKhmerText(updateData[khKey]);
      }
    }
    for (const textKey of [
      'street_address',
      'city',
      'religion',
      'ethnicity',
      'national_id',
      'passport_number',
      'birth_certificate_number',
      'spouse_name',
      'spouse_occupation',
      'spouse_phone',
      'emergency_contact_name',
      'emergency_contact_relationship',
      'emergency_contact_phone',
      'avatar_url',
      'work_phone',
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(updateData, textKey)) {
        const s = String(updateData[textKey] ?? '').trim();
        updateData[textKey] = s.length > 0 ? s : null;
      }
    }

    const { salary: salaryPayload, employee: employeePayload } = splitSalaryPayload(updateData);

    // Preserve join_date when client sends blank/invalid (uncontrolled DatePicker wipe).
    if (Object.prototype.hasOwnProperty.call(employeePayload, 'join_date')) {
      const normalizedJoin = coerceToDateOnlyString(
        (employeePayload as Record<string, unknown>).join_date
      );
      if (normalizedJoin) {
        (employeePayload as Record<string, unknown>).join_date = normalizedJoin;
      } else {
        delete (employeePayload as Record<string, unknown>).join_date;
      }
    }

    try {
      const {
        getPayrollWorkDayPolicy,
        resolveEmployeePayrollBasisDays,
      } = await import('./payroll/payrollBasisDaysService.js');
      const policy = await getPayrollWorkDayPolicy();
      if (policy.method === 'fixed_company_basis') {
        (employeePayload as Record<string, unknown>).payroll_basis_days = policy.companyBasisDays;
      } else if (
        Object.prototype.hasOwnProperty.call(employeePayload, 'payroll_basis_days')
      ) {
        (employeePayload as Record<string, unknown>).payroll_basis_days =
          resolveEmployeePayrollBasisDays({
            policy,
            employeeBasisDays: (employeePayload as Record<string, unknown>).payroll_basis_days,
          });
      }
    } catch {
      /* keep client-provided basis days */
    }

    const existingPlain = employee.get({ plain: true }) as Record<string, unknown>;
    const salaryFromDb = await loadSalaryStructureForEmployeeId(String(employee.id));
    const existingWithComp = mergeCompensationIntoEmployee(existingPlain, salaryFromDb);
    const mergedForStatus = mergeEmployeeRowForStatusValidation(
      existingWithComp,
      employeePayload,
      salaryPayload
    );

    const clientBody = (req.body || {}) as Record<string, unknown>;
    const clientWantsDraft = isDraftRequest(clientBody);
    const { status: _storedStatus, ...mergedForStatusCheck } = mergedForStatus;
    const prevLifecycle = String(employee.status ?? '')
      .trim()
      .toLowerCase();
    const alreadyActiveLike =
      prevLifecycle === 'active' ||
      prevLifecycle === 'probation' ||
      prevLifecycle === 'pending_approval';
    const clientWantsActivate =
      clientBody.activate_profile === true ||
      clientBody.force_activate === true ||
      String(clientBody.status ?? '')
        .trim()
        .toLowerCase() === 'active';
    // Only block incomplete → active transitions. Routine edits of already-active
    // staff must not 400 just because activate_profile is still sent by the UI.
    if (!clientWantsDraft && clientWantsActivate && !alreadyActiveLike) {
      const missing = missingFieldsForActive(mergedForStatusCheck);
      if (missing.length > 0) {
        return res.status(400).json({
          message:
            'Required fields are incomplete. Click Draft to save progress, or complete all required fields to finish.',
          code: 'INCOMPLETE_PROFILE_USE_DRAFT',
          missingFields: missing,
        });
      }
    }
    const { status: resolvedStatus, markOnboardingComplete } = resolveEmployeeStatus({
      body: {
        ...mergedForStatusCheck,
        ...(clientWantsDraft ? { is_draft: true } : {}),
        ...(clientBody.activate_profile === true ? { activate_profile: true } : {}),
        ...(clientBody.status != null && !clientWantsDraft
          ? { status: clientBody.status }
          : {}),
      },
      previousStatus: employee.status,
    });

    employeePayload.status = resolvedStatus;
    if (markOnboardingComplete) {
      (employeePayload as Record<string, unknown>).onboarding_completed_at = new Date();
    }

    const posIdForSalary = String(
      (employeePayload as Record<string, unknown>).position_id ??
        existingPlain.position_id ??
        ''
    );
    const baseInPayload = (salaryPayload as Record<string, unknown>).base_salary;
    const mergedBaseSalary = Number(
      baseInPayload ?? existingWithComp.base_salary ?? existingPlain.base_salary ?? 0
    );
    if (
      !clientWantsDraft &&
      resolvedStatus !== EMPLOYEE_STATUS_DRAFT &&
      mergedBaseSalary > 0
    ) {
      const salaryErr = await validateEmployeeSalaryForPosition(
        posIdForSalary,
        mergedBaseSalary
      );
      if (salaryErr) return res.status(400).json({ message: salaryErr });
    }

    const enablePortalLogin =
      !!allow_login &&
      resolvedStatus !== EMPLOYEE_STATUS_DRAFT;
    const portalAccountActive =
      enablePortalLogin && isEmployeeActiveForPortal(resolvedStatus);

    if (resolvedStatus !== employee.status) {
      await EmployeeStatusHistory.create({
        employee_id: employee.id,
        old_status: employee.status,
        new_status: resolvedStatus,
        reason: updateData.status_change_reason,
        changed_by: updated_by,
      });
    }

    const payloadRecord = employeePayload as Record<string, unknown>;
    const { validateProbationFields } = await import('./probationService.js');
    const probationValidation = validateProbationFields(
      {
        employment_type:
          payloadRecord.employment_type ?? existingPlain.employment_type,
        worker_type: payloadRecord.worker_type ?? existingPlain.worker_type,
        probation_period_months:
          payloadRecord.probation_period_months ?? existingPlain.probation_period_months,
        join_date: payloadRecord.join_date ?? existingPlain.join_date,
      },
      existingPlain
    );
    const earlyDraftSave =
      clientWantsDraft ||
      resolvedStatus === EMPLOYEE_STATUS_DRAFT ||
      normalizeEmployeeLifecycleStatus(employee.status) === EMPLOYEE_STATUS_DRAFT;
    if (!probationValidation.ok && !earlyDraftSave) {
      return res.status(400).json({ message: probationValidation.error });
    }
    payloadRecord.worker_type = probationValidation.workerType;
    payloadRecord.probation_period_months = probationValidation.probationPeriodMonths;
    if (probationValidation.warning) {
      (res.locals as Record<string, unknown>).probationWarning = probationValidation.warning;
    }

    const placementCheck = await sanitizeEmployeePlacementIds(payloadRecord, existingPlain);
    if (!placementCheck.ok) {
      return res.status(400).json({ message: placementCheck.message });
    }

    const {
      assertMovementOnlyFieldsNotDirectlyEdited,
    } = await import('./employeeProfileMetadataService.js');
    const existingIsDraft =
      normalizeEmployeeLifecycleStatus(employee.status) === EMPLOYEE_STATUS_DRAFT;
    const draftSave = clientWantsDraft || resolvedStatus === EMPLOYEE_STATUS_DRAFT || existingIsDraft;

    if (!draftSave) {
      try {
        assertMovementOnlyFieldsNotDirectlyEdited({
          existing: existingPlain,
          payload: employeePayload as Record<string, unknown>,
          correctionMode: Boolean(raw.correction_mode ?? raw.correctionMode),
          actorRole: actor?.role,
        });
      } catch (guardErr: any) {
        return res.status(guardErr?.status || 403).json({ message: guardErr?.message || 'Forbidden' });
      }
    }

    const {
      buildSensitiveEmployeeState,
      canApplySensitiveChangesDirectly,
      computeSensitiveFieldChanges,
      submitSensitiveChangeRequest,
      writeSensitiveChangeAudit,
      SENSITIVE_EMPLOYEE_FIELDS,
    } = await import('./employeeSensitiveChangeService.js');
    const { SALARY_PAYLOAD_KEYS } = await import('./salaryStructureService.js');

    const mergedAfterEmployee = {
      ...existingPlain,
      ...employeePayload,
    };
    const mergedAfterCompensation = {
      ...salaryFromDb,
      ...salaryPayload,
    };
    const beforeSensitive = buildSensitiveEmployeeState(existingWithComp, salaryFromDb);
    const afterSensitive = buildSensitiveEmployeeState(
      mergedAfterEmployee,
      mergedAfterCompensation
    );
    const sensitiveChanges = computeSensitiveFieldChanges(beforeSensitive, afterSensitive);
    const changeReason = String(
      raw.change_reason ?? raw.changeReason ?? updateData.change_reason ?? ''
    ).trim();
    const { resolveEffectiveFromPayload, MasterDataEffectiveDateRequiredError } = await import(
      './payroll/payrollMasterDataGuard.js'
    );
    let effectiveFrom: string | undefined;
    let pendingSensitiveRequest: Awaited<ReturnType<typeof submitSensitiveChangeRequest>> | null =
      null;

    // Draft onboarding must save freely — do not require change reason / effective date
    // for placement or compensation edits while the profile is still a draft.
    if (sensitiveChanges.length > 0 && !draftSave) {
      if (!changeReason) {
        return res.status(400).json({
          message: 'Change reason is required for placement or compensation updates.',
          code: 'CHANGE_REASON_REQUIRED',
        });
      }

      try {
        effectiveFrom = resolveEffectiveFromPayload(raw as Record<string, unknown>);
      } catch (e) {
        if (e instanceof MasterDataEffectiveDateRequiredError) {
          return res.status(400).json({ message: e.message, code: e.code });
        }
        throw e;
      }
      if (!effectiveFrom) {
        return res.status(400).json({
          message:
            'Effective date is required for placement or compensation updates. Specify when the change takes effect.',
          code: 'MASTER_DATA_EFFECTIVE_DATE_REQUIRED',
        });
      }

      const { assertPayrollMasterDataEditableForEffectiveDate, PayrollMasterDataConflictError } =
        await import('./payroll/payrollMasterDataGuard.js');
      try {
        await assertPayrollMasterDataEditableForEffectiveDate(effectiveFrom);
      } catch (e) {
        if (e instanceof PayrollMasterDataConflictError) {
          return res.status(409).json({ message: e.message, code: e.code });
        }
        throw e;
      }

      const actorRole = actor?.role;
      if (!canApplySensitiveChangesDirectly(actorRole)) {
        pendingSensitiveRequest = await submitSensitiveChangeRequest({
          employeePk: String(employee.id),
          employeeId: id,
          changeSource: 'profile_update',
          changeReason,
          effectiveDate: effectiveFrom,
          beforeState: beforeSensitive,
          afterState: afterSensitive,
          fieldChanges: sensitiveChanges,
          submittedBy: String(actor?.id ?? updated_by ?? ''),
        });

        for (const key of SENSITIVE_EMPLOYEE_FIELDS) {
          delete (employeePayload as Record<string, unknown>)[key];
        }
        for (const key of SALARY_PAYLOAD_KEYS) {
          delete (salaryPayload as Record<string, unknown>)[key];
        }
      }
    }

    await employee.update({
      ...employeePayload,
      updated_at: new Date(),
    });

    if (employeePayload.join_date != null) {
      try {
        const { recalculateEmployeeAccrualBalances } = await import('./leaveAccrualService.js');
        await recalculateEmployeeAccrualBalances(String(employee.id));
      } catch (accrualErr) {
        console.warn(
          'Leave accrual recalculation failed:',
          (accrualErr as Error)?.message || accrualErr
        );
      }
    }

    try {
      const { syncEmployeeJobPosition } = await import('./employeeJobPosition.js');
      const posId = String(
        (employeePayload as Record<string, unknown>).position_id ??
          employee.position_id ??
          ''
      );
      await syncEmployeeJobPosition(
        employee.id,
        posId,
        raw.job_position != null ? String(raw.job_position) : null
      );
    } catch {
      /* non-fatal */
    }

    const salaryPayloadWithoutDependents = { ...salaryPayload };
    delete (salaryPayloadWithoutDependents as Record<string, unknown>).tax_dependents;

    const compensationFieldsChanged = new Set(
      sensitiveChanges
        .filter((c) => (SALARY_PAYLOAD_KEYS as readonly string[]).includes(c.field as never))
        .map((c) => c.field)
    );
    const salaryHeldForApproval = Boolean(pendingSensitiveRequest);
    const shouldBootstrapSalary =
      !salaryFromDb && Object.keys(salaryPayloadWithoutDependents).length > 0;
    // Persist full compensation payload whenever pay fields change (or first bootstrap),
    // so bank/currency/NSSF are not dropped when only base_salary is flagged as changed.
    if (
      !salaryHeldForApproval &&
      (shouldBootstrapSalary || compensationFieldsChanged.size > 0) &&
      Object.keys(salaryPayloadWithoutDependents).length > 0
    ) {
      await upsertSalaryStructure(employee.id, salaryPayloadWithoutDependents, {
        changedBy: String((req as any).user?.id ?? ''),
        changeReason: changeReason || 'Employee profile update',
        effectiveFrom:
          effectiveFrom ||
          (shouldBootstrapSalary
            ? String(
                (employeePayload as Record<string, unknown>).join_date ??
                  existingPlain.join_date ??
                  new Date().toISOString()
              ).slice(0, 10)
            : undefined),
        // First compensation row for this employee is bootstrap, not a mid-cycle change.
        skipEffectiveDateGuard: shouldBootstrapSalary,
      });
    }

    if (sensitiveChanges.length > 0 && canApplySensitiveChangesDirectly(actor?.role)) {
      await writeSensitiveChangeAudit({
        employeeId: id,
        employeePk: String(employee.id),
        action: 'APPLIED',
        reason: changeReason,
        fieldChanges: sensitiveChanges,
        performedBy: String(actor?.id ?? updated_by ?? 'system'),
        metadata: { changeSource: 'profile_update' },
      });
    }

    const { syncEmployeeChildren, persistTaxDependentsForEmployee, normalizeChildrenInput } =
      await import('./employeeChildrenService.js');
    let savedChildren: Awaited<ReturnType<typeof syncEmployeeChildren>> | undefined;
    if (childrenBody !== undefined) {
      savedChildren = await syncEmployeeChildren(
        String(employee.id),
        normalizeChildrenInput(childrenBody)
      );
    }
    const mergedPlain = {
      ...existingPlain,
      ...employeePayload,
    };
    await persistTaxDependentsForEmployee(
      String(employee.id),
      mergedPlain.marital_status,
      mergedPlain.spouse_occupation,
      savedChildren,
      effectiveFrom
        ? { effectiveFrom, changeReason: changeReason || 'Employee family profile update' }
        : undefined
    );

    const allowanceTemplateRaw =
      raw.allowance_template_id ?? raw.allowanceTemplateId;
    if (allowanceTemplateRaw !== undefined) {
      try {
        const { assignAllowancePackage } = await import('./allowanceRuleService.js');
        await assignAllowancePackage(
          id,
          allowanceTemplateRaw ? String(allowanceTemplateRaw) : null,
          updated_by
        );
      } catch (pkgErr) {
        console.warn('Allowance package assign failed:', (pkgErr as Error)?.message || pkgErr);
      }
    }

    const refreshed: any = await Employee.findByPk(String(employee.id), {
      include: [{ model: SalaryStructure, as: 'salaryStructure', required: false }],
    });
    if (!refreshed) {
      return res.status(404).json({ message: 'Employee not found after update' });
    }

    const effectiveAccessRole =
      bodyRole != null || bodyAccessRole != null || bodyAccessRoleSnake != null
        ? requestedAccessRole
        : null;

    // Sync access role and login on the User row.
    let linkedRole: string | null = null;
    let linkedAllowLogin = false;
    try {
      if (refreshed?.email || refreshed?.phone) {
        const refreshedPlain = refreshed?.toJSON ? refreshed.toJSON() : refreshed;
        const existingUser: any = await findPortalUserForEmployee({
          id: refreshedPlain.id,
          email: refreshedPlain.email,
          phone: refreshedPlain.phone,
        });

        let positionTitle = refreshed.position_id;
        try {
          const pos: any = await Position.findByPk(refreshed.position_id);
          if (pos?.title) positionTitle = pos.title;
        } catch {
          /* ignore */
        }

        const portalPassword = String(
          raw.portal_password || raw.password || ''
        ).trim();

        if (existingUser) {
          const loginPhone = normalizePhone(refreshed.phone);
          const identityPatch: Record<string, unknown> = {};
          if (loginPhone.length >= 8) identityPatch.phone = loginPhone;
          if (refreshed.email && !isPlaceholderDraftEmail(refreshed.email)) {
            identityPatch.email = refreshed.email;
          }
          if (!String(existingUser.employeeId ?? '').trim() && refreshedPlain.id) {
            identityPatch.employeeId = refreshedPlain.id;
          }

          if (enablePortalLogin) {
            const patch: any = {
              ...identityPatch,
              isActive: portalAccountActive,
              status: portalAccountActive
                ? 'ACTIVE'
                : resolvedStatus === 'terminated' || resolvedStatus === 'resigned'
                  ? PORTAL_USER_STATUS_FROZEN
                  : PORTAL_USER_STATUS_INACTIVE,
            };
            if (effectiveAccessRole) patch.role = effectiveAccessRole;
            else if (bodyRole) patch.role = String(bodyRole).toUpperCase();
            if (portalPassword) {
              if (await rejectInvalidPortalPassword(res, portalPassword)) return;
              patch.password = await bcrypt.hash(portalPassword, 12);
              patch.passwordLength = portalPassword.length;
              patch.passwordChangedAt = new Date();
              // Admin-assigned portal password — require change on next sign-in.
              patch.mustChangePassword = true;
              patch.sessionToken = null;
            }
            if (patch.status === PORTAL_USER_STATUS_FROZEN || patch.isActive === false) {
              patch.sessionToken = null;
            }
            await existingUser.update(patch);
            if (portalPassword) {
              await revokePortalSessionsForUser(String(existingUser.id));
            }
            if (patch.isActive === false) {
              await revokePortalSessionsForUser(String(existingUser.id));
            }
            await syncPortalPhoneFromEmployee(
              String(refreshedPlain.id),
              refreshed.phone
            );
            await syncPortalEmailFromEmployee(
              String(refreshedPlain.id),
              refreshed.email
            );
            linkedRole = String(existingUser.role || patch.role || 'EMPLOYEE').toUpperCase();
            linkedAllowLogin = portalAccountActive;
          } else {
            const inactiveStatus =
              resolvedStatus === 'terminated' || resolvedStatus === 'resigned'
                ? PORTAL_USER_STATUS_FROZEN
                : PORTAL_USER_STATUS_INACTIVE;
            await existingUser.update({
              ...identityPatch,
              isActive: false,
              status: inactiveStatus,
              sessionToken: null,
            });
            await revokePortalSessionsForUser(String(existingUser.id));
            await syncPortalPhoneFromEmployee(
              String(refreshedPlain.id),
              refreshed.phone
            );
            await syncPortalEmailFromEmployee(
              String(refreshedPlain.id),
              refreshed.email
            );
            linkedRole = String(existingUser.role || 'EMPLOYEE').toUpperCase();
            linkedAllowLogin = false;
          }
          clearCachePrefix('all_users');
        } else if (enablePortalLogin) {
          const refreshedPlain = refreshed?.toJSON ? refreshed.toJSON() : refreshed;
          const loginEmployee = mergeCompensationIntoEmployee(
            refreshedPlain,
            refreshedPlain?.salaryStructure ?? null
          );
          if (portalPassword && (await rejectInvalidPortalPassword(res, portalPassword))) return;
          const created = await upsertLoginUserForEmployee({
            employee: loginEmployee,
            role: effectiveAccessRole || (bodyRole ? String(bodyRole).toUpperCase() : 'EMPLOYEE'),
            ...(portalPassword ? { password: portalPassword } : {}),
            nextUserId,
          });
          linkedRole = String(created.role).toUpperCase();
          linkedAllowLogin = true;
          clearCachePrefix('all_users');
        }
      }
    } catch (linkErr: any) {
      console.warn('User sync skipped:', linkErr?.message || linkErr);
    }

    if (resolvedStatus === EMPLOYEE_STATUS_DRAFT) {
      try {
        const {
          syncDraftLeaveAssignmentPreferences,
          buildDefaultLeaveAssignments,
          hasStoredLeaveAssignmentSelection,
        } = await import('./leaveBalanceService.js');
        const leaveYear = new Date().getFullYear();
        const genderForLeave = String(
          (employeePayload as Record<string, unknown>).gender ?? existingPlain.gender ?? ''
        );
        const empPk = String(refreshed.id);
        if (
          leaveAssignmentsBody &&
          typeof leaveAssignmentsBody === 'object' &&
          !Array.isArray(leaveAssignmentsBody)
        ) {
          await syncDraftLeaveAssignmentPreferences(
            empPk,
            leaveAssignmentsBody as Record<string, boolean>,
            leaveYear
          );
        } else if (!(await hasStoredLeaveAssignmentSelection(empPk, leaveYear))) {
          await syncDraftLeaveAssignmentPreferences(
            empPk,
            await buildDefaultLeaveAssignments(genderForLeave),
            leaveYear
          );
        }
      } catch (syncErr) {
        console.warn('Draft leave assignment sync failed:', (syncErr as Error)?.message || syncErr);
      }
    } else {
      try {
        const {
          syncLeaveAssignments,
          applyDefaultLeaveAssignmentsToEmployee,
          employeeNeedsDefaultLeaveBalances,
        } = await import('./leaveBalanceService.js');
        const leaveYear = new Date().getFullYear();
        if (
          leaveAssignmentsBody &&
          typeof leaveAssignmentsBody === 'object' &&
          !Array.isArray(leaveAssignmentsBody)
        ) {
          await syncLeaveAssignments(
            String(refreshed.id),
            leaveAssignmentsBody as Record<string, boolean>,
            leaveYear
          );
        } else {
          // After update(), employee.status is already the NEW status — detect draft→active
          // from the pre-update snapshot. Also heal active employees still missing balances.
          const priorStatus = String(existingPlain.status ?? '').toLowerCase();
          const genderForLeave = String(
            (employeePayload as Record<string, unknown>).gender ?? existingPlain.gender ?? ''
          );
          const empPk = String(refreshed.id);
          if (
            priorStatus === EMPLOYEE_STATUS_DRAFT ||
            (await employeeNeedsDefaultLeaveBalances(empPk, genderForLeave, leaveYear))
          ) {
            await applyDefaultLeaveAssignmentsToEmployee(empPk, genderForLeave, leaveYear);
          }
        }
      } catch (syncErr) {
        console.warn('Leave assignment sync failed:', (syncErr as Error)?.message || syncErr);
      }
    }

    const payloadRaw = refreshed?.toJSON ? refreshed.toJSON() : refreshed;
    const structure = payloadRaw?.salaryStructure ?? null;
    if (payloadRaw) delete payloadRaw.salaryStructure;
    const merged = mergeCompensationIntoEmployee(payloadRaw || {}, structure);
    let leave_assignments: Record<string, boolean> = {};
    try {
      const { resolveLeaveAssignmentsMap } = await import('./leaveBalanceService.js');
      leave_assignments = await resolveLeaveAssignmentsMap(
        String(refreshed.id),
        merged.gender != null ? String(merged.gender) : null,
        resolvedStatus
      );
    } catch {
      /* non-fatal */
    }
    const missingForActive = missingFieldsForActive(mergedForStatusCheck);
    const profileComplete =
      resolvedStatus === EMPLOYEE_STATUS_ACTIVE && missingForActive.length === 0;
    const changedProfileFields = Object.keys(employeePayload as Record<string, unknown>).filter(
      (field) => existingPlain[field] !== (employeePayload as Record<string, unknown>)[field]
    );
    const compensationApplied =
      !salaryHeldForApproval && (shouldBootstrapSalary || compensationFieldsChanged.size > 0);
    if (changedProfileFields.length || compensationApplied) {
      const { notifyEmployeeProfileChanged } = await import('./notificationService.js');
      void notifyEmployeeProfileChanged({
        employeePk: String(refreshed.id),
        employeeDisplayId: String(refreshed.employee_id || id),
        actorUserId: String(actor?.id ?? updated_by ?? ''),
        changedFields: [
          ...changedProfileFields,
          ...(compensationApplied ? [...compensationFieldsChanged] : []),
        ],
        compensationChanged: compensationApplied,
        revision: new Date(refreshed.updated_at || Date.now()).getTime().toString(36),
      }).catch(() => undefined);
    }
    if (pendingSensitiveRequest) {
      return res.status(202).json({
        message:
          'Sensitive placement or compensation changes submitted for HR Manager approval. Other updates were saved.',
        pendingApproval: true,
        changeRequest: pendingSensitiveRequest,
        profileComplete,
        ...(missingForActive.length > 0 ? { missingFields: missingForActive } : {}),
        employee: { ...merged, role: linkedRole, allow_login: linkedAllowLogin, leave_assignments },
      });
    }

    res.json({
      message: profileComplete
        ? 'Employee updated successfully'
        : resolvedStatus === EMPLOYEE_STATUS_ACTIVE
          ? 'Employee saved as active'
          : 'Employee saved',
      profileComplete,
      ...(missingForActive.length > 0 ? { missingFields: missingForActive } : {}),
      employee: { ...merged, role: linkedRole, allow_login: linkedAllowLogin, leave_assignments },
    });
  } catch (error: any) {
    const {
      MasterDataEffectiveDateRequiredError,
      PayrollMasterDataConflictError,
    } = await import('./payroll/payrollMasterDataGuard.js');
    if (
      error instanceof MasterDataEffectiveDateRequiredError ||
      error instanceof PayrollMasterDataConflictError
    ) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    console.error('Error updating employee:', error);
    if (
      error?.name === 'SequelizeForeignKeyConstraintError' ||
      String(error?.original?.code || '').includes('ER_NO_REFERENCED_ROW') ||
      /foreign key constraint fails/i.test(String(error?.message || error?.original?.message || ''))
    ) {
      return res.status(400).json({
        message:
          'Department or position is invalid or no longer exists. Re-select them from the list and save again.',
      });
    }
    res.status(error?.statusCode || error?.status || 500).json({
      message: error?.message || 'Internal server error',
      code: error?.code,
    });
  }
});

router.delete('/employees/:id', hrManagerAccess, async (req, res) => {
  const { id } = req.params;
  const { deleted_by, reason } = req.body || {};
  const actor = (req as { user?: { id?: string } }).user;
  const deletedBy = deleted_by ?? actor?.id ?? null;
  const deleteReason = String(reason ?? '').trim();

  try {
    if (deleteReason.length < 3) {
      return res.status(400).json({
        message: 'A reason is required to delete this employee (at least 3 characters).',
      });
    }

    const employee = await Employee.findOne({
      where: employeeLookupWhere(id) as any,
      attributes: ['id', 'employee_id', 'status'],
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const status = String(employee.get('status') ?? '')
      .trim()
      .toLowerCase();
    if (status === 'draft' || status === 'profile_incomplete') {
      const result = await deleteDraftEmployee({
        displayEmployeeId: String(employee.get('employee_id') ?? id),
        reason: deleteReason,
        deletedBy: deletedBy != null ? String(deletedBy) : null,
      });
      clearCachePrefix('all_users');
      clearCachePrefix('report_stats');
      clearCachePrefix('employees');
      clearCachePrefix('dashboard');
      return res.json(result);
    }

    const result = await terminateEmployee({
      displayEmployeeId: id,
      reason: deleteReason,
      terminatedBy: deletedBy,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EmployeeLifecycleError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error deleting employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/:id/offboard', hrManagerAccess, async (req, res) => {
  const { id } = req.params;
  const { offboard_type, reason, offboarded_by, separation_type } = req.body || {};
  const body = req.body || {};

  try {
    const { normalizeSeparationType } = await import('./payroll/separationTypes.js');
    const separationType = normalizeSeparationType(
      separation_type ?? body.separationType ?? offboard_type
    );
    if (separationType && separationType !== 'normal_resignation') {
      const { offboardWithSeparationType } = await import('./payroll/abandonmentCaseService.js');
      const result = await offboardWithSeparationType({
        displayEmployeeId: id,
        separationType,
        reason: String(body.reason ?? reason ?? ''),
        offboardedBy: body.offboarded_by ?? offboarded_by ?? null,
        lastWorkingDate: body.last_working_date,
      });
      return res.json(result);
    }

    const offboardType = String(offboard_type || 'resign').trim().toLowerCase();
    if (offboardType !== 'terminate' && offboardType !== 'resign') {
      return res.status(400).json({ message: 'offboard_type must be terminate or resign' });
    }

    const result = await offboardEmployee({
      displayEmployeeId: id,
      type: offboardType,
      reason: String(body.reason ?? reason ?? ''),
      offboardedBy: body.offboarded_by ?? offboarded_by ?? null,
      resignationSubmittedAt: body.resignation_submitted_at,
      resignationApprovedAt: body.resignation_approved_at,
      lastWorkingDate: body.last_working_date,
      finalSettlementDate: body.final_settlement_date,
      source: 'employee',
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EmployeeLifecycleError) {
      return res.status(error.status).json({ message: error.message });
    }
    const e = error as Error & { statusCode?: number };
    if (e.statusCode) {
      return res.status(e.statusCode).json({ message: e.message });
    }
    console.error('Error offboarding employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/:id/suspend', hrManagerAccess, async (req, res) => {
  try {
    const { suspendEmployee } = await import('./employeeLifecycle.js');
    const result = await suspendEmployee({
      displayEmployeeId: req.params.id,
      reason: req.body?.reason,
      suspendedBy: req.body?.suspended_by ?? null,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EmployeeLifecycleError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error suspending employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/employees/:id/restore', requireEffectivePermission('hr.employee.restore'), async (req, res) => {
  const { id } = req.params;
  const viewer = (req as { user?: { id?: string } }).user;
  const body = (req.body || {}) as Record<string, unknown>;
  const restoredBy = body.restored_by ?? viewer?.id ?? null;
  const restoreReason = String(body.restore_reason ?? body.reason ?? '').trim();

  try {
    const result = await restoreEmployee({
      displayEmployeeId: id,
      restoredBy: restoredBy != null ? String(restoredBy) : null,
      restoreReason,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EmployeeLifecycleError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error restoring employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/employees/:id/archive-detail', hrManagerAccess, async (req, res) => {
  try {
    const { getEmployeeArchiveDetail } = await import('./employeeArchiveService.js');
    const detail = await getEmployeeArchiveDetail(req.params.id);
    res.json(detail);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404) return res.status(404).json({ message: 'Employee not found' });
    console.error('Error fetching employee archive detail:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/** Latest termination archive for an employee (HR audit). */
router.get('/employees/:id/history', hrManagerAccess, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await HistoryEmployee.findAll({
      where: { employee_id: id },
      order: [['terminated_at', 'DESC']],
      limit: 20,
    });
    res.json(
      rows.map((row) => {
        const p = row.get({ plain: true }) as Record<string, unknown>;
        return {
          id: p.id,
          employee_id: p.employee_id,
          terminated_at: p.terminated_at,
          termination_reason: p.termination_reason,
          terminated_by: p.terminated_by,
          restored_at: p.restored_at,
          restored_by: p.restored_by,
          is_currently_terminated: p.is_currently_terminated,
        };
      })
    );
  } catch (error) {
    console.error('Error fetching employee history:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Employee Activation (Admin approval)
router.post('/employees/:id/activate', requireEffectivePermission('hr.employee.restore'), async (req, res) => {
  const { id } = req.params;
  const { activated_by } = req.body;

  try {
    const employee = await Employee.findOne({ where: employeeLookupWhere(id) as any });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    if (employee.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Employee is not pending approval' });
    }

    // Update employee status
    await employee.update({
      status: 'active',
      onboarding_completed_at: new Date(),
      updated_at: new Date()
    });

    // Log status change
    await EmployeeStatusHistory.create({
      employee_id: employee.id,
      old_status: 'pending_approval',
      new_status: 'active',
      reason: 'Admin approval',
      changed_by: activated_by
    });

    const { ensurePortalUserForEmployee } = await import('./employeeLoginAccountService.js');
    const portal = await ensurePortalUserForEmployee(employee);

    if (!portal.skipped && (portal.created || portal.linked)) {
      try {
        const { notifyPortalAccountReady, resolvePortalUserIdForEmployeeRef } = await import(
          './notificationService.js'
        );
        const portalUserId = await resolvePortalUserIdForEmployeeRef(String(employee.id));
        if (portalUserId) {
          void notifyPortalAccountReady({
            userId: portalUserId,
            employeeDisplayId: id,
          });
        }
      } catch (notifyErr) {
        console.warn('[employees] portal ready notification failed:', notifyErr);
      }
    }

    res.json({
      message: 'Employee activated successfully',
      portalUser: portal.skipped
        ? { created: false, linked: false, reason: 'missing_email' }
        : { created: portal.created, linked: portal.linked },
    });
  } catch (error) {
    console.error('Error activating employee:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// LEAVE ROSTER MANAGEMENT API
// ============================================

// Get all fixed rosters
router.get('/leaves/rosters', async (req, res) => {
  try {
    const { FixedRoster: Roster } = await import('./db');
    const rosters = await Roster.findAll({
      where: req.query.isActive !== 'false' ? { isActive: true } : {},
      order: [['createdAt', 'DESC']]
    });
    res.json(rosters);
  } catch (error) {
    console.error('Error fetching rosters:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create roster
router.post('/leaves/rosters', hrAccess, async (req, res) => {
  try {
    const { FixedRoster: Roster } = await import('./db');
    const roster = await Roster.create({
      id: `rost-${Date.now()}`,
      ...req.body
    });
    res.status(201).json(roster);
  } catch (error) {
    console.error('Error creating roster:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update roster
router.put('/leaves/rosters/:id', hrAccess, async (req, res) => {
  try {
    const { FixedRoster: Roster } = await import('./db');
    const roster = await Roster.findByPk(req.params.id);
    if (!roster) return res.status(404).json({ message: 'Roster not found' });
    await roster.update(req.body);
    res.json(roster);
  } catch (error) {
    console.error('Error updating roster:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete roster
router.delete('/leaves/rosters/:id', hrAccess, async (req, res) => {
  try {
    const { FixedRoster: Roster } = await import('./db');
    const roster = await Roster.findByPk(req.params.id);
    if (!roster) return res.status(404).json({ message: 'Roster not found' });
    await roster.update({ isActive: false });
    res.json({ message: 'Roster deleted' });
  } catch (error) {
    console.error('Error deleting roster:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Monthly planning rosters (Leaves → Planning tab grid)
router.get('/leaves/planning-rosters', async (req, res) => {
  try {
    const { listMonthlyPlanningRosters } = await import('./monthlyPlanningRosterService.js');
    const year = req.query.year != null ? Number(req.query.year) : undefined;
    const month = req.query.month != null ? Number(req.query.month) : undefined;
    const rows = await listMonthlyPlanningRosters({ year, month });
    res.json(rows);
  } catch (error) {
    console.error('Error fetching planning rosters:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/leaves/planning-rosters/off-days', async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;
    const month = String(req.query.month || '').slice(0, 7);
    if (!month) return res.status(400).json({ message: 'month query required (YYYY-MM)' });
    const { getEmployeeOffDatesForMonth } = await import('./employeeRosterOffDaysService.js');
    const offDates = await getEmployeeOffDatesForMonth({
      userId: userId || undefined,
      employeeId,
      month: `${month}-01`,
    });
    res.json({ month, offDates: [...offDates].sort() });
  } catch (error) {
    console.error('Error fetching roster off-days:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/leaves/planning-rosters', planningRosterWriteAccess, async (req, res) => {
  try {
    const { createMonthlyPlanningRoster } = await import('./monthlyPlanningRosterService.js');
    const roster = await createMonthlyPlanningRoster((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(roster);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save roster';
    const isClient = /required|valid roster|already exists/i.test(msg);
    console.error('Error creating planning roster:', error);
    return res.status(isClient ? 400 : 500).json({ message: msg });
  }
});

router.put('/leaves/planning-rosters/:id', planningRosterWriteAccess, async (req, res) => {
  try {
    const { updateMonthlyPlanningRoster } = await import('./monthlyPlanningRosterService.js');
    const roster = await updateMonthlyPlanningRoster(
      req.params.id,
      (req.body ?? {}) as Record<string, unknown>
    );
    if (!roster) return res.status(404).json({ message: 'Planning roster not found' });
    res.json(roster);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save roster';
    const isClient = /required|valid roster|already exists/i.test(msg);
    console.error('Error updating planning roster:', error);
    return res.status(isClient ? 400 : 500).json({ message: msg });
  }
});

router.delete('/leaves/planning-rosters/:id', planningRosterWriteAccess, async (req, res) => {
  try {
    const { deleteMonthlyPlanningRoster } = await import('./monthlyPlanningRosterService.js');
    const ok = await deleteMonthlyPlanningRoster(req.params.id);
    if (!ok) return res.status(404).json({ message: 'Planning roster not found' });
    res.json({ message: 'Planning roster deleted' });
  } catch (error) {
    console.error('Error deleting planning roster:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// ATTENDANCE OFFICE LOCATION API (Geofencing)
// ============================================

// Get all offices (from systemsettings — no officelocations table required)
router.get('/attendance/offices', async (req, res) => {
  try {
    const { listActiveOfficeLocations } = await import('./attendanceSettings.js');
    const offices = await listActiveOfficeLocations();
    const filtered =
      req.query.isActive === 'false' ? offices : offices.filter((o) => o.isActive !== false);
    res.json(filtered);
  } catch (error) {
    console.error('Error fetching offices:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create office (appends to attendance settings)
router.post('/attendance/offices', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const { getAttendanceSettings, saveAttendanceSettings } = await import('./attendanceSettings.js');
    const body = req.body || {};
    const current = await getAttendanceSettings();
    const office = {
      id: `off-${Date.now()}`,
      name: String(body.name || 'New office'),
      address: body.address,
      latitude: Number(body.latitude) || 11.5564,
      longitude: Number(body.longitude) || 104.9282,
      radiusMeters: Number(body.radiusMeters) || 20,
      workingHoursStart: body.workingHoursStart || '08:00',
      workingHoursEnd: body.workingHoursEnd || '17:00',
      isActive: true,
    };
    const saved = await saveAttendanceSettings({
      offices: [...current.offices, office],
    });
    const created = saved.offices.find((o) => o.id === office.id) ?? office;
    res.status(201).json(created);
  } catch (error) {
    console.error('Error creating office:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update office
router.put('/attendance/offices/:id', requireEffectivePermission('attendance.manage'), async (req, res) => {
  try {
    const { getAttendanceSettings, saveAttendanceSettings } = await import('./attendanceSettings.js');
    const id = String(req.params.id);
    const current = await getAttendanceSettings();
    const idx = current.offices.findIndex((o) => o.id === id);
    if (idx < 0) return res.status(404).json({ message: 'Office not found' });
    const body = req.body || {};
    const updated = {
      ...current.offices[idx],
      ...body,
      id,
      isActive: body.isActive !== false,
    };
    const offices = [...current.offices];
    offices[idx] = updated;
    const saved = await saveAttendanceSettings({ offices });
    const row = saved.offices.find((o) => o.id === id);
    res.json(row ?? updated);
  } catch (error) {
    console.error('Error updating office:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Validate location (geofencing check)
router.post('/attendance/validate-location', async (req, res) => {
  try {
    const { latitude, longitude, userId } = req.body;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const { checkUserRequiredZone } = await import('./departmentAttendanceWorksite.js');
    const zoneCheck = await checkUserRequiredZone(String(userId), lat, lng);
    const worksite = zoneCheck.worksite;
    if (!worksite) {
      return res.json({
        valid: true,
        withinRadius: true,
        remote: true,
        message: 'No office geofence configured for this employee',
      });
    }

    res.json({
      valid: zoneCheck.inZone,
      withinRadius: zoneCheck.inZone,
      office: worksite.name,
      distance: zoneCheck.distanceMeters,
      radiusMeters: worksite.radius,
      worksite,
      message: zoneCheck.inZone
        ? `Within ${worksite.radius}m of ${worksite.name}`
        : `You are ${zoneCheck.distanceMeters}m from ${worksite.name} (required: within ${worksite.radius}m of your assigned office)`,
    });
  } catch (error) {
    console.error('Error validating location:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// TAX BRACKET API (Cambodia 2026)
// ============================================

router.get('/payroll/exchange-rate', async (_req, res) => {
  try {
    const { getPayrollExchangeRateDetails } = await import('./payrollExchangeRateService.js');
    const details = await getPayrollExchangeRateDetails();
    res.json(details);
  } catch (error) {
    console.error('Error fetching payroll exchange rate:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/exchange-rates', hrAccess, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const { listExchangeRates } = await import('./exchangeRateService.js');
    res.json({ rates: await listExchangeRates(limit) });
  } catch (error) {
    console.error('Error listing exchange rates:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/exchange-rate', requireEffectivePermission('payroll.rules.edit'), async (req, res) => {
  try {
    const rate = Number(req.body?.exchangeRateKhrPerUsd ?? req.body?.rate);
    const effectiveFrom = req.body?.effectiveFrom ?? req.body?.effective_from;
    const actor = (req as { user?: { id?: string } }).user;
    const { setPayrollExchangeRateKhrPerUsd } = await import('./payrollExchangeRateService.js');
    const details = await setPayrollExchangeRateKhrPerUsd(rate, effectiveFrom, actor?.id);
    res.json({ message: 'Exchange rate scheduled', ...details });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const code = (error as { code?: string }).code;
    const msg = error instanceof Error ? error.message : 'Failed to save exchange rate';
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: msg, code });
    }
    console.error('Error saving payroll exchange rate:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/payroll/tax-brackets', requireEffectivePermission('payroll.rules.view'), async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const { listTaxBracketsForApi } = await import('./taxBracketService.js');
    const snapshot = await listTaxBracketsForApi(month);
    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching tax brackets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/tax-brackets', requireEffectivePermission('payroll.rules.edit'), async (req, res) => {
  try {
    const brackets = req.body?.brackets;
    const effectiveFrom = req.body?.effectiveFrom ?? req.body?.effective_from;
    if (!Array.isArray(brackets)) {
      return res.status(400).json({ message: 'brackets array required' });
    }
    const actor = (req as { user?: { id?: string } }).user;
    const { saveTaxBrackets } = await import('./taxBracketService.js');
    const snapshot = await saveTaxBrackets(brackets, effectiveFrom, actor?.id);
    res.json({ success: true, brackets: snapshot.brackets, effectiveFrom: snapshot.effectiveFrom });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const code = (error as { code?: string }).code;
    const msg = error instanceof Error ? error.message : 'Failed to save tax brackets';
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: msg, code });
    }
    console.error('Error saving tax brackets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// PAYROLL COMPLIANCE RULES API
// ============================================

router.get('/payroll/compliance-rules', hrAccess, async (_req, res) => {
  try {
    const { listPayrollComplianceRules } = await import('./payrollComplianceRuleService.js');
    const rules = await listPayrollComplianceRules();
    res.json(rules);
  } catch (error) {
    console.error('Error fetching compliance rules:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/compliance-rules', hrAccess, async (req, res) => {
  try {
    const rules = req.body?.rules;
    const effectiveFrom = req.body?.effectiveFrom ?? req.body?.effective_from;
    if (!Array.isArray(rules)) {
      return res.status(400).json({ message: 'rules array required' });
    }
    const actor = (req as { user?: { id?: string } }).user;
    const { savePayrollComplianceRules } = await import('./payrollComplianceRuleService.js');
    const saved = await savePayrollComplianceRules(rules, effectiveFrom, actor?.id);
    res.json({ success: true, rules: saved });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const code = (error as { code?: string }).code;
    const msg = error instanceof Error ? error.message : 'Failed to save compliance rules';
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: msg, code });
    }
    console.error('Error saving compliance rules:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// NSSF ASSUMED WAGE TABLE (contributory wage levels)
// ============================================

router.get('/payroll/nssf-assumed-wage-brackets', requireEffectivePermission('payroll.rules.view'), async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const { listNssfAssumedWageBracketsApi } = await import('./nssfAssumedWageService.js');
    const snapshot = await listNssfAssumedWageBracketsApi(month);
    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching NSSF assumed wage brackets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.put('/payroll/nssf-assumed-wage-brackets', requireEffectivePermission('payroll.rules.edit'), async (req, res) => {
  try {
    const brackets = req.body?.brackets;
    const effectiveFrom = req.body?.effectiveFrom ?? req.body?.effective_from;
    if (!Array.isArray(brackets)) {
      return res.status(400).json({ message: 'brackets array required' });
    }
    const actor = (req as { user?: { id?: string } }).user;
    const { saveNssfAssumedWageBrackets } = await import('./nssfAssumedWageService.js');
    const snapshot = await saveNssfAssumedWageBrackets(brackets, effectiveFrom, actor?.id);
    res.json({ success: true, brackets: snapshot.brackets, effectiveFrom: snapshot.effectiveFrom });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    const code = (error as { code?: string }).code;
    const msg = error instanceof Error ? error.message : 'Failed to save NSSF wage brackets';
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: msg, code });
    }
    console.error('Error saving NSSF assumed wage brackets:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ============================================
// NSSF CONFIG API
// ============================================

mountPayrollHybridRoutes(router, { hrAccess, requirePerm: requireEffectivePermission });
mountFinalSettlementRoutes(router, { hrAccess, requirePerm: requireEffectivePermission });
mountAbandonmentRoutes(router, { hrAccess, requirePerm: requireEffectivePermission });
mountHistoricalRecordsRoutes(router, { hrAccess });

router.use(createAllowanceRoutes(hrAccess, requireEffectivePermission));
router.use('/payroll', createUnifiedPayrollRuleRoutes(hrAccess));
router.use('/seniority/indemnity', createSeniorityIndemnityRoutes(hrAccess));

router.get('/payroll/nssf-config', async (_req, res) => {
  try {
    const { getActiveNssfConfig } = await import('./nssfConfigService.js');
    res.json(await getActiveNssfConfig());
  } catch (error) {
    console.error('Error fetching NSSF config:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});