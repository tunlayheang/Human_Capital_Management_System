import { Employee, SalaryStructure, User, sequelize } from './db.js';
import { inferPaymentMethodFromBank, normalizePaymentMethod } from './paymentMethod.js';

/** Payload keys that belong on salarystructures, not employees. */
export const SALARY_PAYLOAD_KEYS = [
  'salary_type',
  'base_salary',
  'currency',
  'payment_day',
  'bank_name',
  'bank_account_number',
  'payment_method',
  'tax_id',
  'nssf_id',
  'tax_dependents',
  'nssf_enrolled',
] as const;

const EMPLOYEE_SALARY_COLUMNS = [
  'salary_type',
  'base_salary',
  'currency',
  'payment_day',
  'bank_name',
  'bank_account_number',
  'payment_method',
  'tax_id',
] as const;

export type SalaryPayload = Partial<{
  salary_type: string;
  base_salary: number;
  currency: string;
  payment_day: number | null;
  bank_name: string | null;
  bank_account_number: string | null;
  payment_method: string | null;
  tax_id: string | null;
  nssf_id: string | null;
  tax_dependents: number;
  nssf_enrolled: boolean;
}>;

export function splitSalaryPayload(
  body: Record<string, unknown>
): { salary: SalaryPayload; employee: Record<string, unknown> } {
  const salary: SalaryPayload = {};
  const employee: Record<string, unknown> = { ...body };
  for (const key of SALARY_PAYLOAD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      (salary as Record<string, unknown>)[key] = body[key];
      delete employee[key];
    }
  }
  return { salary, employee };
}

export function mergeCompensationIntoEmployee(
  employeePlain: Record<string, unknown>,
  structurePlain?: Record<string, unknown> | null
): Record<string, unknown> {
  if (!structurePlain) return { ...employeePlain };
  return {
    ...employeePlain,
    salary_type: structurePlain.salary_type ?? 'monthly',
    base_salary: structurePlain.base_salary ?? 0,
    currency: structurePlain.currency ?? 'USD',
    payment_day: structurePlain.payment_day ?? null,
    bank_name: structurePlain.bank_name ?? null,
    bank_account_number: structurePlain.bank_account_number ?? null,
    payment_method: structurePlain.payment_method ?? 'bank',
    tax_id: structurePlain.tax_id ?? null,
    nssf_id: structurePlain.nssf_id ?? null,
    tax_dependents: structurePlain.tax_dependents ?? 0,
    nssf_enrolled: structurePlain.nssf_enrolled !== false,
    salary_structure: structurePlain,
  };
}

export async function loadSalaryStructureForEmployeeId(
  employeeRowId: string
): Promise<Record<string, unknown> | null> {
  const row = await SalaryStructure.findByPk(employeeRowId);
  if (!row) return null;
  return row.get({ plain: true }) as Record<string, unknown>;
}

