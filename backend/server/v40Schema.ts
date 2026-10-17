import {
  sequelize,
  UserDeviceSession,
  EmployeeReview,
} from './db.js';

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[v40-schema] Added ${table}.${column}`);
}

/**
 * Idempotent schema updates for v4.0 features (PIN, device sessions, QR, reviews).
 * Safe on existing databases — does not drop or overwrite data.
 */
export async function ensureV40Schema(): Promise<void> {
  const userTable = 'users';

  await ensureColumn(userTable, 'securityPinHash', 'VARCHAR(255) NULL');
  await ensureColumn(userTable, 'pinAutoLockMinutes', 'INT NOT NULL DEFAULT 15');
  await ensureColumn(userTable, 'pinLockEnabled', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(userTable, 'pinFailedAttempts', 'INT NOT NULL DEFAULT 0');
  await ensureColumn(userTable, 'pinLockedRequiresOtp', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(userTable, 'pinLockedRequiresAdminReset', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(userTable, 'pinRecoveryOtpHash', 'VARCHAR(255) NULL');
  await ensureColumn(userTable, 'pinRecoveryOtpExpiry', 'DATETIME NULL');
  await ensureColumn(userTable, 'pinRecoveryVerifiedAt', 'DATETIME NULL');
  await ensureColumn(userTable, 'resetPasswordVerifiedAt', 'DATETIME NULL');
  await ensureColumn(userTable, 'preferred_currency', "VARCHAR(3) NOT NULL DEFAULT 'KHR'");
  await ensureColumn(userTable, 'failedLoginAttempts', 'INT NOT NULL DEFAULT 0');
  await ensureColumn(userTable, 'loginLockedUntil', 'DATETIME NULL');

  if (!(await tableExists('userdevicesessions'))) {
    await UserDeviceSession.sync();
    console.log('[v40-schema] Created userdevicesessions');
  }

  const { dropLegacyAttendanceQrTokensTable } = await import('./attendanceQrTokenService.js');
  await dropLegacyAttendanceQrTokensTable();

  if (!(await tableExists('employeereviews'))) {
    await EmployeeReview.sync();
    console.log('[v40-schema] Created employeereviews');
  }

  const { ensureEmployeeReviewKpiColumns } = await import(
    './personalAnalytics/employeeReviewKpiSchema.js'
  );
  await ensureEmployeeReviewKpiColumns();

  const { ensureAttendanceRecordCorrectionColumns } = await import('./attendanceRecordSchema.js');
  await ensureAttendanceRecordCorrectionColumns();

  const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
  await ensureAttendanceLateColumns();

  const { ensureLeaveRequestHalfDayColumns } = await import('./leaveRequestSchema.js');
  await ensureLeaveRequestHalfDayColumns();

  const { ensureLeaveTypeCategoryColumns } = await import('./leaveTypeSchema.js');
  await ensureLeaveTypeCategoryColumns();

  const { ensureLeaveBalanceRenewalColumns, ensureEmployeeLeaveTypeAssignmentTable } =
    await import('./leaveBalanceSchema.js');
  await ensureLeaveBalanceRenewalColumns();
  await ensureEmployeeLeaveTypeAssignmentTable();

  const { ensureLeaveLedgerSchema } = await import('./leaveLedgerSchema.js');
  await ensureLeaveLedgerSchema();

  const { ensureAnnualLeaveAccrualConfigSetting } = await import('./annualLeaveAccrualConfig.js');
  await ensureAnnualLeaveAccrualConfigSetting();

  await purgeRemovedEmployeeModuleSettings();
}

/** Orphan keys from removed Employee Module Settings UI (never consumed by server logic). */
async function purgeRemovedEmployeeModuleSettings(): Promise<void> {
  if (!(await tableExists('systemsettings'))) return;
  const [result]: unknown = await sequelize.query(
    `DELETE FROM systemsettings
     WHERE \`key\` LIKE 'employee.%'
       AND (description = 'Employee module setting' OR category = 'employee')`
  );
  const affected =
    result && typeof result === 'object' && 'affectedRows' in result
      ? Number((result as { affectedRows?: number }).affectedRows)
      : 0;
  if (affected > 0) {
    console.log(`[v40-schema] Removed ${affected} obsolete employee.* system setting row(s).`);
  }
}
