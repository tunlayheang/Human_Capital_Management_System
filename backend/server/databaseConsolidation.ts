/**
 * Safe, idempotent database consolidations — migrate legacy data then drop redundant tables.
 * Runs on server startup and via `npm run db:consolidate`.
 */
import { Op, QueryTypes } from 'sequelize';
import {
  sequelize,
  Employee,
  EmployeeSetting,
  EmployeeAllowanceAssignment,
  AllowanceType,
} from './db.js';

export const ONBOARDING_DEDUCTIONS_KEY = 'payroll.onboarding_deductions';
export const CUSTOM_ALLOWANCE_TYPE_ID = 'at-other';
export const CUSTOM_ALLOWANCE_TYPE_CODE = 'OTHER';

export type OnboardingDeductionRow = {
  id: string;
  deduction_name: string;
  amount: number;
  is_recurring: boolean;
  effective_from: string;
  effective_to?: string | null;
};

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { table } }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function dropTableIfExists(table: string): Promise<boolean> {
  if (!(await tableExists(table))) return false;
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
    console.log(`[db-consolidate] Dropped table ${table}.`);
    return true;
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

export async function ensureCustomAllowanceType(): Promise<void> {
  const existing = await AllowanceType.findByPk(CUSTOM_ALLOWANCE_TYPE_ID);
  if (existing) return;
  await AllowanceType.create({
    id: CUSTOM_ALLOWANCE_TYPE_ID,
    code: CUSTOM_ALLOWANCE_TYPE_CODE,
    name: 'Other Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    active: true,
    description: 'Custom onboarding or ad-hoc allowance (migrated from legacy employeeallowances).',
  } as never);
}

async function resolveEmployeeInternalId(employeeRef: string): Promise<string | null> {
  const ref = String(employeeRef ?? '').trim();
  if (!ref) return null;
  const emp = await Employee.findOne({
    where: { [Op.or]: [{ id: ref }, { employee_id: ref }] },
    attributes: ['id'],
  });
  return emp ? String((emp.get({ plain: true }) as { id: string }).id) : null;
}

/** employeeallowances → employee_allowance_assignments (payroll allowance engine). */
export async function migrateLegacyEmployeeAllowancesIfNeeded(): Promise<number> {
  if (!(await tableExists('employeeallowances'))) return 0;

  await ensureCustomAllowanceType();

  const rows = (await sequelize.query(
    `SELECT id, employee_id, allowance_name, amount, is_recurring, effective_from, effective_to
     FROM employeeallowances ORDER BY id ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const internalId = await resolveEmployeeInternalId(String(row.employee_id ?? ''));
    if (!internalId) continue;

    const assignmentId = `eaa-mig-${row.id}`;
    const existing = await EmployeeAllowanceAssignment.findByPk(assignmentId);
    if (existing) {
      migrated++;
      continue;
    }

    const name = String(row.allowance_name ?? 'Allowance').trim();
    const amount = Number(row.amount) || 0;
    const effectiveTo = row.effective_to ? String(row.effective_to).slice(0, 10) : null;
    const active = !effectiveTo || new Date(effectiveTo) >= new Date();

    await EmployeeAllowanceAssignment.create({
      id: assignmentId,
      employee_id: internalId,
      allowance_type_id: CUSTOM_ALLOWANCE_TYPE_ID,
      custom_amount: amount,
      start_date: row.effective_from
        ? String(row.effective_from).slice(0, 10)
        : null,
      end_date: effectiveTo,
      active,
      notes: name,
    } as never);
    migrated++;
  }

  if (migrated) {
    console.log(`[db-consolidate] Migrated ${migrated} legacy employee allowance row(s).`);
  }
  return migrated;
}

/** employeedeductions → employeesettings JSON (payroll.onboarding_deductions). */
export async function migrateLegacyEmployeeDeductionsIfNeeded(): Promise<number> {
  if (!(await tableExists('employeedeductions'))) return 0;

  const rows = (await sequelize.query(
    `SELECT id, employee_id, deduction_name, amount, is_recurring, effective_from, effective_to
     FROM employeedeductions ORDER BY id ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  const byEmployee = new Map<string, OnboardingDeductionRow[]>();
  for (const row of rows) {
    const internalId = await resolveEmployeeInternalId(String(row.employee_id ?? ''));
    if (!internalId) continue;
    const list = byEmployee.get(internalId) ?? [];
    list.push({
      id: `ded-mig-${row.id}`,
      deduction_name: String(row.deduction_name ?? 'Deduction'),
      amount: Number(row.amount) || 0,
      is_recurring: row.is_recurring !== 0 && row.is_recurring !== false,
      effective_from: row.effective_from
        ? String(row.effective_from).slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      effective_to: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    });
    byEmployee.set(internalId, list);
  }

  let migrated = 0;
  for (const [employeeId, deductions] of byEmployee) {
    const existing = await EmployeeSetting.findOne({
      where: { employeeId, settingKey: ONBOARDING_DEDUCTIONS_KEY },
    });
    if (existing) {
      const current = (existing.get('value') as OnboardingDeductionRow[]) ?? [];
      const merged = [...current];
      for (const d of deductions) {
        if (!merged.some((m) => m.id === d.id)) merged.push(d);
      }
      await existing.update({ value: merged });
    } else {
      await EmployeeSetting.create({
        id: `emp-set-ded-${employeeId}`,
        employeeId,
        settingKey: ONBOARDING_DEDUCTIONS_KEY,
        value: deductions,
      } as never);
    }
    migrated += deductions.length;
  }

  if (migrated) {
    console.log(`[db-consolidate] Migrated ${migrated} legacy employee deduction row(s).`);
  }
  return migrated;
}

export async function listOnboardingDeductions(employeeInternalId: string): Promise<OnboardingDeductionRow[]> {
  const row = await EmployeeSetting.findOne({
    where: { employeeId: employeeInternalId, settingKey: ONBOARDING_DEDUCTIONS_KEY },
  });
  const value = row?.get('value');
  return Array.isArray(value) ? (value as OnboardingDeductionRow[]) : [];
}

export async function saveOnboardingDeductions(
  employeeInternalId: string,
  deductions: OnboardingDeductionRow[]
): Promise<void> {
  const existing = await EmployeeSetting.findOne({
    where: { employeeId: employeeInternalId, settingKey: ONBOARDING_DEDUCTIONS_KEY },
  });
  if (existing) {
    await existing.update({ value: deductions });
    return;
  }
  await EmployeeSetting.create({
    id: `emp-set-ded-${employeeInternalId}`,
    employeeId: employeeInternalId,
    settingKey: ONBOARDING_DEDUCTIONS_KEY,
    value: deductions,
  } as never);
}

/** Drop tables replaced by consolidated storage. */
export async function dropConsolidatedLegacyTables(): Promise<string[]> {
  const dropped: string[] = [];
  if (await dropTableIfExists('employeeallowances')) dropped.push('employeeallowances');
  if (await dropTableIfExists('employeedeductions')) dropped.push('employeedeductions');
  return dropped;
}

/** Map allowance assignments to legacy API shape for employee profile. */
export function mapAssignmentsToLegacyAllowances(
  assignments: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return assignments.map((a) => ({
    id: a.id,
    employee_id: a.employee_id,
    allowance_name: a.notes || 'Allowance',
    amount: a.custom_amount ?? 0,
    is_recurring: a.active !== false,
    effective_from: a.start_date,
    effective_to: a.end_date,
    source: 'employee_allowance_assignments',
  }));
}

export function mapOnboardingDeductionsToLegacy(
  deductions: OnboardingDeductionRow[],
  employeeId: string
): Array<Record<string, unknown>> {
  return deductions.map((d) => ({
    id: d.id,
    employee_id: employeeId,
    deduction_name: d.deduction_name,
    amount: d.amount,
    is_recurring: d.is_recurring,
    effective_from: d.effective_from,
    effective_to: d.effective_to ?? null,
    source: 'employeesettings',
  }));
}

/** Run all safe consolidations (migrate data, then drop redundant tables). */
export async function ensureDatabaseConsolidation(): Promise<void> {
  try {
    const { dropLegacyRolesTableIfNeeded } = await import('./fixedSystemRoles.js');
    await dropLegacyRolesTableIfNeeded();
    const { ensurePersonalHubSchema } = await import('./personalAnalytics/personalHubSchema.js');
    await ensurePersonalHubSchema();
    await migrateLegacyEmployeeAllowancesIfNeeded();
    await migrateLegacyEmployeeDeductionsIfNeeded();
    const consolidated = await dropConsolidatedLegacyTables();
    if (consolidated.length) {
      console.log(`[db-consolidate] Dropped consolidated tables: ${consolidated.join(', ')}`);
    }

    const { dropUnusedTables } = await import('../scripts/lib/dropUnusedTables.js');
    const dropped = await dropUnusedTables(sequelize);
    if (dropped.length) {
      console.log(`[db-consolidate] Dropped unused/legacy tables: ${dropped.join(', ')}`);
    }

    const { ensureTableConsolidations } = await import('./tableConsolidationService.js');
    await ensureTableConsolidations();
  } catch (err) {
    console.warn(
      '[db-consolidate] Consolidation warning:',
      err instanceof Error ? err.message : err
    );
  }
}
