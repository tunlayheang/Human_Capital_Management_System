import { AttendanceRecord, sequelize } from './db.js';
import { resolveLateAttendanceFields } from './attendanceLateMinutes.js';
import { DEFAULT_ATTENDANCE_RULES, getAttendanceGeofenceConfig } from './attendanceSettings.js';
import { getEmployeeScheduleForUser } from './employeeAttendanceSchedule.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureAttendanceColumn(column: string, ddl: string): Promise<void> {
  if (await columnExists('attendancerecords', column)) return;
  await sequelize.query(`ALTER TABLE \`attendancerecords\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[attendance] Added attendancerecords.${column}`);
}

/** Ensures late tracking columns exist on attendance records (no warnings table). */
let attendanceLateColumnsReady = false;
let lateStatusHealDone = false;

export async function ensureAttendanceLateColumns(): Promise<void> {
  if (attendanceLateColumnsReady) return;
  await ensureAttendanceColumn('lateMinutes', 'INT NOT NULL DEFAULT 0');
  await ensureAttendanceColumn('lateExcused', 'TINYINT(1) NOT NULL DEFAULT 0');
  attendanceLateColumnsReady = true;
  await healLateStatusTimezoneMismatches();
}

/**
 * Recompute lateMinutes + LATE/PRESENT for rows that look inconsistent or
 * were labeled with server-local timezone (UTC) while lateMinutes used ICT.
 */
export async function healLateStatusTimezoneMismatches(): Promise<number> {
  if (lateStatusHealDone) return 0;
  lateStatusHealDone = true;
  try {
    const { Op } = await import('sequelize');
    const candidates = await AttendanceRecord.findAll({
      where: {
        [Op.or]: [
          {
            status: { [Op.in]: ['LATE', 'late'] },
            lateMinutes: { [Op.or]: [0, null] },
            clockIn: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
          },
          {
            status: { [Op.in]: ['PRESENT', 'present'] },
            lateMinutes: { [Op.gt]: 0 },
            clockIn: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
          },
        ],
      },
      limit: 5000,
      attributes: ['id', 'userId', 'date', 'clockIn', 'status', 'lateMinutes'],
    });
    let healed = 0;
    for (const row of candidates) {
      const plain = row.get({ plain: true }) as {
        id: string;
        userId: string;
        date: string;
        clockIn: string;
        status: string;
        lateMinutes: number | null;
      };
      const beforeStatus = String(plain.status ?? '').toUpperCase();
      const beforeLate = Number(plain.lateMinutes ?? 0) || 0;
      const result = await applyLateFieldsToRecord(plain);
      if (
        result.status !== beforeStatus ||
        result.lateMinutes !== beforeLate
      ) {
        healed += 1;
      }
    }
    if (healed > 0) {
      console.log(`[attendance] Healed ${healed} LATE/PRESENT row(s) via ICT late recomputation`);
    }
    return healed;
  } catch (e) {
    console.warn('[attendance] late status heal skipped:', e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Compute and persist late minutes + LATE status on an attendance record. */
export async function applyLateFieldsToRecord(
  row: { clockIn?: string | null; status?: string; date?: string; userId?: string; id?: string }
): Promise<{ lateMinutes: number; status: string }> {
  await ensureAttendanceLateColumns();
  const userId = String(row.userId ?? '');
  const clockIn = row.clockIn ?? null;
  if (!clockIn) {
    return { lateMinutes: 0, status: String(row.status ?? 'PRESENT') };
  }

  const settings = await getAttendanceGeofenceConfig();
  const rules = settings?.rules ?? DEFAULT_ATTENDANCE_RULES;
  const schedule = userId ? await getEmployeeScheduleForUser(userId) : null;
  const { status, lateMinutes } = resolveLateAttendanceFields(clockIn, schedule, rules);

  const record: any = await AttendanceRecord.findByPk(String(row.id ?? ''));
  if (record) {
    record.lateMinutes = lateMinutes;
    const preserved = new Set(['DAY_OFF', 'PH', 'MISSION']);
    const storedStatus = String(record.status ?? '').toUpperCase();
    if (status === 'LATE' && !preserved.has(storedStatus)) record.status = 'LATE';
    else if (!preserved.has(storedStatus)) record.status = status;
    await record.save();
  }

  return { lateMinutes, status };
}
