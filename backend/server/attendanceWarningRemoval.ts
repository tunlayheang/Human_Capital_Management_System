import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

export const ATTENDANCE_WARNING_CONFIG_KEY = 'attendance.warning_rules';

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { table } }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function dropAttendanceWarningsTableIfNeeded(): Promise<void> {
  if (!(await tableExists('attendance_warnings'))) return;
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await sequelize.query('DROP TABLE IF EXISTS `attendance_warnings`');
    console.log('[attendance] Dropped table attendance_warnings.');
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** Remove stored warning-rule config from systemsettings. */
export async function removeAttendanceWarningSettingsIfNeeded(): Promise<void> {
  await sequelize.query(`DELETE FROM systemsettings WHERE \`key\` = :key`, {
    replacements: { key: ATTENDANCE_WARNING_CONFIG_KEY },
    type: QueryTypes.DELETE,
  });
}

export async function ensureAttendanceWarningsRemoved(): Promise<void> {
  await dropAttendanceWarningsTableIfNeeded();
  await removeAttendanceWarningSettingsIfNeeded();
}