export async function upsertSalaryStructure(
  employeeRowId: string,
  payload: SalaryPayload,
  options?: {
    changedBy?: string | null;
    changeReason?: string | null;
    effectiveFrom?: string | null;
    /** Skip effective-date guard (e.g. seed scripts, initial hire bootstrap). */
    skipEffectiveDateGuard?: boolean;
  }
): Promise<void> {
  if (!payload || Object.keys(payload).length === 0) return;

  const existing = await SalaryStructure.findByPk(employeeRowId);
  const isUpdate = Boolean(existing);
  let effectiveFrom = options?.effectiveFrom?.slice(0, 10) ?? null;
  // Brand-new compensation row (or explicit bootstrap) never requires a payroll change date.
  const skipGuard = Boolean(options?.skipEffectiveDateGuard) || !isUpdate;
  if (isUpdate && !skipGuard) {
    if (!effectiveFrom) {
      const { MasterDataEffectiveDateRequiredError } = await import(
        './payroll/payrollMasterDataGuard.js'
      );
      throw new MasterDataEffectiveDateRequiredError(
        'Effective date is required when updating employee compensation.'
      );
    }
    const { assertPayrollMasterDataEditableForEffectiveDate } = await import(
      './payroll/payrollMasterDataGuard.js'
    );
    await assertPayrollMasterDataEditableForEffectiveDate(effectiveFrom);
  } else if (!effectiveFrom) {
    effectiveFrom = new Date().toISOString().slice(0, 10);
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (payload.salary_type !== undefined) patch.salary_type = payload.salary_type || 'monthly';
  if (payload.base_salary !== undefined) patch.base_salary = payload.base_salary;
  if (payload.currency !== undefined) patch.currency = payload.currency || 'USD';
  if (payload.payment_day !== undefined) patch.payment_day = payload.payment_day;
  if (payload.bank_name !== undefined) patch.bank_name = payload.bank_name;
  if (payload.bank_account_number !== undefined) {
    patch.bank_account_number = payload.bank_account_number;
  }
  if (payload.payment_method !== undefined) {
    patch.payment_method = normalizePaymentMethod(payload.payment_method);
  }
  if (payload.tax_id !== undefined) patch.tax_id = payload.tax_id;
  if (payload.nssf_id !== undefined) patch.nssf_id = payload.nssf_id;
  if (payload.tax_dependents !== undefined) patch.tax_dependents = payload.tax_dependents;
  if (payload.nssf_enrolled !== undefined) patch.nssf_enrolled = payload.nssf_enrolled;

  if (existing) {
    const before = existing.get({ plain: true }) as Record<string, unknown>;
    await existing.update(patch);
    const after = existing.get({ plain: true }) as Record<string, unknown>;
    const { recordSalaryStructureChange } = await import('./salaryStructureHistoryService.js');
    await recordSalaryStructureChange({
      employeeRowId,
      previous: before,
      next: after,
      changedBy: options?.changedBy ?? null,
      changeReason: options?.changeReason ?? null,
      effectiveFrom,
    });
    return;
  }

  if (patch.base_salary === undefined) {
    patch.base_salary = 0;
  }
  await SalaryStructure.create({
    employee_id: employeeRowId,
    salary_type: 'monthly',
    currency: 'USD',
    tax_dependents: 0,
    nssf_enrolled: true,
    created_at: new Date(),
    ...patch,
  } as any);
  const created = await SalaryStructure.findByPk(employeeRowId);
  if (created) {
    const { recordSalaryStructureChange } = await import('./salaryStructureHistoryService.js');
    await recordSalaryStructureChange({
      employeeRowId,
      previous: null,
      next: created.get({ plain: true }) as Record<string, unknown>,
      changedBy: options?.changedBy ?? null,
      changeReason: options?.changeReason ?? 'Initial compensation',
      effectiveFrom,
    });
  }
}

export async function bulkLoadSalaryStructures(
  employeeRowIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(employeeRowIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return map;
  const { Op } = await import('sequelize');
  const rows = await SalaryStructure.findAll({
    where: { employee_id: { [Op.in]: ids } },
  });
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    map.set(String(plain.employee_id), plain);
  }
  return map;
}

export async function attachCompensationToEmployeeRows(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = rows.map((r) => String(r.id || '')).filter(Boolean);
  const byId = await bulkLoadSalaryStructures(ids);
  return rows.map((r) => mergeCompensationIntoEmployee(r, byId.get(String(r.id)) ?? null));
}

/** Active employees from the HR employee list with portal login — excludes system admin users. */
let payrollCohortCache: {
  fetchedAt: number;
  rows: Array<{ userId: string; employee: Record<string, unknown> }>;
} | null = null;
const PAYROLL_COHORT_CACHE_MS = 60_000;

export async function loadActiveEmployeesForPayroll(options?: {
  skipCache?: boolean;
}): Promise<Array<{ userId: string; employee: Record<string, unknown> }>> {
  if (
    !options?.skipCache &&
    payrollCohortCache &&
    Date.now() - payrollCohortCache.fetchedAt < PAYROLL_COHORT_CACHE_MS
  ) {
    return payrollCohortCache.rows;
  }

  const { Op } = await import('sequelize');
  const { isEligibleForPayrollRun } = await import('./payroll/employeePayrollEligibility.js');
  const { bulkFindPortalUsersForEmployees, portalLoginIsActive } = await import('./userAuth.js');

  const employeeRows = await Employee.findAll({
    where: {
      status: { [Op.in]: ['active', 'pending_approval'] },
    },
  });

  const plains = employeeRows.map(
    (r) => r.get({ plain: true }) as Record<string, unknown>
  );
  const employeeIds = plains
    .map((r) => String(r.id ?? '').trim())
    .filter(Boolean);
  const [structures, portalUsersByPk] = await Promise.all([
    bulkLoadSalaryStructures(employeeIds),
    bulkFindPortalUsersForEmployees(
      plains.map((p) => ({
        id: String(p.id ?? ''),
        employee_id: String(p.employee_id ?? ''),
        email: p.email,
        phone: p.phone,
      }))
    ),
  ]);

  const out: Array<{ userId: string; employee: Record<string, unknown> }> = [];
  const seenUserIds = new Set<string>();

  for (const plain of plains) {
    const pk = String(plain.id ?? '').trim();
    const userPlain = portalUsersByPk.get(pk);
    if (!userPlain) continue;

    if (!portalLoginIsActive(userPlain as { isActive?: boolean; status?: string })) continue;
    if (!isEligibleForPayrollRun({ employee: plain, portalUser: userPlain })) continue;

    const userId = String(userPlain.id ?? '').trim();
    if (!userId || seenUserIds.has(userId)) continue;

    seenUserIds.add(userId);
    out.push({
      userId,
      employee: mergeCompensationIntoEmployee(plain, structures.get(pk) ?? null),
    });
  }

  const { attachTaxDependentsToPayrollEmployees } = await import('./employeeChildrenService.js');
  try {
    const withDependents = await attachTaxDependentsToPayrollEmployees(
      out.map((row) => row.employee)
    );
    for (let i = 0; i < out.length; i++) {
      out[i]!.employee = withDependents[i]!;
    }
  } catch (depErr) {
    console.warn(
      '[payroll] Tax dependents batch attach skipped:',
      (depErr as Error)?.message || depErr
    );
  }

  payrollCohortCache = { fetchedAt: Date.now(), rows: out };
  return out;
}

export function invalidatePayrollCohortCache(): void {
  payrollCohortCache = null;
}

export async function findEmployeeWithCompensation(userId: string): Promise<any | null> {
  const { findEmployeeByUserId } = await import('./employeeAttendanceSchedule.js');
  const employee = await findEmployeeByUserId(userId);
  if (!employee) return null;
  const plain = employee.get ? employee.get({ plain: true }) : employee;
  const structure = await loadSalaryStructureForEmployeeId(String(plain.id));
  return mergeCompensationIntoEmployee(plain, structure);
}

async function dropDuplicateSalaryStructureTimestampColumns(): Promise<void> {
  const [tableCols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarystructures'`
  )) as [{ COLUMN_NAME: string }[], unknown];

  const names = new Set((tableCols ?? []).map((c) => c.COLUMN_NAME));
  const dropped: string[] = [];
  if (names.has('createdAt')) {
    await sequelize.query(`ALTER TABLE salarystructures DROP COLUMN createdAt`);
    dropped.push('createdAt');
  }
  if (names.has('updatedAt')) {
    await sequelize.query(`ALTER TABLE salarystructures DROP COLUMN updatedAt`);
    dropped.push('updatedAt');
  }
  if (dropped.length) {
    console.log(`[db] salarystructures: dropped duplicate ${dropped.join(', ')}.`);
  }
}

