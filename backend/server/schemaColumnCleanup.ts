import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function dropColumnIfExists(table: string, column: string): Promise<boolean> {
  if (!(await columnExists(table, column))) return false;
  await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  console.log(`[schema-cleanup] Dropped ${table}.${column}`);
  return true;
}

async function mergeColumnIfBothExist(
  table: string,
  target: string,
  source: string
): Promise<void> {
  if (!(await columnExists(table, target)) || !(await columnExists(table, source))) return;
  await sequelize.query(
    `UPDATE \`${table}\` SET \`${target}\` = COALESCE(\`${target}\`, \`${source}\`)
     WHERE \`${source}\` IS NOT NULL`
  );
}

async function dropEmployeesReportingManagerId(): Promise<void> {
  const table = 'employees';
  const column = 'reporting_manager_id';
  if (!(await columnExists(table, column))) return;
  const [fkRows]: unknown = await sequelize.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: [table, column] }
  );
  if (Array.isArray(fkRows)) {
    for (const row of fkRows as { CONSTRAINT_NAME: string }[]) {
      try {
        await sequelize.query(
          `ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
        );
      } catch {
        /* ignore */
      }
    }
  }
  await dropColumnIfExists(table, column);
}

/** Remove denormalized head count — always computed live from employees. */
async function dropDepartmentsHeadCount(): Promise<void> {
  await dropColumnIfExists('departments', 'headCount');
}

/** Unused placeholder on abandonment cases. */
async function dropAbandonmentDocumentsJson(): Promise<void> {
  await dropColumnIfExists('employeeabandonmentcases', 'documentsJson');
}

/** Prefer snake_case created_at/updated_at; drop duplicate Sequelize camelCase columns. */
async function consolidateEmployeeTimestampColumns(): Promise<void> {
  await mergeColumnIfBothExist('employees', 'created_at', 'createdAt');
  await mergeColumnIfBothExist('employees', 'updated_at', 'updatedAt');
  await dropColumnIfExists('employees', 'createdAt');
  await dropColumnIfExists('employees', 'updatedAt');
}

async function consolidateEmployeeDependentTimestampColumns(): Promise<void> {
  if (!(await columnExists('employeedependents', 'updated_at'))) {
    await sequelize.query(
      `ALTER TABLE \`employeedependents\`
       ADD COLUMN \`updated_at\` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
    );
  }
  await mergeColumnIfBothExist('employeedependents', 'created_at', 'createdAt');
  await dropColumnIfExists('employeedependents', 'createdAt');
  await dropColumnIfExists('employeedependents', 'updatedAt');
}

async function dropAppendOnlyDuplicateTimestamps(): Promise<void> {
  for (const table of ['employeestatushistories', 'historyemployee'] as const) {
    await dropColumnIfExists(table, 'createdAt');
    await dropColumnIfExists(table, 'updatedAt');
  }
}

/** remark duplicated notes on employee_movements. */
async function dropEmployeeMovementRemarkColumn(): Promise<void> {
  if (!(await columnExists('employee_movements', 'remark'))) return;
  if (await columnExists('employee_movements', 'notes')) {
    await sequelize.query(
      `UPDATE employee_movements
       SET notes = COALESCE(NULLIF(TRIM(notes), ''), remark)
       WHERE remark IS NOT NULL AND TRIM(remark) <> ''
         AND (notes IS NULL OR TRIM(notes) = '')`
    );
  }
  await dropColumnIfExists('employee_movements', 'remark');
}

/** department_id is canonical; departmentId was a duplicate camelCase column. */
async function consolidatePositionDepartmentColumn(): Promise<void> {
  await mergeColumnIfBothExist('positions', 'department_id', 'departmentId');
  await dropColumnIfExists('positions', 'departmentId');
}

/** salary range uses salary_min/salary_max; legacy salary column is redundant. */
async function dropPositionLegacySalaryColumn(): Promise<void> {
  if (!(await columnExists('positions', 'salary'))) return;
  if (await columnExists('positions', 'salary_min')) {
    await sequelize.query(
      `UPDATE positions
       SET salary_min = COALESCE(NULLIF(salary_min, 0), salary, 0),
           salary_max = COALESCE(NULLIF(salary_max, 0), salary, salary_min, 0)
       WHERE salary IS NOT NULL`
    );
  }
  await dropColumnIfExists('positions', 'salary');
}

async function consolidateLeaveTypeLegacyColumns(): Promise<void> {
  await mergeColumnIfBothExist('leavetypes', 'monthlyAccrualRate', 'accrualRate');
  await mergeColumnIfBothExist('leavetypes', 'maxCarryForward', 'carryoverLimit');
  await dropColumnIfExists('leavetypes', 'accrualRate');
  await dropColumnIfExists('leavetypes', 'carryoverLimit');
}

/**
 * Drop unused / duplicate columns after data is merged into canonical fields.
 * Safe to re-run — each step checks information_schema first.
 */
export async function ensureSchemaColumnCleanup(): Promise<void> {
  await dropDepartmentsHeadCount();
  await dropAbandonmentDocumentsJson();
  await dropEmployeesReportingManagerId();
  await consolidateEmployeeTimestampColumns();
  await consolidateEmployeeDependentTimestampColumns();
  await dropAppendOnlyDuplicateTimestamps();
  await dropEmployeeMovementRemarkColumn();
  await consolidatePositionDepartmentColumn();
  await dropPositionLegacySalaryColumn();
  await consolidateLeaveTypeLegacyColumns();
}
