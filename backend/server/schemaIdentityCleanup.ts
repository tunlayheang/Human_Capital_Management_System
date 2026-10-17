import { sequelize, SystemSetting } from './db.js';
import {
  findDisplayIdByEmployeePk,
  findEmployeePkByDisplayId,
  findEmployeePkByUserId,
  findUserIdByEmployeePk,
} from './employeeIdentity.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function dropColumnIfExists(table: string, column: string): Promise<void> {
  if (!(await columnExists(table, column))) return;
  await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  console.log(`[identity-cleanup] Dropped ${table}.${column}`);
}

async function dropFkIfExists(table: string, column: string): Promise<void> {
  const [rows]: unknown = await sequelize.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: [table, column] }
  );
  if (!Array.isArray(rows)) return;
  for (const row of rows as { CONSTRAINT_NAME: string }[]) {
    try {
      await sequelize.query(
        `ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
      );
    } catch {
      /* ignore */
    }
  }
}

/** Portal workflow — userId is enough (users.employeeId → employees). */
async function dropOvertimeRequestEmployeeId(): Promise<void> {
  await dropFkIfExists('overtimerequests', 'employeeId');
  await dropColumnIfExists('overtimerequests', 'employeeId');
}

/** Payslip display code is derived from userId at read time. */
async function dropPayslipEmployeeId(): Promise<void> {
  await dropFkIfExists('payslips', 'employeeId');
  await dropColumnIfExists('payslips', 'employeeId');
}

/** Drop legacy face recognition storage (feature removed). */
async function dropEmployeeFaceProfilesTable(): Promise<void> {
  try {
    await sequelize.query('DROP TABLE IF EXISTS `employee_face_profiles`');
  } catch {
    /* non-fatal */
  }
  try {
    await SystemSetting.destroy({ where: { key: 'attendance.enable_face_scan' } });
  } catch {
    /* non-fatal */
  }
}

/** HR correction requests — employee_pk is canonical. */
async function dropSensitiveChangeDisplayEmployeeId(): Promise<void> {
  await dropColumnIfExists('employee_sensitive_changes', 'employee_id');
}

/** payrolldeductionauthorizations: one employees.id column. */
async function consolidatePayrollDeductionIdentity(): Promise<void> {
  const table = 'payrolldeductionauthorizations';
  if (!(await columnExists(table, 'employeeId'))) return;

  if (!(await columnExists(table, 'employee_id'))) {
    await sequelize.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`employee_id\` varchar(255) NULL AFTER \`id\``
    );
  }

  const [rows]: unknown = await sequelize.query(`SELECT id, employeeId, userId FROM \`${table}\``);
  if (Array.isArray(rows)) {
    for (const row of rows as { id: string; employeeId: string; userId: string }[]) {
      let pk =
        (await findEmployeePkByDisplayId(String(row.employeeId ?? ''))) ??
        (await findEmployeePkByUserId(String(row.userId ?? '')));
      if (!pk) pk = await findEmployeePkByDisplayId(String(row.employeeId ?? ''));
      if (pk) {
        await sequelize.query(`UPDATE \`${table}\` SET employee_id = ? WHERE id = ?`, {
          replacements: [pk, row.id],
        });
      }
    }
  }

  await dropFkIfExists(table, 'employeeId');
  await dropFkIfExists(table, 'userId');
  await dropColumnIfExists(table, 'userId');
  await dropColumnIfExists(table, 'employeeId');
}

/** finalsettlementruns: one employees.id column. */
async function consolidateFinalSettlementIdentity(): Promise<void> {
  const table = 'finalsettlementruns';
  if (!(await columnExists(table, 'employeeId')) && !(await columnExists(table, 'userId'))) {
    return;
  }

  if (!(await columnExists(table, 'employee_id'))) {
    await sequelize.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`employee_id\` varchar(255) NULL AFTER \`id\``
    );
  }

  const [rows]: unknown = await sequelize.query(`SELECT id, employeeId, userId FROM \`${table}\``);
  if (Array.isArray(rows)) {
    for (const row of rows as { id: string; employeeId: string; userId: string }[]) {
      const pk =
        (await findEmployeePkByDisplayId(String(row.employeeId ?? ''))) ??
        (await findEmployeePkByUserId(String(row.userId ?? '')));
      if (pk) {
        await sequelize.query(`UPDATE \`${table}\` SET employee_id = ? WHERE id = ?`, {
          replacements: [pk, row.id],
        });
      }
    }
  }

  await dropFkIfExists(table, 'employeeId');
  await dropFkIfExists(table, 'userId');
  await dropColumnIfExists(table, 'userId');
  await dropColumnIfExists(table, 'employeeId');
}

/** employeeabandonmentcases: employee_pk → employee_id; drop display + user duplicates. */
async function consolidateAbandonmentCaseIdentity(): Promise<void> {
  const table = 'employeeabandonmentcases';
  if (!(await columnExists(table, 'employeeId'))) return;

  if (!(await columnExists(table, 'employee_id'))) {
    if (await columnExists(table, 'employeePk')) {
      await sequelize.query(
        `ALTER TABLE \`${table}\` CHANGE COLUMN \`employeePk\` \`employee_id\` varchar(255) NULL`
      );
    } else {
      await sequelize.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`employee_id\` varchar(255) NULL AFTER \`id\``
      );
    }
  } else if (await columnExists(table, 'employeePk')) {
    await sequelize.query(
      `UPDATE \`${table}\` SET employee_id = COALESCE(employee_id, employeePk)
       WHERE employee_id IS NULL AND employeePk IS NOT NULL`
    );
  }

  const [rows]: unknown = await sequelize.query(
    `SELECT id, employeeId, employee_id, userId${
      (await columnExists(table, 'employeePk')) ? ', employeePk' : ''
    } FROM \`${table}\``
  );
  if (Array.isArray(rows)) {
    for (const row of rows as Record<string, string>) {
      if (row.employee_id) continue;
      const pk =
        (row.employeePk && String(row.employeePk)) ||
        (await findEmployeePkByDisplayId(String(row.employeeId ?? ''))) ||
        (await findEmployeePkByUserId(String(row.userId ?? '')));
      if (pk) {
        await sequelize.query(`UPDATE \`${table}\` SET employee_id = ? WHERE id = ?`, {
          replacements: [pk, row.id],
        });
      }
    }
  }

  await dropFkIfExists(table, 'employeeId');
  await dropFkIfExists(table, 'userId');
  await dropFkIfExists(table, 'employeePk');
  await dropColumnIfExists(table, 'userId');
  await dropColumnIfExists(table, 'employeeId');
  await dropColumnIfExists(table, 'employeePk');
}

/**
 * Collapse duplicate userId + employeeId columns to a single canonical reference.
 * Portal tables keep userId; HR/offboarding tables keep employee_id → employees.id.
 */
export async function ensureSchemaIdentityCleanup(): Promise<void> {
  await dropOvertimeRequestEmployeeId();
  await dropPayslipEmployeeId();
  await dropEmployeeFaceProfilesTable();
  await dropSensitiveChangeDisplayEmployeeId();
  await consolidatePayrollDeductionIdentity();
  await consolidateFinalSettlementIdentity();
  await consolidateAbandonmentCaseIdentity();
}

/** Resolve display badge for API responses after employee_id-only storage. */
export { findDisplayIdByEmployeePk, findUserIdByEmployeePk };