async function ensureSalaryStructurePaymentMethodColumn(): Promise<void> {
  const [tableCols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarystructures'`
  )) as [{ COLUMN_NAME: string }[], unknown];

  const names = new Set((tableCols ?? []).map((c) => c.COLUMN_NAME));
  if (!names.has('payment_method')) {
    await sequelize.query(
      `ALTER TABLE salarystructures
       ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'bank' AFTER bank_account_number`
    );
    await sequelize.query(
      `UPDATE salarystructures
       SET payment_method = 'cash'
       WHERE (bank_name IS NULL OR TRIM(bank_name) = '')
         AND (bank_account_number IS NULL OR TRIM(bank_account_number) = '')`
    );
    console.log('[db] salarystructures.payment_method column added.');
  }
}

export async function ensureSalaryStructureSchema(): Promise<void> {
  await SalaryStructure.sync();
  await dropDuplicateSalaryStructureTimestampColumns();
  await ensureSalaryStructurePaymentMethodColumn();

  const [cols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'base_salary'`
  )) as [{ COLUMN_NAME: string }[], unknown];

  if (!cols?.length) return;

  const employees = await Employee.findAll({
    attributes: ['id', ...EMPLOYEE_SALARY_COLUMNS],
    raw: true,
  });

  for (const emp of employees as Record<string, unknown>[]) {
    const rowId = String(emp.id);
    const existing = await SalaryStructure.findByPk(rowId);
    if (existing) continue;
    await SalaryStructure.create({
      employee_id: rowId,
      salary_type: emp.salary_type || 'monthly',
      base_salary: emp.base_salary ?? 0,
      currency: emp.currency || 'USD',
      payment_day: emp.payment_day ?? null,
      bank_name: emp.bank_name ?? null,
      bank_account_number: emp.bank_account_number ?? null,
      tax_id: emp.tax_id ?? null,
      tax_dependents: 0,
      nssf_enrolled: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);
  }

  for (const col of EMPLOYEE_SALARY_COLUMNS) {
    await sequelize.query(`ALTER TABLE employees DROP COLUMN \`${col}\``);
  }

  console.log(
    '[db] Migrated employees salary columns → salarystructures and dropped legacy columns.'
  );
}
